"""Frame-by-frame video enhancement through FFmpeg pipes. Audio is carried over."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Callable

import numpy as np

from .imageio import to_uint8
from .pipeline import Pipeline, Progress, Settings
from .tiling import Cancelled

CODECS = {
    "h264": ["-c:v", "libx264", "-preset", "slow", "-pix_fmt", "yuv420p"],
    "h265": ["-c:v", "libx265", "-preset", "slow", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"],
    "prores": ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"],
}


@dataclass
class VideoInfo:
    width: int
    height: int
    fps: Fraction
    frames: int
    has_audio: bool


def ffmpeg_bin(name: str = "ffmpeg") -> str:
    path = shutil.which(name)
    if not path:
        raise RuntimeError(f"{name} was not found on PATH. Install FFmpeg to process video.")
    return path


def probe(path: str | Path) -> VideoInfo:
    out = subprocess.run(
        [ffmpeg_bin("ffprobe"), "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    meta = json.loads(out)
    v = next(s for s in meta["streams"] if s["codec_type"] == "video")
    w, h = int(v["width"]), int(v["height"])
    rotation = 0
    for sd in v.get("side_data_list", []):
        if "rotation" in sd:
            rotation = int(float(sd["rotation"]))
    if "rotate" in v.get("tags", {}):
        rotation = int(v["tags"]["rotate"])
    if abs(rotation) % 180 == 90:
        w, h = h, w
    rate = v.get("avg_frame_rate") or v.get("r_frame_rate") or "30/1"
    fps = Fraction(rate) if rate != "0/0" else Fraction(v.get("r_frame_rate", "30/1"))
    frames = int(v.get("nb_frames") or 0)
    if not frames:
        dur = float(v.get("duration") or meta.get("format", {}).get("duration") or 0)
        frames = max(1, round(dur * float(fps)))
    has_audio = any(s["codec_type"] == "audio" for s in meta["streams"])
    return VideoInfo(w, h, fps, frames, has_audio)


def read_frame(path: str | Path, index: int = 0) -> np.ndarray:
    """Decode one frame (for previews) as HxWx3 float32 RGB."""
    info = probe(path)
    t = index / float(info.fps) if info.fps else 0
    raw = subprocess.run(
        [ffmpeg_bin(), "-v", "error", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True,
    ).stdout
    frame = np.frombuffer(raw, np.uint8)[: info.width * info.height * 3]
    return frame.reshape(info.height, info.width, 3).astype(np.float32) / 255.0


def even_settings(s: Settings, w: int, h: int) -> Settings:
    """Most video codecs need even dimensions."""
    ow, oh = s.output_size(w, h)
    out = Settings.from_dict(s.to_dict())
    out.width, out.height = ow + (ow % 2), oh + (oh % 2)
    return out


def enhance_video(src: str | Path, dst: str | Path, settings: Settings, pipeline: Pipeline,
                  codec: str = "h264", crf: int = 16, progress: Progress | None = None,
                  cancel: Callable[[], bool] | None = None) -> Path:
    src, dst = Path(src), Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    info = probe(src)
    s = even_settings(settings, info.width, info.height)
    ow, oh = s.width, s.height
    frame_bytes = info.width * info.height * 3

    reader = subprocess.Popen(
        [ffmpeg_bin(), "-v", "error", "-i", str(src), "-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
    )
    audio = ["-map", "1:a?"]
    audio += ["-c:a", "aac", "-b:a", "192k"] if dst.suffix.lower() in (".mp4", ".m4v") else ["-c:a", "copy"]
    quality = ["-crf", str(crf)] if codec in ("h264", "h265") else []
    writer = subprocess.Popen(
        [ffmpeg_bin(), "-y", "-v", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{ow}x{oh}", "-r", str(info.fps), "-i", "-",
         "-i", str(src), "-map", "0:v:0", *audio, *CODECS[codec], *quality, "-shortest", str(dst)],
        stdin=subprocess.PIPE,
    )
    n = 0
    try:
        while True:
            if cancel and cancel():
                raise Cancelled()
            buf = reader.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            frame = np.frombuffer(buf, np.uint8).reshape(info.height, info.width, 3).astype(np.float32) / 255.0

            def frame_progress(label: str, frac: float, n=n):
                if progress:
                    progress(f"Frame {n + 1}/{info.frames}", min(1.0, (n + frac) / info.frames))

            out, _ = pipeline.process(frame, s, progress=frame_progress, cancel=cancel)
            writer.stdin.write(to_uint8(out).tobytes())
            n += 1
    except BaseException:
        reader.kill()
        writer.kill()
        writer.wait()
        dst.unlink(missing_ok=True)
        raise
    finally:
        reader.stdout.close()
        reader.wait()
    writer.stdin.close()
    if writer.wait() != 0:
        raise RuntimeError(f"FFmpeg failed while writing {dst}")
    if progress:
        progress("Done", 1.0)
    return dst
