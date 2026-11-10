"""Geometric distortion, camera shake and the in-effect transform."""
from __future__ import annotations

import numpy as np

from . import EDGE_MODES, P, build_frag, effect, shader, uniforms

_XF = {
    "offset": P([0.0, 0.0], "Shift in pixels (x right, y down).", px=True),
    "scale": P(100.0, "Uniform scale in percent.", min=1, max=2000),
    "rotation": P(0.0, "Rotation in degrees."),
    "center": P([0.5, 0.5], "Pivot for scale and rotation, normalised."),
    "edge": P("mirror", "How pixels beyond the frame are filled (mirror hides edges during shakes and whips).", choices=EDGE_MODES),
    "motion_blur": P(0.0, "Shutter amount: 0 = off, 1 = a full frame of motion blur from this effect's own keyframes.", min=0, max=4),
    "samples": P(16, "Motion-blur quality.", min=2, max=32),
}
_XF_FRAG = build_frag(_XF, """
uniform vec4 u_s[32]; uniform vec2 u_c[32]; uniform int u_n;
vec4 fx(vec2 uv){
  vec4 acc = vec4(0.0);
  for(int i = 0; i < 32; i++){
    if(i >= u_n) break;
    vec2 p = (uv - u_c[i]) * u_res - u_s[i].xy;
    p = rot2(u_s[i].w) * p / u_s[i].z;
    acc += tex_edge(u_tex, p / u_res + u_c[i], u_edge);
  }
  return acc / float(u_n);
}""")


@effect("transform", "distort", "Move / scale / rotate inside the layer with edge fill and real motion blur from its own "
        "keyframes. Use this (not the layer transform) for whip pans, zoom punches and spins so edges never show.", _XF)
def transform(gl, src, p, env):
    n = int(p["samples"]) if p["motion_blur"] > 0 else 1
    s = np.zeros((32, 4), np.float32)
    c = np.zeros((32, 2), np.float32)
    dt = p["motion_blur"] / env.fps
    for i in range(n):
        q = p if n == 1 else env.params_at(env.t + (i / (n - 1) - 0.5) * dt)
        s[i] = (q["offset"][0], q["offset"][1], max(q["scale"], 0.01) / 100.0, np.radians(q["rotation"]))
        c[i] = q["center"]
    if n == 1 and abs(s[0, 0]) + abs(s[0, 1]) < 1e-4 and abs(s[0, 2] - 1) < 1e-6 and abs(s[0, 3]) < 1e-7:
        return src
    return gl.run(_XF_FRAG, src.size, u_tex=src, u_s=s, u_c=c, u_n=n, **uniforms(_XF, p, env))


shader("shake", "distort", "Procedural camera shake with built-in motion blur. Keyframe `amount` in short pulses for "
       "impact shakes on beats; leave it constant for handheld jitter.", {
    "amount": P(30.0, "Shake distance. Keyframe 0 → peak → 0 for hits.", min=0, max=1000, px=True),
    "frequency": P(14.0, "Shakes per second.", min=0.1, max=60),
    "rotation": P(1.5, "Rotational shake in degrees.", min=0, max=45),
    "zoom": P(0.0, "Zoom jitter in percent.", min=0, max=50),
    "x": P(1.0, "Horizontal multiplier.", min=0, max=4),
    "y": P(1.0, "Vertical multiplier.", min=0, max=4),
    "motion_blur": P(0.6, "Shutter amount (0 = sharp, 1 = full-frame blur).", min=0, max=2),
    "edge": P("mirror", "How pixels beyond the frame are filled.", choices=EDGE_MODES),
    "seed": P(0.0, "Random seed."),
    "fps": P(30.0, "Frame rate used for the motion-blur shutter.", min=1, max=240),
}, """
vec4 fx(vec2 uv){
  if(u_amount <= 0.0 && u_rotation <= 0.0 && u_zoom <= 0.0) return T(uv);
  float k = u_amount > 0.0 ? 1.0 : 0.0;
  vec4 acc = vec4(0.0);
  int n = u_motion_blur > 0.0 ? 12 : 1;
  for(int i = 0; i < 12; i++){
    if(i >= n) break;
    float t = u_time + (n > 1 ? (float(i) / float(n - 1) - 0.5) * u_motion_blur / u_fps : 0.0);
    float f = t * u_frequency;
    vec2 off = vec2(noise1(f + u_seed * 17.0) + 0.5 * noise1(f * 2.3 + 31.0 + u_seed), noise1(f + 57.0 + u_seed * 29.0) + 0.5 * noise1(f * 2.1 + 91.0 + u_seed)) * vec2(u_x, u_y) * u_amount;
    float r = radians(u_rotation) * noise1(f * 0.9 + 133.0 + u_seed) * k;
    float z = 1.0 + u_zoom * 0.01 * noise1(f * 0.8 + 211.0 + u_seed) * k;
    vec2 p = (uv - 0.5) * u_res - off;
    p = rot2(-r) * p / z;
    acc += tex_edge(u_tex, p / u_res + 0.5, u_edge);
  }
  return acc / float(n);
}""")

