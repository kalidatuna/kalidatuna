"""Blur and sharpen effects, plus the shared gaussian helper used by glows."""
from __future__ import annotations

import math

from ..gl import COPY, PRELUDE
from . import P, build_frag, effect, shader, uniforms

GAUSS = PRELUDE + """
uniform vec2 u_dir; uniform float u_sigma; uniform int u_n;
void main(){
  vec4 s = vec4(0.0); float ws = 0.0;
  for(int i = -40; i <= 40; i++){
    if(abs(i) > u_n) continue;
    float w = exp(-0.5 * float(i * i) / (u_sigma * u_sigma));
    s += texture(u_tex, v_uv + u_dir * float(i)) * w; ws += w;
  }
  o = s / ws;
}"""


def downsample(gl, src, levels):
    """Halve `levels` times. Always returns a new texture (a copy when levels == 0)."""
    cur = src
    for _ in range(levels):
        nxt = gl.run(COPY, (max(1, (cur.w + 1) // 2), max(1, (cur.h + 1) // 2)), u_tex=cur)
        if cur is not src:
            gl.release(cur)
        cur = nxt
    return gl.copy(src) if cur is src else cur


def gauss(gl, src, rx, ry=None, max_sigma=6.0):
    """Gaussian blur with radius in pixels. Returns a NEW texture, possibly at reduced size
    (sample it with bilinear filtering). Never releases src."""
    ry = rx if ry is None else ry
    sig = max(rx, ry) / 2.0
    lv = 0
    while sig / (2 ** lv) > max_sigma and min(src.w, src.h) >> (lv + 1) >= 4:
        lv += 1
    cur = downsample(gl, src, lv)
    f = 2 ** lv
    for rad, d in ((rx, (1.0 / cur.w, 0.0)), (ry, (0.0, 1.0 / cur.h))):
        s = rad / 2.0 / f
        if s < 0.15:
            continue
        nxt = gl.run(GAUSS, cur.size, u_tex=cur, u_dir=d, u_sigma=s, u_n=min(40, int(math.ceil(s * 3))))
        gl.release(cur)
        cur = nxt
    return cur


@effect("gaussian_blur", "blur", "Smooth gaussian blur. Keyframe radius for focus pulls and blur-in/out.", {
    "radius": P(20.0, "Blur radius.", min=0, max=500, px=True),
    "direction": P("both", "Blur axis.", choices=["both", "horizontal", "vertical"]),
})
def gaussian_blur(gl, src, p, env):
    r = p["radius"]
    if r < 0.2:
        return src
    b = gauss(gl, src, 0 if p["direction"] == 2 else r, 0 if p["direction"] == 1 else r)
    if b.size == src.size:
        return b
    out = gl.copy(b, src.size)
    gl.release(b)
    return out


_DIR = {
    "length": P(60.0, "Blur length.", min=0, max=2000, px=True),
    "angle": P(0.0, "Direction in degrees (0 = horizontal, 90 = vertical)."),
    "edge": P("mirror", "How pixels beyond the frame are filled.", choices=["transparent", "clamp", "repeat", "mirror"]),
}
_DIR_FRAG = build_frag(_DIR, """
uniform float u_len2;
vec4 fx(vec2 uv){
  float a = radians(u_angle);
  vec2 d = vec2(cos(a), sin(a)) * u_len2 / u_res;
  vec4 s = vec4(0.0);
  for(int i = 0; i < 24; i++){ float k = (float(i) + 0.5) / 24.0 - 0.5; s += tex_edge(u_tex, uv + d * k, u_edge); }
  return s / 24.0;
}""")


@effect("directional_blur", "blur", "Linear motion blur along an angle. The core of whip-pan and slide transitions.", _DIR)
def directional_blur(gl, src, p, env):
    if p["length"] < 0.5:
        return src
    u = uniforms(_DIR, p, env)
    a = gl.run(_DIR_FRAG, src.size, u_tex=src, u_len2=p["length"], **u)
    b = gl.run(_DIR_FRAG, src.size, u_tex=a, u_len2=p["length"] / 24.0, **u)
    gl.release(a)
    return b


_ZOOM = {
    "amount": P(0.2, "Strength: fraction of the distance to the centre that is smeared.", min=0, max=1),
    "center": P([0.5, 0.5], "Blur origin, normalised frame coordinates."),
}
_ZOOM_FRAG = build_frag(_ZOOM, """
uniform float u_amt;
vec4 fx(vec2 uv){
  vec4 s = vec4(0.0);
  for(int i = 0; i < 24; i++){ float k = (float(i) + 0.5) / 24.0; s += tex_edge(u_tex, u_center + (uv - u_center) * (1.0 - u_amt * k), 3); }
  return s / 24.0;
}""")


@effect("zoom_blur", "blur", "Radial zoom blur streaking outward from a centre point. Use for zoom punches and zoom transitions.", _ZOOM)
def zoom_blur(gl, src, p, env):
    if p["amount"] < 0.002:
        return src
    u = uniforms(_ZOOM, p, env)
    a = gl.run(_ZOOM_FRAG, src.size, u_tex=src, u_amt=p["amount"], **u)
    b = gl.run(_ZOOM_FRAG, src.size, u_tex=a, u_amt=p["amount"] / 24.0, **u)
    gl.release(a)
    return b


_SPIN = {
    "angle": P(15.0, "Arc of the blur in degrees.", min=0, max=360),
    "center": P([0.5, 0.5], "Rotation centre, normalised."),
}
_SPIN_FRAG = build_frag(_SPIN, """
uniform float u_ang;
vec4 fx(vec2 uv){
  vec2 asp = vec2(u_res.x / u_res.y, 1.0);
  vec2 p = (uv - u_center) * asp; vec4 s = vec4(0.0);
  for(int i = 0; i < 24; i++){ float k = (float(i) + 0.5) / 24.0 - 0.5; s += tex_edge(u_tex, u_center + (rot2(radians(u_ang) * k) * p) / asp, 3); }
  return s / 24.0;
}""")


@effect("spin_blur", "blur", "Rotational blur around a centre point. Use with rotation for spin transitions.", _SPIN)
def spin_blur(gl, src, p, env):
    if p["angle"] < 0.05:
        return src
    u = uniforms(_SPIN, p, env)
    a = gl.run(_SPIN_FRAG, src.size, u_tex=src, u_ang=p["angle"], **u)
    b = gl.run(_SPIN_FRAG, src.size, u_tex=a, u_ang=p["angle"] / 24.0, **u)
    gl.release(a)
    return b


shader("bokeh_blur", "blur", "Lens-style defocus with bright disc-shaped highlights.", {
    "radius": P(18.0, "Defocus radius.", min=0, max=200, px=True),
    "highlights": P(2.0, "How much bright areas bloom into bokeh discs.", min=0, max=10),
}, """
vec4 fx(vec2 uv){
  if(u_radius < 0.3) return T(uv);
  vec4 s = vec4(0.0); float ws = 0.0;
  float jit = hash21(uv * u_res) * TAU;
  for(int i = 0; i < 72; i++){
    float r = sqrt((float(i) + 0.5) / 72.0) * u_radius;
    float a = float(i) * 2.39996323 + jit;
    vec4 c = T(uv + vec2(cos(a), sin(a)) * r / u_res);
    float w = 1.0 + u_highlights * pow(clamp(luma(c.rgb), 0.0, 4.0), 4.0);
    s += c * w; ws += w;
  }
  return s / ws;
}""")


_SHARP = {
    "amount": P(1.0, "Sharpening strength.", min=0, max=5),
    "radius": P(2.0, "Detail size.", min=0.5, max=50, px=True),
}
_SHARP_FRAG = build_frag(_SHARP, """
uniform sampler2D u_blur;
vec4 fx(vec2 uv){ vec4 s = T(uv); vec4 b = texture(u_blur, uv); return vec4(s.rgb + (s.rgb - b.rgb) * u_amount, s.a); }""")


@effect("sharpen", "blur", "Unsharp-mask sharpening. Small radius for crispness, large radius for punchy local contrast.", _SHARP)
def sharpen(gl, src, p, env):
    b = gauss(gl, src, p["radius"])
    out = gl.run(_SHARP_FRAG, src.size, u_tex=src, u_blur=b, **uniforms(_SHARP, p, env))
    gl.release(b)
    return out


_TILT = {
    "radius": P(25.0, "Maximum blur radius.", min=0, max=300, px=True),
    "center": P([0.5, 0.5], "Centre of the in-focus band, normalised."),
    "width": P(0.2, "Half-height of the sharp band (fraction of frame height).", min=0, max=1),
    "falloff": P(0.25, "Distance over which blur ramps to full.", min=0.001, max=1),
    "angle": P(0.0, "Rotation of the focus band in degrees."),
    "radial": P(False, "Use a circular focus area instead of a band."),
}
_TILT_FRAG = build_frag(_TILT, """
uniform sampler2D u_blur;
vec4 fx(vec2 uv){
  vec2 p = (uv - u_center) * vec2(u_res.x / u_res.y, 1.0);
  p = rot2(radians(-u_angle)) * p;
  float d = u_radial == 1 ? length(p) : abs(p.y);
  return mix(T(uv), texture(u_blur, uv), smoothstep(u_width, u_width + u_falloff, d));
}""")


@effect("tilt_shift", "blur", "Selective focus: sharp band or circle, blurred elsewhere. Also works as a quick fake depth of field.", _TILT)
def tilt_shift(gl, src, p, env):
    b = gauss(gl, src, p["radius"])
    out = gl.run(_TILT_FRAG, src.size, u_tex=src, u_blur=b, **uniforms(_TILT, p, env))
    gl.release(b)
    return out
