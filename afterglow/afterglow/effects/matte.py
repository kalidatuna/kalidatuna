"""Keying, wipes and alpha-based layer styles (shadow, stroke, fill)."""
from __future__ import annotations

from . import P, build_frag, effect, shader, uniforms
from .blur import gauss

shader("chroma_key", "matte", "Remove a green/blue screen (or any key colour) with spill suppression.", {
    "key": P([0.0, 1.0, 0.0, 1.0], "Colour to remove."),
    "tolerance": P(0.25, "How far from the key colour still counts as background.", min=0, max=1),
    "softness": P(0.1, "Edge softness.", min=0, max=1),
    "spill": P(0.8, "Remove key-coloured fringing on the subject.", min=0, max=1),
}, """
vec2 cbcr(vec3 c){ return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b); }
vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s);
  float d = distance(cbcr(c), cbcr(u_key.rgb));
  float a = smoothstep(u_tolerance, u_tolerance + u_softness + 1e-4, d);
  vec3 k = normalize(u_key.rgb + 1e-4); float sp = max(dot(c, k) - dot(c, vec3(1.0) - k) * 0.6, 0.0);
  float mx = max(u_key.r, max(u_key.g, u_key.b));
  if(u_key.g == mx) c.g = mix(c.g, min(c.g, max(c.r, c.b)), u_spill);
  else if(u_key.b == mx) c.b = mix(c.b, min(c.b, max(c.r, c.g)), u_spill);
  else c.r = mix(c.r, min(c.r, max(c.g, c.b)), u_spill);
  return pre(c, s.a * a); }""")

shader("luma_key", "matte", "Make dark (or bright) areas transparent. Use on stock overlays shot on black.", {
    "threshold": P(0.2, "Brightness cutoff.", min=0, max=1),
    "softness": P(0.2, "Edge softness.", min=0, max=1),
    "invert": P(False, "Key out bright areas instead of dark ones."),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); float l = luma(unpre(s));
  float a = smoothstep(u_threshold, u_threshold + u_softness + 1e-4, l); if(u_invert == 1) a = 1.0 - a; return s * a; }""")

shader("wipe", "matte", "Reveal or hide the layer with an animated wipe. Animate progress 0→1 on the incoming clip of a transition.", {
    "progress": P(0.5, "0 = fully hidden, 1 = fully visible.", min=0, max=1),
    "shape": P("linear", "Wipe geometry.", choices=["linear", "radial", "iris", "clock", "blinds", "noise"]),
    "angle": P(0.0, "Direction for linear/blinds, start angle for clock (degrees)."),
    "feather": P(0.05, "Edge softness.", min=0, max=1),
    "center": P([0.5, 0.5], "Centre for radial/iris/clock, normalised."),
    "count": P(8.0, "Number of blinds.", min=1, max=100),
    "invert": P(False, "Reverse which side is revealed."),
}, """
vec4 fx(vec2 uv){ vec4 s = T(uv); vec2 asp = vec2(u_res.x / u_res.y, 1.0); float a = radians(u_angle); vec2 d = vec2(cos(a), sin(a)); float v;
  vec2 p = (uv - 0.5) * asp;
  if(u_shape == 0){ float ext = (abs(d.x) * asp.x + abs(d.y)) * 0.5; v = (dot(p, d) + ext) / (2.0 * ext); }
  else if(u_shape == 1 || u_shape == 2){ vec2 q = (uv - u_center) * asp; float mx = length(asp) * 0.5 + length((u_center - 0.5) * asp); v = length(q) / mx; }
  else if(u_shape == 3){ vec2 q = (uv - u_center) * asp; v = fract((atan(q.y, q.x) - a) / TAU + 0.25); }
  else if(u_shape == 4){ float ext = (abs(d.x) * asp.x + abs(d.y)) * 0.5; v = fract((dot(p, d) + ext) / (2.0 * ext) * u_count); }
  else { v = fbm(uv * asp * 4.0 + 3.7); v = clamp((v - 0.2) / 0.6, 0.0, 1.0); }
  float f = max(u_feather, 1e-4); float pr = u_progress * (1.0 + f) - f;
  if(u_invert == 1) v = 1.0 - v;
  return s * (1.0 - smoothstep(pr, pr + f, v)); }""")

shader("fill", "matte", "Replace the layer's colour with a flat colour, keeping its alpha (recolour text, shapes, cutouts).", {
    "color": P([1.0, 1.0, 1.0, 1.0], "Fill colour."),
    "amount": P(1.0, "Blend with the original colour.", min=0, max=1),
}, "vec4 fx(vec2 uv){ vec4 s = T(uv); return pre(mix(unpre(s), u_color.rgb, u_amount), s.a); }")

shader("alpha_levels", "matte", "Choke or spread the alpha edge and adjust overall transparency.", {
    "black": P(0.0, "Alpha below this becomes fully transparent (choke).", min=0, max=1),
    "white": P(1.0, "Alpha above this becomes fully opaque (spread).", min=0, max=1),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); float a = clamp((s.a - u_black) / max(u_white - u_black, 1e-4), 0.0, 1.0); return pre(unpre(s), a); }""")

