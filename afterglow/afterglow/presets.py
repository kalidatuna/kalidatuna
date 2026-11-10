"""One-call building blocks: beat hits, colour looks and transitions.

They only write ordinary effects and keyframes onto layers, so everything they
produce can be inspected and tweaked afterwards with the normal tools.
"""
from __future__ import annotations

from .project import add_effect, add_pulse, find_layer, get_comp, set_keyframes, set_prop


def _ensure(project, layer, type, tag, params):
    """Reuse the effect a preset created earlier on this layer, or add it."""
    for fx in layer.get("effects", []):
        if fx["type"] == type and fx.get("tag") == tag:
            return fx
    fx = add_effect(project, layer, type, params)
    fx["tag"] = tag
    return fx


def _pulse(project, layer, type, param, t, peak, base, attack, decay, extra=None, ease_out="easeOutCubic"):
    fx = _ensure(project, layer, type, "hit", dict(extra or {}, **{param: base}))
    add_pulse(layer, f"{fx['id']}.{param}", t, peak, base=base, attack=attack, decay=decay, ease_out=ease_out)
    return fx["id"]


# --------------------------------------------------------------------------- hits

def zoom_punch(project, comp, layer, t, amount=18.0, attack=0.05, decay=0.45, **_):
    """Quick scale bump that eases back: the standard beat zoom."""
    return _pulse(project, layer, "transform", "scale", t, 100.0 + amount, 100.0, attack, decay,
                  {"edge": "mirror", "motion_blur": 0.8}, "easeOutExpo")


def shake_hit(project, comp, layer, t, amount=45.0, attack=0.02, decay=0.4, **_):
    """Burst of camera shake that settles."""
    return _pulse(project, layer, "shake", "amount", t, amount, 0.0, attack, decay, {"rotation": 1.5, "frequency": 16.0})


def flash(project, comp, layer, t, amount=2.5, attack=0.02, decay=0.25, **_):
    """White exposure flash."""
    return _pulse(project, layer, "exposure", "stops", t, amount, 0.0, attack, decay)


def color_flash(project, comp, layer, t, amount=0.8, attack=0.02, decay=0.25, color="#ffffff", blend="add", **_):
    """Flash of a flat colour over the layer."""
    fx = _ensure(project, layer, "color_overlay", "hit:" + str(color), {"color": color, "blend": blend, "opacity": 0.0})
    add_pulse(layer, f"{fx['id']}.opacity", t, amount, base=0.0, attack=attack, decay=decay)
    return fx["id"]


def rgb_hit(project, comp, layer, t, amount=30.0, attack=0.02, decay=0.3, **_):
    """RGB split that snaps out and collapses."""
    return _pulse(project, layer, "rgb_split", "amount", t, amount, 0.0, attack, decay, {"mode": "radial"})


def glow_pulse(project, comp, layer, t, amount=2.0, attack=0.03, decay=0.4, **_):
    """Bloom that swells on the hit."""
    return _pulse(project, layer, "glow", "intensity", t, amount, 0.0, attack, decay, {"threshold": 0.5, "radius": 90.0})


def blur_hit(project, comp, layer, t, amount=40.0, attack=0.03, decay=0.3, **_):
    """Quick defocus that snaps back to sharp."""
    return _pulse(project, layer, "gaussian_blur", "radius", t, amount, 0.0, attack, decay)


def zoom_blur_hit(project, comp, layer, t, amount=0.25, attack=0.03, decay=0.3, **_):
    """Radial streak burst."""
    return _pulse(project, layer, "zoom_blur", "amount", t, amount, 0.0, attack, decay)


def bass_bump(project, comp, layer, t, amount=0.35, attack=0.04, decay=0.3, **_):
    """Lens bulge that thumps with a kick."""
    return _pulse(project, layer, "bulge", "amount", t, amount, 0.0, attack, decay, {"radius": 1.2})


