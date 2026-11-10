"""Project data model: plain JSON-serialisable dicts plus the functions that edit them.

project = {"version": 1, "media": {id: info}, "comps": {id: comp}, "custom_effects": {name: {...}}, "counters": {...}}
comp    = {"width", "height", "fps", "duration", "background": [r,g,b,a], "layers": [top ... bottom]}
layer   = {"id", "name", "type", "start", "end", "enabled", "blend", "transform": {...}, "effects": [...], ...}

Layer types: footage, image, solid, text, shape, adjustment, comp, null, audio.
All times are seconds of comp time.  Layers are stored top-first, like a layer panel.
"""
from __future__ import annotations

import copy
import json
import os

import numpy as np

from . import media
from .props import evaluate, is_animated, shift_keyframes, sort_keyframes

LAYER_TYPES = ["footage", "image", "solid", "text", "shape", "adjustment", "comp", "null", "audio"]
BLEND_MODES = ["normal", "add", "screen", "multiply", "overlay", "soft_light", "hard_light", "color_dodge",
               "color_burn", "darken", "lighten", "difference", "exclusion", "subtract", "divide",
               "linear_burn", "vivid_light", "pin_light", "hue", "saturation", "color", "luminosity"]
FIT_MODES = ["cover", "contain", "stretch", "none"]
MATTE_MODES = ["alpha", "alpha_inverted", "luma", "luma_inverted"]
LAYER_FIELDS = {"transform", "text", "shape", "masks", "matte", "speed", "volume", "time_remap", "color", "effects"}


def new_project(width=1080, height=1920, fps=30.0, duration=10.0, comp_id="main"):
    p = {"version": 1, "media": {}, "comps": {}, "custom_effects": {}, "counters": {}}
    add_comp(p, comp_id, width, height, fps, duration)
    return p


def add_comp(project, comp_id, width, height, fps, duration, background=None):
    if comp_id in project["comps"]:
        raise ValueError(f"comp {comp_id!r} already exists")
    project["comps"][comp_id] = {"width": int(width), "height": int(height), "fps": float(fps),
                                 "duration": float(duration), "background": background or [0, 0, 0, 1], "layers": []}
    return project["comps"][comp_id]


def get_comp(project, comp_id=None):
    comps = project["comps"]
    if comp_id is None:
        comp_id = "main" if "main" in comps else next(iter(comps))
    if comp_id not in comps:
        raise KeyError(f"no comp {comp_id!r}; comps: {list(comps)}")
    return comps[comp_id]


def find_layer(comp, layer_id):
    for l in comp["layers"]:
        if l["id"] == layer_id or l.get("name") == layer_id:
            return l
    raise KeyError(f"no layer {layer_id!r}; layers: {[l['id'] for l in comp['layers']]}")


def new_id(project, prefix):
    c = project.setdefault("counters", {})
    c[prefix] = c.get(prefix, 0) + 1
    return f"{prefix}{c[prefix]}"


def add_media(project, path):
    path = os.path.abspath(os.path.expanduser(path))
    for mid, m in project["media"].items():
        if m["path"] == path:
            return mid
    info = media.probe(path)
    mid = new_id(project, "m")
    project["media"][mid] = info
    return mid


def source_duration(project, layer):
    if layer["type"] in ("footage", "audio"):
        return project["media"][layer["source"]].get("duration") or 0.0
    if layer["type"] == "comp":
        return project["comps"][layer["source"]]["duration"]
    return 0.0


