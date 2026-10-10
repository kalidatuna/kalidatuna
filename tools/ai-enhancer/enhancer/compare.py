"""Measure how close an output is to a reference (for example, a Topaz export),
and search for the settings that come closest to that reference."""

from __future__ import annotations

import itertools
from dataclasses import dataclass
from typing import Callable, Iterable

import cv2
import numpy as np

from . import models
from .pipeline import Pipeline, Settings
from .tiling import Cancelled


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))
    return float("inf") if mse == 0 else 10.0 * np.log10(1.0 / mse)


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    """Mean SSIM on luminance (Wang et al. 2004, Gaussian window, sigma 1.5)."""
    ya = cv2.cvtColor(a.astype(np.float32), cv2.COLOR_RGB2GRAY).astype(np.float64)
    yb = cv2.cvtColor(b.astype(np.float32), cv2.COLOR_RGB2GRAY).astype(np.float64)
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    blur = lambda x: cv2.GaussianBlur(x, (11, 11), 1.5)
    ma, mb = blur(ya), blur(yb)
    va = blur(ya * ya) - ma * ma
    vb = blur(yb * yb) - mb * mb
    cov = blur(ya * yb) - ma * mb
    s = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2))
    return float(s.mean())


def sharpness(a: np.ndarray) -> float:
    y = cv2.cvtColor(a.astype(np.float32), cv2.COLOR_RGB2GRAY)
    return float(cv2.Laplacian(y, cv2.CV_32F).var())


def delta_e(a: np.ndarray, b: np.ndarray) -> float:
    la = cv2.cvtColor(a.astype(np.float32), cv2.COLOR_RGB2LAB)
    lb = cv2.cvtColor(b.astype(np.float32), cv2.COLOR_RGB2LAB)
    return float(np.sqrt(((la - lb) ** 2).sum(axis=2)).mean())


def metrics(ours: np.ndarray, ref: np.ndarray) -> dict:
    if ours.shape != ref.shape:
        ours = cv2.resize(ours, (ref.shape[1], ref.shape[0]), interpolation=cv2.INTER_AREA)
    sr, so = sharpness(ref), sharpness(ours)
    return {
        "psnr": psnr(ours, ref),
        "ssim": ssim(ours, ref),
        "delta_e": delta_e(ours, ref),
        "sharpness_ratio": so / sr if sr else float("nan"),
    }


