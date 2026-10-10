"""Built-in starting points. Each preset overrides some settings and keeps the rest."""

from __future__ import annotations

from .pipeline import Settings

PRESETS: dict[str, tuple[str, dict]] = {
    "tiktok-fast": (
        "TikTok edit: fast (long videos)",
        dict(model="video-2x", scale=2.0, denoise_model="compression", denoise_strength=1.0,
             recover_detail=0.0, sharpen=0.1, face_model="gfpgan", face_strength=0.5),
    ),
    "tiktok-balanced": (
        "TikTok edit: balanced",
        dict(model="social-fast", scale=2.0, denoise_model="compression", denoise_strength=1.0,
             recover_detail=0.0, sharpen=0.0, face_model="gfpgan", face_strength=0.5),
    ),
    "tiktok-best": (
        "TikTok edit: best quality (slow)",
        dict(model="social-hd", scale=2.0, denoise_model="compression", denoise_strength=0.7,
             recover_detail=0.0, sharpen=0.0, face_model="gfpgan", face_strength=0.6),
    ),
    "photo": (
        "Photo: natural",
        dict(model="standard", scale=2.0, noise=0.5, denoise_model="", recover_detail=0.1,
             sharpen=0.0, face_model="gfpgan", face_strength=0.7),
    ),
}


def apply(base: Settings, key: str) -> Settings:
    """Return ``base`` with the preset's values applied (device and tile size are kept)."""
    _, values = PRESETS[key]
    return Settings.from_dict(base.to_dict() | values | {"width": 0, "height": 0})
