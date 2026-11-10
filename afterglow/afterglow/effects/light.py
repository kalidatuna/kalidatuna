"""Glows, streaks, rays, flares and leaks."""
from __future__ import annotations

import math

from ..gl import PRELUDE
from . import P, build_frag, effect, shader, uniforms
from .blur import downsample, gauss

THRESH = PRELUDE + """
uniform float u_threshold; uniform float u_knee; uniform float u_sat;
void main(){
  vec4 s = texture(u_tex, v_uv);
  float l = max(s.r, max(s.g, s.b));
  float k = smoothstep(u_threshold - u_knee, u_threshold + u_knee + 1e-4, l);
  vec3 c = s.rgb * k;
  float g = luma(c);
  o = vec4(max(mix(vec3(g), c, u_sat), 0.0), 1.0);
}"""


def bright_pass(gl, src, threshold, knee=0.1, sat=1.0, levels=1):
    b = gl.run(THRESH, src.size, u_tex=src, u_threshold=threshold, u_knee=knee, u_sat=sat)
    if levels:
        d = downsample(gl, b, levels)
        gl.release(b)
        b = d
    return b


_GLOW = {
    "threshold": P(0.6, "Brightness above which pixels start to glow (0 = everything glows).", min=0, max=2),
    "radius": P(60.0, "Glow size.", min=0, max=800, px=True),
    "intensity": P(1.0, "Glow brightness. Keyframe this for beat-synced glow pulses.", min=0, max=20),
    "color": P([1.0, 1.0, 1.0, 1.0], "Glow tint."),
    "saturation": P(1.2, "Colour saturation of the glow itself.", min=0, max=4),
    "softness": P(0.15, "Softness of the threshold.", min=0, max=1),
    "blend": P("add", "How the glow is combined with the image.", choices=["add", "screen"]),
    "glow_only": P(False, "Output only the glow (useful on a duplicate layer)."),
}
_GLOW_FRAG = build_frag(_GLOW, """
uniform sampler2D u_b0; uniform sampler2D u_b1; uniform sampler2D u_b2;
vec4 fx(vec2 uv){
  vec4 s = T(uv);
  vec3 g = (texture(u_b0, uv).rgb * 0.45 + texture(u_b1, uv).rgb * 0.33 + texture(u_b2, uv).rgb * 0.22) * u_intensity * u_color.rgb;
  float ga = clamp(max(g.r, max(g.g, g.b)), 0.0, 1.0);
  if(u_glow_only == 1) return vec4(g, ga);
  vec3 c = u_blend == 0 ? s.rgb + g : s.rgb + g * (1.0 - clamp(s.rgb, 0.0, 1.0));
  return vec4(c, max(s.a, ga));
}""")


@effect("glow", "light", "Multi-scale bloom around bright areas: tight core plus wide soft halo. "
        "The workhorse glow for hype edits; keyframe intensity on beats.", _GLOW)
def glow(gl, src, p, env):
    if p["intensity"] <= 0 and not p["glow_only"]:
        return src
    b = bright_pass(gl, src, p["threshold"], p["softness"], p["saturation"], levels=1)
    r = p["radius"] / 2.0  # bright pass is half-res
    b0, b1, b2 = gauss(gl, b, r * 0.22), gauss(gl, b, r * 0.55), gauss(gl, b, r * 1.3)
    out = gl.run(_GLOW_FRAG, src.size, u_tex=src, u_b0=b0, u_b1=b1, u_b2=b2, **uniforms(_GLOW, p, env))
    gl.release(b, b0, b1, b2)
    return out


