"""Media IO: frame-accurate random-access video decoding, stills, audio (PyAV + Pillow)."""
from __future__ import annotations

import os
from collections import OrderedDict
from fractions import Fraction

import av
import numpy as np
from PIL import Image

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"}
SAMPLE_RATE = 48000


def probe(path):
    """Return basic facts about a media file."""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"media file not found: {path}")
    ext = os.path.splitext(path)[1].lower()
    if ext in IMAGE_EXT:
        with Image.open(path) as im:
            return {"path": path, "kind": "image", "width": im.width, "height": im.height, "has_audio": False}
    with av.open(path) as c:
        info = {"path": path, "has_audio": bool(c.streams.audio)}
        dur = float(c.duration / av.time_base) if c.duration else 0.0
        if c.streams.video and ext not in AUDIO_EXT:
            s = c.streams.video[0]
            fps = float(s.average_rate or s.guessed_rate or 30)
            rot = 0
            try:
                for fr in c.decode(s):
                    rot = int(getattr(fr, "rotation", 0) or 0)
                    break
            except Exception:
                pass
            w, h = s.codec_context.width, s.codec_context.height
            if abs(rot) % 180 == 90:
                w, h = h, w
            if s.duration and s.time_base:
                dur = float(s.duration * s.time_base)
            info.update(kind="video", width=w, height=h, fps=round(fps, 4), duration=round(dur, 4),
                        frames=int(s.frames or round(dur * fps)), rotation=rot,
                        has_alpha="a" in (s.codec_context.pix_fmt or "") and "gray" not in (s.codec_context.pix_fmt or ""))
        else:
            info.update(kind="audio", duration=round(dur, 4))
    return info