shader("wave_warp", "distort", "Sine-wave displacement. Low amplitude = heat shimmer, high = wobbly dream/drunk look.", {
    "amplitude": P(20.0, "Wave height.", min=0, max=500, px=True),
    "wavelength": P(200.0, "Distance between wave peaks.", min=1, max=4000, px=True),
    "speed": P(1.0, "Cycles per second.", min=-20, max=20),
    "angle": P(0.0, "Direction the waves travel, in degrees."),
    "edge": P("mirror", "Edge fill.", choices=EDGE_MODES),
}, """vec4 fx(vec2 uv){ float a = radians(u_angle); vec2 d = vec2(cos(a), sin(a)); vec2 p = uv * u_res;
  float w = sin((dot(p, d) / u_wavelength - u_time * u_speed) * TAU) * u_amplitude;
  return tex_edge(u_tex, (p + vec2(-d.y, d.x) * w) / u_res, u_edge); }""")

shader("ripple", "distort", "Concentric ripples from a point, like a water drop or shockwave. Animate phase/amplitude for an impact wave.", {
    "center": P([0.5, 0.5], "Ripple origin, normalised."),
    "amplitude": P(15.0, "Displacement strength.", min=0, max=300, px=True),
    "wavelength": P(120.0, "Distance between rings.", min=1, max=2000, px=True),
    "speed": P(2.0, "Outward speed in cycles per second.", min=-20, max=20),
    "radius": P(1.5, "How far the ripples reach (fraction of frame height).", min=0, max=5),
}, """vec4 fx(vec2 uv){ vec2 p = (uv - u_center) * u_res; float d = length(p);
  float fall = 1.0 - smoothstep(0.0, u_radius * u_res.y, d);
  float w = sin((d / u_wavelength - u_time * u_speed) * TAU) * u_amplitude * fall;
  return tex_edge(u_tex, (p + normalize(p + 1e-5) * w) / u_res + u_center, 3); }""")

shader("shockwave", "distort", "A single expanding refraction ring. Animate progress 0→1 on an impact.", {
    "center": P([0.5, 0.5], "Origin, normalised."),
    "progress": P(0.5, "Ring radius as a fraction of the frame diagonal.", min=0, max=1.5),
    "width": P(0.08, "Ring thickness.", min=0.005, max=0.5),
    "strength": P(40.0, "Refraction amount.", min=0, max=400, px=True),
}, """vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x / u_res.y, 1.0); vec2 p = (uv - u_center) * asp; float d = length(p);
  float x = (d - u_progress * 1.2) / u_width; float ring = exp(-x * x * 4.0) * (1.0 - smoothstep(0.7, 1.2, u_progress));
  vec2 off = normalize(p + 1e-5) * ring * x * u_strength / u_res.y;
  vec4 s = tex_edge(u_tex, uv - off / asp, 3); return vec4(s.rgb * (1.0 + ring * 0.25), s.a); }""")

shader("turbulent_displace", "distort", "Organic noise-driven warping. Use for heat haze, liquid text, dreamy wobble.", {
    "amount": P(30.0, "Displacement strength.", min=0, max=1000, px=True),
    "size": P(150.0, "Size of the noise features.", min=2, max=4000, px=True),
    "speed": P(0.5, "Evolution speed.", min=0, max=20),
    "seed": P(0.0, "Random seed."),
    "edge": P("mirror", "Edge fill.", choices=EDGE_MODES),
}, """vec4 fx(vec2 uv){ vec2 p = uv * u_res / u_size + u_seed * 7.1; float t = u_time * u_speed;
  vec2 n = vec2(fbm(p + vec2(t, 0.0)), fbm(p + vec2(31.7, t + 5.2))) - 0.47;
  return tex_edge(u_tex, uv + n * 2.0 * u_amount / u_res, u_edge); }""")

shader("bulge", "distort", "Bulge (positive) or pinch (negative) around a point. Pulse it for a 'bass bump' punch.", {
    "center": P([0.5, 0.5], "Centre, normalised."),
    "radius": P(0.5, "Affected radius as a fraction of frame height.", min=0.01, max=3),
    "amount": P(0.5, "Positive = bulge out, negative = pinch in.", min=-1, max=1),
}, """vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x / u_res.y, 1.0); vec2 p = (uv - u_center) * asp; float d = length(p) / u_radius;
  if(d < 1.0){ p *= pow(d, 1.0 + u_amount * (1.0 - d * d) * 1.5) / max(d, 1e-5); }
  return tex_edge(u_tex, p / asp + u_center, 3); }""")

shader("twirl", "distort", "Swirl the image around a point. Animate angle for a vortex transition.", {
    "center": P([0.5, 0.5], "Centre, normalised."),
    "angle": P(90.0, "Twist at the centre in degrees."),
    "radius": P(0.6, "Affected radius as a fraction of frame height.", min=0.01, max=3),
}, """vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x / u_res.y, 1.0); vec2 p = (uv - u_center) * asp;
  float k = 1.0 - smoothstep(0.0, u_radius, length(p)); p = rot2(radians(u_angle) * k * k) * p;
  return tex_edge(u_tex, p / asp + u_center, 3); }""")

