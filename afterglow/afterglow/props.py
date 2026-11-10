"""Animated properties: keyframes, easing curves, wiggle and expressions.

A property is either a plain value (number / list / colour string) or a dict:

    {"keyframes": [{"t": 0.0, "v": 100, "ease": "easeOutExpo"}, {"t": 0.4, "v": 130}],
     "loop": "cycle" | "pingpong",          # optional, repeats the keyframed range
     "wiggle": {"freq": 12, "amp": 20, "seed": 1, "octaves": 1},   # optional, added on top
     "expr": "value + sin(t * 6) * 10",     # optional, evaluated last-but-one
     "value": 100}                          # base value when there are no keyframes

Keyframe times are comp time in seconds.  "ease" shapes the segment that starts at
that keyframe and may be a name from EASINGS, "hold", or a cubic-bezier [x1, y1, x2, y2].
"""
from __future__ import annotations

import ast
import math
from functools import lru_cache

# --------------------------------------------------------------------------- easing

def _bounce_out(x):
    n1, d1 = 7.5625, 2.75
    if x < 1 / d1:
        return n1 * x * x
    if x < 2 / d1:
        x -= 1.5 / d1
        return n1 * x * x + 0.75
    if x < 2.5 / d1:
        x -= 2.25 / d1
        return n1 * x * x + 0.9375
    x -= 2.625 / d1
    return n1 * x * x + 0.984375


def _elastic_out(x):
    if x in (0, 1):
        return x
    return 2 ** (-10 * x) * math.sin((x * 10 - 0.75) * (2 * math.pi / 3)) + 1


def _back_in(x, c=1.70158):
    return (c + 1) * x ** 3 - c * x * x


def _mk(inn):
    """Build (in, out, inOut) from an ease-in function."""
    out = lambda x: 1 - inn(1 - x)
    io = lambda x: inn(2 * x) / 2 if x < 0.5 else 1 - inn(2 - 2 * x) / 2
    return inn, out, io


EASINGS = {"linear": lambda x: x}
for _name, _fn in {
    "Sine": lambda x: 1 - math.cos(x * math.pi / 2),
    "Quad": lambda x: x * x,
    "Cubic": lambda x: x ** 3,
    "Quart": lambda x: x ** 4,
    "Quint": lambda x: x ** 5,
    "Expo": lambda x: 0.0 if x <= 0 else 2 ** (10 * x - 10),
    "Circ": lambda x: 1 - math.sqrt(max(0.0, 1 - x * x)),
    "Back": _back_in,
    "Elastic": lambda x: 1 - _elastic_out(1 - x),
    "Bounce": lambda x: 1 - _bounce_out(1 - x),
}.items():
    _i, _o, _io = _mk(_fn)
    EASINGS["easeIn" + _name] = _i
    EASINGS["easeOut" + _name] = _o
    EASINGS["easeInOut" + _name] = _io


@lru_cache(maxsize=512)
def cubic_bezier(x1, y1, x2, y2):
    """CSS-style cubic-bezier timing function."""

    def bez(a, b, s):
        return 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3

    def f(x):
        if x <= 0:
            return 0.0
        if x >= 1:
            return 1.0
        lo, hi = 0.0, 1.0
        for _ in range(24):
            mid = (lo + hi) / 2
            if bez(x1, x2, mid) < x:
                lo = mid
            else:
                hi = mid
        return bez(y1, y2, (lo + hi) / 2)

    return f


_CSS = {
    "ease": (0.25, 0.1, 0.25, 1.0),
    "easeIn": (0.42, 0, 1, 1),
    "easeOut": (0, 0, 0.58, 1),
    "easeInOut": (0.42, 0, 0.58, 1),
    # the AE "easy ease" default (33% influence both sides)
    "easyEase": (0.33, 0, 0.67, 1),
    # snappy curves that short-form editors reach for constantly
    "snap": (0.1, 0.9, 0.2, 1.0),
    "whip": (0.7, 0, 0.3, 1),
    "overshoot": (0.2, 1.4, 0.4, 1.0),
}


def get_ease(e):
    if e is None:
        return EASINGS["linear"]
    if isinstance(e, (list, tuple)) and len(e) == 4:
        return cubic_bezier(*[float(x) for x in e])
    if e in EASINGS:
        return EASINGS[e]
    if e in _CSS:
        return cubic_bezier(*_CSS[e])
    raise ValueError(f"unknown easing {e!r}; use one of {ease_names()} or [x1,y1,x2,y2]")