def glitch_hit(project, comp, layer, t, amount=0.8, duration=0.15, **_):
    """Glitch that fires for a few frames."""
    fx = _ensure(project, layer, "glitch", "hit", {"amount": 0.0})
    set_keyframes(layer, f"{fx['id']}.amount", [{"t": t, "v": amount, "ease": "hold"}, {"t": t + duration, "v": 0.0}],
                  clear_range=(t, t + duration))
    return fx["id"]


def invert_hit(project, comp, layer, t, duration=0.07, **_):
    """Negative frames for an instant."""
    fx = _ensure(project, layer, "invert", "hit", {"amount": 0.0})
    set_keyframes(layer, f"{fx['id']}.amount", [{"t": t, "v": 1.0, "ease": "hold"}, {"t": t + duration, "v": 0.0}],
                  clear_range=(t, t + duration))
    return fx["id"]


def impact(project, comp, layer, t, amount=1.0, **_):
    """Combined hit: zoom punch + shake + flash + RGB split, scaled by amount."""
    return [zoom_punch(project, comp, layer, t, 16.0 * amount), shake_hit(project, comp, layer, t, 40.0 * amount),
            flash(project, comp, layer, t, 1.6 * amount), rgb_hit(project, comp, layer, t, 24.0 * amount)]


def velocity(project, comp, layer, t, slow=0.3, fast=2.5, ramp=0.35, hold=0.15, **_):
    """Speed ramp around t: fast into the moment, slow-motion on it, fast out. Works on footage layers."""
    if layer["type"] not in ("footage", "comp"):
        raise ValueError("velocity needs a footage or comp layer")
    cur = layer.get("speed", 1.0)
    if not isinstance(cur, dict):
        set_prop(layer, "speed", {"keyframes": [{"t": layer["start"], "v": float(cur)}]})
    kfs = [{"t": round(t - ramp, 4), "v": fast, "ease": "easeOutCubic"},
           {"t": round(t, 4), "v": slow, "ease": "linear"},
           {"t": round(t + hold, 4), "v": slow, "ease": "easeInCubic"},
           {"t": round(t + hold + ramp, 4), "v": fast}]
    kfs = [k for k in kfs if layer["start"] <= k["t"] <= layer["end"]]
    set_keyframes(layer, "speed", kfs, clear_range=(t - ramp, t + hold + ramp))
    layer["frame_blend"] = True
    return "speed"


def push_in(project, comp, layer, t=None, amount=10.0, **_):
    """Slow continuous zoom across the whole layer (adds life to static shots)."""
    fx = _ensure(project, layer, "transform", "push", {"edge": "mirror"})
    set_keyframes(layer, f"{fx['id']}.scale", [{"t": layer["start"], "v": 100.0}, {"t": layer["end"], "v": 100.0 + amount}], mode="replace")
    return fx["id"]


HITS = {f.__name__: f for f in (zoom_punch, shake_hit, flash, color_flash, rgb_hit, glow_pulse, blur_hit, zoom_blur_hit,
                                bass_bump, glitch_hit, invert_hit, impact, velocity, push_in)}

# --------------------------------------------------------------------------- looks

