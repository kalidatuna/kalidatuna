"""Tiled inference so large images fit in limited GPU or CPU memory."""

from __future__ import annotations

from typing import Callable

import numpy as np

TileProgress = Callable[[int, int], None]


class Cancelled(Exception):
    pass


def _positions(length: int, tile: int, step: int) -> list[int]:
    if length <= tile:
        return [0]
    pos = list(range(0, length - tile, step))
    pos.append(length - tile)
    return pos


def _ramp(size: int, overlap: int, start_edge: bool, end_edge: bool) -> np.ndarray:
    w = np.ones(size, dtype=np.float32)
    if overlap <= 0:
        return w
    ramp = np.linspace(0.0, 1.0, overlap + 2, dtype=np.float32)[1:-1]
    if not start_edge:
        w[:overlap] = ramp
    if not end_edge:
        w[-overlap:] = ramp[::-1]
    return w


def run_model(fn: Callable[[np.ndarray], np.ndarray], img: np.ndarray, scale: int, tile: int = 256,
              overlap: int = 16, progress: TileProgress | None = None,
              cancel: Callable[[], bool] | None = None) -> np.ndarray:
    """Apply ``fn`` (HxWxC float32 -> sH x sW x C) over ``img`` in overlapping tiles.

    Overlapping regions are cross-faded with linear ramps, so tile seams do
    not show.
    """
    h, w, c = img.shape
    if tile <= 0 or (h <= tile and w <= tile):
        if progress:
            progress(0, 1)
        out = fn(img)
        if progress:
            progress(1, 1)
        return out

    overlap = max(0, min(overlap, tile // 2))
    step = tile - overlap
    ys = _positions(h, tile, step)
    xs = _positions(w, tile, step)
    total = len(ys) * len(xs)
    out = np.zeros((h * scale, w * scale, c), dtype=np.float32)
    weight = np.zeros((h * scale, w * scale, 1), dtype=np.float32)
    done = 0
    for y in ys:
        th = min(tile, h - y)
        for x in xs:
            if cancel and cancel():
                raise Cancelled()
            tw = min(tile, w - x)
            res = fn(img[y:y + th, x:x + tw])
            wy = _ramp(th * scale, overlap * scale, y == 0, y + th >= h)
            wx = _ramp(tw * scale, overlap * scale, x == 0, x + tw >= w)
            wm = (wy[:, None] * wx[None, :])[..., None]
            ys_, xs_ = y * scale, x * scale
            out[ys_:ys_ + th * scale, xs_:xs_ + tw * scale] += res * wm
            weight[ys_:ys_ + th * scale, xs_:xs_ + tw * scale] += wm
            done += 1
            if progress:
                progress(done, total)
    return out / np.maximum(weight, 1e-8)


def descriptor_fn(desc) -> Callable[[np.ndarray], np.ndarray]:
    """Wrap a spandrel image model as a NumPy HxWx3 float32 [0, 1] function."""
    import torch

    param = next(desc.model.parameters())
    device, dtype = param.device, param.dtype

    def fn(tile: np.ndarray) -> np.ndarray:
        t = torch.from_numpy(np.ascontiguousarray(tile.transpose(2, 0, 1)))[None]
        t = t.to(device=device, dtype=dtype)
        with torch.inference_mode():
            r = desc(t)
        return r[0].float().cpu().numpy().transpose(1, 2, 0)

    return fn