_STREAK = PRELUDE + """
uniform vec2 u_dir; uniform float u_fall;
void main(){
  vec4 s = vec4(0.0); float ws = 0.0;
  for(int i = -20; i <= 20; i++){
    float k = float(i) / 20.0; float w = pow(1.0 - abs(k), u_fall);
    s += texture(u_tex, v_uv + u_dir * k) * w; ws += w;
  }
  o = s / ws;
}"""
_GLINT = {
    "threshold": P(0.7, "Brightness above which highlights emit streaks.", min=0, max=2),
    "length": P(220.0, "Streak length.", min=0, max=2000, px=True),
    "intensity": P(1.5, "Streak brightness.", min=0, max=20),
    "points": P(4, "Number of star points (2 = one anamorphic line, 4 = cross, 6, 8).", min=2, max=8),
    "angle": P(0.0, "Rotation of the star in degrees."),
    "color": P([1.0, 1.0, 1.0, 1.0], "Streak tint."),
}
_GLINT_FRAG = build_frag(_GLINT, """
uniform sampler2D u_s0; uniform sampler2D u_s1; uniform sampler2D u_s2; uniform sampler2D u_s3; uniform int u_lines;
vec4 fx(vec2 uv){
  vec4 s = T(uv);
  vec3 g = texture(u_s0, uv).rgb;
  if(u_lines > 1) g += texture(u_s1, uv).rgb;
  if(u_lines > 2) g += texture(u_s2, uv).rgb;
  if(u_lines > 3) g += texture(u_s3, uv).rgb;
  g *= u_intensity * u_color.rgb * 6.0;
  return vec4(s.rgb + g, max(s.a, clamp(max(g.r, max(g.g, g.b)), 0.0, 1.0)));
}""")