_SHADOW = {
    "color": P([0.0, 0.0, 0.0, 1.0], "Shadow colour."),
    "opacity": P(0.6, "Shadow opacity.", min=0, max=1),
    "offset": P([8.0, 8.0], "Shadow offset in pixels.", px=True),
    "blur": P(12.0, "Shadow softness.", min=0, max=300, px=True),
    "shadow_only": P(False, "Render only the shadow."),
}
_SHADOW_FRAG = build_frag(_SHADOW, """
uniform sampler2D u_blur_tex;
vec4 fx(vec2 uv){ vec4 s = T(uv); float a = texture(u_blur_tex, uv - u_offset / u_res).a * u_opacity * u_color.a;
  vec4 sh = vec4(u_color.rgb * a, a); if(u_shadow_only == 1) return sh; return s + sh * (1.0 - s.a); }""")


@effect("drop_shadow", "matte", "Soft shadow behind the layer's alpha. With offset [0,0] and a bright colour it becomes an outer glow.", _SHADOW)
def drop_shadow(gl, src, p, env):
    b = gauss(gl, src, p["blur"])
    out = gl.run(_SHADOW_FRAG, src.size, u_tex=src, u_blur_tex=b, **uniforms(_SHADOW, p, env))
    gl.release(b)
    return out


shader("stroke", "matte", "Outline around the layer's alpha (sticker / cut-out border, text outline).", {
    "width": P(6.0, "Outline thickness.", min=0, max=100, px=True),
    "color": P([1.0, 1.0, 1.0, 1.0], "Outline colour."),
    "softness": P(0.0, "Edge softness (0 = crisp).", min=0, max=1),
    "outline_only": P(False, "Hide the layer itself and keep only the outline."),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); float m = 0.0;
  for(int i = 0; i < 32; i++){ float a = float(i) * TAU / 32.0; vec2 d = vec2(cos(a), sin(a)) * u_width / u_res;
    m = max(m, T(uv + d).a); m = max(m, T(uv + d * 0.5).a); }
  m = mix(m, smoothstep(0.0, 1.0, m), u_softness);
  vec4 st = vec4(u_color.rgb * m * u_color.a, m * u_color.a);
  if(u_outline_only == 1) return st * (1.0 - s.a);
  return s + st * (1.0 - s.a); }""")

shader("round_corners", "matte", "Clip the layer to a rounded rectangle (picture-in-picture cards, phone-style frames).", {
    "radius": P(60.0, "Corner radius.", min=0, max=2000, px=True),
    "inset": P(0.0, "Shrink the rectangle inward.", min=0, max=2000, px=True),
}, """vec4 fx(vec2 uv){ vec2 h = u_res * 0.5 - u_inset; vec2 q = abs(uv * u_res - u_res * 0.5) - h + u_radius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius; return T(uv) * (1.0 - smoothstep(-0.75, 0.75, d)); }""")