class VideoReader:
    """Random-access frame reader with an LRU cache; cheap for forward, reverse and ramped playback."""

    def __init__(self, path, cache_mb=900):
        self.path = path
        self.container = av.open(path)
        self.stream = self.container.streams.video[0]
        self.stream.thread_type = "AUTO"
        self.fps = float(self.stream.average_rate or self.stream.guessed_rate or 30)
        self.tb = float(self.stream.time_base)
        self.start_pts = self.stream.start_time or 0
        self.alpha = "a" in (self.stream.codec_context.pix_fmt or "") and "gray" not in (self.stream.codec_context.pix_fmt or "")
        dur = float(self.stream.duration * self.stream.time_base) if self.stream.duration else float(
            (self.container.duration or 0) / av.time_base)
        self.nframes = max(1, int(self.stream.frames or round(dur * self.fps)))
        self.duration = self.nframes / self.fps
        self.cache = OrderedDict()
        self.cache_bytes = cache_mb * 1024 * 1024
        self.size = None
        self._iter = None
        self._pos = -1
        self._last = None

    def close(self):
        try:
            self.container.close()
        except Exception:
            pass

    def _index(self, frame):
        pts = frame.pts if frame.pts is not None else 0
        return int(round((pts - self.start_pts) * self.tb * self.fps))

    def _convert(self, frame, size):
        rot = int(getattr(frame, "rotation", 0) or 0) % 360
        w, h = size
        if rot in (90, 270):
            w, h = h, w
        arr = frame.to_ndarray(width=w, height=h, format="rgba" if self.alpha else "rgb24")
        if rot:
            arr = np.rot90(arr, k=rot // 90)
        return np.ascontiguousarray(arr)

    def frame(self, t, size):
        """Decoded frame nearest to source time t, scaled to size (w, h) in display orientation."""
        size = (max(2, int(size[0])), max(2, int(size[1])))
        if size != self.size:
            self.cache.clear()
            self.size = size
        idx = min(max(int(t * self.fps + 1e-4), 0), self.nframes - 1)
        hit = self.cache.get(idx)
        if hit is not None:
            self.cache.move_to_end(idx)
            return hit
        if self._iter is None or idx <= self._pos or idx > self._pos + max(48, int(self.fps * 2)):
            pts = int(idx / self.fps / self.tb) + self.start_pts
            self.container.seek(max(pts, self.start_pts), stream=self.stream, backward=True, any_frame=False)
            self._iter = self.container.decode(self.stream)
            self._pos = -1
        per = size[0] * size[1] * (4 if self.alpha else 3)
        limit = max(8, self.cache_bytes // per)
        got = None
        try:
            for fr in self._iter:
                i = self._index(fr)
                self._pos = i
                # only keep frames near the target; long seeks would otherwise flood the cache
                if i >= idx - limit // 2:
                    arr = self._convert(fr, size)
                    self.cache[i] = arr
                    self._last = arr
                    while len(self.cache) > limit:
                        self.cache.popitem(last=False)
                    if i >= idx:
                        got = arr
                        break
        except (av.error.EOFError, StopIteration):
            pass
        if got is None:  # past the end of the stream: hold the last frame
            self._iter = None
            got = self._last
            if got is None:
                got = np.zeros((size[1], size[0], 4 if self.alpha else 3), np.uint8)
            self.cache[idx] = got
        return got


_image_cache = {}


def load_image(path, max_side=4096):
    key = (path, os.path.getmtime(path))
    if key not in _image_cache:
        im = Image.open(path)
        try:
            from PIL import ImageOps
            im = ImageOps.exif_transpose(im)
        except Exception:
            pass
        im = im.convert("RGBA")
        if max(im.size) > max_side:
            k = max_side / max(im.size)
            im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
        _image_cache[key] = np.asarray(im)
    return _image_cache[key]


_audio_cache = {}


def load_audio(path, sr=SAMPLE_RATE):
    """Whole file as float32 (n, 2) at sr. Returns an empty array when there is no audio."""
    key = (path, sr)
    if key in _audio_cache:
        return _audio_cache[key]
    chunks = []
    with av.open(path) as c:
        if c.streams.audio:
            s = c.streams.audio[0]
            res = av.AudioResampler(format="flt", layout="stereo", rate=sr)
            for frame in c.decode(s):
                for f in res.resample(frame):
                    chunks.append(f.to_ndarray().reshape(-1, 2).copy())
            for f in res.resample(None):
                chunks.append(f.to_ndarray().reshape(-1, 2).copy())
    out = np.concatenate(chunks) if chunks else np.zeros((0, 2), np.float32)
    _audio_cache[key] = out
    return out


class VideoWriter:
    """H.264 + AAC MP4 writer."""

    def __init__(self, path, width, height, fps, crf=17, preset="medium", codec="libx264", audio=False):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.out = av.open(path, "w")
        self.w, self.h = width - width % 2, height - height % 2
        rate = Fraction(fps).limit_denominator(1001)
        self.vs = self.out.add_stream(codec, rate=rate)
        self.vs.width, self.vs.height = self.w, self.h
        self.vs.pix_fmt = "yuv420p"
        if codec == "libx264":
            self.vs.options = {"crf": str(crf), "preset": preset}
        elif "nvenc" in codec:
            self.vs.options = {"rc": "vbr", "cq": str(crf + 2), "preset": "p5"}
        self.aud = None
        if audio:
            self.aud = self.out.add_stream("aac", rate=SAMPLE_RATE)
            self.aud.bit_rate = 256000
            try:
                self.aud.layout = "stereo"
            except Exception:
                pass
        self.n = 0

    def write(self, rgb):
        frame = av.VideoFrame.from_ndarray(np.ascontiguousarray(rgb[: self.h, : self.w, :3]), format="rgb24")
        frame.pts = self.n
        self.n += 1
        for pkt in self.vs.encode(frame):
            self.out.mux(pkt)

    def write_audio(self, samples):
        """samples: float32 (n, 2)."""
        if self.aud is None or not len(samples):
            return
        step, pts = 1024, 0
        for i in range(0, len(samples), step):
            chunk = samples[i:i + step]
            fr = av.AudioFrame.from_ndarray(np.ascontiguousarray(chunk.T), format="fltp", layout="stereo")
            fr.sample_rate = SAMPLE_RATE
            fr.pts = pts
            pts += len(chunk)
            for pkt in self.aud.encode(fr):
                self.out.mux(pkt)

    def close(self):
        for pkt in self.vs.encode(None):
            self.out.mux(pkt)
        if self.aud is not None:
            for pkt in self.aud.encode(None):
                self.out.mux(pkt)
        self.out.close()
