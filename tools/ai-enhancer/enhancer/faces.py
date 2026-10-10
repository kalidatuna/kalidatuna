"""Face detection, alignment, restoration, and blending back into the image."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

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


def paste_face(img: np.ndarray, face: np.ndarray, m: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """Warp a restored 512 crop back into ``img`` with a feathered mask."""
    h, w = img.shape[:2]
    inv = cv2.invertAffineTransform(m)
    back = cv2.warpAffine(face, inv, (w, h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
    mask = np.ones((FACE_SIZE, FACE_SIZE), dtype=np.float32)
    mask = cv2.warpAffine(mask, inv, (w, h), flags=cv2.INTER_LINEAR)
    # Feather proportionally to the face's size in the output image.
    face_px = FACE_SIZE / np.sqrt(abs(np.linalg.det(m[:, :2])))
    erode = max(1, int(face_px / 40))
    mask = cv2.erode(mask, np.ones((2 * erode + 1, 2 * erode + 1), np.uint8))
    blur = max(1, int(face_px / 20)) * 2 + 1
    mask = cv2.GaussianBlur(mask, (blur, blur), 0)[..., None] * float(strength)
    return img * (1.0 - mask) + np.clip(back, 0, 1) * mask


def restore_crop(desc, crop: np.ndarray, kind: str, fidelity: float = 0.5) -> np.ndarray:
    """Run GFPGAN or CodeFormer on one aligned 512x512 RGB float crop in [0, 1]."""
    import torch

    model = desc.model
    param = next(model.parameters())
    t = torch.from_numpy(np.ascontiguousarray(crop.transpose(2, 0, 1)))[None]
    t = (t.to(param.device, param.dtype) * 2.0 - 1.0)
    with torch.inference_mode():
        if kind == "codeformer":
            out = model(t, weight=float(fidelity))[0]
        else:
            out = model(t, return_rgb=False)[0]
    out = ((out.float().clamp(-1, 1) + 1.0) / 2.0)[0].cpu().numpy().transpose(1, 2, 0)
    return out


def restore_all(src: np.ndarray, faces: list[Face], desc, kind: str,
                fidelity: float) -> list[tuple[np.ndarray, np.ndarray]]:
    """Restore every face in ``src``. Returns ``(restored_crop, src_to_crop_matrix)`` pairs.

    Faces are cropped from the source image, not from the upscaled result, so
    the face model sees real input detail instead of the upscaler's guesses.
    """
    out = []
    for f in faces:
        try:
            crop, m = crop_face(src, f.landmarks)
        except ValueError:
            continue
        out.append((restore_crop(desc, crop, kind, fidelity), m))
    return out


def paste_all(out: np.ndarray, src_shape: tuple[int, ...], restored: list[tuple[np.ndarray, np.ndarray]],
              strength: float) -> np.ndarray:
    """Blend restored crops from :func:`restore_all` into ``out`` (any size)."""
    to_src = np.diag([src_shape[1] / out.shape[1], src_shape[0] / out.shape[0]])
    for crop, m in restored:
        m_out = np.hstack([m[:, :2] @ to_src, m[:, 2:]])
        out = paste_face(out, crop, m_out, strength)
    return out
