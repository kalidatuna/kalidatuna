"""Effect plugin registry.

An effect is a named render function plus a parameter spec.  Most effects are a single
GLSL fragment shader declared with `shader(...)`; multi-pass ones use `@effect(...)`.

GLSL bodies define `vec4 fx(vec2 uv)` and may use everything in gl.PRELUDE: the source
`T(uv)` (premultiplied RGBA), `u_res`, `u_time`, plus one `u_<param>` uniform per parameter.
"""
from __future__ import annotations

from ..gl import PRELUDE
from ..props import parse_color

REGISTRY = {}
CATEGORIES = ["blur", "light", "color", "distort", "stylize", "matte", "generate", "time", "custom"]
EDGE_MODES = ["transparent", "clamp", "repeat", "mirror"]
BLEND_CHOICES = ["normal", "add", "screen", "multiply", "overlay", "replace"]

# shared GLSL for generators that draw new pixels over the source
GEN_BLEND = """
vec4 gen_blend(vec4 dst, vec3 col, float a, int mode){
  a = clamp(a, 0.0, 1.0);
  if(mode == 5) return vec4(col * a, a);
  if(mode == 1) return vec4(dst.rgb + col * a, max(dst.a, a));
  if(mode == 2) return vec4(dst.rgb + col * a * (1.0 - clamp(dst.rgb, 0.0, 1.0)), max(dst.a, a));
  if(mode == 3){ vec3 d = unpre(dst); return pre(mix(d, d * col, a), dst.a); }
  if(mode == 4){ vec3 d = unpre(dst); vec3 ov = mix(2.0*d*col, 1.0 - 2.0*(1.0-d)*(1.0-col), step(0.5, d)); return pre(mix(d, ov, a), dst.a); }
  return vec4(col * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
}
"""


class P:
    """Parameter spec. kind: float | int | bool | vec2 | color | enum | text | points"""

    def __init__(self, default, desc="", kind=None, min=None, max=None, px=False, choices=None):
        if kind is None:
            if choices:
                kind = "enum"
            elif isinstance(default, bool):
                kind = "bool"
            elif isinstance(default, int):
                kind = "int"
            elif isinstance(default, str):
                kind = "color" if default.startswith("#") else "text"
            elif isinstance(default, (list, tuple)):
                kind = "vec2" if len(default) == 2 else "color"
            else:
                kind = "float"
        self.default, self.desc, self.kind = default, desc, kind
        self.min, self.max, self.px, self.choices = min, max, px, choices

    def describe(self):
        d = {"type": self.kind, "default": self.default}
        if self.desc:
            d["desc"] = self.desc
        if self.min is not None or self.max is not None:
            d["range"] = [self.min, self.max]
        if self.px:
            d["unit"] = "px"
        if self.choices:
            d["choices"] = self.choices
        return d

    @property
    def glsl(self):
        return {"float": "float", "int": "int", "bool": "int", "enum": "int", "vec2": "vec2", "color": "vec4"}.get(self.kind)

    def coerce(self, v, scale=1.0):
        k = self.kind
        if k == "enum":
            if isinstance(v, str):
                if v not in self.choices:
                    raise ValueError(f"{v!r} is not one of {self.choices}")
                return self.choices.index(v)
            return int(round(v))
        if k == "bool":
            return int(bool(v) if not isinstance(v, (int, float)) else v >= 0.5)
        if k == "int":
            return int(round(v))
        if k == "color":
            if isinstance(v, str):
                v = parse_color(v)
            v = [float(x) for x in v]
            return (v + [1.0] * 4)[:4] if len(v) < 4 else v[:4]
        if k == "vec2":
            if not isinstance(v, (list, tuple)):
                v = [v, v]
            return [float(v[0]) * (scale if self.px else 1.0), float(v[1]) * (scale if self.px else 1.0)]
        if k == "float":
            return float(v) * (scale if self.px else 1.0)
        return v


MIX = P(1.0, "Blend between the untouched input (0) and the full effect (1).", min=0, max=1)


class Effect:
    def __init__(self, name, category, desc, params, render, temporal=False):
        self.name, self.category, self.desc = name, category, desc
        self.params = dict(params)
        self.params.setdefault("mix", MIX)
        self.render, self.temporal = render, temporal

    def describe(self, full=True):
        d = {"name": self.name, "category": self.category, "desc": self.desc}
        if full:
            d["params"] = {k: p.describe() for k, p in self.params.items()}
        return d


def effect(name, category, desc, params, temporal=False):
    def deco(fn):
        REGISTRY[name] = Effect(name, category, desc, params, fn, temporal)
        return fn
    return deco


def build_frag(params, glsl, extra=""):
    decl = "".join(f"uniform {p.glsl} u_{k};\n" for k, p in params.items() if p.glsl and k != "mix")
    return PRELUDE + extra + decl + glsl + "\nvoid main(){ o = fx(v_uv); }\n"


def uniforms(params, p, env):
    u = {f"u_{k}": p[k] for k, spec in params.items() if spec.glsl and k in p}
    u.update(env.uniforms)
    return u


def shader(name, category, desc, params, glsl, extra=""):
    """Register a single-pass GLSL effect."""
    frag = build_frag(params, glsl, extra)

    def render(gl, src, p, env):
        return gl.run(frag, src.size, u_tex=src, **uniforms(params, p, env))

    REGISTRY[name] = Effect(name, category, desc, params, render)
    return REGISTRY[name]


def register_custom(name, glsl, params=None, desc="", category="custom"):
    """Register a user-written GLSL effect at runtime.

    params: {"amount": {"default": 1.0, "type": "float", "min": 0, "max": 5, "px": false, "desc": "..."}, ...}
    """
    specs = {}
    reserved = {"tex", "res", "time", "ltime", "frame", "rscale"}
    for k, d in (params or {}).items():
        if k in reserved or not k.isidentifier():
            raise ValueError(f"parameter name {k!r} is reserved or invalid")
        if not isinstance(d, dict):
            d = {"default": d}
        specs[k] = P(d.get("default", 0.0), d.get("desc", ""), d.get("type"), d.get("min"), d.get("max"),
                     bool(d.get("px", False)), d.get("choices"))
    if "vec4 fx(" not in glsl.replace("  ", " "):
        raise ValueError("custom effect GLSL must define `vec4 fx(vec2 uv)`")
    return shader(name, category, desc or "Custom shader effect.", specs, glsl)


def catalog(category=None, full=False):
    items = [e for e in REGISTRY.values() if category in (None, e.category)]
    items.sort(key=lambda e: (CATEGORIES.index(e.category) if e.category in CATEGORIES else 99, e.name))
    return [e.describe(full) for e in items]


def load_builtin():
    from . import blur, color, distort, generate, light, matte, stylize, timefx  # noqa: F401


load_builtin()
