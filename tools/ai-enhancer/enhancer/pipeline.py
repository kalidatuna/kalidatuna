"""The enhancement pipeline: denoise, upscale, recover detail, restore faces, sharpen."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, fields
from typing import Callable

import cv2
import numpy as np
import torch
import torch.nn.functional as F

from . import models
from .faces import FaceDetector, paste_all, restore_all
from .imageio import to_uint8
from .tiling import Cancelled, descriptor_fn, run_tiled

Progress = Callable[[str, float], None]

MAX_SCALE = 16.0
PREVIEW_CACHE_ITEMS = 8  # AI results kept for region previews


@dataclass
class Settings:
    model: str = "standard"  # key in models.UPSCALERS
    scale: float = 2.0  # output size / input size; ignored when width or height is set
    width: int = 0  # exact output width; 0 = use scale
    height: int = 0  # exact output height; 0 = use scale
    noise: float = 0.5  # 0..1, noise reduction built into the "standard" model
    denoise_model: str = ""  # "", "normal" or "strong": SCUNet pre-pass at the input size
    denoise_strength: float = 1.0  # 0..1 blend of the denoise pre-pass
    recover_detail: float = 0.0  # 0..1 blend of the original (resized) back into the result
    face_model: str = ""  # "", "gfpgan" or "codeformer"
    face_strength: float = 0.8  # 0..1 blend of restored faces
    face_fidelity: float = 0.7  # CodeFormer only: 0 = most restoration, 1 = closest to input
    sharpen: float = 0.0  # 0..1 unsharp mask amount
    grain: float = 0.0  # 0..1 film grain, stronger in shadows; hides flat "painted" areas and banding
    tile: int = 0  # input tile size; 0 = automatic (largest that fits in GPU memory)
    device: str = "auto"

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Settings":
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in d.items() if k in names})

    def output_size(self, w: int, h: int) -> tuple[int, int]:
        if self.width and self.height:
            return self.width, self.height
        if self.width:
            return self.width, max(1, round(h * self.width / w))
        if self.height:
            return max(1, round(w * self.height / h)), self.height
        return max(1, round(w * self.scale)), max(1, round(h * self.scale))


def to_tensor(rgb: np.ndarray, device) -> torch.Tensor:
    """HxWx3 float32 or uint8 array -> (1, 3, H, W) float32 tensor in [0, 1] on ``device``."""
    t = torch.from_numpy(np.ascontiguousarray(rgb)).to(device)
    t = t.float() / 255.0 if t.dtype == torch.uint8 else t.float()
    return t.permute(2, 0, 1)[None].contiguous()


def to_numpy(t: torch.Tensor) -> np.ndarray:
    return t[0].permute(1, 2, 0).float().cpu().numpy()


def to_uint8_array(t: torch.Tensor) -> np.ndarray:
    """Convert on the device, so only a quarter of the bytes cross to the CPU."""
    return (t[0].clamp(0, 1) * 255.0 + 0.5).to(torch.uint8).permute(1, 2, 0).contiguous().cpu().numpy()


def resize(x: torch.Tensor, w: int, h: int) -> torch.Tensor:
    if x.shape[-1] == w and x.shape[-2] == h:
        return x
    return F.interpolate(x, size=(h, w), mode="bicubic", align_corners=False, antialias=True)


_gauss_cache: dict = {}


def gaussian_blur(x: torch.Tensor, sigma: float) -> torch.Tensor:
    key = (sigma, x.device)
    if key not in _gauss_cache:
        r = max(1, int(np.ceil(3 * sigma)))
        k = torch.exp(-torch.arange(-r, r + 1, dtype=torch.float32) ** 2 / (2 * sigma * sigma))
        _gauss_cache[key] = (k / k.sum()).to(x.device)
    k = _gauss_cache[key]
    r = (k.numel() - 1) // 2
    c = x.shape[1]
    x = F.pad(x, (r, r, r, r), mode="reflect")
    x = F.conv2d(x, k.view(1, 1, 1, -1).expand(c, 1, 1, -1), groups=c)
    return F.conv2d(x, k.view(1, 1, -1, 1).expand(c, 1, -1, 1), groups=c)


def add_grain(x: torch.Tensor, amount: float, seed: int = 0, size: float = 0.7) -> torch.Tensor:
    """Luminance film grain. ``amount`` 1.0 is a standard deviation of 4% in the shadows.

    Video frames pass their frame number as ``seed`` so the grain moves like
    film; previews use a fixed seed so they do not flicker.
    """
    if amount <= 0:
        return x
    gen = torch.Generator(device=x.device).manual_seed(int(seed))
    g = torch.randn((1, 1, *x.shape[-2:]), generator=gen, device=x.device)
    g = gaussian_blur(g, size)
    g = g / g.std().clamp_min(1e-6)
    lum = 0.299 * x[:, 0:1] + 0.587 * x[:, 1:2] + 0.114 * x[:, 2:3]
    return x + g * (0.6 + 0.4 * (1.0 - lum)) * (amount * 0.04)


def unsharp(x: torch.Tensor, amount: float, radius: float = 1.2) -> torch.Tensor:
    if amount <= 0:
        return x
    return x + (x - gaussian_blur(x, radius)) * (amount * 1.5)


class Pipeline:
    def __init__(self, device: str = "auto"):
        self.device = models.pick_device(device)
        self.cache = models.ModelCache(self.device)
        self._detector: FaceDetector | None = None
        self.download_progress: Callable[[str, int, int], None] | None = None

    def _dl(self, name: str):
        if not self.download_progress:
            return None
        cb = self.download_progress
        return lambda done, total: cb(name, done, total)

    def detector(self) -> FaceDetector:
        if self._detector is None:
            self._detector = FaceDetector(models.ensure_file("YuNet", self._dl("YuNet")))
        return self._detector

    def passes_needed(self, s: Settings, w: int, h: int) -> int:
        ow, oh = s.output_size(w, h)
        target = max(ow / w, oh / h)
        native = models.UPSCALERS[s.model].scale
        n = max(1, math.ceil(math.log(max(target, 1.0)) / math.log(native) - 1e-9))
        return min(n, 2)

    @staticmethod
    def base_key(s: Settings) -> tuple:
        """Settings that change the AI upscale result; the rest are cheap post-steps."""
        noise = round(s.noise, 2) if models.UPSCALERS[s.model].denoise_blend else 0.0
        den = (s.denoise_model, round(s.denoise_strength, 2)) if s.denoise_model else ("", 0.0)
        return (s.model, noise, den, s.tile)

    def upscale_t(self, x: torch.Tensor, s: Settings, progress: Progress | None = None,
                  cancel: Callable[[], bool] | None = None) -> torch.Tensor:
        """Clean up and AI-upscale ``x`` ((1, 3, H, W) on the device) to the output size."""
        h, w = x.shape[-2:]
        ow, oh = s.output_size(w, h)
        if max(ow / w, oh / h) > MAX_SCALE:
            raise ValueError(f"Scale above {MAX_SCALE:g}x is not supported")
        up = models.UPSCALERS[s.model]
        n_pass = self.passes_needed(s, w, h)
        weights = {f"upscale{i}": 3.0 for i in range(n_pass)}
        if s.denoise_model:
            weights["denoise"] = 1.0
        total_w = sum(weights.values())
        done_w = 0.0

        def stage_progress(name: str, label: str):
            def cb(done: int, total: int):
                if progress:
                    progress(label, (done_w + weights[name] * done / max(total, 1)) / total_w)
            return cb

        img = x
        if s.denoise_model:
            _, key = models.DENOISERS[s.denoise_model]
            desc = self.cache.get((key,), progress=self._dl(key))
            den = run_tiled(descriptor_fn(desc), img, 1, tile=max(s.tile, 384) if s.tile else 0, overlap=32,
                            progress=stage_progress("denoise", "Cleaning up"), cancel=cancel, auto_key=key)
            img = img + (den - img) * float(s.denoise_strength)
            done_w += weights["denoise"]

        blend = float(s.noise) if up.denoise_blend else 0.0
        desc = self.cache.get(up.files, blend, progress=self._dl(up.label))
        fn = descriptor_fn(desc)
        for i in range(n_pass):
            if cancel and cancel():
                raise Cancelled()
            img = run_tiled(fn, img.clamp(0, 1), up.scale, tile=s.tile, overlap=16,
                            progress=stage_progress(f"upscale{i}", f"Upscaling (pass {i + 1}/{n_pass})"),
                            cancel=cancel, auto_key=up.files)
            done_w += weights[f"upscale{i}"]
        return resize(img, ow, oh)

    def finish_t(self, base: torch.Tensor, src: np.ndarray, s: Settings, faces=None,
                 face_cache: dict | None = None, src_t: torch.Tensor | None = None,
                 seed: int = 0) -> torch.Tensor:
        """Recover detail, restore faces, and sharpen an upscaled image, on the device.

        ``src`` is the source as an HxWx3 float32 array (faces are cropped from
        it). ``faces`` skips face detection when the caller already has it.
        ``face_cache`` keeps restored face crops between calls on the same source.
        """
        oh, ow = base.shape[-2:]
        img = base
        if s.recover_detail > 0:
            if src_t is None:
                src_t = to_tensor(src, base.device)
            img = img + (resize(src_t, ow, oh) - img) * float(s.recover_detail)
        img = img.clamp(0, 1)
        if s.face_model and s.face_strength > 0:
            key = (s.face_model, round(s.face_fidelity, 2) if s.face_model == "codeformer" else 0.0)
            restored = face_cache.get(key) if face_cache is not None else None
            if restored is None:
                if faces is None:
                    faces = self.detector().detect(to_uint8(src))
                restored = []
                if faces:
                    _, mkey = models.FACE_MODELS[s.face_model]
                    fdesc = self.cache.get((mkey,), progress=self._dl(mkey))
                    restored = restore_all(src, faces, fdesc, s.face_model, s.face_fidelity)
                if face_cache is not None:
                    face_cache[key] = restored
            img = paste_all(img.clone(), src.shape, restored, s.face_strength)
        return add_grain(unsharp(img, s.sharpen), s.grain, seed).clamp(0, 1)

    @torch.inference_mode()
    def upscale(self, rgb: np.ndarray, s: Settings, progress: Progress | None = None,
                cancel: Callable[[], bool] | None = None) -> np.ndarray:
        """NumPy front end to :meth:`upscale_t` (HxWx3 float32 in [0, 1])."""
        return to_numpy(self.upscale_t(to_tensor(rgb, self.device), s, progress, cancel))

    @torch.inference_mode()
    def finish(self, base: np.ndarray, src: np.ndarray, s: Settings, faces=None,
               face_cache: dict | None = None) -> np.ndarray:
        """NumPy front end to :meth:`finish_t`."""
        return to_numpy(self.finish_t(to_tensor(base, self.device), src, s, faces, face_cache))

    @torch.inference_mode()
    def process(self, rgb: np.ndarray, s: Settings, alpha: np.ndarray | None = None,
                progress: Progress | None = None, cancel: Callable[[], bool] | None = None):
        """Enhance an HxWx3 float32 RGB image in [0, 1]. Returns ``(rgb, alpha)`` at the output size."""
        share = 0.85 if s.face_model else 1.0
        up_progress = (lambda label, f: progress(label, f * share)) if progress else None
        x = to_tensor(rgb, self.device)
        base = self.upscale_t(x, s, up_progress, cancel)
        if progress and s.face_model:
            progress("Restoring faces", share)
        img = to_numpy(self.finish_t(base, rgb, s, src_t=x))
        oh, ow = img.shape[:2]
        out_alpha = None
        if alpha is not None:
            out_alpha = np.clip(cv2.resize(alpha, (ow, oh), interpolation=cv2.INTER_CUBIC), 0, 1)
        if progress:
            progress("Done", 1.0)
        return img, out_alpha

    @torch.inference_mode()
    def process_frame(self, frame: np.ndarray, s: Settings, progress: Progress | None = None,
                      cancel: Callable[[], bool] | None = None, index: int = 0) -> np.ndarray:
        """Enhance one HxWx3 uint8 video frame and return a uint8 frame. Stays on the device."""
        x = to_tensor(frame, self.device)
        base = self.upscale_t(x, s, progress, cancel)
        faces = self.detector().detect(frame) if s.face_model and s.face_strength > 0 else None
        src = frame.astype(np.float32) / 255.0 if faces else frame
        return to_uint8_array(self.finish_t(base, src, s, faces=faces or [], src_t=x, seed=index))

    def preview(self, rgb: np.ndarray, s: Settings, rect: tuple[int, int, int, int],
                progress: Progress | None = None, cancel: Callable[[], bool] | None = None,
                cache: dict | None = None):
        """Process only ``rect`` (x, y, w, h in input pixels) of the image.

        Returns ``(patch, out_rect)`` where ``out_rect`` is the patch position
        in output pixels. Extra context around the rect avoids edge artifacts.
        ``cache`` keeps the AI result, so changing only the detail, sharpen or
        face settings re-renders the preview almost instantly.
        """
        h, w = rgb.shape[:2]
        ow, oh = s.output_size(w, h)
        sx, sy = ow / w, oh / h
        x, y, rw, rh = rect
        x, y = max(0, min(x, w - 1)), max(0, min(y, h - 1))
        rw, rh = max(1, min(rw, w - x)), max(1, min(rh, h - y))
        m = 16
        x0, y0 = max(0, x - m), max(0, y - m)
        x1, y1 = min(w, x + rw + m), min(h, y + rh + m)
        crop = rgb[y0:y1, x0:x1]
        cs = Settings.from_dict(s.to_dict())
        cs.width = max(1, round((x1 - x0) * sx))
        cs.height = max(1, round((y1 - y0) * sy))
        key = (self.base_key(cs), (x0, y0, x1, y1), (cs.width, cs.height))
        entry = cache.pop(key, None) if cache is not None else None
        if entry is None:
            with torch.inference_mode():
                entry = {"base": self.upscale_t(to_tensor(crop, self.device), cs, progress, cancel), "faces": {}}
        if cache is not None:
            cache[key] = entry  # most recently used last
            while len(cache) > PREVIEW_CACHE_ITEMS:
                cache.pop(next(iter(cache)))
        if progress:
            progress("Finishing", 0.99)
        with torch.inference_mode():
            out = to_numpy(self.finish_t(entry["base"], crop, cs, face_cache=entry["faces"]))
        ox, oy = round((x - x0) * sx), round((y - y0) * sy)
        pw, ph = round(rw * sx), round(rh * sy)
        patch = out[oy:oy + ph, ox:ox + pw]
        return patch, (round(x * sx), round(y * sy), patch.shape[1], patch.shape[0])