def add_layer(project, comp_id, type, props=None, index=0):
    """Create a layer. props may hold any layer field; sensible defaults fill the rest."""
    if type not in LAYER_TYPES:
        raise ValueError(f"layer type must be one of {LAYER_TYPES}")
    comp = get_comp(project, comp_id)
    props = copy.deepcopy(props or {})
    layer = {"id": new_id(project, "L"), "name": props.pop("name", None) or type, "type": type, "enabled": True}
    start = float(props.pop("start", 0.0))
    layer["start"] = start
    if type in ("footage", "image", "audio", "comp"):
        src = props.pop("source", None)
        if src is None and props.get("path"):
            src = add_media(project, props.pop("path"))
        if type == "comp":
            if src not in project["comps"]:
                raise KeyError(f"comp layer needs source = a comp id; comps: {list(project['comps'])}")
        elif src not in project["media"]:
            raise KeyError(f"layer needs source = a media id (import the file first); media: {list(project['media'])}")
        layer["source"] = src
    if type in ("footage", "audio", "comp"):
        layer["source_in"] = float(props.pop("source_in", 0.0))
        layer["speed"] = props.pop("speed", 1.0)
    dur = props.pop("duration", None)
    end = props.pop("end", None)
    if end is None:
        if dur is not None:
            end = start + float(dur)
        elif type in ("footage", "audio", "comp") and not props.get("loop") and "time_remap" not in props:
            sp = layer["speed"] if isinstance(layer["speed"], (int, float)) else 1.0
            remain = max(source_duration(project, layer) - layer["source_in"], 0.0) if sp >= 0 else layer["source_in"]
            end = start + (remain / abs(sp) if sp else comp["duration"])
            end = min(end, comp["duration"]) if end > start else comp["duration"]
        else:
            end = comp["duration"]
    layer["end"] = float(end)
    if type == "footage" or type == "image" or type == "comp":
        layer["fit"] = props.pop("fit", "cover")
    if type == "solid":
        layer["color"] = props.pop("color", [0, 0, 0, 1])
    if type == "text":
        t = props.pop("text", {})
        if isinstance(t, str):
            t = {"content": t}
        layer["text"] = t
    if type == "shape":
        layer["shape"] = props.pop("shape", {"kind": "rect", "size": [400, 400], "fill": "#ffffff"})
    layer["transform"] = props.pop("transform", {})
    layer["effects"] = []
    for fx in props.pop("effects", []):
        add_effect(project, layer, fx.get("type"), fx.get("params"), enabled=fx.get("enabled", True))
    layer.update(props)
    validate_layer(layer)
    comp["layers"].insert(max(0, min(index, len(comp["layers"]))), layer)
    return layer


def validate_layer(layer):
    if layer.get("blend", "normal") not in BLEND_MODES:
        raise ValueError(f"blend must be one of {BLEND_MODES}")
    if layer.get("fit", "cover") not in FIT_MODES:
        raise ValueError(f"fit must be one of {FIT_MODES}")
    if layer["end"] <= layer["start"]:
        raise ValueError(f"layer {layer['id']}: end ({layer['end']}) must be after start ({layer['start']})")
    m = layer.get("matte")
    if m and m.get("mode", "alpha") not in MATTE_MODES:
        raise ValueError(f"matte.mode must be one of {MATTE_MODES}")
    _sort_all(layer)


def _sort_all(obj):
    if isinstance(obj, dict):
        sort_keyframes(obj)
        for v in obj.values():
            _sort_all(v)
    elif isinstance(obj, list):
        for v in obj:
            _sort_all(v)


def add_effect(project, layer, type, params=None, index=None, enabled=True):
    from .effects import REGISTRY
    if type not in REGISTRY:
        import difflib
        near = difflib.get_close_matches(str(type), list(REGISTRY), n=5, cutoff=0.4)
        raise KeyError(f"unknown effect {type!r}. Close matches: {near}. Use effect_catalog to list all.")
    spec = REGISTRY[type]
    params = copy.deepcopy(params or {})
    unknown = [k for k in params if k not in spec.params]
    if unknown:
        raise KeyError(f"effect {type!r} has no params {unknown}; valid: {list(spec.params)}")
    fx = {"id": new_id(project, "fx"), "type": type, "enabled": enabled, "params": params}
    _sort_all(fx)
    effects = layer.setdefault("effects", [])
    effects.insert(len(effects) if index is None else index, fx)
    return fx


def find_effect(layer, effect_id):
    for fx in layer.get("effects", []):
        if fx["id"] == effect_id:
            return fx
    # allow addressing by type when unambiguous
    hits = [fx for fx in layer.get("effects", []) if fx["type"] == effect_id]
    if len(hits) == 1:
        return hits[0]
    raise KeyError(f"no effect {effect_id!r} on layer {layer['id']}; effects: {[(f['id'], f['type']) for f in layer.get('effects', [])]}")


# --------------------------------------------------------------------------- property paths