LOOKS = {
    "teal_orange": ("Blockbuster grade: teal shadows, warm skin and highlights.", [
        ("split_tone", {"shadows": [0.0, 0.4, 0.55, 1], "highlights": [1.0, 0.6, 0.25, 1], "amount": 0.35}),
        ("curves", {"master": [[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]]}),
        ("vibrance", {"amount": 0.3})]),
    "moody_dark": ("Low-key, desaturated, crushed shadows with a cool cast.", [
        ("exposure", {"stops": -0.35}),
        ("curves", {"master": [[0, 0], [0.3, 0.2], [0.7, 0.72], [1, 0.94]]}),
        ("hue_saturation", {"saturation": 0.7}),
        ("color_balance", {"lift": [-0.01, 0.0, 0.03, 1], "gain": [0.98, 1.0, 1.04, 1]}),
        ("vignette", {"amount": 0.55, "size": 0.35, "softness": 0.7})]),
    "vintage_film": ("Faded stock with halation, grain and warm tones.", [
        ("fade", {"amount": 0.3}),
        ("temperature", {"temperature": 0.18, "tint": 0.04}),
        ("halation", {"amount": 0.7}),
        ("film_grain", {"amount": 0.3, "size": 1.8}),
        ("vignette", {"amount": 0.35})]),
    "vhs_tape": ("Camcorder tape: smeared chroma, scanlines, tracking noise.", [
        ("hue_saturation", {"saturation": 1.15}),
        ("vhs", {"amount": 1.0}),
        ("gaussian_blur", {"radius": 1.5, "direction": "horizontal"})]),
    "dreamy": ("Soft bloom, pastel colour and lifted shadows.", [
        ("diffusion", {"radius": 50.0, "amount": 0.7}),
        ("fade", {"amount": 0.2, "color": [0.14, 0.11, 0.16, 1]}),
        ("vibrance", {"amount": 0.25}),
        ("temperature", {"temperature": 0.08, "tint": 0.08})]),
    "cyberpunk_neon": ("Magenta/cyan split, heavy glow, deep contrast.", [
        ("split_tone", {"shadows": [0.0, 0.3, 0.9, 1], "highlights": [1.0, 0.1, 0.7, 1], "amount": 0.55}),
        ("curves", {"master": [[0, 0], [0.3, 0.2], [0.7, 0.85], [1, 1]]}),
        ("glow", {"threshold": 0.55, "radius": 90.0, "intensity": 0.8, "saturation": 1.8}),
        ("rgb_split", {"amount": 3.0, "mode": "radial"})]),
    "bw_contrast": ("Punchy black and white with grain.", [
        ("black_white", {"amount": 1.0}),
        ("curves", {"master": [[0, 0], [0.25, 0.15], [0.75, 0.88], [1, 1]]}),
        ("film_grain", {"amount": 0.25})]),
    "anime_vivid": ("Saturated, bright and crisp, the look of anime fan edits.", [
        ("vibrance", {"amount": 0.6}),
        ("hue_saturation", {"saturation": 1.2}),
        ("curves", {"master": [[0, 0], [0.25, 0.22], [0.75, 0.84], [1, 1]]}),
        ("sharpen", {"amount": 0.8, "radius": 2.0}),
        ("glow", {"threshold": 0.7, "radius": 60.0, "intensity": 0.45})]),
    "warm_golden": ("Golden-hour warmth with soft highlights.", [
        ("temperature", {"temperature": 0.3, "tint": 0.05}),
        ("color_balance", {"gain": [1.05, 1.0, 0.92, 1]}),
        ("diffusion", {"radius": 35.0, "amount": 0.35}),
        ("vignette", {"amount": 0.3})]),
    "cold_blue": ("Cold steel-blue grade for night and winter footage.", [
        ("temperature", {"temperature": -0.3}),
        ("hue_saturation", {"saturation": 0.85}),
        ("curves", {"master": [[0, 0], [0.3, 0.24], [0.75, 0.8], [1, 1]]}),
        ("vignette", {"amount": 0.4})]),
    "clean_pop": ("Neutral polish: gentle contrast, vibrance and sharpening for talking-head clips.", [
        ("curves", {"master": [[0, 0], [0.25, 0.23], [0.75, 0.79], [1, 1]]}),
        ("vibrance", {"amount": 0.35}),
        ("sharpen", {"amount": 0.5, "radius": 1.5})]),
}


def apply_look(project, layer, name):
    if name not in LOOKS:
        raise KeyError(f"unknown look {name!r}; looks: {list(LOOKS)}")
    ids = []
    for type, params in LOOKS[name][1]:
        fx = add_effect(project, layer, type, params)
        fx["tag"] = "look:" + name
        ids.append(fx["id"])
    return ids


