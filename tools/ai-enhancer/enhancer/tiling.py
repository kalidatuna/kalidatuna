"""Tiled inference, done on the model's device so large frames never leave the GPU."""

from __future__ import annotations

from typing import Callable

import numpy as np
import torch

TileProgress = Callable[[int, int], None]
TensorFn = Callable[[torch.Tensor], torch.Tensor]

# Tile sizes tried, largest first, when the tile size is "auto" (0) on a GPU.
# None means the whole image in one pass. Each step down is taken only after
# running out of GPU memory, and the size that worked is remembered.
GPU_AUTO_TILES = (None, 1536, 1024, 768, 512, 384, 256, 128)
CPU_AUTO_TILE = 512
_auto_tile: dict = {}


class Cancelled(Exception):
    pass


def _positions(length: int, tile: int, step: int) -> list[int]:
    if length <= tile:
        return [0]
    pos = list(range(0, length - tile, step))
    pos.append(length - tile)
    return pos


def _ramp(size: int, overlap: int, start_edge: bool, end_edge: bool, device) -> torch.Tensor:
    w = torch.ones(size, device=device)
    if overlap <= 0:
        return w
    ramp = torch.linspace(0.0, 1.0, overlap + 2, device=device)[1:-1]
    if not start_edge:
        w[:overlap] = ramp
    if not end_edge:
        w[-overlap:] = ramp.flip(0)
    return w


def _is_gpu(x: torch.Tensor) -> bool:
    return x.device.type == "cuda"


def _is_oom(e: BaseException) -> bool:
    return isinstance(e, torch.cuda.OutOfMemoryError) or "out of memory" in str(e).lower()


def _run_fixed(fn: TensorFn, x: torch.Tensor, scale: int, tile: int | None, overlap: int,
               progress: TileProgress | None, cancel: Callable[[], bool] | None) -> torch.Tensor:
    _, c, h, w = x.shape
    if tile is None or (h <= tile and w <= tile):
        if progress:
            progress(0, 1)
        out = fn(x)
        if progress:
            progress(1, 1)
        return out

    overlap = max(0, min(overlap, tile // 2))
    step = tile - overlap
    ys = _positions(h, tile, step)
    xs = _positions(w, tile, step)
    total = len(ys) * len(xs)
    out = torch.zeros((1, c, h * scale, w * scale), device=x.device)
    weight = torch.zeros((1, 1, h * scale, w * scale), device=x.device)
    done = 0
    for y in ys:
        th = min(tile, h - y)
        wy = _ramp(th * scale, overlap * scale, y == 0, y + th >= h, x.device)
        for x0 in xs:
            if cancel and cancel():
                raise Cancelled()
            tw = min(tile, w - x0)
            res = fn(x[:, :, y:y + th, x0:x0 + tw])
            wx = _ramp(tw * scale, overlap * scale, x0 == 0, x0 + tw >= w, x.device)
            wm = (wy[:, None] * wx[None, :])[None, None]
            ys_, xs_ = y * scale, x0 * scale
            out[:, :, ys_:ys_ + th * scale, xs_:xs_ + tw * scale] += res * wm
            weight[:, :, ys_:ys_ + th * scale, xs_:xs_ + tw * scale] += wm
            done += 1
            if progress:
                progress(done, total)
    return out / weight.clamp_min(1e-8)


def run_tiled(fn: TensorFn, x: torch.Tensor, scale: int, tile: int = 0, overlap: int = 16,
              progress: TileProgress | None = None, cancel: Callable[[], bool] | None = None,
              auto_key=None) -> torch.Tensor:
    """Apply ``fn`` ((1, C, h, w) -> (1, C, s*h, s*w)) over ``x`` in overlapping tiles.

    Overlaps are cross-faded with linear ramps, so seams do not show.
    ``tile`` <= 0 picks the size automatically: the whole image on a GPU when
    it fits, smaller tiles after an out-of-memory error, 512 on a CPU.
    """
    if tile > 0:
        return _run_fixed(fn, x, scale, tile, overlap, progress, cancel)
    if not _is_gpu(x):
        return _run_fixed(fn, x, scale, CPU_AUTO_TILE, overlap, progress, cancel)
    key = (auto_key, tuple(x.shape[-2:]))
    side = max(x.shape[-2:])
    # Sizes that would not split the image are the same as the whole image.
    candidates = [None] + [t for t in GPU_AUTO_TILES if t is not None and t < side]
    if key in _auto_tile:
        candidates = candidates[candidates.index(_auto_tile[key]):]
    for t in candidates:
        try:
            out = _run_fixed(fn, x, scale, t, overlap, progress, cancel)
        except (RuntimeError, torch.cuda.OutOfMemoryError) as e:
            if not _is_oom(e) or t == candidates[-1]:
                raise
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            continue
        _auto_tile[key] = t
        return out
    raise RuntimeError("unreachable")


def descriptor_fn(desc) -> TensorFn:
    """Wrap a spandrel model: float32 tensor in, float32 tensor out, on the model's device.

    If a half-precision model ever returns NaN or infinity, the model is
    switched to full precision and the tile is computed again.
    """
    def fn(t: torch.Tensor) -> torch.Tensor:
        dtype = next(desc.model.parameters()).dtype
        with torch.inference_mode():
            r = desc(t.to(dtype))
            if dtype == torch.float16 and not torch.isfinite(r).all():
                desc.float()
                r = desc(t.float())
        return r.float()

    return fn


def run_model(fn: Callable[[np.ndarray], np.ndarray], img: np.ndarray, scale: int, tile: int = 256,
              overlap: int = 16, progress: TileProgress | None = None,
              cancel: Callable[[], bool] | None = None) -> np.ndarray:
    """NumPy front end to :func:`run_tiled` for HxWxC float32 images and functions."""
    def tfn(t: torch.Tensor) -> torch.Tensor:
        a = fn(t[0].permute(1, 2, 0).cpu().numpy())
        return torch.from_numpy(np.ascontiguousarray(a.transpose(2, 0, 1)))[None]

    x = torch.from_numpy(np.ascontiguousarray(img.transpose(2, 0, 1)))[None]
    return run_tiled(tfn, x, scale, tile, overlap, progress, cancel)[0].permute(1, 2, 0).numpy()