shader("lens_distort", "distort", "Barrel (fisheye) or pincushion lens distortion, with optional colour fringing. "
       "Positive amount = wide-angle/GoPro look.", {
    "amount": P(0.3, "Positive = barrel/fisheye, negative = pincushion.", min=-1, max=2),
    "fringe": P(0.0, "Chromatic fringing toward the edges.", min=0, max=1),
    "zoom": P(1.0, "Compensating zoom to hide stretched edges.", min=0.2, max=4),
}, """
vec2 ld(vec2 uv, float k){ vec2 p = (uv - 0.5) * 2.0; p.x *= u_res.x / u_res.y; float r2 = dot(p, p);
  p *= (1.0 + k * r2) / (1.0 + k * 0.5) / u_zoom; p.x /= u_res.x / u_res.y; return p * 0.5 + 0.5; }
vec4 fx(vec2 uv){
  if(u_fringe <= 0.0) return tex_edge(u_tex, ld(uv, u_amount), 3);
  vec4 r = tex_edge(u_tex, ld(uv, u_amount * (1.0 + 0.12 * u_fringe)), 3);
  vec4 g = tex_edge(u_tex, ld(uv, u_amount), 3);
  vec4 b = tex_edge(u_tex, ld(uv, u_amount * (1.0 - 0.12 * u_fringe)), 3);
  return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a))); }""")

shader("mirror", "distort", "Reflect one half of the frame onto the other.", {
    "center": P([0.5, 0.5], "Position of the mirror line, normalised."),
    "angle": P(0.0, "Mirror line angle: 0 = left reflects onto right, 90 = top onto bottom, 180/270 = the other side."),
}, """vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x / u_res.y, 1.0); float a = radians(u_angle); vec2 n = vec2(cos(a), sin(a));
  vec2 p = (uv - u_center) * asp; float d = dot(p, n); if(d > 0.0) p -= 2.0 * d * n;
  return tex_edge(u_tex, p / asp + u_center, 3); }""")

shader("kaleidoscope", "distort", "Mirror the image into rotating wedge segments.", {
    "segments": P(6.0, "Number of mirrored wedges.", min=1, max=32),
    "angle": P(0.0, "Rotation of the pattern in degrees. Animate to spin."),
    "center": P([0.5, 0.5], "Centre, normalised."),
    "zoom": P(1.0, "Zoom of the sampled source.", min=0.1, max=10),
}, """vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x / u_res.y, 1.0); vec2 p = (uv - u_center) * asp;
  float r = length(p), a = atan(p.y, p.x) + radians(u_angle); float seg = TAU / u_segments;
  a = abs(mod(a, seg) - seg * 0.5);
  return tex_edge(u_tex, vec2(cos(a), sin(a)) * r / u_zoom / asp + 0.5, 3); }""")

shader("tile", "distort", "Repeat the image in a grid (optionally mirrored). Scale down + tile for multi-screen looks.", {
    "columns": P(2.0, "Tiles across.", min=0.1, max=50),
    "rows": P(2.0, "Tiles down.", min=0.1, max=50),
    "mirror": P(False, "Flip every other tile so edges match."),
    "offset": P([0.0, 0.0], "Scroll offset in tile units. Animate for an endless scroll."),
}, """vec4 fx(vec2 uv){ vec2 p = (uv - 0.5) * vec2(u_columns, u_rows) + 0.5 + u_offset;
  return texture(u_tex, edge_uv(p, u_mirror == 1 ? 3 : 2)); }""")

shader("flip", "distort", "Flip horizontally and/or vertically.", {
    "horizontal": P(True, "Flip left-right."),
    "vertical": P(False, "Flip top-bottom."),
}, "vec4 fx(vec2 uv){ return T(vec2(u_horizontal == 1 ? 1.0 - uv.x : uv.x, u_vertical == 1 ? 1.0 - uv.y : uv.y)); }")

shader("slit_stretch", "distort", "Stretch a single row or column of pixels across part of the frame (pixel-stretch look).", {
    "position": P(0.5, "Where the stretch starts (normalised along the axis).", min=0, max=1),
    "vertical": P(True, "True stretches downward from a row, False stretches rightward from a column."),
    "reverse": P(False, "Stretch toward the other side."),
    "feather": P(0.02, "Softness of the transition.", min=0, max=0.5),
}, """vec4 fx(vec2 uv){ float c = u_vertical == 1 ? uv.y : uv.x;
  float k = u_reverse == 1 ? 1.0 - smoothstep(u_position - u_feather - 1e-4, u_position, c) : smoothstep(u_position, u_position + u_feather + 1e-4, c);
  vec2 q = u_vertical == 1 ? vec2(uv.x, u_position) : vec2(u_position, uv.y);
  return mix(T(uv), T(q), k); }""")
