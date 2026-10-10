"""Detect soft (blurry) sources, which upscale better when shrunk first.

Many phone and social-media videos are much softer than their pixel count:
filters, focus, and compression leave detail only at a coarser scale. Run at
full size, an upscaler treats that blur as real and keeps it. Shrunk first so
the blur spans fewer pixels, the same model re-creates edges and texture.
"""

from __future__ import annotations

from typing import Iterable

import cv2
import numpy as np

FACTORS = (0.67, 0.5, 0.4, 0.33)
# Calibration (mean over frames; lower = less detail lost by shrinking):
#   sharp photos (astronaut, cat, coffee, small compressed portrait): 0.40-0.51 at 0.67
#   a soft 576x1024 TikTok clip: 0.27-0.30 at 0.67, 0.35-0.37 at 0.5, 0.46-0.49 at 0.4
SOFT_GATE = 0.35  # loss at 0.67 must be below this to count as soft at all
MAX_LOSS = 0.5  # strongest shrink whose loss stays below this is chosen


def shrink_loss(rgb: np.ndarray, factor: float) -> float:
    """Detail lost by shrinking to ``factor`` and enlarging back, relative to the image's own detail."""
    g = rgb if rgb.ndim == 2 else cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    g = g.astype(np.float32) / (255.0 if rgb.dtype == np.uint8 else 1.0)
    h, w = g.shape
    small = cv2.resize(g, (max(8, round(w * factor)), max(8, round(h * factor))), interpolation=cv2.INTER_AREA)
    back = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
    detail = g - cv2.GaussianBlur(g, (0, 0), 2.0)
    return float(np.sqrt(((g - back) ** 2).mean()) / (np.sqrt((detail ** 2).mean()) + 1e-4))


def detect(frames: Iterable[np.ndarray]) -> float:
    """Return the shrink factor to use before upscaling: 1.0 (sharp) or one of 0.5, 0.4, 0.33."""
    losses = np.array([[shrink_loss(f, k) for k in FACTORS] for f in frames])
    if losses.size == 0:
        return 1.0
    med = np.median(losses, axis=0)
    if med[0] >= SOFT_GATE:
        return 1.0
    chosen = 1.0
    for k, loss in zip(FACTORS[1:], med[1:]):
        if loss < MAX_LOSS:
            chosen = k
    return chosen


def label(factor: float) -> str:
    return {1.0: "sharp", 0.5: "soft", 0.4: "very soft", 0.33: "extremely soft"}.get(round(factor, 2), f"{factor:g}")