# --------------------------------------------------------------------------- transitions

TRANSITIONS = {
    "whip_left": "Fast pan: picture flies off to the left with motion blur, next clip arrives from the right.",
    "whip_right": "Fast pan to the right.",
    "whip_up": "Fast pan upward.",
    "whip_down": "Fast pan downward.",
    "zoom_in": "Punch into the outgoing clip, next clip lands from a larger zoom.",
    "zoom_out": "Pull out of the outgoing clip, next clip settles from small.",
    "spin_cw": "Clockwise spin with blur through the cut.",
    "spin_ccw": "Counter-clockwise spin with blur through the cut.",
    "flash": "White flash peaking on the cut.",
    "dip_black": "Fade down to black and back up.",
    "blur": "Blur out, blur in.",
    "glitch": "Glitch burst across the cut.",
    "shake": "Shake burst across the cut.",
    "rgb": "RGB split burst across the cut.",
    "dissolve": "Cross dissolve (clips are overlapped).",
    "wipe_left": "Linear wipe revealing the next clip from the right edge (clips are overlapped).",
    "wipe_right": "Linear wipe from the left edge.",
    "wipe_up": "Linear wipe from the bottom.",
    "wipe_down": "Linear wipe from the top.",
    "iris": "Circular reveal from the centre (clips are overlapped).",
    "clock": "Clock wipe (clips are overlapped).",
    "noise_dissolve": "Organic noise-pattern dissolve (clips are overlapped).",
}


def _xf(project, layer):
    return _ensure(project, layer, "transform", "transition", {"edge": "mirror", "motion_blur": 1.5, "samples": 24})


def _overlap(comp, a, b, cut, d):
    """Make clips overlap by d around the cut and return the upper layer of the two."""
    half = d / 2
    a["end"] = max(a["end"], cut + half)
    if b["start"] > cut - half:
        shift = b["start"] - (cut - half)
        if b["type"] in ("footage", "audio", "comp") and not isinstance(b.get("speed", 1.0), dict) and "time_remap" not in b:
            b["source_in"] = max(0.0, b.get("source_in", 0.0) - shift * float(b.get("speed", 1.0)))
        b["start"] = cut - half
    layers = comp["layers"]
    return b if layers.index(b) < layers.index(a) else a