def resolve_path(layer, path):
    """Return (container, key) for a property path such as 'transform.scale', 'fx3.amount', 'speed', 'text.size'."""
    parts = [p for p in path.split(".") if p]
    if parts[0] == "effects":
        parts = parts[1:]
    # effect ids always resolve; effect *types* only when they don't shadow a layer field (e.g. "transform")
    fx_ids = {fx["id"] for fx in layer.get("effects", [])} | {
        fx["type"] for fx in layer.get("effects", []) if fx["type"] not in LAYER_FIELDS}
    if parts[0] in fx_ids and len(parts) >= 2:
        fx = find_effect(layer, parts[0])
        key = parts[-1]
        from .effects import REGISTRY
        if key not in REGISTRY[fx["type"]].params:
            raise KeyError(f"effect {fx['type']!r} has no param {key!r}; valid: {list(REGISTRY[fx['type']].params)}")
        return fx["params"], key
    node = layer
    for p in parts[:-1]:
        if isinstance(node, list):
            node = node[int(p)]
        else:
            node = node.setdefault(p, {})
    return node, parts[-1]


def get_prop(layer, path):
    c, k = resolve_path(layer, path)
    return c[int(k)] if isinstance(c, list) else c.get(k)


def set_prop(layer, path, value):
    c, k = resolve_path(layer, path)
    if isinstance(value, dict):
        sort_keyframes(value)
    if isinstance(c, list):
        c[int(k)] = value
    else:
        c[k] = value


def set_keyframes(layer, path, keyframes, mode="merge", clear_range=None):
    """Write keyframes onto a property. mode: replace | merge (same-time keys are overwritten)."""
    for k in keyframes:
        if "t" not in k or "v" not in k:
            raise ValueError('each keyframe needs "t" (seconds) and "v" (value); optional "ease"')
        if k.get("ease") not in (None, "hold"):
            from .props import get_ease
            get_ease(k["ease"])
    cur = get_prop(layer, path)
    base = cur if isinstance(cur, dict) else {}
    old = [] if mode == "replace" else list(base.get("keyframes", []))
    if clear_range:
        old = [k for k in old if not (clear_range[0] - 1e-6 <= k["t"] <= clear_range[1] + 1e-6)]
    times = {round(k["t"], 5) for k in keyframes}
    merged = [k for k in old if round(k["t"], 5) not in times] + [dict(k) for k in keyframes]
    merged.sort(key=lambda k: k["t"])
    new = {k: v for k, v in base.items() if k != "keyframes"}
    new["keyframes"] = merged
    new.pop("value", None)
    set_prop(layer, path, new)
    return new


def add_pulse(layer, path, t, peak, base=None, attack=0.03, decay=0.3, ease_in="easeOutQuad", ease_out="easeOutCubic"):
    """Insert base → peak → base keyframes around time t without disturbing other pulses."""
    cur = get_prop(layer, path)
    if base is None:
        base = evaluate(cur, t - 1e-3) if cur is not None else 0.0
        if is_animated(cur) and cur.get("keyframes"):
            base = cur["keyframes"][0]["v"]
    kfs = [{"t": round(t, 5), "v": base, "ease": ease_in},
           {"t": round(t + attack, 5), "v": peak, "ease": ease_out},
           {"t": round(t + attack + decay, 5), "v": base}]
    if cur is not None and not isinstance(cur, dict):
        set_prop(layer, path, {"keyframes": []})
    return set_keyframes(layer, path, kfs, mode="merge", clear_range=(t, t + attack + decay))


# --------------------------------------------------------------------------- time mapping

_speed_cache = {}
_STEP = 1.0 / 240.0


def _speed_table(layer):
    key = (layer["id"], layer["start"], layer["end"], layer.get("source_in", 0.0),
           json.dumps(layer.get("speed", 1.0), sort_keys=True))
    hit = _speed_cache.get(layer["id"])
    if hit and hit[0] == key:
        return hit[1]
    n = int((layer["end"] - layer["start"]) / _STEP) + 2
    ts = layer["start"] + np.arange(n) * _STEP
    sp = np.array([float(evaluate(layer["speed"], float(t))) for t in ts])
    table = layer.get("source_in", 0.0) + np.concatenate([[0.0], np.cumsum((sp[1:] + sp[:-1]) * 0.5 * _STEP)])
    _speed_cache[layer["id"]] = (key, table)
    return table


def source_time(layer, t):
    """Source-media time shown by a layer at comp time t (handles speed ramps and time remap)."""
    if "time_remap" in layer and layer["time_remap"] is not None:
        return float(evaluate(layer["time_remap"], t))
    sp = layer.get("speed", 1.0)
    if not isinstance(sp, dict):
        return layer.get("source_in", 0.0) + (t - layer["start"]) * float(sp)
    table = _speed_table(layer)
    x = (t - layer["start"]) / _STEP
    return float(np.interp(x, np.arange(len(table)), table))


