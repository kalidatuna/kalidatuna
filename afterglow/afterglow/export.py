"""Audio mixdown and final video export."""
from __future__ import annotations

import time

import numpy as np

from . import media
from .project import get_comp, source_times
from .props import evaluate
from .renderer import Renderer

SR = media.SAMPLE_RATE


def mix_audio(project, comp_id, start, end, depth=0):
    """Mix every audible layer of a comp between start and end → float32 (n, 2).

    Audio follows each layer's speed / time-remap (pitch shifts with speed, as in a real time remap).
    `volume` is a property: 1.0 = unity, keyframe it for fades and ducking.
    """
    comp = get_comp(project, comp_id)
    n = max(0, int(round((end - start) * SR)))
    out = np.zeros((n, 2), np.float32)
    if n == 0 or depth > 6:
        return out
    ts = start + np.arange(n) / SR
    for layer in comp["layers"]:
        if not layer.get("enabled", True) or layer.get("muted"):
            continue
        a, b = max(start, layer["start"]), min(end, layer["end"])
        if b <= a:
            continue
        i0, i1 = int(round((a - start) * SR)), min(n, int(round((b - start) * SR)))
        if i1 <= i0:
            continue
        tt = ts[i0:i1]
        if layer["type"] in ("footage", "audio"):
            m = project["media"].get(layer.get("source"))
            if not m or not m.get("has_audio"):
                continue
            src = media.load_audio(m["path"])
            if len(src) < 2:
                continue
            st = source_times(layer, tt)
            if layer.get("loop"):
                st = np.mod(st, len(src) / SR)
            pos = st * SR
            ok = (pos >= 0) & (pos < len(src) - 1)
            idx = np.clip(pos.astype(np.int64), 0, len(src) - 2)
            frac = (pos - idx).astype(np.float32)[:, None]
            seg = (src[idx] * (1 - frac) + src[idx + 1] * frac) * ok[:, None]
        elif layer["type"] == "comp" and not isinstance(layer.get("speed", 1.0), dict) and float(layer.get("speed", 1.0)) == 1.0:
            s0 = layer.get("source_in", 0.0) + (a - layer["start"])
            seg = mix_audio(project, layer["source"], s0, s0 + (b - a), depth + 1)[: i1 - i0]
            if len(seg) < i1 - i0:
                seg = np.pad(seg, ((0, i1 - i0 - len(seg)), (0, 0)))
        else:
            continue
        vol = layer.get("volume", 1.0)
        if isinstance(vol, dict):
            coarse = np.arange(a, b + 0.02, 0.01)
            g = np.interp(tt, coarse, [float(evaluate(vol, float(c))) for c in coarse]).astype(np.float32)[:, None]
            seg = seg * g
        elif vol != 1.0:
            seg = seg * float(vol)
        out[i0:i1] += seg.astype(np.float32)
    return out


def _limit(x):
    """Gentle soft-clip so stacked layers don't hard-clip."""
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    return np.tanh(x * 1.0) if peak > 0.98 else x


def render_iter(project, comp_id, path, start=0.0, end=None, scale=1.0, crf=17, codec="libx264", preset="medium",
                audio=True, renderer=None):
    """Generator: renders one frame per step, yields (done, total); returns the summary dict."""
    comp = get_comp(project, comp_id)
    fps = float(comp["fps"])
    end = comp["duration"] if end is None else min(end, comp["duration"])
    own = renderer is None
    r = renderer or Renderer(project)
    w, h = r.canvas(comp, scale)
    nframes = max(1, int(round((end - start) * fps)))
    mixed = _limit(mix_audio(project, comp_id, start, start + nframes / fps)) if audio else None
    has_audio = mixed is not None and bool(np.any(np.abs(mixed) > 1e-5))
    writer = media.VideoWriter(path, w, h, fps, crf=crf, preset=preset, codec=codec, audio=has_audio)
    t0 = time.time()
    done = 0
    try:
        for i in range(nframes):
            old = r.decode_oversample
            r.decode_oversample = 1.5 if scale >= 1.0 else 1.0
            try:
                frame = r.frame(comp_id, start + i / fps, scale)
            finally:
                r.decode_oversample = old
            writer.write(frame)
            done = i + 1
            if i % 30 == 0:
                r.gl.trim()
            yield done, nframes
    finally:
        try:
            if has_audio:
                writer.write_audio(mixed[: int(done / fps * SR)])
        finally:
            writer.close()
            if own:
                r.close()
    el = time.time() - t0
    return {"path": path, "frames": done, "total_frames": nframes, "width": writer.w, "height": writer.h, "fps": fps,
            "audio": has_audio, "seconds": round(el, 2), "render_fps": round(done / el, 2) if el > 0 else None}


def render_video(project, comp_id, path, progress=None, **kw):
    """Render a comp to an MP4 (blocking). Returns a summary dict."""
    it = render_iter(project, comp_id, path, **kw)
    while True:
        try:
            done, total = next(it)
        except StopIteration as stop:
            return stop.value
        if progress:
            progress(done, total)