@effect("glint", "light", "Star-shaped light streaks from highlights. points=2 gives a horizontal anamorphic streak.", _GLINT)
def glint(gl, src, p, env):
    b = bright_pass(gl, src, p["threshold"], 0.08, 1.2, levels=1)
    lines = max(1, min(4, p["points"] // 2))
    streaks = []
    for i in range(lines):
        a = math.radians(p["angle"]) + math.pi * i / lines
        d = (math.cos(a) * p["length"] / 2 / b.w, math.sin(a) * p["length"] / 2 / b.h)
        s1 = gl.run(_STREAK, b.size, u_tex=b, u_dir=d, u_fall=2.5)
        s2 = gl.run(_STREAK, b.size, u_tex=s1, u_dir=(d[0] / 20, d[1] / 20), u_fall=1.0)
        gl.release(s1)
        streaks.append(s2)
    tex = {f"u_s{i}": streaks[min(i, lines - 1)] for i in range(4)}
    out = gl.run(_GLINT_FRAG, src.size, u_tex=src, u_lines=lines, **tex, **uniforms(_GLINT, p, env))
    gl.release(b, *streaks)
    return out


_RAYS_PASS = PRELUDE + """
uniform vec2 u_center; uniform float u_len; uniform float u_decay;
void main(){
  vec2 d = (u_center - v_uv) * u_len / 16.0; vec4 s = vec4(0.0); float w = 1.0, ws = 0.0;
  for(int i = 0; i < 16; i++){ s += texture(u_tex, v_uv + d * float(i)) * w; ws += w; w *= u_decay; }
  o = s / ws;
}"""
_RAYS = {
    "threshold": P(0.6, "Brightness above which pixels cast rays.", min=0, max=2),
    "center": P([0.5, 0.3], "Light source position, normalised."),
    "length": P(0.6, "Ray length as a fraction of the distance to the source.", min=0, max=1),
    "intensity": P(1.5, "Ray brightness.", min=0, max=20),
    "color": P([1.0, 0.95, 0.85, 1.0], "Ray tint."),
}
_RAYS_FRAG = build_frag(_RAYS, """
uniform sampler2D u_rays;
vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 g = texture(u_rays, uv).rgb * u_intensity * u_color.rgb * 2.0;
  return vec4(s.rgb + g, max(s.a, clamp(max(g.r, max(g.g, g.b)), 0.0, 1.0))); }""")


@effect("light_rays", "light", "Volumetric god rays shining from a point through bright areas of the image.", _RAYS)
def light_rays(gl, src, p, env):
    b = bright_pass(gl, src, p["threshold"], 0.1, 1.0, levels=1)
    a = gl.run(_RAYS_PASS, b.size, u_tex=b, u_center=p["center"], u_len=p["length"], u_decay=0.92)
    c = gl.run(_RAYS_PASS, b.size, u_tex=a, u_center=p["center"], u_len=p["length"] / 16.0, u_decay=1.0)
    out = gl.run(_RAYS_FRAG, src.size, u_tex=src, u_rays=c, **uniforms(_RAYS, p, env))
    gl.release(b, a, c)
    return out


_SOFT = {
    "radius": P(40.0, "Diffusion size.", min=0, max=500, px=True),
    "amount": P(0.6, "Strength of the dreamy bloom.", min=0, max=3),
    "threshold": P(0.0, "Only diffuse pixels brighter than this.", min=0, max=1),
    "tint": P([1.0, 1.0, 1.0, 1.0], "Colour of the diffused light."),
}
_SOFT_FRAG = build_frag(_SOFT, """
uniform sampler2D u_blur;
vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 b = texture(u_blur, uv).rgb * u_tint.rgb * u_amount;
  return vec4(s.rgb + b * (1.0 - clamp(s.rgb, 0.0, 1.0)), s.a); }""")


@effect("diffusion", "light", "Soft dreamy bloom (blurred copy screened over the image). The 'soft glow' aesthetic look.", _SOFT)
def diffusion(gl, src, p, env):
    b = bright_pass(gl, src, p["threshold"], 0.2, 1.0, levels=0) if p["threshold"] > 0 else None
    blur = gauss(gl, b or src, p["radius"])
    out = gl.run(_SOFT_FRAG, src.size, u_tex=src, u_blur=blur, **uniforms(_SOFT, p, env))
    gl.release(b, blur)
    return out


_HAL = {
    "threshold": P(0.75, "Brightness above which highlights bleed.", min=0, max=2),
    "radius": P(30.0, "Bleed size.", min=0, max=300, px=True),
    "amount": P(0.8, "Strength.", min=0, max=5),
    "color": P([1.0, 0.3, 0.15, 1.0], "Halation colour (film halation is red-orange)."),
}
_HAL_FRAG = build_frag(_HAL, """
uniform sampler2D u_blur;
vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 b = vec3(luma(texture(u_blur, uv).rgb)) * u_color.rgb * u_amount;
  return vec4(s.rgb + b * (1.0 - clamp(s.rgb, 0.0, 1.0)), s.a); }""")


@effect("halation", "light", "Film halation: red-orange glow bleeding from highlights. Pair with film_grain for an analog look.", _HAL)
def halation(gl, src, p, env):
    b = bright_pass(gl, src, p["threshold"], 0.1, 1.0, levels=1)
    blur = gauss(gl, b, p["radius"] / 2)
    out = gl.run(_HAL_FRAG, src.size, u_tex=src, u_blur=blur, **uniforms(_HAL, p, env))
    gl.release(b, blur)
    return out


shader("lens_flare", "light", "Procedural lens flare: hot core, anamorphic streak, halo ring and ghosts. Animate center for a sweep.", {
    "center": P([0.3, 0.3], "Light source position, normalised."),
    "intensity": P(1.0, "Overall brightness.", min=0, max=10),
    "size": P(1.0, "Overall scale of the flare elements.", min=0.05, max=5),
    "color": P([1.0, 0.85, 0.7, 1.0], "Core tint."),
    "streak": P(1.0, "Strength of the horizontal anamorphic streak.", min=0, max=5),
    "ghosts": P(1.0, "Strength of the ghost reflections.", min=0, max=5),
}, """
vec4 fx(vec2 uv){
  vec4 s = T(uv);
  vec2 asp = vec2(u_res.x / u_res.y, 1.0);
  vec2 p = (uv - u_center) * asp / u_size; float d = length(p);
  vec3 f = u_color.rgb * (0.012 / (d * d + 0.004));
  float ang = atan(p.y, p.x);
  f += u_color.rgb * (0.03 / (d + 0.02)) * pow(abs(sin(ang * 7.0 + u_center.x * 9.0)) * 0.5 + 0.5 * abs(sin(ang * 3.0)), 6.0) * smoothstep(0.9, 0.0, d);
  f += vec3(0.35, 0.55, 1.0) * exp(-abs(p.y) * 140.0) * exp(-abs(p.x) * 1.6) * 0.9 * u_streak;
  f += vec3(1.0, 0.6, 0.3) * smoothstep(0.03, 0.0, abs(d - 0.42)) * 0.12;
  vec2 axis = (vec2(0.5) - u_center) * asp / u_size;
  for(int i = 1; i <= 6; i++){
    float fi = float(i); vec2 gp = p - axis * (0.45 * fi + 0.2 * hash11(fi));
    float r = 0.035 + 0.06 * hash11(fi * 3.7);
    vec3 col = 0.5 + 0.5 * cos(TAU * (hash11(fi * 9.1) + vec3(0.0, 0.33, 0.67)));
    f += col * smoothstep(r, r * 0.6, length(gp)) * 0.07 * u_ghosts;
  }
  f *= u_intensity;
  return vec4(s.rgb + f, max(s.a, clamp(max(f.r, max(f.g, f.b)), 0.0, 1.0)));
}""")


shader("light_leak", "light", "Organic drifting colour leaks from the frame edges, like light hitting film. Screen-blended.", {
    "amount": P(0.8, "Leak brightness. Keyframe for leak flashes on cuts.", min=0, max=5),
    "color_a": P([1.0, 0.45, 0.1, 1.0], "First leak colour."),
    "color_b": P([1.0, 0.1, 0.4, 1.0], "Second leak colour."),
    "speed": P(0.4, "Drift speed.", min=0, max=10),
    "scale": P(1.0, "Size of the leak shapes.", min=0.1, max=10),
    "seed": P(0.0, "Random seed for a different leak pattern."),
}, """
vec4 fx(vec2 uv){
  vec4 s = T(uv);
  vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) / u_scale;
  float t = u_time * u_speed + u_seed * 13.7;
  float n1 = fbm(p * 1.3 + vec2(t * 0.6, -t * 0.25) + u_seed);
  float n2 = fbm(p * 0.9 + vec2(-t * 0.4, t * 0.5) + 37.0 + u_seed);
  float edge = smoothstep(0.1, 0.75, length(uv - 0.5) * 1.35);
  float a = smoothstep(0.42, 0.85, n1) * (0.35 + 0.65 * edge);
  float b = smoothstep(0.45, 0.9, n2) * (0.35 + 0.65 * edge);
  vec3 leak = (u_color_a.rgb * a + u_color_b.rgb * b) * u_amount;
  return vec4(s.rgb + leak * (1.0 - clamp(s.rgb, 0.0, 1.0)), max(s.a, clamp(luma(leak), 0.0, 1.0)));
}""")


shader("light_sweep", "light", "A band of light sweeping across the layer. Animate progress 0→1; great on text and logos.", {
    "progress": P(0.5, "Position of the sweep across the frame (0 → 1).", min=-0.5, max=1.5),
    "angle": P(25.0, "Tilt of the band in degrees."),
    "width": P(0.12, "Band width as a fraction of the frame.", min=0.005, max=1),
    "intensity": P(1.0, "Brightness.", min=0, max=10),
    "color": P([1.0, 1.0, 1.0, 1.0], "Sweep colour."),
}, """
vec4 fx(vec2 uv){
  vec4 s = T(uv);
  vec2 p = rot2(radians(u_angle)) * ((uv - 0.5) * vec2(u_res.x / u_res.y, 1.0));
  float span = u_res.x / u_res.y + 0.6;
  float x = p.x + span * 0.5 - u_progress * span;
  float band = exp(-x * x / (u_width * u_width * 0.5));
  return vec4(s.rgb + u_color.rgb * band * u_intensity * s.a, s.a);
}""")
