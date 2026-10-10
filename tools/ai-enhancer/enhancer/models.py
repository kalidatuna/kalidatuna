"""Model registry, download cache, and loading.

Every model here is an openly published checkpoint downloaded from its
authors' release page and verified by SHA-256. No Topaz Labs files are used.
"""

from __future__ import annotations

import hashlib
import os
import threading
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

ProgressFn = Callable[[int, int], None]


@dataclass(frozen=True)
class ModelFile:
    key: str
    filename: str
    url: str
    sha256: str
    license: str


@dataclass(frozen=True)
class UpscaleModel:
    """A user-facing upscaling mode.

    ``files`` holds one checkpoint, or two when ``denoise_blend`` is set: the
    sharp checkpoint first and the denoising variant second. Their weights are
    interpolated to give a continuous noise-reduction control.
    """

    key: str
    label: str
    description: str
    files: tuple[str, ...]
    scale: int
    denoise_blend: bool = False


_RE = "https://github.com/xinntao/Real-ESRGAN/releases/download"

FILES: dict[str, ModelFile] = {
    f.key: f
    for f in [
        ModelFile(
            "realesr-general-x4v3",
            "realesr-general-x4v3.pth",
            f"{_RE}/v0.2.5.0/realesr-general-x4v3.pth",
            "8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292",
            "BSD-3-Clause",
        ),
        ModelFile(
            "realesr-general-wdn-x4v3",
            "realesr-general-wdn-x4v3.pth",
            f"{_RE}/v0.2.5.0/realesr-general-wdn-x4v3.pth",
            "1641f8c4464b9f097c9fdda5589273713f67cf59f3d909e0bd688f0cee269dca",
            "BSD-3-Clause",
        ),
        ModelFile(
            "RealESRGAN_x4plus",
            "RealESRGAN_x4plus.pth",
            f"{_RE}/v0.1.0/RealESRGAN_x4plus.pth",
            "4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1",
            "BSD-3-Clause",
        ),
        ModelFile(
            "RealESRGAN_x2plus",
            "RealESRGAN_x2plus.pth",
            f"{_RE}/v0.2.1/RealESRGAN_x2plus.pth",
            "49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb",
            "BSD-3-Clause",
        ),
        ModelFile(
            "RealESRGAN_x4plus_anime_6B",
            "RealESRGAN_x4plus_anime_6B.pth",
            f"{_RE}/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth",
            "f872d837d3c90ed2e05227bed711af5671a6fd1c9f7d7e91c911a61f155e99da",
            "BSD-3-Clause",
        ),
        ModelFile(
            "SwinIR-L-realSR-x4",
            "003_realSR_BSRGAN_DFOWMFC_s64w8_SwinIR-L_x4_GAN.pth",
            "https://github.com/JingyunLiang/SwinIR/releases/download/v0.0/"
            "003_realSR_BSRGAN_DFOWMFC_s64w8_SwinIR-L_x4_GAN.pth",
            "99adfa91350a84c99e946c1eb3d8fce34bc28f57d807b09dc8fe40a316328c0a",
            "Apache-2.0",
        ),
        ModelFile(
            "scunet-psnr",
            "scunet_color_real_psnr.pth",
            "https://github.com/cszn/KAIR/releases/download/v1.0/scunet_color_real_psnr.pth",
            "fa78899ba2caec9d235a900e91d96c689da71c42029230c2028b00f09f809c2e",
            "Apache-2.0",
        ),
        ModelFile(
            "scunet-gan",
            "scunet_color_real_gan.pth",
            "https://github.com/cszn/KAIR/releases/download/v1.0/scunet_color_real_gan.pth",
            "892c83f812c59173273b74f4f34a14ecaf57a2fdb68df056664589beb55c966e",
            "Apache-2.0",
        ),
        ModelFile(
            "GFPGANv1.4",
            "GFPGANv1.4.pth",
            "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth",
            "e2cd4703ab14f4d01fd1383a8a8b266f9a5833dacee8e6a79d3bf21a1b6be5ad",
            "Apache-2.0",
        ),
        ModelFile(
            "CodeFormer",
            "codeformer.pth",
            "https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth",
            "1009e537e0c2a07d4cabce6355f53cb66767cd4b4297ec7a4a64ca4b8a5684b7",
            "S-Lab License 1.0 (non-commercial use only)",
        ),
        ModelFile(
            "YuNet",
            "face_detection_yunet_2023mar.onnx",
            "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
            "face_detection_yunet/face_detection_yunet_2023mar.onnx",
            "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
            "MIT",
        ),
    ]
}

