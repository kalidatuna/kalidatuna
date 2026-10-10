"""Test fixtures. A fake model stands in for the real checkpoints, so tests run offline."""

from __future__ import annotations

import numpy as np
import pytest
import torch

from enhancer import models
from enhancer.pipeline import Pipeline


class FakeDescriptor:
    """Behaves like a spandrel ImageModelDescriptor: nearest-neighbour upscaling."""

    def __init__(self, scale: int):
        self.scale = scale
        self.model = torch.nn.Conv2d(3, 3, 1)

    def __call__(self, t: torch.Tensor) -> torch.Tensor:
        return torch.nn.functional.interpolate(t, scale_factor=self.scale, mode="nearest")


@pytest.fixture
def fake_pipeline(monkeypatch) -> Pipeline:
    def get(self, file_keys, blend=0.0, progress=None):
        two_x = {f for up in models.UPSCALERS.values() for f in up.files if up.scale == 2}
        one_x = {key for _, key in models.DENOISERS.values()}
        return FakeDescriptor(2 if file_keys[0] in two_x else 1 if file_keys[0] in one_x else 4)

    monkeypatch.setattr(models.ModelCache, "get", get)
    return Pipeline("cpu")


@pytest.fixture
def gradient() -> np.ndarray:
    y, x = np.mgrid[0:48, 0:64].astype(np.float32)
    return np.stack([x / 63, y / 47, (x + y) / 110], axis=2).astype(np.float32)
