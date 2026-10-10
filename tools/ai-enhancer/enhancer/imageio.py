"""Image loading and saving that keeps bit depth, alpha, orientation, ICC and EXIF."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".bmp"}
VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
OUTPUT_FORMATS = {"png": ".png", "jpeg": ".jpg", "tiff": ".tif", "webp": ".webp"}

_ORIENT_OPS = {
    2: lambda a: a[:, ::-1],
    3: lambda a: a[::-1, ::-1],
    4: lambda a: a[::-1],
    5: lambda a: np.swapaxes(a, 0, 1),
    6: lambda a: np.swapaxes(a, 0, 1)[:, ::-1],
    7: lambda a: np.swapaxes(a, 0, 1)[::-1, ::-1],
    8: lambda a: np.swapaxes(a, 0, 1)[::-1],
}


@dataclass
class LoadedImage:
    rgb: np.ndarray  # HxWx3 float32 in [0, 1]
    alpha: np.ndarray | None  # HxW float32 in [0, 1]
    bits: int  # 8 or 16
    icc: bytes | None = None
    exif: bytes | None = None
    path: Path | None = None
    extra: dict = field(default_factory=dict)

    @property
    def size(self) -> tuple[int, int]:
        return self.rgb.shape[1], self.rgb.shape[0]


def is_video(path: str | Path) -> bool:
    return Path(path).suffix.lower() in VIDEO_EXTS


def load_image(path: str | Path) -> LoadedImage:
    path = Path(path)
    data = np.fromfile(str(path), dtype=np.uint8)  # handles non-ASCII paths on Windows
    raw = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    if raw is None:
        raise ValueError(f"Cannot read image: {path}")
    icc = exif = None
    orientation = 1
    try:
        with Image.open(path) as pil:
            icc = pil.info.get("icc_profile")
            ex = pil.getexif()
            orientation = int(ex.get(0x0112, 1))
            if ex:
                ex[0x0112] = 1
                exif = ex.tobytes()
    except Exception:
        pass
    return from_array(raw, bgr=True, orientation=orientation, icc=icc, exif=exif, path=path)


def from_array(raw: np.ndarray, bgr: bool = False, orientation: int = 1, **kw) -> LoadedImage:
    if raw.dtype == np.uint16:
        bits, f = 16, raw.astype(np.float32) / 65535.0
    elif raw.dtype == np.uint8:
        bits, f = 8, raw.astype(np.float32) / 255.0
    else:
        bits, f = 16, np.clip(raw.astype(np.float32), 0, 1)
    if f.ndim == 2:
        f = f[..., None]
    alpha = None
    if f.shape[2] == 4:
        alpha = f[..., 3]
        f = f[..., :3]
    elif f.shape[2] == 2:
        alpha = f[..., 1]
        f = f[..., :1]
    if f.shape[2] == 1:
        f = np.repeat(f, 3, axis=2)
    elif bgr:
        f = f[..., ::-1]
    if orientation in _ORIENT_OPS:
        f = _ORIENT_OPS[orientation](f)
        if alpha is not None:
            alpha = _ORIENT_OPS[orientation](alpha)
    rgb = np.ascontiguousarray(f, dtype=np.float32)
    alpha = None if alpha is None else np.ascontiguousarray(alpha, dtype=np.float32)
    return LoadedImage(rgb, alpha, bits, **kw)


def to_uint8(rgb: np.ndarray) -> np.ndarray:
    return (np.clip(rgb, 0, 1) * 255.0 + 0.5).astype(np.uint8)


def save_image(path: str | Path, rgb: np.ndarray, alpha: np.ndarray | None = None, fmt: str = "png",
               quality: int = 95, bits: int = 8, icc: bytes | None = None, exif: bytes | None = None) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    has_alpha = alpha is not None and fmt in ("png", "tiff", "webp")
    if bits == 16 and fmt in ("png", "tiff"):
        arr = np.clip(rgb, 0, 1)[..., ::-1]
        if has_alpha:
            arr = np.concatenate([arr, np.clip(alpha, 0, 1)[..., None]], axis=2)
        arr = (arr * 65535.0 + 0.5).astype(np.uint16)
        ok, buf = cv2.imencode(path.suffix or OUTPUT_FORMATS[fmt], arr)
        if not ok:
            raise ValueError(f"Cannot encode {path}")
        buf.tofile(str(path))
        return path
    u8 = to_uint8(rgb)
    if has_alpha:
        u8 = np.concatenate([u8, to_uint8(alpha)[..., None]], axis=2)
    img = Image.fromarray(u8, "RGBA" if has_alpha else "RGB")
    kw: dict = {}
    if icc:
        kw["icc_profile"] = icc
    if exif and fmt in ("jpeg", "png", "webp", "tiff"):
        kw["exif"] = exif
    if fmt == "jpeg":
        kw.update(quality=quality, subsampling=0 if quality >= 90 else 2, optimize=True)
    elif fmt == "webp":
        kw.update(quality=quality, method=5)
    elif fmt == "png":
        kw.update(compress_level=6)
    elif fmt == "tiff":
        kw.update(compression="tiff_lzw")
    img.save(path, format={"jpeg": "JPEG", "png": "PNG", "webp": "WEBP", "tiff": "TIFF"}[fmt], **kw)
    return path