def diff_image(ours: np.ndarray, ref: np.ndarray, gain: float = 4.0) -> np.ndarray:
    if ours.shape != ref.shape:
        ours = cv2.resize(ours, (ref.shape[1], ref.shape[0]), interpolation=cv2.INTER_AREA)
    d = np.abs(ours - ref).mean(axis=2) * gain
    heat = cv2.applyColorMap((np.clip(d, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
    return heat[..., ::-1].astype(np.float32) / 255.0


@dataclass
class MatchResult:
    settings: Settings
    scores: dict

    @property
    def score(self) -> float:
        # SSIM drives structure; PSNR and colour error break ties.
        return self.scores["ssim"] + 0.002 * self.scores["psnr"] - 0.002 * self.scores["delta_e"]


def candidate_settings(face: bool, quick: bool = False) -> Iterable[Settings]:
    """Every combination to try. Grouped by AI upscale so each base result is computed once."""
    recover = (0.0, 0.25) if quick else (0.0, 0.1, 0.2, 0.3, 0.45)
    sharpen = (0.0, 0.3) if quick else (0.0, 0.15, 0.3, 0.5)
    faces = ("", "gfpgan", "codeformer") if face else ("",)
    for key, up in models.UPSCALERS.items():
        noises = ((0.0, 0.5, 1.0) if quick else (0.0, 0.25, 0.5, 0.75, 1.0)) if up.denoise_blend else (0.0,)
        for noise, fm, rec, sh in itertools.product(noises, faces, recover, sharpen):
            yield Settings(model=key, noise=noise, recover_detail=rec, sharpen=sh, face_model=fm)


def center_crop_box(w: int, h: int, size: int) -> tuple[int, int, int, int]:
    cw, ch = min(w, size), min(h, size)
    return (w - cw) // 2, (h - ch) // 2, cw, ch


def match(source: np.ndarray, reference: np.ndarray, pipeline: Pipeline, crop: int = 160,
          quick: bool = False, progress: Callable[[str, float], None] | None = None,
          cancel: Callable[[], bool] | None = None) -> list[MatchResult]:
    """Try preset combinations on a crop of ``source`` and rank them by similarity to ``reference``.

    ``reference`` must be the source processed by the other tool, at any
    scale. The same region is cut from both images, so the search stays fast
    on large photos.
    """
    h, w = source.shape[:2]
    rh, rw = reference.shape[:2]
    sx, sy = rw / w, rh / h
    has_face = bool(pipeline.detector().detect((np.clip(source, 0, 1) * 255).astype(np.uint8)))
    x, y, cw, ch = center_crop_box(w, h, crop) if not has_face else _face_box(pipeline, source, crop)
    src_crop = source[y:y + ch, x:x + cw]
    ref_crop = reference[round(y * sy):round((y + ch) * sy), round(x * sx):round((x + cw) * sx)]
    cands = list(candidate_settings(has_face, quick))
    faces = pipeline.detector().detect((np.clip(src_crop, 0, 1) * 255).astype(np.uint8)) if has_face else []
    bases: dict[tuple, np.ndarray] = {}
    face_cache: dict = {}
    n_bases = len({Pipeline.base_key(s) for s in cands})
    results = []
    for i, s in enumerate(cands):
        if cancel and cancel():
            raise Cancelled()
        s.width, s.height = ref_crop.shape[1], ref_crop.shape[0]
        key = Pipeline.base_key(s)
        if key not in bases:
            if progress:
                progress(f"Trying {models.UPSCALERS[s.model].label} ({len(bases) + 1}/{n_bases})", i / len(cands))
            bases[key] = pipeline.upscale(src_crop, s, cancel=cancel)
        out = pipeline.finish(bases[key], src_crop, s, faces=faces, face_cache=face_cache)
        results.append(MatchResult(s, metrics(out, ref_crop)))
    results.sort(key=lambda r: r.score, reverse=True)

    # Fine-tune the cheap continuous controls around the best few candidates.
    if progress:
        progress("Fine-tuning", 0.99)
    seen = {_sig(r.settings) for r in results}
    for r in results[:3]:
        best = r
        names = ["recover_detail", "sharpen"] + (["face_strength"] if best.settings.face_model else [])
        for step in (0.1, 0.05, 0.025, 0.0125):
            improved = True
            while improved:
                improved = False
                for name in names:
                    for d in (-step, step):
                        if cancel and cancel():
                            raise Cancelled()
                        s = Settings.from_dict(best.settings.to_dict())
                        setattr(s, name, round(min(1.0, max(0.0, getattr(s, name) + d)), 4))
                        if _sig(s) in seen:
                            continue
                        seen.add(_sig(s))
                        out = pipeline.finish(bases[Pipeline.base_key(s)], src_crop, s, faces=faces,
                                              face_cache=face_cache)
                        cand = MatchResult(s, metrics(out, ref_crop))
                        results.append(cand)
                        if cand.score > best.score:
                            best, improved = cand, True
    for r in results:
        r.settings.width = r.settings.height = 0
        r.settings.scale = round(sx, 3)
    if progress:
        progress("Done", 1.0)
    unique: dict[tuple, MatchResult] = {}
    for r in sorted(results, key=lambda r: r.score, reverse=True):
        unique.setdefault(_sig(r.settings), r)
    return list(unique.values())


def _sig(s: Settings) -> tuple:
    return (Pipeline.base_key(s), s.recover_detail, s.sharpen, s.face_model, s.face_strength)


def _face_box(pipeline: Pipeline, source: np.ndarray, size: int) -> tuple[int, int, int, int]:
    h, w = source.shape[:2]
    faces = pipeline.detector().detect((np.clip(source, 0, 1) * 255).astype(np.uint8))
    f = max(faces, key=lambda f: f.box[2] * f.box[3])
    cx, cy = f.box[0] + f.box[2] / 2, f.box[1] + f.box[3] / 2
    side = int(min(max(size, f.box[2] * 1.6, f.box[3] * 1.6), w, h))
    x = int(min(max(0, cx - side / 2), w - side))
    y = int(min(max(0, cy - side / 2), h - side))
    return x, y, side, side