def source_times(layer, ts):
    """Vectorised source_time for audio rendering."""
    if "time_remap" in layer and layer["time_remap"] is not None:
        coarse = np.arange(ts[0], ts[-1] + 0.01, 0.005)
        vals = np.array([float(evaluate(layer["time_remap"], float(t))) for t in coarse])
        return np.interp(ts, coarse, vals)
    sp = layer.get("speed", 1.0)
    if not isinstance(sp, dict):
        return layer.get("source_in", 0.0) + (ts - layer["start"]) * float(sp)
    table = _speed_table(layer)
    return np.interp((ts - layer["start"]) / _STEP, np.arange(len(table)), table)


# --------------------------------------------------------------------------- editing helpers

def move_layer(layer, new_start):
    dt = new_start - layer["start"]
    layer["start"] += dt
    layer["end"] += dt
    shift_keyframes(layer, dt)
    return layer


def duplicate_layer(project, comp, layer):
    new = copy.deepcopy(layer)
    new["id"] = new_id(project, "L")
    new["name"] = layer.get("name", layer["type"]) + " copy"
    for fx in new.get("effects", []):
        fx["id"] = new_id(project, "fx")
    comp["layers"].insert(comp["layers"].index(layer), new)
    return new


def split_layer(project, comp, layer, t):
    """Cut a layer in two at comp time t. Returns the new (later) layer."""
    if not (layer["start"] < t < layer["end"]):
        raise ValueError(f"split time {t} is outside layer {layer['id']} ({layer['start']}–{layer['end']})")
    new = copy.deepcopy(layer)
    new["id"] = new_id(project, "L")
    for fx in new.get("effects", []):
        fx["id"] = new_id(project, "fx")
    if layer["type"] in ("footage", "audio", "comp") and "time_remap" not in layer:
        new["source_in"] = round(source_time(layer, t), 6)
    new["start"] = t
    layer["end"] = t
    comp["layers"].insert(comp["layers"].index(layer), new)
    return new


def summarize_layer(layer, verbose=False):
    s = {"id": layer["id"], "name": layer.get("name"), "type": layer["type"],
         "start": round(layer["start"], 4), "end": round(layer["end"], 4)}
    for k in ("source", "source_in", "blend", "parent", "matte", "fit"):
        if layer.get(k) not in (None, "normal", "cover", 0.0):
            s[k] = layer[k]
    if not layer.get("enabled", True):
        s["enabled"] = False
    sp = layer.get("speed", 1.0)
    if sp != 1.0:
        s["speed"] = sp if verbose or not isinstance(sp, dict) else "animated"
    if layer["type"] == "text":
        t = layer["text"]
        s["text"] = t.get("content") or " ".join(w["text"] for w in t.get("words", []))[:80]
    if verbose:
        for k in ("transform", "effects", "masks", "text", "shape", "color", "motion_blur", "edge", "volume", "time_remap"):
            if layer.get(k):
                s[k] = layer[k]
    else:
        if layer.get("effects"):
            s["effects"] = [f"{fx['id']}:{fx['type']}" + ("" if fx.get("enabled", True) else "(off)") for fx in layer["effects"]]
        anim = [k for k, v in layer.get("transform", {}).items() if is_animated(v)]
        if anim:
            s["animated"] = anim
    return s


def summarize(project, comp_id=None, verbose=False):
    out = {"media": {k: {kk: vv for kk, vv in m.items() if kk in ("path", "kind", "width", "height", "fps", "duration", "has_audio")}
                     for k, m in project["media"].items()}, "comps": {}}
    for cid, c in project["comps"].items():
        if comp_id and cid != comp_id:
            continue
        out["comps"][cid] = {"width": c["width"], "height": c["height"], "fps": c["fps"], "duration": c["duration"],
                             "layers_top_to_bottom": [summarize_layer(l, verbose) for l in c["layers"]]}
    if project.get("custom_effects"):
        out["custom_effects"] = list(project["custom_effects"])
    return out


def save(project, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(project, f, indent=1)
    os.replace(tmp, path)


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        project = json.load(f)
    project.setdefault("custom_effects", {})
    project.setdefault("counters", {})
    from .effects import register_custom
    for name, ce in project["custom_effects"].items():
        register_custom(name, ce["glsl"], ce.get("params"), ce.get("desc", ""))
    for c in project["comps"].values():
        for l in c["layers"]:
            _sort_all(l)
    return project