def ease_names():
    return sorted(EASINGS) + sorted(_CSS) + ["hold"]


# --------------------------------------------------------------------------- values

def parse_color(s):
    s = s.strip().lstrip("#")
    if len(s) in (3, 4):
        s = "".join(ch * 2 for ch in s)
    if len(s) == 6:
        s += "ff"
    return [int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4, 6)]


def num(v):
    """Normalise a raw property value into a float or list of floats."""
    if isinstance(v, str):
        if v.startswith("#"):
            return parse_color(v)
        return v
    if isinstance(v, bool):
        return float(v)
    if isinstance(v, (list, tuple)):
        return [num(x) for x in v]
    return v


def _lerp(a, b, k):
    if isinstance(a, (list, tuple)) or isinstance(b, (list, tuple)):
        if not isinstance(a, (list, tuple)):
            a = [a] * len(b)
        if not isinstance(b, (list, tuple)):
            b = [b] * len(a)
        return [x + (y - x) * k for x, y in zip(a, b)]
    if isinstance(a, str) or isinstance(b, str):
        return a if k < 1 else b
    return a + (b - a) * k


def _hash(n, seed):
    x = math.sin(n * 127.1 + seed * 311.7) * 43758.5453123
    return x - math.floor(x)


def noise1(x, seed=0.0):
    """Smooth 1D value noise in [-1, 1]."""
    i = math.floor(x)
    f = x - i
    u = f * f * f * (f * (f * 6 - 15) + 10)
    return (_hash(i, seed) * (1 - u) + _hash(i + 1, seed) * u) * 2 - 1


def wiggle_value(t, freq, amp, seed=0.0, octaves=1, comp=0):
    total, a, f = 0.0, 1.0, freq
    for o in range(max(1, int(octaves))):
        total += a * noise1(t * f + 17.0 * o, seed * 7.31 + comp * 53.7 + o * 3.1)
        a *= 0.5
        f *= 2
    return total * amp


def _interp(kfs, t, loop=None):
    n = len(kfs)
    if n == 1:
        return num(kfs[0]["v"])
    t0, t1 = kfs[0]["t"], kfs[-1]["t"]
    if loop and t1 > t0 and (t > t1 or t < t0):
        span = t1 - t0
        k = (t - t0) / span
        if loop == "pingpong":
            c = math.floor(k)
            fr = k - c
            t = t0 + (fr if c % 2 == 0 else 1 - fr) * span
        else:
            t = t0 + (k - math.floor(k)) * span
    if t <= t0:
        return num(kfs[0]["v"])
    if t >= t1:
        return num(kfs[-1]["v"])
    lo, hi = 0, n - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if kfs[mid]["t"] <= t:
            lo = mid
        else:
            hi = mid
    a, b = kfs[lo], kfs[hi]
    e = a.get("ease")
    if e == "hold":
        return num(a["v"])
    span = b["t"] - a["t"]
    k = (t - a["t"]) / span if span > 1e-9 else 1.0
    return _lerp(num(a["v"]), num(b["v"]), get_ease(e)(k))


# --------------------------------------------------------------------------- expressions

class Vec(list):
    """List with element-wise arithmetic, used inside expressions."""

    def _op(self, o, fn):
        if isinstance(o, (list, tuple)):
            return Vec(fn(a, b) for a, b in zip(self, o))
        return Vec(fn(a, o) for a in self)

    def __add__(self, o): return self._op(o, lambda a, b: a + b)
    __radd__ = __add__
    def __sub__(self, o): return self._op(o, lambda a, b: a - b)
    def __rsub__(self, o): return self._op(o, lambda a, b: b - a)
    def __mul__(self, o): return self._op(o, lambda a, b: a * b)
    __rmul__ = __mul__
    def __truediv__(self, o): return self._op(o, lambda a, b: a / b)
    def __neg__(self): return Vec(-a for a in self)


_ALLOWED = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Call, ast.Name, ast.Load, ast.Constant,
    ast.IfExp, ast.Compare, ast.BoolOp, ast.List, ast.Tuple, ast.Subscript, ast.Index if hasattr(ast, "Index") else ast.Load,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod, ast.Pow, ast.FloorDiv, ast.USub, ast.UAdd, ast.Not,
    ast.And, ast.Or, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Eq, ast.NotEq,
)


