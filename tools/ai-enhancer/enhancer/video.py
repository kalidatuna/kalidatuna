"""Frame-by-frame video enhancement through FFmpeg pipes. Audio is carried over."""

from __future__ import annotations

import functools
import json
import math
import queue
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from .pipeline import Pipeline, Progress, Settings
from .tiling import Cancelled

CODECS = {
    "h264": ["-c:v", "libx264", "-preset", "slow", "-pix_fmt", "yuv420p"],
    "h265": ["-c:v", "libx265", "-preset", "slow", "-pix_fmt", "yuv420p", "-tag:v", "hvc1",
             "-x265-params", "log-level=error"],
    "h264_nvenc": ["-c:v", "h264_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-b:v", "0",
                   "-pix_fmt", "yuv420p"],
    "hevc_nvenc": ["-c:v", "hevc_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-b:v", "0",
                   "-pix_fmt", "yuv420p", "-tag:v", "hvc1"],
    "prores": ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"],
}
# Software encoder to use when a GPU encoder is missing or fails to start.
FALLBACK = {"h264_nvenc": "h264", "hevc_nvenc": "h265"}


@functools.lru_cache(maxsize=None)
def encoder_works(codec: str) -> bool:
    """True if FFmpeg can actually open ``codec`` here (NVENC also needs an NVIDIA driver)."""
    name = CODECS[codec][1]
    try:
        r = subprocess.run(
            [ffmpeg_bin(), "-v", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.1",
             "-frames:v", "1", "-c:v", name, "-f", "null", "-"],
            capture_output=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return r.returncode == 0


def resolve_codec(codec: str) -> str:
    if codec in FALLBACK and not encoder_works(codec):
        print(f"{codec} is not available here; using {FALLBACK[codec]} instead.", file=sys.stderr)
        return FALLBACK[codec]
    return codec


def quality_args(codec: str, crf: int) -> list[str]:
    if codec in ("h264", "h265"):
        return ["-crf", str(crf)]
    if codec.endswith("_nvenc"):
        return ["-cq", str(crf)]
    return []


def format_eta(seconds: float) -> str:
    seconds = int(max(0, seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}h {m:02d}m" if h else f"{m}m {s:02d}s" if m else f"{s}s"


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


def sample_frames(src: str | Path, info: VideoInfo | None = None, count: int = 5) -> list[np.ndarray]:
    """A few frames spread over the video, as uint8 RGB arrays (for softness detection)."""
    info = info or probe(src)
    duration = info.frames / float(info.fps) if info.fps else 0
    times = [duration * (i + 0.5) / count for i in range(count)] if duration else [0.0]
    out = []
    for t in times:
        raw = subprocess.run(
            [ffmpeg_bin(), "-v", "error", "-ss", f"{t:.3f}", "-i", str(src), "-frames:v", "1",
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            capture_output=True,
        ).stdout
        if len(raw) >= info.width * info.height * 3:
            out.append(np.frombuffer(raw, np.uint8)[: info.width * info.height * 3].reshape(info.height, info.width, 3))
    return out


def even_settings(s: Settings, w: int, h: int) -> Settings:
    """Most video codecs need even dimensions."""
    ow, oh = s.output_size(w, h)
    out = Settings.from_dict(s.to_dict())
    out.width, out.height = ow + (ow % 2), oh + (oh % 2)
    return out


REPEAT_BLOCK = 16
REPEAT_THRESHOLD = 1.0  # mean |difference| per block, out of 255


def is_repeat(a: np.ndarray | None, b: np.ndarray) -> bool:
    """True when ``b`` shows no visible change from ``a``.

    The check is per 16x16 block, so a change in one small area (a blink)
    still counts as motion. The threshold is strict: in tests, a 40x16 px
    blink scored 7.5 and a subtle eyelid change 1.2, while re-encoded
    duplicate frames scored 1-3. Some duplicates are therefore processed
    anyway, but real motion is never dropped.
    """
    if a is None or a.shape != b.shape:
        return False
    d = cv2.absdiff(a, b).mean(axis=2, dtype=np.float32)
    h, w = d.shape
    blocks = cv2.resize(d, (max(1, w // REPEAT_BLOCK), max(1, h // REPEAT_BLOCK)), interpolation=cv2.INTER_AREA)
    return float(blocks.max()) < REPEAT_THRESHOLD


_DONE = object()


def _put(q: queue.Queue, item, stop: threading.Event):
    while not stop.is_set():
        try:
            q.put(item, timeout=0.2)
            return
        except queue.Full:
            continue


def enhance_video(src: str | Path, dst: str | Path, settings: Settings, pipeline: Pipeline,
                  codec: str = "h264", crf: int = 16, progress: Progress | None = None,
                  cancel: Callable[[], bool] | None = None, skip_repeats: bool = True,
                  max_seconds: float | None = None) -> Path:
    """Enhance a video. Decoding, the AI, and encoding run in parallel threads.

    ``skip_repeats`` reuses the previous result for frames that are copies of
    the last processed one. ``max_seconds`` stops after that much video (for
    quick tests).
    """
    src, dst = Path(src), Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    info = probe(src)
    s = even_settings(settings, info.width, info.height)
    if s.prescale <= 0:
        s = Pipeline.resolve(s, sample_frames(src, info))
    ow, oh = s.width, s.height
    frame_bytes = info.width * info.height * 3
    total = info.frames
    limit = []
    if max_seconds:
        limit = ["-t", f"{max_seconds:.3f}"]
        total = max(1, min(total, math.ceil(max_seconds * float(info.fps))))

    reader = subprocess.Popen(
        [ffmpeg_bin(), "-v", "error", "-i", str(src), *limit, "-map", "0:v:0", "-f", "rawvideo",
         "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
    )
    codec = resolve_codec(codec)
    audio = ["-map", "1:a?"]
    audio += ["-c:a", "aac", "-b:a", "192k"] if dst.suffix.lower() in (".mp4", ".m4v") else ["-c:a", "copy"]
    quality = quality_args(codec, crf)
    writer = subprocess.Popen(
        [ffmpeg_bin(), "-y", "-v", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{ow}x{oh}", "-r", str(info.fps), "-i", "-",
         *limit, "-i", str(src), "-map", "0:v:0", *audio, *CODECS[codec], *quality, "-shortest", str(dst)],
        stdin=subprocess.PIPE,
    )

    q_in: queue.Queue = queue.Queue(maxsize=6)
    q_out: queue.Queue = queue.Queue(maxsize=6)
    stop = threading.Event()
    errors: list[BaseException] = []

    def read_loop():
        try:
            while not stop.is_set():
                buf = reader.stdout.read(frame_bytes)
                if len(buf) < frame_bytes:
                    break
                _put(q_in, np.frombuffer(buf, np.uint8).reshape(info.height, info.width, 3), stop)
        except BaseException as e:  # reported by the main loop
            errors.append(e)
        finally:
            _put(q_in, _DONE, stop)

    def write_loop():
        try:
            while not stop.is_set():
                try:
                    item = q_out.get(timeout=0.2)
                except queue.Empty:
                    continue
                if item is _DONE:
                    break
                writer.stdin.write(item)
        except BaseException as e:
            errors.append(e)
            stop.set()

    threads = [threading.Thread(target=read_loop, daemon=True), threading.Thread(target=write_loop, daemon=True)]
    for t in threads:
        t.start()

    n = reused = 0
    last_src = last_out = None
    started = time.monotonic()
    try:
        while True:
            if cancel and cancel():
                raise Cancelled()
            if errors:
                raise errors[0]
            try:
                frame = q_in.get(timeout=0.2)
            except queue.Empty:
                continue
            if frame is _DONE:
                break

            def frame_progress(label: str, frac: float, n=n):
                if progress:
                    done = n + frac
                    text = f"Frame {n + 1}/{total}"
                    elapsed = time.monotonic() - started
                    if n >= 1 and elapsed > 0:
                        fps = n / elapsed
                        text += f" · {fps:.2f} fps · {format_eta((total - done) / fps)} left"
                    if reused:
                        text += f" · {reused} repeated frames reused"
                    progress(text, min(1.0, done / total))

            if skip_repeats and is_repeat(last_src, frame):
                reused += 1
                frame_progress("", 1.0)
            else:
                last_out = pipeline.process_frame(frame, s, progress=frame_progress, cancel=cancel, index=n).tobytes()
                last_src = frame
            _put(q_out, last_out, stop)
            n += 1
        _put(q_out, _DONE, stop)
        threads[1].join()
        if errors:
            raise errors[0]
    except BaseException:
        stop.set()
        reader.kill()
        writer.kill()
        writer.wait()
        for t in threads:
            t.join(timeout=5)
        dst.unlink(missing_ok=True)
        raise
    finally:
        reader.stdout.close()
        reader.wait()
    writer.stdin.close()
    if writer.wait() != 0:
        raise RuntimeError(f"FFmpeg failed while writing {dst}")
    if progress:
        progress(f"Done: {n} frames, {reused} repeated frames reused", 1.0)
    return dst
