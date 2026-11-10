"""Generators: draw new pixels (gradients, noise, particles, speed lines) over or instead of the layer."""
from __future__ import annotations

from . import BLEND_CHOICES, GEN_BLEND, P, shader

_BL = lambda default="normal": P(default, "How the generated pixels combine with the layer (replace ignores the layer).", choices=BLEND_CHOICES)
_OP = P(1.0, "Opacity of the generated pixels.", min=0, max=1)

shader("gradient", "generate", "Linear or radial colour gradient. On a solid layer it makes backgrounds; with blend it tints footage.", {
    "start_color": P([0.1, 0.0, 0.3, 1.0], "Colour at the start."),
    "end_color": P([1.0, 0.4, 0.2, 1.0], "Colour at the end."),
    "start": P([0.5, 0.0], "Start point, normalised."),
    "end": P([0.5, 1.0], "End point, normalised."),
    "shape": P("linear", "Gradient type.", choices=["linear", "radial"]),
    "blend": _BL("replace"), "opacity": _OP,
}, """vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x / u_res.y, 1.0); vec2 a = u_start * asp, b = u_end * asp, p = uv * asp; float k;
  if(u_shape == 0){ vec2 d = b - a; k = dot(p - a, d) / max(dot(d, d), 1e-6); } else k = length(p - a) / max(length(b - a), 1e-6);
  k = clamp(k, 0.0, 1.0); k = k * k * (3.0 - 2.0 * k);
  vec4 c = mix(u_start_color, u_end_color, k); c.rgb += (hash21(uv * u_res) - 0.5) / 255.0;
  return gen_blend(T(uv), c.rgb, c.a * u_opacity, u_blend); }""", GEN_BLEND)

shader("fractal_noise", "generate", "Animated cloud/smoke noise. Use as fog or texture, or as a luma matte source for organic reveals.", {
    "scale": P(300.0, "Feature size.", min=2, max=5000, px=True),
    "speed": P(0.3, "Evolution speed.", min=0, max=20),
    "drift": P([0.0, 0.0], "Scroll velocity in features per second."),
    "contrast": P(1.5, "Contrast of the noise.", min=0, max=10),
    "brightness": P(0.0, "Brightness offset.", min=-1, max=1),
    "color_a": P([0.0, 0.0, 0.0, 1.0], "Dark colour."),
    "color_b": P([1.0, 1.0, 1.0, 1.0], "Bright colour."),
    "seed": P(0.0, "Random seed."),
    "blend": _BL("replace"), "opacity": _OP,
}, """vec4 fx(vec2 uv){ vec2 p = uv * u_res / u_scale + u_seed * 17.3 - u_drift * u_time; float t = u_time * u_speed;
  float n = fbm(p + vec2(fbm(p + t), fbm(p - t + 9.2)) * 1.2);
  n = clamp((n - 0.5) * u_contrast + 0.5 + u_brightness, 0.0, 1.0);
  vec4 c = mix(u_color_a, u_color_b, n); return gen_blend(T(uv), c.rgb, c.a * u_opacity, u_blend); }""", GEN_BLEND)

shader("grid", "generate", "Line grid overlay (retro / tech / synthwave backgrounds). Set perspective for a floor grid.", {
    "spacing": P(80.0, "Cell size.", min=4, max=2000, px=True),
    "thickness": P(2.0, "Line thickness.", min=0.5, max=200, px=True),
    "color": P([0.2, 1.0, 0.9, 1.0], "Line colour."),
    "scroll": P([0.0, 0.0], "Scroll speed in cells per second."),
    "perspective": P(0.0, "0 = flat grid, 1 = receding floor grid below the horizon.", min=0, max=1),
    "horizon": P(0.5, "Horizon height for the floor grid, normalised.", min=0, max=1),
    "blend": _BL("add"), "opacity": _OP,
}, """vec4 fx(vec2 uv){ vec2 p = uv * u_res; float fade = 1.0;
  if(u_perspective > 0.0){ float y = uv.y - u_horizon; if(y <= 0.0) return T(uv);
    float z = 1.0 / (y * 4.0 + 1e-3); vec2 f = vec2((uv.x - 0.5) * z * u_res.x, z * u_res.y * 0.5); p = mix(p, f, u_perspective); fade = smoothstep(0.0, 0.12, y); }
  vec2 g = p / u_spacing + u_scroll * u_time; vec2 d = abs(fract(g - 0.5) - 0.5) * u_spacing; vec2 w = fwidth(g) * u_spacing;
  float l = max(1.0 - smoothstep(u_thickness * 0.5 - w.x, u_thickness * 0.5 + w.x, d.x), 1.0 - smoothstep(u_thickness * 0.5 - w.y, u_thickness * 0.5 + w.y, d.y));
  return gen_blend(T(uv), u_color.rgb, l * fade * u_color.a * u_opacity, u_blend); }""", GEN_BLEND)

