"""Reference analysis: measure what an edit actually does so it can be reproduced.

Everything here is plain numpy over low-resolution frames, so it is fast and has no GPU needs.
  * detect_cuts      – shot boundaries and flash frames
  * detect_beats     – tempo, beat grid, strong onsets and kicks from the audio track
  * motion_profile   – per-frame camera motion (pan, zoom, rotation), brightness, blur, RGB split
  * analyze          – one combined, compact "style report" with a timeline of detected events
  * contact_sheet    – labelled frame grids so the model can *look* at the reference
"""
from __future__ import annotations

import math

import av
import numpy as np
from PIL import Image, ImageDraw

from . import media

AW = 128  # analysis frame size (square, aspect squashed)


def iter_small(path, start=0.0, end=None, size=AW, max_frames=20000):
    """Yield (time, rgb float32 array size×size×3 in 0..1) for consecutive frames."""
    with av.open(path) as c:
        s = c.streams.video[0]
        s.thread_type = "AUTO"
        tb = float(s.time_base)
        st = s.start_time or 0
        if start > 0.5:
            c.seek(int(start / tb) + st, stream=s, backward=True)
        n = 0
        for fr in c.decode(s):
            t = ((fr.pts or 0) - st) * tb
            if t < start - 1e-4:
                continue
            if end is not None and t > end:
                break
            rot = int(getattr(fr, "rotation", 0) or 0) % 360
            arr = fr.to_ndarray(width=size, height=size, format="rgb24")
            if rot:
                arr = np.rot90(arr, k=rot // 90)
            yield t, arr.astype(np.float32) / 255.0
            n += 1
            if n >= max_frames:
                break


def _luma(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def _hist(a, bins=12):
    h = [np.histogram(a[..., i], bins=bins, range=(0, 1))[0] for i in range(3)]
    h = np.concatenate(h).astype(np.float32)
    return h / max(h.sum(), 1.0)


_win_cache = {}


def _phase_corr(a, b):
    """Shift (dx, dy) that maps a onto b, plus peak confidence."""
    n = a.shape[0]
    win = _win_cache.get(n)
    if win is None:
        w = np.hanning(n).astype(np.float32)
        win = _win_cache[n] = np.outer(w, w)
    fa, fb = np.fft.rfft2((a - a.mean()) * win), np.fft.rfft2((b - b.mean()) * win)
    r = fa.conj() * fb
    r /= np.abs(r) + 1e-6
    c = np.fft.irfft2(r, s=a.shape)
    iy, ix = np.unravel_index(np.argmax(c), c.shape)
    peak = float(c[iy, ix])

    def sub(v0, v1, v2):
        d = v0 - 2 * v1 + v2
        return 0.0 if abs(d) < 1e-9 else 0.5 * (v0 - v2) / d

    dy = iy + sub(c[(iy - 1) % n, ix], peak, c[(iy + 1) % n, ix])
    dx = ix + sub(c[iy, (ix - 1) % n], peak, c[iy, (ix + 1) % n])
    if dy > n / 2:
        dy -= n
    if dx > n / 2:
        dx -= n
    return dx, dy, peak


def _tile_fit(g0, g1):
    """Least-squares similarity (complex gain c, complex shift t in pixels, confidence) from tile phase correlation."""
    n = g0.shape[0]
    tile = n // 2
    step = tile // 4
    pts, ds, ws = [], [], []
    for y in range(0, n - tile + 1, step):
        for x in range(0, n - tile + 1, step):
            dx, dy, pk = _phase_corr(g0[y:y + tile, x:x + tile], g1[y:y + tile, x:x + tile])
            if pk > 0.02:
                pts.append((x + tile / 2 - n / 2, y + tile / 2 - n / 2))
                ds.append((dx, dy))
                ws.append(pk)
    if len(pts) < 6:
        return 1 + 0j, 0j, 0.0
    P, D, W = np.array(pts), np.array(ds), np.sqrt(np.array(ws))
    # d = [[a, -b], [b, a]] p + t   →   unknowns a, b, tx, ty
    A = np.zeros((len(P) * 2, 4))
    A[0::2] = np.c_[P[:, 0], -P[:, 1], np.ones(len(P)), np.zeros(len(P))]
    A[1::2] = np.c_[P[:, 1], P[:, 0], np.zeros(len(P)), np.ones(len(P))]
    w2 = np.repeat(W, 2)
    sol, *_ = np.linalg.lstsq(A * w2[:, None], D.reshape(-1) * w2, rcond=None)
    for _ in range(2):  # robust refits: drop the worst third of tiles (moving subjects)
        res = np.abs(A @ sol - D.reshape(-1)).reshape(-1, 2).sum(1)
        keep = res <= np.percentile(res, 67)
        if keep.sum() < 6:
            break
        k2 = np.repeat(keep, 2)
        sol, *_ = np.linalg.lstsq((A * w2[:, None])[k2], (D.reshape(-1) * w2)[k2], rcond=None)
    a, b, tx, ty = sol
    return complex(1 + a, b), complex(tx, ty), float(np.mean(ws))


def _warp(g, c, t):
    """Resample g at c·p + t (p centred), bilinear: undoes a similarity so the residual can be measured."""
    n = g.shape[0]
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    z = (xs - n / 2 + 1j * (ys - n / 2)) * c + t
    x = np.clip(z.real + n / 2, 0, n - 1.001)
    y = np.clip(z.imag + n / 2, 0, n - 1.001)
    x0, y0 = x.astype(int), y.astype(int)
    fx, fy = x - x0, y - y0
    return (g[y0, x0] * (1 - fx) * (1 - fy) + g[y0, x0 + 1] * fx * (1 - fy)
            + g[y0 + 1, x0] * (1 - fx) * fy + g[y0 + 1, x0 + 1] * fx * fy)


def _similarity(g0, g1, refine=2):
    """Global motion between two grey frames: (tx, ty in frame fractions, zoom factor, rotation deg, confidence).

    Coarse-to-fine: estimate, undo the estimate, measure what is left. Handles large zoom punches and shakes."""
    n = g0.shape[0]
    c, t, conf = _tile_fit(g0, g1)
    for _ in range(refine):
        if conf <= 0:
            break
        c2, t2, conf2 = _tile_fit(g0, _warp(g1, c, t))
        if conf2 <= 0:
            break
        c, t, conf = c * c2, c * t2 + t, max(conf, conf2)
    if conf <= 0:
        return 0.0, 0.0, 1.0, 0.0, 0.0
    return float(t.real / n), float(t.imag / n), float(abs(c)), float(math.degrees(math.atan2(c.imag, c.real))), conf


def _grad(c):
    return np.abs(np.diff(c, axis=0, prepend=c[:1])) + np.abs(np.diff(c, axis=1, prepend=c[:, :1]))


def _rgb_split(a):
    """Misregistration between the red and blue channels as a fraction of frame width.

    Linear splits show up as a shift, radial (lens-style) splits as a scale difference between channels."""
    tx, ty, zoom, _, conf = _similarity(_grad(a[..., 0]), _grad(a[..., 2]), refine=0)
    if conf < 0.08:
        return 0.0
    return float(max(math.hypot(tx, ty), abs(zoom - 1.0) * 0.5))


def frame_stats(path, start=0.0, end=None):
    """Per-frame measurements used by every other analysis."""
    T, rows, grids, prev, prev_h = [], [], [], None, None
    ys, xs = np.mgrid[0:AW, 0:AW].astype(np.float32)
    rx, ry = xs - AW / 2 + 0.5, ys - AW / 2 + 0.5
    rn = np.hypot(rx, ry) + 1e-6
    rx, ry = rx / rn, ry / rn
    for t, a in iter_small(path, start, end):
        g = _luma(a)
        h = _hist(a)
        mx, mn = a.max(-1), a.min(-1)
        sat = float(np.mean((mx - mn) / (mx + 1e-4)))
        gx = np.diff(g, axis=1, prepend=g[:, :1])
        gy = np.diff(g, axis=0, prepend=g[:1])
        ex, ey = float(np.mean(gx * gx)), float(np.mean(gy * gy))
        erad, etan = float(np.mean((gx * rx + gy * ry) ** 2)), float(np.mean((-gx * ry + gy * rx) ** 2))
        row = {"luma": float(g.mean()), "contrast": float(g.std()), "sat": sat, "sharp": math.sqrt(ex + ey),
               "ex": ex, "ey": ey, "erad": erad, "etan": etan, "rgb_split": _rgb_split(a),
               "hist_diff": 0.0, "grid_diff": 0.0, "tx": 0.0, "ty": 0.0, "zoom": 1.0, "rot": 0.0, "conf": 0.0}
        grid = a.reshape(8, AW // 8, 8, AW // 8, 3).mean((1, 3))
        if prev is not None:
            row["hist_diff"] = float(np.abs(h - prev_h).sum() / 2)
            row["grid_diff"] = float(np.mean(np.abs(grid - grids[-1])))
            row["tx"], row["ty"], row["zoom"], row["rot"], row["conf"] = _similarity(prev, g)
        prev, prev_h = g, h
        T.append(t)
        rows.append(row)
        grids.append(grid)
    cols = {k: np.array([r[k] for r in rows]) for k in (rows[0] if rows else {})}
    cols["t"] = np.array(T)
    cols["grid"] = np.array(grids)
    return cols


def _corr(a, b):
    """Exposure-invariant similarity of two colour grids (1 = same picture, ~0 = unrelated)."""
    a, b = a.reshape(-1) - a.mean(), b.reshape(-1) - b.mean()
    d = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(a @ b) / d if d > 1e-9 else 1.0


def _cuts_from(st, sensitivity=1.0):
    """Indices of cut frames (first frame of the new shot) and of flash frames.

    Hard cuts are score peaks where the picture stays different afterwards. Cuts hidden inside a blurred
    transition (whip, spin, zoom) are found by comparing the picture before and after the blurred run."""
    t, hd, gd, lum, grid = st["t"], st["hist_diff"], st["grid_diff"], st["luma"], st["grid"]
    n = len(t)
    score = hd * 0.5 + np.clip(gd * 4.0, 0, 1) * 0.5
    flashes = []
    for i in range(1, n - 1):
        before = np.median(lum[max(0, i - 6):max(1, i - 1)])
        after = np.median(lum[min(n - 1, i + 2):min(n, i + 8)]) if i + 2 < n else before
        if lum[i] - max(before, after) > 0.18 and lum[i] >= lum[max(0, i - 2):i + 3].max() - 1e-9:
            flashes.append(i)
    cuts = []
    thr = 0.16 / sensitivity
    for i in range(1, n):
        lo, hi = max(1, i - 6), min(n, i + 7)
        if score[i] < thr or score[i] < score[lo:hi].max() - 1e-9 or score[i] < np.median(score[lo:hi]) * 2.5 + 0.03:
            continue
        if _corr(grid[max(0, i - 3)], grid[min(n - 1, i + 3)]) > 0.6:
            continue  # same picture a moment later: a flash, shake or glitch, not a cut
        cuts.append(i)
    med = float(np.median(st["sharp"])) + 1e-6
    for a, b in _runs(st["sharp"] < med * 0.5, t, 2):
        if any(a - 2 <= c <= b + 2 for c in cuts):
            continue
        if _corr(grid[max(0, a - 2)], grid[min(n - 1, b + 2)]) < 0.45:
            cuts.append(int(a + np.argmin(st["sharp"][a:b + 1])))
    cuts = sorted(set(cuts))
    cuts = [c for i, c in enumerate(cuts) if i == 0 or c - cuts[i - 1] >= 3]
    return cuts, flashes


def detect_cuts(path, start=0.0, end=None, sensitivity=1.0, stats=None):
    st = stats or frame_stats(path, start, end)
    cuts, flashes = _cuts_from(st, sensitivity)
    t = st["t"]
    times = [round(float(t[i]), 3) for i in cuts]
    edges = [float(t[0])] + [float(t[i]) for i in cuts] + [float(t[-1]) + (t[1] - t[0] if len(t) > 1 else 0)]
    shots = [round(b - a, 3) for a, b in zip(edges[:-1], edges[1:])]
    return {"cuts": times, "shot_lengths": shots, "flashes": [round(float(t[i]), 3) for i in flashes],
            "count": len(times), "avg_shot": round(float(np.mean(shots)), 3) if shots else None,
            "median_shot": round(float(np.median(shots)), 3) if shots else None,
            "note": "hard cuts and cuts hidden inside fast transitions; slow dissolves are not listed"}


# --------------------------------------------------------------------------- audio

def detect_beats(path, start=0.0, end=None, max_onsets=200):
    """Tempo, beat grid and the strongest onsets of a file's audio track."""
    y = media.load_audio(path, 22050)
    if len(y) < 2048:
        return {"has_audio": False, "bpm": None, "beats": [], "onsets": [], "kicks": []}
    sr = 22050
    y = y.mean(1)
    i0, i1 = int(start * sr), int(end * sr) if end else len(y)
    y = y[i0:i1]
    nfft, hop = 1024, 256
    nfr = 1 + (len(y) - nfft) // hop
    if nfr < 8:
        return {"has_audio": True, "bpm": None, "beats": [], "onsets": [], "kicks": []}
    idx = np.arange(nfft)[None, :] + hop * np.arange(nfr)[:, None]
    mag = np.abs(np.fft.rfft(y[idx] * np.hanning(nfft)[None, :], axis=1))
    logm = np.log1p(200.0 * mag)
    flux = np.maximum(np.diff(logm, axis=0), 0)
    env = np.concatenate([[0], flux.sum(1)])
    lowbins = max(2, int(160 / (sr / nfft)))
    low = np.concatenate([[0], flux[:, :lowbins].sum(1)])
    fps = sr / hop
    ftime = lambda i: start + (i * hop + nfft * 0.75) / sr  # flux fires as the onset enters the window

    def norm(e):
        e = e - np.convolve(e, np.ones(int(fps * 0.4)) / int(fps * 0.4), mode="same")
        e = np.maximum(e, 0)
        return e / (e.std() + 1e-9)

    env_n, low_n = norm(env), norm(low)

    def peaks(e, delta, wait):
        out = []
        for i in range(2, len(e) - 2):
            if e[i] > delta and e[i] >= e[i - 2:i + 3].max() and (not out or i - out[-1][0] >= wait):
                out.append((i, float(e[i])))
        return out

    onsets = peaks(env_n, 1.2, int(fps * 0.06))
    kicks = peaks(low_n, max(1.5, 0.35 * float(np.percentile(low_n, 99.5))), int(fps * 0.1))
    env_n = env_n + 1.5 * low_n  # beats follow the low end: kicks outrank hi-hats when choosing the phase
    # tempo by autocorrelation with a gentle prior around 120 bpm
    ac = np.correlate(env_n, env_n, mode="full")[len(env_n) - 1:]
    best, bpm = -1, None
    for cand in np.arange(60.0, 200.0, 0.5):
        lag = fps * 60.0 / cand
        k = int(lag)
        if k + 1 >= len(ac):
            continue
        v = ac[k] * (1 - (lag - k)) + ac[k + 1] * (lag - k)
        v += 0.5 * (ac[int(lag * 2)] if int(lag * 2) < len(ac) else 0)
        v *= math.exp(-0.5 * (math.log2(cand / 120.0) / 0.9) ** 2)
        if v > best:
            best, bpm = v, cand
    beats = []
    if bpm:
        period = fps * 60.0 / bpm
        n = len(env_n)
        score = env_n.copy()
        back = -np.ones(n, dtype=int)
        lo, hi = int(round(period * 0.5)), int(round(period * 2.0))
        for i in range(n):
            a, b = max(0, i - hi), i - lo
            if b <= a:
                continue
            prev = np.arange(a, b)
            pen = -100.0 * np.log((i - prev) / period) ** 2
            j = int(np.argmax(score[prev] + pen))
            score[i] = env_n[i] + score[prev[j]] + pen[j]
            back[i] = prev[j]
        i = int(np.argmax(score[-int(period):]) + n - int(period)) if n > period else int(np.argmax(score))
        while i >= 0:
            beats.append(i)
            i = back[i]
        beats = [round(ftime(i), 3) for i in reversed(beats)]
    onsets.sort(key=lambda p: -p[1])
    strong = sorted(onsets[:max_onsets])
    # loudness curve + "drops" (sudden jumps in energy)
    blk = int(sr * 0.5)
    rms = np.array([float(np.sqrt(np.mean(y[i:i + blk] ** 2))) for i in range(0, max(len(y) - blk, 1), blk)])
    drops = []
    for i in range(2, len(rms)):
        if rms[i] > 1.6 * np.mean(rms[max(0, i - 4):i]) + 0.01 and rms[i] > 0.5 * rms.max():
            if not drops or start + i * 0.5 - drops[-1] > 2.0:
                drops.append(round(start + i * 0.5, 2))
    return {"has_audio": True, "bpm": round(float(bpm), 1) if bpm else None, "beat_period": round(60.0 / bpm, 4) if bpm else None,
            "beats": beats, "onsets": [{"t": round(ftime(i), 3), "strength": round(s, 2)} for i, s in strong],
            "kicks": [round(ftime(i), 3) for i, _ in kicks], "energy_per_half_second": [round(float(x), 3) for x in rms],
            "drops": drops}


# --------------------------------------------------------------------------- motion

def motion_profile(path, start=0.0, end=None, stats=None):
    """Per-frame camera motion and image measurements for a time range (keep ranges short: one move at a time)."""
    st = stats or frame_stats(path, start, end)
    cuts, _ = _cuts_from(st)
    cutset = set(cuts)
    rows, cum = [], [0.0, 0.0, 1.0, 0.0]
    for i in range(len(st["t"])):
        if i in cutset:
            cum = [0.0, 0.0, 1.0, 0.0]
        elif i > 0:
            cum[0] += st["tx"][i]
            cum[1] += st["ty"][i]
            cum[2] *= st["zoom"][i]
            cum[3] += st["rot"][i]
        rows.append({"t": round(float(st["t"][i]), 3), "cut": i in cutset,
                     "dx": round(float(st["tx"][i]), 4), "dy": round(float(st["ty"][i]), 4),
                     "zoom_step": round(float(st["zoom"][i]), 4), "rot_step": round(float(st["rot"][i]), 3),
                     "cum_x": round(cum[0], 4), "cum_y": round(cum[1], 4), "cum_zoom": round(cum[2], 4), "cum_rot": round(cum[3], 3),
                     "luma": round(float(st["luma"][i]), 3), "sharp": round(float(st["sharp"][i]), 4),
                     "rgb_split": round(float(st["rgb_split"][i]), 4)})
    return {"note": "dx/dy are fractions of frame width/height per frame (positive = content moves right/down); "
                    "zoom_step > 1 = zooming in; cum_* accumulate within each shot.", "frames": rows}


def _runs(mask, t, min_len=1):
    out, i, n = [], 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j + 1 < n and mask[j + 1]:
                j += 1
            if j - i + 1 >= min_len:
                out.append((i, j))
            i = j + 1
        else:
            i += 1
    return out


def find_events(st, cuts, flashes, fps):
    """Turn per-frame measurements into a timeline of named editing moves."""
    t = st["t"]
    n = len(t)
    ev = []
    cutset = set(cuts)
    valid = np.ones(n, bool)
    for c in cuts:
        valid[max(0, c - 1):c + 2] = False
    med = float(np.median(st["sharp"])) + 1e-6
    r_xy = float(np.median(st["ex"] / (st["ey"] + 1e-9)))
    r_rt = float(np.median(st["erad"] / (st["etan"] + 1e-9)))
    radial = (st["erad"] / (st["etan"] + 1e-9)) / r_rt < 0.6
    # zoom readings are only trusted on sharp frames or radially blurred ones (directional blur fools them)
    lz = np.log(np.clip(st["zoom"], 0.5, 2.0)) * valid * ((st["sharp"] >= med * 0.45) | radial)
    zooms = []
    for sign in (1, -1):
        for a, b in _runs(lz * sign > 0.01, t, 1):
            tot = float(np.exp(lz[a:b + 1].sum()))
            if abs(tot - 1) > 0.05:
                peak = int(a + np.argmax(np.abs(lz[a:b + 1])))
                zooms.append({"a": a, "b": b, "tot": tot, "shape": "front-loaded (ease-out)" if peak - a < (b - a) / 3 + 0.5 else
                              ("back-loaded (ease-in)" if b - peak < (b - a) / 3 + 0.5 else "even")})
    zooms.sort(key=lambda z: z["a"])
    used = set()
    for i, z in enumerate(zooms):
        if i in used:
            continue
        nxt = zooms[i + 1] if i + 1 < len(zooms) else None
        dur = float(t[z["b"]] - t[z["a"]] + 1 / fps)
        if nxt and z["tot"] > 1 and nxt["tot"] < 1 and nxt["a"] - z["b"] <= 2 and abs(z["tot"] * nxt["tot"] - 1) < 0.5 * (z["tot"] - 1):
            used.add(i + 1)  # in then straight back out = a punch
            ev.append({"t": float(t[z["a"]]), "type": "zoom_punch", "duration": float(t[nxt["b"]] - t[z["a"]] + 1 / fps),
                       "amount": round(z["tot"], 3), "attack_s": round(dur, 3),
                       "decay_s": round(float(t[nxt["b"]] - t[nxt["a"]] + 1 / fps), 3), "decay_shape": nxt["shape"]})
        else:
            ev.append({"t": float(t[z["a"]]), "type": "zoom_in" if z["tot"] > 1 else "zoom_out", "duration": dur,
                       "amount": round(z["tot"], 3), "shape": z["shape"]})
    mv = np.hypot(st["tx"], st["ty"]) * valid
    for a, b in _runs(mv > 0.008, t, 3):
        sx, sy = st["tx"][a:b + 1], st["ty"][a:b + 1]
        net = math.hypot(sx.sum(), sy.sum())
        path = float(mv[a:b + 1].sum())
        if net > 0.6 * path and net > 0.25:
            ang = math.degrees(math.atan2(sy.sum(), sx.sum()))
            d = "right" if -45 <= ang < 45 else "down" if 45 <= ang < 135 else "up" if -135 <= ang < -45 else "left"
            ev.append({"t": float(t[a]), "type": "whip_pan", "duration": float(t[b] - t[a] + 1 / fps),
                       "direction": f"content moves {d}", "amount": round(net, 3)})
        elif path > 0.06 and net < 0.5 * path:
            ev.append({"t": float(t[a]), "type": "shake", "duration": float(t[b] - t[a] + 1 / fps),
                       "amount": round(float(mv[a:b + 1].max()), 4), "peak_px_at_1080w": int(mv[a:b + 1].max() * 1080)})
    rot = st["rot"] * valid
    for a, b in _runs(np.abs(rot) > 1.2, t, 3):
        tot = float(rot[a:b + 1].sum())
        if abs(tot) > 12:
            ev.append({"t": float(t[a]), "type": "spin", "duration": float(t[b] - t[a] + 1 / fps), "degrees": round(tot, 1)})
    for i in flashes:
        ev.append({"t": float(t[i]), "type": "flash", "duration": round(2 / fps, 3), "brightness": round(float(st["luma"][i]), 2)})
    base_split = float(np.median(st["rgb_split"]))  # constant fringing is a look, spikes are hits
    for a, b in _runs((st["rgb_split"] > base_split + 0.012) & (st["sharp"] >= med * 0.5), t, 1):
        if any(a - 1 <= f <= b + 1 for f in flashes):
            continue
        ev.append({"t": float(t[a]), "type": "rgb_split", "duration": float(t[b] - t[a] + 1 / fps),
                   "amount_px_at_1080w": int(st["rgb_split"][a:b + 1].max() * 1080 / 2)})
    for a, b in _runs(st["sharp"] < med * 0.45, t, 2):
        k = int(a + np.argmin(st["sharp"][a:b + 1]))
        xy = (st["ex"][k] / (st["ey"][k] + 1e-9)) / r_xy
        rt = (st["erad"][k] / (st["etan"][k] + 1e-9)) / r_rt
        ratios = {"horizontal motion blur (whip/slide left-right)": xy, "vertical motion blur (whip/slide up-down)": 1 / max(xy, 1e-6),
                  "radial zoom blur": rt, "rotational spin blur": 1 / max(rt, 1e-6)}
        kind, val = min(ratios.items(), key=lambda kv: kv[1])
        ev.append({"t": float(t[a]), "type": "blur", "duration": float(t[b] - t[a] + 1 / fps),
                   "kind": kind if val < 0.55 else "defocus / gaussian blur",
                   "sharpness_ratio": round(float(st["sharp"][a:b + 1].min() / med), 2)})
    for e in ev:
        e["t"] = round(e["t"], 3)
        e["duration"] = round(e["duration"], 3)
        near = [float(t[c]) for c in cutset if abs(float(t[c]) - e["t"]) < 0.12 or abs(float(t[c]) - (e["t"] + e["duration"])) < 0.12]
        if near:
            e["at_cut"] = round(near[0], 3)
    ev.sort(key=lambda e: e["t"])
    return ev


RECIPES = {
    "zoom_punch": "hit_apply zoom_punch with amount = (amount-1)*100, attack = attack_s, decay = decay_s",
    "zoom_in": "keyframe a transform effect's scale (motion_blur on) with the same amount/duration/easing shape; transition zoom_in when at a cut",
    "zoom_out": "transform effect scale from >100 back to 100, or transition zoom_out when it sits on a cut",
    "whip_pan": "transition whip_left/right/up/down when at a cut, otherwise transform.offset keyframes with motion_blur",
    "shake": "preset shake_hit with amount ≈ peak_px_at_1080w",
    "spin": "transition spin_cw/spin_ccw at a cut, or transform.rotation keyframes with motion_blur",
    "flash": "preset flash (exposure pulse) or transition flash when at a cut",
    "rgb_split": "preset rgb_hit with amount ≈ amount_px_at_1080w",
    "blur": "preset blur_hit, or transition blur when at a cut",
}


def analyze(path, start=0.0, end=None, max_events=80):
    """Compact style report for a reference edit."""
    info = media.probe(path)
    st = frame_stats(path, start, end)
    if "t" not in st or len(st["t"]) < 3:
        raise ValueError("could not decode enough frames to analyse")
    fps = info.get("fps", 30.0)
    cut_idx, flash_idx = _cuts_from(st)
    cuts = detect_cuts(path, stats=st)
    beats = detect_beats(path, start, end)
    events = find_events(st, cut_idx, flash_idx, fps)
    rep = {"file": {k: info.get(k) for k in ("width", "height", "fps", "duration", "has_audio")},
           "pacing": {"cuts": cuts["cuts"], "cut_count": cuts["count"], "avg_shot_s": cuts["avg_shot"],
                      "median_shot_s": cuts["median_shot"], "shortest_shot_s": min(cuts["shot_lengths"]) if cuts["shot_lengths"] else None,
                      "longest_shot_s": max(cuts["shot_lengths"]) if cuts["shot_lengths"] else None}}
    if beats.get("bpm"):
        grid = np.array(beats["beats"])
        ons = np.array([o["t"] for o in beats["onsets"]]) if beats["onsets"] else np.array([])

        def frac_near(times, ref, tol=0.07):
            if not len(times) or not len(ref):
                return None
            return round(float(np.mean([np.min(np.abs(ref - x)) <= tol for x in times])), 2)

        ct = np.array(cuts["cuts"])
        rep["music"] = {"bpm": beats["bpm"], "beat_period_s": beats["beat_period"], "beat_count": len(beats["beats"]),
                        "first_beats": beats["beats"][:8], "drops": beats["drops"],
                        "cuts_on_beat": frac_near(ct, grid), "cuts_on_any_onset": frac_near(ct, ons),
                        "effects_on_beat": frac_near(np.array([e["t"] for e in events]), grid),
                        "note": "call detect_beats for the full beat/onset/kick lists"}
        if len(ct) > 2 and beats["beat_period"]:
            per = np.diff(ct) / beats["beat_period"]
            rep["music"]["shot_lengths_in_beats"] = [round(float(x), 2) for x in per[:40]]
    counts = {}
    for e in events:
        counts[e["type"]] = counts.get(e["type"], 0) + 1
    rep["effects_detected"] = {"counts": counts, "timeline": events[:max_events],
                               "how_to_recreate": {k: RECIPES[k] for k in counts}}
    lum, sat = st["luma"], st["sat"]
    rep["look"] = {"avg_brightness": round(float(lum.mean()), 3), "avg_contrast": round(float(st["contrast"].mean()), 3),
                   "avg_saturation": round(float(sat.mean()), 3), "grade": color_profile(path, start, end)}
    rep["next_steps"] = ("Look at the reference with media_frames (contact sheets around the cuts and events above), "
                         "use motion_profile on single moves to copy their exact curves, then rebuild with layers, "
                         "keyframes, presets and transitions and verify with compare_frames.")
    return rep


def color_profile(path, start=0.0, end=None, samples=24):
    """Average colour of shadows, midtones and highlights across the clip → reveals the grade."""
    info = media.probe(path)
    dur = info.get("duration") or 0
    end = min(end or dur, dur)
    times = np.linspace(start + 0.05, max(end - 0.05, start + 0.05), samples)
    rd = media.VideoReader(path)
    acc = {"shadows": [], "midtones": [], "highlights": []}
    black, white = [], []
    try:
        for t in times:
            a = rd.frame(float(t), (96, 96))[..., :3].astype(np.float32) / 255.0
            g = _luma(a)
            lo, hi = np.percentile(g, 25), np.percentile(g, 75)
            black.append(np.percentile(g, 1))
            white.append(np.percentile(g, 99))
            for name, m in (("shadows", g <= lo), ("midtones", (g > lo) & (g < hi)), ("highlights", g >= hi)):
                if m.any():
                    acc[name].append(a[m].mean(0))
    finally:
        rd.close()
    out = {}
    for k, v in acc.items():
        if v:
            c = np.mean(v, 0)
            out[k] = {"rgb": [round(float(x), 3) for x in c],
                      "tint": [round(float(x - c.mean()), 3) for x in c]}
    out["black_point"] = round(float(np.mean(black)), 3)
    out["white_point"] = round(float(np.mean(white)), 3)
    out["note"] = ("tint = channel minus grey: positive blue in shadows + positive red in highlights = teal/orange; "
                   "black_point well above 0 = faded/lifted blacks; white_point below 1 = soft highlights.")
    return out


# --------------------------------------------------------------------------- images for the model

def _label(img, text):
    d = ImageDraw.Draw(img)
    try:
        from .text import get_font
        font = get_font(None, max(12, img.width // 14))[0]
    except Exception:
        font = None
    box = d.textbbox((0, 0), text, font=font)
    d.rectangle((0, 0, box[2] + 10, box[3] + 8), fill=(0, 0, 0))
    d.text((5, 3), text, fill=(255, 235, 60), font=font)


def contact_sheet(frames, labels=None, columns=None, cell_width=270, gap=6):
    """frames: list of uint8 RGB arrays (same aspect). Returns a PIL image grid."""
    if not frames:
        raise ValueError("no frames")
    n = len(frames)
    columns = columns or min(n, 6 if n > 4 else n)
    rows = int(math.ceil(n / columns))
    h0, w0 = frames[0].shape[:2]
    cw = cell_width
    ch = int(round(cw * h0 / w0))
    sheet = Image.new("RGB", (columns * cw + (columns + 1) * gap, rows * ch + (rows + 1) * gap), (24, 24, 28))
    for i, f in enumerate(frames):
        im = Image.fromarray(f[..., :3]).resize((cw, ch), Image.BILINEAR)
        if labels:
            _label(im, labels[i])
        sheet.paste(im, (gap + (i % columns) * (cw + gap), gap + (i // columns) * (ch + gap)))
    return sheet


def media_frames(path, times, width=540):
    """Decode frames of a media file at the given times → list of uint8 RGB arrays."""
    info = media.probe(path)
    if info["kind"] == "image":
        im = media.load_image(path)[..., :3]
        return [np.asarray(Image.fromarray(im).resize((width, int(width * im.shape[0] / im.shape[1]))))] * len(times)
    h = int(round(width * info["height"] / info["width"] / 2)) * 2
    rd = media.VideoReader(path)
    try:
        return [rd.frame(float(t), (width, h))[..., :3].copy() for t in times]
    finally:
        rd.close()


def side_by_side(a, b, labels=("reference", "yours")):
    """Two frames next to each other at equal height, labelled."""
    h = min(a.shape[0], b.shape[0], 960)
    ims = []
    for arr, lab in zip((a, b), labels):
        im = Image.fromarray(arr[..., :3])
        im = im.resize((max(2, int(im.width * h / im.height)), h), Image.BILINEAR)
        _label(im, lab)
        ims.append(im)
    out = Image.new("RGB", (ims[0].width + ims[1].width + 8, h), (24, 24, 28))
    out.paste(ims[0], (0, 0))
    out.paste(ims[1], (ims[0].width + 8, 0))
    return out