@lru_cache(maxsize=1024)
def _compile(src):
    tree = ast.parse(src.strip(), mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED):
            raise ValueError(f"expression: {type(node).__name__} is not allowed")
        if isinstance(node, ast.Name) and node.id.startswith("_"):
            raise ValueError("expression: names may not start with an underscore")
    return compile(tree, "<expr>", "eval")


def _clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def _smoothstep(a, b, x):
    k = _clamp((x - a) / (b - a) if b != a else 0.0)
    return k * k * (3 - 2 * k)


def _linear(x, x0, x1, v0, v1):
    return _lerp(v0, v1, _clamp((x - x0) / (x1 - x0) if x1 != x0 else 1.0))


def _pulse(x, at, attack=0.03, decay=0.3):
    """0 -> 1 -> 0 envelope: fast rise at `at`, eased fall. The classic beat hit."""
    if x < at:
        return 0.0
    if x < at + attack:
        return (x - at) / attack
    k = (x - at - attack) / decay
    return 0.0 if k >= 1 else (1 - k) ** 3


_FUNCS = {
    "sin": math.sin, "cos": math.cos, "tan": math.tan, "abs": abs, "min": min, "max": max,
    "floor": math.floor, "ceil": math.ceil, "round": round, "sqrt": math.sqrt, "pow": pow,
    "exp": math.exp, "log": math.log, "pi": math.pi, "clamp": _clamp, "smoothstep": _smoothstep,
    "lerp": _lerp, "mix": _lerp, "linear": _linear, "pulse": _pulse,
    "step": lambda edge, x: 0.0 if x < edge else 1.0,
    "fract": lambda x: x - math.floor(x),
    "sign": lambda x: (x > 0) - (x < 0),
    "noise": noise1,
    "rand": lambda seed=0: _hash(float(seed), 1.0),
    "ease": lambda name, x: get_ease(name)(_clamp(x)),
}


def eval_expr(src, t, value, env=None):
    names = dict(_FUNCS)
    names.update(env or {})
    names["t"] = t
    names["value"] = Vec(value) if isinstance(value, (list, tuple)) else value
    names["wiggle"] = lambda freq, amp, seed=0: (
        Vec(wiggle_value(t, freq, amp, seed, 1, i) for i in range(len(value)))
        if isinstance(value, (list, tuple)) else wiggle_value(t, freq, amp, seed))
    out = eval(_compile(src), {"__builtins__": {}}, names)
    return list(out) if isinstance(out, (list, tuple)) else out


# --------------------------------------------------------------------------- public API

def is_animated(prop):
    return isinstance(prop, dict) and any(k in prop for k in ("keyframes", "wiggle", "expr"))


def evaluate(prop, t, env=None):
    """Evaluate a property at comp time t (seconds)."""
    if not isinstance(prop, dict):
        return num(prop)
    v = num(prop.get("value", 0.0))
    kfs = prop.get("keyframes")
    if kfs:
        v = _interp(kfs, t, prop.get("loop"))
    if prop.get("expr"):
        v = eval_expr(prop["expr"], t, v, env)
    w = prop.get("wiggle")
    if w:
        amp = evaluate(w.get("amp", 10.0), t, env)
        freq = float(evaluate(w.get("freq", 5.0), t, env))
        seed, octv = float(w.get("seed", 0)), int(w.get("octaves", 1))
        if isinstance(v, (list, tuple)):
            amps = amp if isinstance(amp, (list, tuple)) else [amp] * len(v)
            v = [x + wiggle_value(t, freq, a, seed, octv, i) for i, (x, a) in enumerate(zip(v, amps))]
        else:
            v = v + wiggle_value(t, freq, amp if not isinstance(amp, (list, tuple)) else amp[0], seed, octv)
    return v


def sort_keyframes(prop):
    if isinstance(prop, dict) and prop.get("keyframes"):
        prop["keyframes"].sort(key=lambda k: k["t"])
    return prop


def shift_keyframes(obj, dt):
    """Recursively shift every keyframe time inside obj (layer, effect, ...) by dt."""
    if isinstance(obj, dict):
        if isinstance(obj.get("keyframes"), list):
            for k in obj["keyframes"]:
                if isinstance(k, dict) and "t" in k:
                    k["t"] = round(k["t"] + dt, 6)
        for k, v in obj.items():
            if k != "keyframes":
                shift_keyframes(v, dt)
    elif isinstance(obj, list):
        for v in obj:
            shift_keyframes(v, dt)