shader("particles", "generate", "Procedural drifting particles: dust, snow, embers, bokeh. Layer over footage for atmosphere.", {
    "density": P(40.0, "Number of particles per layer (3 depth layers).", min=1, max=400),
    "size": P(6.0, "Particle size.", min=0.5, max=300, px=True),
    "speed": P(0.15, "Drift speed in frame heights per second.", min=0, max=5),
    "direction": P(90.0, "Drift direction in degrees (90 = falling down, 270 = rising)."),
    "wander": P(0.3, "Sideways wobble.", min=0, max=2),
    "softness": P(0.5, "0 = hard discs, 1 = soft glows.", min=0, max=1),
    "color": P([1.0, 1.0, 1.0, 1.0], "Particle colour."),
    "twinkle": P(0.5, "Brightness flicker.", min=0, max=1),
    "seed": P(0.0, "Random seed."),
    "blend": _BL("add"), "opacity": _OP,
}, """vec4 fx(vec2 uv){ vec2 asp = vec2(u_res.x / u_res.y, 1.0); float a = radians(u_direction); vec2 dir = vec2(cos(a), sin(a)); float acc = 0.0;
  for(int L = 0; L < 3; L++){ float fl = float(L); float depth = 1.0 - fl * 0.3; float n = sqrt(u_density);
    vec2 p = uv * asp * n - dir * u_time * u_speed * n * depth + fl * 37.1 + u_seed * 5.3;
    vec2 cell = floor(p);
    for(int j = -1; j <= 1; j++) for(int i = -1; i <= 1; i++){ vec2 c = cell + vec2(i, j); vec2 h = hash22(c + fl * 11.0);
      vec2 pos = c + h + vec2(sin(u_time * (0.5 + h.x) + h.y * 40.0), cos(u_time * (0.4 + h.y) + h.x * 40.0)) * u_wander * 0.35;
      float r = u_size * (0.4 + h.x * 0.9) * depth / u_res.y * n; float d = length(p - pos);
      float m = 1.0 - smoothstep(r * (1.0 - u_softness), r + 1e-4, d);
      float tw = 1.0 - u_twinkle * (0.5 + 0.5 * sin(u_time * (2.0 + h.y * 6.0) + h.x * 50.0));
      acc += m * tw * depth; } }
  return gen_blend(T(uv), u_color.rgb, acc * u_color.a * u_opacity, u_blend); }""", GEN_BLEND)

shader("speed_lines", "generate", "Radial anime-style speed lines bursting from a centre. Keyframe opacity for impact frames.", {
    "center": P([0.5, 0.5], "Focus point, normalised."),
    "density": P(90.0, "Number of lines around the circle.", min=4, max=600),
    "inner": P(0.35, "Radius of the clear area around the centre.", min=0, max=1.5),
    "sharpness": P(0.6, "0 = soft wedges, 1 = thin needles.", min=0, max=1),
    "speed": P(14.0, "Flicker rate (pattern changes per second).", min=0, max=60),
    "color": P([1.0, 1.0, 1.0, 1.0], "Line colour."),
    "seed": P(0.0, "Random seed."),
    "blend": _BL("normal"), "opacity": _OP,
}, """vec4 fx(vec2 uv){ vec2 p = (uv - u_center) * vec2(u_res.x / u_res.y, 1.0); float r = length(p); float ang = atan(p.y, p.x) / TAU + 0.5;
  float t = floor(u_time * u_speed) + u_seed * 7.0; float k = ang * u_density; float id = floor(k); float f = fract(k);
  float h = hash21(vec2(id, t)); float on = step(0.45, h);
  float w = mix(0.5, 0.12, u_sharpness) * (0.4 + h); float line = 1.0 - smoothstep(w * 0.4, w, abs(f - 0.5));
  float start = u_inner * (0.7 + 0.6 * hash21(vec2(id + 3.0, t))); float m = line * on * smoothstep(start, start + 0.25, r);
  return gen_blend(T(uv), u_color.rgb, m * u_color.a * u_opacity, u_blend); }""", GEN_BLEND)

shader("stripes", "generate", "Animated stripes or chevrons for backgrounds, wipes and mattes.", {
    "spacing": P(120.0, "Distance between stripes.", min=2, max=4000, px=True),
    "ratio": P(0.5, "Stripe width as a fraction of spacing.", min=0, max=1),
    "angle": P(45.0, "Stripe angle in degrees."),
    "speed": P(1.0, "Scroll speed in stripes per second."),
    "color": P([1.0, 1.0, 1.0, 1.0], "Stripe colour."),
    "blend": _BL("normal"), "opacity": _OP,
}, """vec4 fx(vec2 uv){ float a = radians(u_angle); float c = dot(uv * u_res, vec2(cos(a), sin(a))) / u_spacing - u_time * u_speed;
  float w = fwidth(c); float f = fract(c); float m = smoothstep(0.0, w, f) * (1.0 - smoothstep(u_ratio, u_ratio + w, f));
  return gen_blend(T(uv), u_color.rgb, m * u_color.a * u_opacity, u_blend); }""", GEN_BLEND)

shader("color_overlay", "generate", "Lay a flat colour over the layer with a blend mode (tints, washes, flash frames).", {
    "color": P([1.0, 1.0, 1.0, 1.0], "Overlay colour."),
    "blend": _BL("normal"), "opacity": P(0.5, "Overlay opacity. Keyframe 0 → 1 → 0 for a colour flash.", min=0, max=1),
}, "vec4 fx(vec2 uv){ return gen_blend(T(uv), u_color.rgb, u_color.a * u_opacity, u_blend); }", GEN_BLEND)