def add_transition(project, comp_id, from_layer, to_layer, type="whip_left", duration=0.4, cut=None):
    """Build a transition between two adjacent clips. `cut` defaults to where the second clip starts."""
    if type not in TRANSITIONS:
        raise KeyError(f"unknown transition {type!r}; transitions: {list(TRANSITIONS)}")
    comp = get_comp(project, comp_id)
    a, b = find_layer(comp, from_layer), find_layer(comp, to_layer)
    cut = b["start"] if cut is None else float(cut)
    d = float(duration)
    h = d / 2
    W, H = comp["width"], comp["height"]
    t0, t1 = round(cut - h, 5), round(cut + h, 5)
    cut = round(cut, 5)
    made = []

    def key(layer, fx, param, kfs):
        set_keyframes(layer, f"{fx['id']}.{param}", kfs, clear_range=(t0, t1))
        made.append(f"{layer['id']}.{fx['id']}.{param}")

    if type.startswith("whip_"):
        dx, dy = {"left": (-1, 0), "right": (1, 0), "up": (0, -1), "down": (0, 1)}[type[5:]]
        fa, fb = _xf(project, a), _xf(project, b)
        key(a, fa, "offset", [{"t": t0, "v": [0, 0], "ease": "easeInCubic"}, {"t": cut, "v": [dx * W, dy * H]}])
        key(b, fb, "offset", [{"t": cut, "v": [-dx * W, -dy * H], "ease": "easeOutCubic"}, {"t": t1, "v": [0, 0]}])
    elif type in ("zoom_in", "zoom_out"):
        fa, fb = _xf(project, a), _xf(project, b)
        out_to, in_from = (320.0, 35.0) if type == "zoom_in" else (35.0, 320.0)
        key(a, fa, "scale", [{"t": t0, "v": 100.0, "ease": "easeInExpo"}, {"t": cut, "v": out_to}])
        key(b, fb, "scale", [{"t": cut, "v": in_from, "ease": "easeOutExpo"}, {"t": t1, "v": 100.0}])
    elif type in ("spin_cw", "spin_ccw"):
        s = 1 if type == "spin_cw" else -1
        fa, fb = _xf(project, a), _xf(project, b)
        key(a, fa, "rotation", [{"t": t0, "v": 0.0, "ease": "easeInCubic"}, {"t": cut, "v": 120.0 * s}])
        key(a, fa, "scale", [{"t": t0, "v": 100.0, "ease": "easeInCubic"}, {"t": cut, "v": 170.0}])
        key(b, fb, "rotation", [{"t": cut, "v": -120.0 * s, "ease": "easeOutCubic"}, {"t": t1, "v": 0.0}])
        key(b, fb, "scale", [{"t": cut, "v": 170.0, "ease": "easeOutCubic"}, {"t": t1, "v": 100.0}])
    elif type in ("flash", "dip_black"):
        peak = 5.0 if type == "flash" else -12.0
        for layer, kfs in ((a, [{"t": t0, "v": 0.0, "ease": "easeInQuad"}, {"t": cut, "v": peak}]),
                           (b, [{"t": cut, "v": peak, "ease": "easeOutQuad"}, {"t": t1, "v": 0.0}])):
            key(layer, _ensure(project, layer, "exposure", "transition", {"stops": 0.0}), "stops", kfs)
    elif type in ("blur", "glitch", "shake", "rgb"):
        etype, param, peak, extra = {"blur": ("gaussian_blur", "radius", 90.0, {}),
                                     "glitch": ("glitch", "amount", 1.0, {}),
                                     "shake": ("shake", "amount", 90.0, {"frequency": 18.0, "rotation": 3.0}),
                                     "rgb": ("rgb_split", "amount", 60.0, {"mode": "radial"})}[type]
        for layer, kfs in ((a, [{"t": t0, "v": 0.0, "ease": "easeInQuad"}, {"t": cut, "v": peak}]),
                           (b, [{"t": cut, "v": peak, "ease": "easeOutQuad"}, {"t": t1, "v": 0.0}])):
            key(layer, _ensure(project, layer, etype, "transition", dict(extra, **{param: 0.0})), param, kfs)
    else:
        top = _overlap(comp, a, b, cut, d)
        incoming = top is b
        if type == "dissolve":
            kfs = [{"t": t0, "v": 0.0 if incoming else 100.0}, {"t": t1, "v": 100.0 if incoming else 0.0}]
            set_keyframes(top, "transform.opacity", kfs, clear_range=(t0, t1))
            made.append(f"{top['id']}.transform.opacity")
        else:
            shape, angle = {"wipe_left": ("linear", 180.0), "wipe_right": ("linear", 0.0), "wipe_up": ("linear", 270.0),
                            "wipe_down": ("linear", 90.0), "iris": ("iris", 0.0), "clock": ("clock", -90.0),
                            "noise_dissolve": ("noise", 0.0)}[type]
            fx = add_effect(project, top, "wipe", {"shape": shape, "angle": angle, "feather": 0.08, "progress": 1.0})
            fx["tag"] = "transition"
            kfs = [{"t": t0, "v": 0.0 if incoming else 1.0, "ease": "easeInOutCubic"}, {"t": t1, "v": 1.0 if incoming else 0.0}]
            if not incoming:
                fx["params"]["invert"] = True
            key(top, fx, "progress", kfs)
    return {"type": type, "cut": cut, "from": a["id"], "to": b["id"], "duration": d, "animated": made}
