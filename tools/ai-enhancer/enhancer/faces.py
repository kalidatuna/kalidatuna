"""Face detection, alignment, restoration, and blending back into the image."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F

# Five-point FFHQ template (eyes, nose, mouth corners) for 512x512 crops, the
# layout that GFPGAN and CodeFormer were trained on.
FFHQ_TEMPLATE_512 = np.array(
    [
        [192.98138, 239.94708],
        [318.90277, 240.19360],
        [256.63416, 314.01935],
        [201.26117, 371.41043],
        [313.08905, 371.15118],
    ],
    dtype=np.float32,
)
FACE_SIZE = 512


@dataclass
class Face:
    box: tuple[float, float, float, float]  # x, y, w, h
    landmarks: np.ndarray  # 5x2, image-left eye first
    score: float


class FaceDetector:
    def __init__(self, onnx_path: Path, score_threshold: float = 0.7):
        self.det = cv2.FaceDetectorYN.create(str(onnx_path), "", (320, 320), score_threshold, 0.3, 5000)

    def detect(self, rgb_u8: np.ndarray, max_side: int = 1280) -> list[Face]:
        h, w = rgb_u8.shape[:2]
        s = min(1.0, max_side / max(h, w))
        img = rgb_u8 if s == 1.0 else cv2.resize(rgb_u8, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
        bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        self.det.setInputSize((bgr.shape[1], bgr.shape[0]))
        _, rows = self.det.detect(bgr)
        faces = []
        for r in rows if rows is not None else []:
            # YuNet: box, then right eye, left eye (subject's), nose, right mouth, left mouth.
            lms = r[4:14].reshape(5, 2) / s
            faces.append(Face(tuple(float(v) / s for v in r[:4]), lms.astype(np.float32), float(r[14])))
        return faces


def align_matrix(landmarks: np.ndarray) -> np.ndarray:
    m, _ = cv2.estimateAffinePartial2D(landmarks, FFHQ_TEMPLATE_512, method=cv2.LMEDS)
    if m is None:
        raise ValueError("could not estimate face alignment")
    return m


def crop_face(img: np.ndarray, landmarks: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    m = align_matrix(landmarks)
    crop = cv2.warpAffine(img, m, (FACE_SIZE, FACE_SIZE), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(0.53, 0.53, 0.53))
    return crop, m


_feather_cache: dict = {}


def feather_mask(device) -> torch.Tensor:
    """Soft-edged 512x512 blend mask in crop coordinates (inset and blurred)."""
    if device not in _feather_cache:
        m = np.zeros((FACE_SIZE, FACE_SIZE), np.float32)
        inset = FACE_SIZE // 40
        m[inset:-inset, inset:-inset] = 1.0
        k = (FACE_SIZE // 10) | 1  # odd kernel, about 51 px
        m = cv2.GaussianBlur(m, (k, k), 0)
        _feather_cache[device] = torch.from_numpy(m)[None, None].to(device)
    return _feather_cache[device]


def paste_face(img: torch.Tensor, face: torch.Tensor, m: np.ndarray, strength: float = 1.0) -> torch.Tensor:
    """Blend a restored crop (1, 3, 512, 512) into ``img`` (1, 3, H, W), in place.

    ``m`` maps image pixel coordinates to crop coordinates. Only the face's
    bounding box is touched, so the cost does not grow with the frame size.
    """
    h, w = img.shape[-2:]
    inv = cv2.invertAffineTransform(m)
    corners = np.array([[0, 0], [FACE_SIZE, 0], [0, FACE_SIZE], [FACE_SIZE, FACE_SIZE]], np.float64)
    pts = corners @ inv[:, :2].T + inv[:, 2]
    x0, y0 = (max(0, int(np.floor(v))) for v in pts.min(axis=0))
    x1, y1 = min(w, int(np.ceil(pts[:, 0].max())) + 1), min(h, int(np.ceil(pts[:, 1].max())) + 1)
    if x1 <= x0 or y1 <= y0:
        return img
    dev = img.device
    ys, xs = torch.meshgrid(torch.arange(y0, y1, device=dev, dtype=torch.float32),
                            torch.arange(x0, x1, device=dev, dtype=torch.float32), indexing="ij")
    mt = torch.tensor(m, device=dev, dtype=torch.float32)
    cx = mt[0, 0] * xs + mt[0, 1] * ys + mt[0, 2]
    cy = mt[1, 0] * xs + mt[1, 1] * ys + mt[1, 2]
    grid = torch.stack([cx, cy], dim=-1)[None] / (FACE_SIZE - 1) * 2.0 - 1.0
    back = F.grid_sample(face, grid, mode="bicubic", padding_mode="border", align_corners=True).clamp_(0, 1)
    mask = F.grid_sample(feather_mask(dev), grid, mode="bilinear", padding_mode="zeros", align_corners=True)
    mask = mask * float(strength)
    roi = img[:, :, y0:y1, x0:x1]
    img[:, :, y0:y1, x0:x1] = roi * (1.0 - mask) + back * mask
    return img


def restore_crop(desc, crop: np.ndarray, kind: str, fidelity: float = 0.5) -> torch.Tensor:
    """Run GFPGAN or CodeFormer on one aligned 512x512 RGB float crop in [0, 1].

    Returns a (1, 3, 512, 512) float32 tensor on the model's device.
    """
    model = desc.model
    param = next(model.parameters())
    t = torch.from_numpy(np.ascontiguousarray(crop.transpose(2, 0, 1)))[None]
    t = (t.to(param.device, param.dtype) * 2.0 - 1.0)
    with torch.inference_mode():
        if kind == "codeformer":
            out = model(t, weight=float(fidelity))[0]
        else:
            out = model(t, return_rgb=False)[0]
    return (out.float().clamp(-1, 1) + 1.0) / 2.0


def _gaussian(x: torch.Tensor, sigma: float) -> torch.Tensor:
    r = max(1, int(np.ceil(3 * sigma)))
    k = torch.exp(-torch.arange(-r, r + 1, dtype=torch.float32, device=x.device) ** 2 / (2 * sigma * sigma))
    k = k / k.sum()
    c = x.shape[1]
    x = F.pad(x, (r, r, r, r), mode="reflect")
    x = F.conv2d(x, k.view(1, 1, 1, -1).expand(c, 1, 1, -1), groups=c)
    return F.conv2d(x, k.view(1, 1, -1, 1).expand(c, 1, -1, 1), groups=c)


DETAIL_SIGMA = 2.5  # px at 512: finer than this comes from the detail model, coarser from the face model
DETAIL_INPUT = 128  # the detail model upscales a 128 px aligned crop 4x to 512


def face_width(m: np.ndarray) -> float:
    """Width of the 512 px aligned face crop, measured in source pixels."""
    return FACE_SIZE / float(np.sqrt(abs(np.linalg.det(m[:, :2]))))


def add_detail(restored: torch.Tensor, src: np.ndarray, m: np.ndarray, detail_fn, amount: float) -> torch.Tensor:
    """Add skin, lash and hair micro-detail from a face upscaler to a restored 512 crop.

    Colours and shading stay those of ``restored`` (so eye colour cannot
    change); only detail finer than DETAIL_SIGMA comes from the detail model.
    Large faces take that detail from the source itself; small faces (too few
    source pixels) from the restored face, blended by face size.
    """
    k = DETAIL_INPUT / FACE_SIZE
    width = face_width(m)
    w_src = float(np.clip((width - 60.0) / 80.0, 0.0, 1.0))  # 0 below ~60 px, 1 above ~140 px
    parts = []
    if w_src > 0:
        small = cv2.warpAffine(src, m * k, (DETAIL_INPUT, DETAIL_INPUT), flags=cv2.INTER_CUBIC,
                               borderMode=cv2.BORDER_REFLECT)
        t = torch.from_numpy(np.ascontiguousarray(small.transpose(2, 0, 1)))[None].to(restored.device)
        parts.append((w_src, detail_fn(t).clamp(0, 1)))
    if w_src < 1:
        t = F.interpolate(restored, size=(DETAIL_INPUT, DETAIL_INPUT), mode="area")
        parts.append((1.0 - w_src, detail_fn(t).clamp(0, 1)))
    det = sum(w * d for w, d in parts)
    det = F.interpolate(det, size=restored.shape[-2:], mode="bicubic", align_corners=False) \
        if det.shape[-1] != restored.shape[-1] else det
    return (restored + (det - _gaussian(det, DETAIL_SIGMA)) * float(amount)).clamp(0, 1)


def restore_all(src: np.ndarray, faces: list[Face], desc, kind: str, fidelity: float,
                detail_fn=None, detail: float = 0.0) -> list[tuple[torch.Tensor, np.ndarray]]:
    """Restore every face in ``src``. Returns ``(restored_crop, src_to_crop_matrix)`` pairs.

    Faces are cropped from the source image, not from the upscaled result, so
    the face model sees real input detail instead of the upscaler's guesses.
    With ``detail_fn`` and ``detail`` > 0, fine detail is added (see add_detail).
    """
    out = []
    for f in faces:
        try:
            crop, m = crop_face(src, f.landmarks)
        except ValueError:
            continue
        restored = restore_crop(desc, crop, kind, fidelity)
        if detail_fn is not None and detail > 0:
            restored = add_detail(restored, src, m, detail_fn, detail)
        out.append((restored, m))
    return out


def paste_all(out: torch.Tensor, src_shape: tuple[int, ...], restored: list[tuple[torch.Tensor, np.ndarray]],
              strength: float) -> torch.Tensor:
    """Blend restored crops from :func:`restore_all` into ``out`` (1, 3, H, W) of any size."""
    to_src = np.diag([src_shape[1] / out.shape[-1], src_shape[0] / out.shape[-2]])
    for crop, m in restored:
        m_out = np.hstack([m[:, :2] @ to_src, m[:, 2:]])
        out = paste_face(out, crop.to(out.device), m_out, strength)
    return out