UPSCALERS: dict[str, UpscaleModel] = {
    m.key: m
    for m in [
        UpscaleModel(
            "standard",
            "Standard",
            "Balanced general-purpose model with an adjustable noise-reduction "
            "control. Fast, and works on most photos.",
            ("realesr-general-x4v3", "realesr-general-wdn-x4v3"),
            4,
            denoise_blend=True,
        ),
        UpscaleModel(
            "high-fidelity",
            "High Fidelity",
            "Transformer model (SwinIR-L) that keeps fine texture on good-quality "
            "sources. Slowest option.",
            ("SwinIR-L-realSR-x4",),
            4,
        ),
        UpscaleModel(
            "low-resolution",
            "Low Resolution / Heavy Recovery",
            "Strong GAN model (Real-ESRGAN x4plus) for small, blurry or heavily "
            "compressed images. Removes artifacts aggressively.",
            ("RealESRGAN_x4plus",),
            4,
        ),
        UpscaleModel(
            "standard-2x",
            "Standard 2x",
            "Real-ESRGAN x2plus. Gentler than the 4x models for 2x enlargements.",
            ("RealESRGAN_x2plus",),
            2,
        ),
        UpscaleModel(
            "art-cg",
            "Art & CG",
            "Tuned for illustrations, anime, and computer graphics with flat colors "
            "and clean lines.",
            ("RealESRGAN_x4plus_anime_6B",),
            4,
        ),
    ]
}

DENOISERS: dict[str, tuple[str, str]] = {
    "normal": ("Normal", "scunet-psnr"),
    "strong": ("Strong", "scunet-gan"),
}

FACE_MODELS: dict[str, tuple[str, str]] = {
    "gfpgan": ("GFPGAN v1.4 (natural)", "GFPGANv1.4"),
    "codeformer": ("CodeFormer (non-commercial license)", "CodeFormer"),
}


def model_dir() -> Path:
    env = os.environ.get("ENHANCER_MODEL_DIR")
    if env:
        return Path(env).expanduser()
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "ai-enhancer" / "models"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


_download_lock = threading.Lock()


def ensure_file(key: str, progress: ProgressFn | None = None) -> Path:
    """Return the local path of a model file, downloading and verifying it if needed."""
    spec = FILES[key]
    dest = model_dir() / spec.filename
    with _download_lock:
        if dest.exists():
            return dest
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        with urllib.request.urlopen(spec.url) as resp, tmp.open("wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            while chunk := resp.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                if progress:
                    progress(done, total)
        digest = _sha256(tmp)
        if digest != spec.sha256:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(
                f"Checksum mismatch for {spec.filename}: expected {spec.sha256}, got {digest}"
            )
        tmp.replace(dest)
        return dest


def pick_device(preference: str = "auto"):
    import torch

    if preference != "auto":
        return torch.device(preference)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


_spandrel_ready = False


def _loader():
    global _spandrel_ready
    import spandrel

    if not _spandrel_ready:
        import spandrel_extra_arches

        spandrel_extra_arches.install()
        _spandrel_ready = True
    return spandrel.ModelLoader()


def _read_state_dict(path: Path) -> dict:
    import spandrel

    return spandrel.canonicalize_state_dict(spandrel.ModelLoader().load_state_dict_from_file(path))


def load_descriptor(file_keys: tuple[str, ...], device, blend: float = 0.0, progress: ProgressFn | None = None):
    """Load a spandrel model descriptor.

    With two files, the weights are interpolated as ``(1 - blend) * a + blend * b``.
    This is the deep network interpolation used by Real-ESRGAN for its
    denoise-strength control.
    """
    paths = [ensure_file(k, progress) for k in file_keys]
    loader = _loader()
    if len(paths) == 1 or blend <= 0.0:
        desc = loader.load_from_file(paths[0])
    else:
        a = _read_state_dict(paths[0])
        b = _read_state_dict(paths[1])
        mixed = {k: (1.0 - blend) * a[k] + blend * b[k] for k in a}
        desc = loader.load_from_state_dict(mixed)
    desc.to(device).eval()
    if device.type == "cuda" and desc.supports_half:
        desc.half()
    return desc


class ModelCache:
    """Keeps recently used models in memory, keyed by file set and blend."""

    def __init__(self, device, max_items: int = 4):
        self.device = device
        self.max_items = max_items
        self._items: dict[tuple, object] = {}
        self._lock = threading.Lock()

    def get(self, file_keys: tuple[str, ...], blend: float = 0.0, progress: ProgressFn | None = None):
        key = (file_keys, round(blend, 2))
        with self._lock:
            if key in self._items:
                desc = self._items.pop(key)
                self._items[key] = desc
                return desc
        desc = load_descriptor(file_keys, self.device, round(blend, 2), progress)
        with self._lock:
            self._items[key] = desc
            while len(self._items) > self.max_items:
                self._items.pop(next(iter(self._items)))
        return desc
