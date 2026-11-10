"""Stylise: RGB split, glitch, VHS, grain, halftone, edges and friends."""
from __future__ import annotations

from . import P, build_frag, effect, shader, uniforms
from .blur import gauss

shader("rgb_split", "stylize", "Chromatic aberration: offset the red and blue channels. Keyframe `amount` in short "
       "pulses for the classic beat-hit RGB split.", {
    "amount": P(12.0, "Channel separation.", min=0, max=500, px=True),
    "angle": P(0.0, "Direction of the split in degrees (linear mode)."),
    "mode": P("linear", "linear = same offset everywhere; radial = grows toward the edges like a real lens.", choices=["linear", "radial"]),
    "center": P([0.5, 0.5], "Centre for radial mode, normalised."),
    "samples": P(1, "1 = hard 3-channel split; more = smooth spectral smear.", min=1, max=16),
}, """
vec3 spec(float k){ return clamp(vec3(1.5 - abs(k * 4.0 - 1.0) * 1.5, 1.5 - abs(k * 4.0 - 2.0) * 1.5, 1.5 - abs(k * 4.0 - 3.0) * 1.5), 0.0, 1.0); }
vec4 fx(vec2 uv){
  float a = radians(u_angle);
  vec2 d = u_mode == 0 ? vec2(cos(a), sin(a)) * u_amount / u_res : (uv - u_center) * 2.0 * u_amount / u_res.x;
  if(u_samples <= 1){
    vec4 r = tex_edge(u_tex, uv + d, 3), g = T(uv), b = tex_edge(u_tex, uv - d, 3);
    return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
  }
  vec3 acc = vec3(0.0), ws = vec3(0.0); float al = 0.0;
  for(int i = 0; i < 16; i++){
    if(i >= u_samples) break;
    float k = (float(i) + 0.5) / float(u_samples);
    vec4 c = tex_edge(u_tex, uv + d * (1.0 - 2.0 * k), 3); vec3 w = spec(k);
    acc += c.rgb * w; ws += w; al = max(al, c.a);
  }
  return vec4(acc / max(ws, 1e-4), al);
}""")

shader("glitch", "stylize", "Digital glitch: displaced blocks and slices, channel shifts, noise bands. Keyframe `amount` "
       "to fire it for a few frames on cuts.", {
    "amount": P(0.5, "Overall glitch strength (0 = clean).", min=0, max=1),
    "block_size": P(80.0, "Size of displaced blocks.", min=4, max=1000, px=True),
    "shift": P(120.0, "Maximum horizontal displacement.", min=0, max=2000, px=True),
    "rgb": P(15.0, "Colour channel separation during glitches.", min=0, max=300, px=True),
    "speed": P(14.0, "How many times per second the pattern changes.", min=0.5, max=60),
    "scan": P(0.3, "Strength of noisy scanline bands.", min=0, max=1),
    "seed": P(0.0, "Random seed."),
}, """
vec4 fx(vec2 uv){
  if(u_amount <= 0.0) return T(uv);
  float t = floor(u_time * u_speed) + u_seed * 13.0;
  vec2 px = uv * u_res;
  float row = floor(px.y / u_block_size);
  float h = hash21(vec2(row, t));
  float off = 0.0;
  if(h < u_amount * 0.6) off = (hash21(vec2(row + 7.0, t)) - 0.5) * 2.0 * u_shift;
  float thin = floor(px.y / max(u_block_size * 0.12, 2.0));
  if(hash21(vec2(thin, t + 3.0)) < u_amount * 0.15) off += (hash21(vec2(thin, t + 9.0)) - 0.5) * u_shift * 0.6;
  vec2 cell = floor(px / vec2(u_block_size * 2.5, u_block_size));
  vec2 boff = vec2(0.0);
  if(hash21(cell + t * 1.7) < u_amount * 0.2) boff = (hash22(cell + t) - 0.5) * u_block_size * 2.0;
  vec2 q = (px + vec2(off, 0.0) + boff) / u_res;
  float ca = u_rgb * u_amount * (0.4 + hash11(t)) / u_res.x;
  vec4 r = tex_edge(u_tex, q + vec2(ca, 0.0), 3), g = tex_edge(u_tex, q, 3), b = tex_edge(u_tex, q - vec2(ca, 0.0), 3);
  vec4 c = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
  float band = step(1.0 - u_scan * u_amount * 0.35, hash21(vec2(floor(px.y / 3.0), t * 2.0)));
  c.rgb += band * (hash21(px + t) - 0.3) * 0.5 * c.a;
  if(hash21(cell + t * 3.3) < u_amount * 0.05) c.rgb = (1.0 - unpre(c)) * c.a;
  return c;
}""")

shader("vhs", "stylize", "Analog tape look: chroma bleed, tracking wobble, head-switching noise, scanlines and soft detail.", {
    "amount": P(1.0, "Overall strength.", min=0, max=2),
    "bleed": P(6.0, "Horizontal colour smear.", min=0, max=60, px=True),
    "wobble": P(2.0, "Horizontal line jitter.", min=0, max=60, px=True),
    "noise": P(0.25, "Tape noise level.", min=0, max=1),
    "scanlines": P(0.25, "Scanline darkness.", min=0, max=1),
    "tracking": P(0.3, "Strength of the rolling tracking-error band.", min=0, max=1),
}, """
vec4 fx(vec2 uv){
  float t = u_time; vec2 px = uv * u_res; float A = u_amount;
  float line = floor(px.y / max(2.0 * u_rscale, 1.0));
  float wob = (noise1(line * 0.07 + t * 9.0) * 0.6 + (hash21(vec2(line, floor(t * 30.0))) - 0.5) * 0.5) * u_wobble * A;
  float bandY = fract(t * 0.23) * 1.3 - 0.15;
  float band = exp(-pow((uv.y - bandY) * 18.0, 2.0)) * u_tracking * A;
  wob += band * 40.0 * u_rscale * (hash21(vec2(line, floor(t * 24.0))) - 0.2);
  wob += smoothstep(0.965, 1.0, uv.y) * (hash21(vec2(line, floor(t * 60.0))) - 0.5) * 80.0 * u_rscale * A;
  vec2 q = uv + vec2(wob / u_res.x, 0.0);
  vec4 s = tex_edge(u_tex, q, 1);
  float y = luma(s.rgb);
  vec3 ch = vec3(0.0); float ws = 0.0;
  for(int i = -4; i <= 4; i++){ float w = 1.0 - abs(float(i)) / 5.0; ch += tex_edge(u_tex, q + vec2(float(i) * u_bleed * A * 0.5 + u_bleed * A, 0.0) / u_res, 1).rgb * w; ws += w; }
  ch /= ws;
  vec3 c = vec3(y) + (ch - vec3(luma(ch))) * 1.15;
  c = mix(s.rgb, c, clamp(A, 0.0, 1.0));
  c += (hash21(px + t * 91.0) - 0.5) * u_noise * A * 0.35;
  c += band * (hash21(px * 0.5 + t) - 0.3) * 0.5;
  c *= 1.0 - u_scanlines * A * (0.5 + 0.5 * sin(px.y * PI / max(u_rscale * 2.0, 1.0)));
  c = mix(c, c * vec3(1.03, 1.0, 0.94) + vec3(0.015, 0.0, 0.03), clamp(A, 0.0, 1.0));
  return vec4(c * s.a, s.a);
}""")

shader("crt", "stylize", "CRT monitor: curved screen, RGB phosphor mask, scanlines and corner falloff.", {
    "curvature": P(0.15, "Screen bulge.", min=0, max=1),
    "scanlines": P(0.5, "Scanline strength.", min=0, max=1),
    "line_count": P(240.0, "Number of scanlines down the frame.", min=20, max=2000),
    "mask": P(0.3, "RGB phosphor stripe strength.", min=0, max=1),
    "vignette": P(0.4, "Edge darkening.", min=0, max=1),
}, """
vec4 fx(vec2 uv){
  vec2 p = uv * 2.0 - 1.0; p *= 1.0 + u_curvature * dot(p, p) * 0.25; p /= 1.0 + u_curvature * 0.25; vec2 q = p * 0.5 + 0.5;
  vec4 s = tex_edge(u_tex, q, 0); vec3 c = s.rgb;
  c *= 1.0 - u_scanlines * (0.5 - 0.5 * cos(q.y * u_line_count * TAU));
  float m = mod(floor(uv.x * u_res.x / max(u_rscale, 1.0)), 3.0);
  c *= mix(vec3(1.0), vec3(m == 0.0 ? 1.4 : 0.8, m == 1.0 ? 1.4 : 0.8, m == 2.0 ? 1.4 : 0.8), u_mask);
  c *= 1.0 + u_scanlines * 0.35;
  vec2 e = abs(p); c *= 1.0 - u_vignette * smoothstep(0.6, 1.25, length(e * e));
  return vec4(c, s.a);
}""")

shader("film_grain", "stylize", "Animated film grain, stronger in the midtones.", {
    "amount": P(0.25, "Grain strength.", min=0, max=2),
    "size": P(1.5, "Grain size.", min=0.5, max=20, px=True),
    "color": P(0.2, "0 = monochrome grain, 1 = fully coloured grain.", min=0, max=1),
    "fps": P(24.0, "How often the grain pattern changes.", min=1, max=120),
}, """
vec4 fx(vec2 uv){
  vec4 s = T(uv); vec2 p = floor(uv * u_res / u_size); float t = floor(u_time * u_fps);
  vec3 n = vec3(hash21(p + t * 17.13), hash21(p + t * 29.41 + 71.0), hash21(p + t * 43.7 + 131.0)) - 0.5;
  n = mix(vec3(n.r), n, u_color);
  float l = luma(unpre(s)); float w = 1.0 - pow(abs(l * 2.0 - 1.0), 2.0) * 0.6;
  return vec4(s.rgb + n * u_amount * 0.4 * w * s.a, s.a);
}""")

shader("pixelate", "stylize", "Mosaic blocks. Animate size from large to 1 for a pixel-resolve transition.", {
    "size": P(24.0, "Block size.", min=1, max=1000, px=True),
}, "vec4 fx(vec2 uv){ vec2 n = u_res / max(u_size, 1.0); return T((floor(uv * n) + 0.5) / n); }")

shader("halftone", "stylize", "Print-style dot screen.", {
    "size": P(10.0, "Dot spacing.", min=2, max=200, px=True),
    "angle": P(45.0, "Screen angle in degrees."),
    "color": P(False, "True = keep image colours in the dots; False = ink colour on paper colour."),
    "ink": P([0.05, 0.05, 0.08, 1.0], "Dot colour (mono mode)."),
    "paper": P([0.96, 0.94, 0.9, 1.0], "Background colour (mono mode)."),
}, """
vec4 fx(vec2 uv){
  mat2 r = rot2(radians(u_angle)); vec2 p = r * (uv * u_res) / u_size; vec2 cell = floor(p) + 0.5;
  vec2 cuv = (transpose(r) * (cell * u_size)) / u_res; vec4 s = T(clamp(cuv, 0.0, 1.0)); vec3 c = unpre(s);
  float l = clamp(luma(c), 0.0, 1.0); float rad = sqrt(u_color == 1 ? l : 1.0 - l) * 0.72;
  float d = length(p - cell); float m = 1.0 - smoothstep(rad - 0.08, rad + 0.08, d);
  vec3 outc = u_color == 1 ? c * m / max(l, 0.15) * 0.9 : mix(u_paper.rgb, u_ink.rgb, m);
  float a = T(uv).a; return pre(outc, a);
}""")

_EDGE_GLSL = """
float sob(vec2 uv){ vec2 e = u_width / u_res; float tl = luma(T(uv + vec2(-e.x, -e.y)).rgb), t = luma(T(uv + vec2(0.0, -e.y)).rgb), tr = luma(T(uv + vec2(e.x, -e.y)).rgb);
  float l = luma(T(uv + vec2(-e.x, 0.0)).rgb), r = luma(T(uv + vec2(e.x, 0.0)).rgb);
  float bl = luma(T(uv + vec2(-e.x, e.y)).rgb), b = luma(T(uv + vec2(0.0, e.y)).rgb), br = luma(T(uv + vec2(e.x, e.y)).rgb);
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br, gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br; return sqrt(gx * gx + gy * gy); }
"""

shader("edge_detect", "stylize", "Find edges: line-art on a solid background, or coloured neon outlines.", {
    "width": P(1.5, "Edge sampling width.", min=0.5, max=20, px=True),
    "strength": P(2.0, "Edge gain.", min=0, max=20),
    "color": P([1.0, 1.0, 1.0, 1.0], "Line colour."),
    "background": P([0.0, 0.0, 0.0, 1.0], "Background colour."),
    "keep_color": P(False, "Tint the lines with the image's own colours."),
    "overlay": P(0.0, "Blend the lines over the original image instead of the background.", min=0, max=1),
}, _EDGE_GLSL + """
vec4 fx(vec2 uv){ vec4 s = T(uv); float e = clamp(sob(uv) * u_strength, 0.0, 1.0);
  vec3 line = u_keep_color == 1 ? normalize(unpre(s) + 1e-3) * 1.6 * u_color.rgb : u_color.rgb;
  vec3 bg = mix(u_background.rgb, unpre(s), u_overlay);
  return pre(mix(bg, line, e), s.a); }""")

_NEON = {
    "width": P(1.5, "Edge sampling width.", min=0.5, max=20, px=True),
    "strength": P(3.0, "Edge gain.", min=0, max=20),
    "radius": P(18.0, "Glow size.", min=0, max=300, px=True),
    "glow": P(2.0, "Glow brightness.", min=0, max=10),
    "color": P([0.2, 0.9, 1.0, 1.0], "Neon colour."),
    "keep_color": P(False, "Use the image's own colours for the lines."),
    "darken": P(0.8, "How much the underlying image is darkened.", min=0, max=1),
}
_NEON_EDGE = build_frag(_NEON, _EDGE_GLSL + """
vec4 fx(vec2 uv){ vec4 s = T(uv); float e = clamp(sob(uv) * u_strength, 0.0, 1.0);
  vec3 line = u_keep_color == 1 ? normalize(unpre(s) + 1e-3) * 1.7 : u_color.rgb; return vec4(line * e, e); }""")
_NEON_COMB = build_frag(_NEON, """
uniform sampler2D u_edges; uniform sampler2D u_blur;
vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 e = texture(u_edges, uv).rgb, b = texture(u_blur, uv).rgb;
  return vec4(s.rgb * (1.0 - u_darken) + (e * 1.2 + b * u_glow) * s.a, s.a); }""")


@effect("neon_edges", "stylize", "Glowing neon outlines traced from the image's edges over a darkened picture.", _NEON)
def neon_edges(gl, src, p, env):
    u = uniforms(_NEON, p, env)
    e = gl.run(_NEON_EDGE, src.size, u_tex=src, **u)
    b = gauss(gl, e, p["radius"])
    out = gl.run(_NEON_COMB, src.size, u_tex=src, u_edges=e, u_blur=b, **u)
    gl.release(e, b)
    return out


shader("emboss", "stylize", "Relief shading as if the image were stamped into metal.", {
    "strength": P(2.0, "Relief depth.", min=0, max=20),
    "angle": P(135.0, "Light direction in degrees."),
    "width": P(1.5, "Sampling distance.", min=0.5, max=20, px=True),
    "blend": P(0.0, "Mix the original colour back in.", min=0, max=1),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); float a = radians(u_angle); vec2 d = vec2(cos(a), sin(a)) * u_width / u_res;
  float e = (luma(T(uv + d).rgb) - luma(T(uv - d).rgb)) * u_strength + 0.5;
  return pre(mix(vec3(e), unpre(s) * e * 2.0, u_blend), s.a); }""")

shader("cartoon", "stylize", "Flat posterised colour with dark outlines (cel-shaded / comic look).", {
    "levels": P(5.0, "Number of colour steps.", min=2, max=24),
    "width": P(1.5, "Outline width.", min=0.5, max=20, px=True),
    "strength": P(2.5, "Outline strength.", min=0, max=20),
    "outline": P([0.0, 0.0, 0.0, 1.0], "Outline colour."),
    "saturation": P(1.3, "Colour boost.", min=0, max=3),
}, _EDGE_GLSL + """
vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 h = rgb2hsv(max(unpre(s), 0.0)); h.z = floor(h.z * u_levels + 0.5) / u_levels; h.y = clamp(h.y * u_saturation, 0.0, 1.0);
  float e = smoothstep(0.25, 0.7, sob(uv) * u_strength); return pre(mix(hsv2rgb(h), u_outline.rgb, e), s.a); }""")

shader("dither", "stylize", "Ordered (Bayer) dithering down to a few levels: retro game / 1-bit look.", {
    "levels": P(2.0, "Levels per channel.", min=2, max=16),
    "size": P(3.0, "Pixel size of the dither pattern.", min=1, max=40, px=True),
    "mono": P(False, "Convert to greyscale first."),
}, """
float bayer(vec2 p){ int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)); int i = x + y * 4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return (m[i] + 0.5) / 16.0; }
vec4 fx(vec2 uv){ vec2 n = u_res / max(u_size, 1.0); vec2 cell = floor(uv * n); vec4 s = T((cell + 0.5) / n); vec3 c = unpre(s);
  if(u_mono == 1) c = vec3(luma(c)); float L = u_levels - 1.0;
  c = floor(c * L + bayer(cell)) / L; return pre(c, s.a); }""")

shader("strobe", "stylize", "Rhythmic flashing: alternate between the image and a flash colour / inverted / blank frame.", {
    "rate": P(8.0, "Flashes per second.", min=0.1, max=60),
    "duty": P(0.5, "Fraction of each cycle that is flashed.", min=0, max=1),
    "mode": P("color", "What the flash frames show.", choices=["color", "invert", "black", "transparent"]),
    "color": P([1.0, 1.0, 1.0, 1.0], "Flash colour for color mode."),
    "amount": P(1.0, "Flash opacity. Keyframe to gate the strobe to certain moments.", min=0, max=1),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); float on = step(fract(u_time * u_rate), u_duty) * u_amount; vec3 c = unpre(s);
  if(u_mode == 0) return pre(mix(c, u_color.rgb, on), s.a);
  if(u_mode == 1) return pre(mix(c, 1.0 - c, on), s.a);
  if(u_mode == 2) return pre(c * (1.0 - on), s.a);
  return s * (1.0 - on); }""")

shader("old_film", "stylize", "Aged film: flicker, vertical scratches, dust specks, gate weave and sepia toning.", {
    "amount": P(1.0, "Overall strength.", min=0, max=2),
    "scratches": P(0.5, "Scratch density.", min=0, max=1),
    "dust": P(0.5, "Dust density.", min=0, max=1),
    "flicker": P(0.3, "Brightness flicker.", min=0, max=1),
    "sepia": P(0.5, "Sepia toning.", min=0, max=1),
    "weave": P(2.0, "Frame jitter.", min=0, max=30, px=True),
}, """
vec4 fx(vec2 uv){
  float t = floor(u_time * 18.0); float A = u_amount;
  vec2 q = uv + (hash22(vec2(t, 3.0)) - 0.5) * u_weave * A / u_res;
  vec4 s = tex_edge(u_tex, q, 1); vec3 c = unpre(s);
  c = mix(c, vec3(luma(c)) * vec3(1.1, 0.95, 0.72), u_sepia * clamp(A, 0.0, 1.0));
  c *= 1.0 + (hash11(t * 1.7) - 0.5) * u_flicker * A * 0.5;
  for(int i = 0; i < 4; i++){ float fi = float(i); float on = step(1.0 - u_scratches * 0.5, hash21(vec2(t * 0.37 + fi, fi * 7.0)));
    float x = hash21(vec2(floor(t / 3.0) + fi, 11.0)) + (hash11(t + fi) - 0.5) * 0.004;
    c += on * A * 0.35 * (1.0 - smoothstep(0.0, 1.6 / u_res.x * u_rscale, abs(uv.x - x))) * (hash11(fi + t) > 0.5 ? 1.0 : -1.0); }
  for(int i = 0; i < 6; i++){ float fi = float(i); vec2 dp = hash22(vec2(t + fi * 3.1, fi)); float r = (0.002 + 0.006 * hash11(t + fi * 5.0));
    float on = step(1.0 - u_dust * 0.6, hash21(vec2(t, fi * 13.0)));
    c -= on * A * 0.6 * (1.0 - smoothstep(r * 0.4, r, length((uv - dp) * vec2(u_res.x / u_res.y, 1.0)))); }
  return pre(c, s.a);
}""")

shader("letterbox", "stylize", "Cinematic bars. Animate `amount` to slide the bars in.", {
    "aspect": P(2.35, "Target picture aspect ratio (width / height) when amount = 1.", min=0.2, max=5),
    "amount": P(1.0, "0 = no bars, 1 = full bars.", min=0, max=1),
    "color": P([0.0, 0.0, 0.0, 1.0], "Bar colour."),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); float fa = u_res.x / u_res.y; float m;
  if(u_aspect >= fa){ float h = fa / u_aspect; float bar = (1.0 - h) * 0.5 * u_amount; m = step(uv.y, bar) + step(1.0 - bar, uv.y); }
  else { float w = u_aspect / fa; float bar = (1.0 - w) * 0.5 * u_amount; m = step(uv.x, bar) + step(1.0 - bar, uv.x); }
  return mix(s, vec4(u_color.rgb, 1.0), clamp(m, 0.0, 1.0)); }""")

shader("smear", "stylize", "Drag bright pixels along a direction (cheap pixel-sort / light-drag look).", {
    "length": P(200.0, "Smear length.", min=0, max=3000, px=True),
    "angle": P(90.0, "Smear direction in degrees (90 = downward)."),
    "threshold": P(0.5, "Only pixels brighter than this are dragged.", min=0, max=1),
}, """vec4 fx(vec2 uv){ float a = radians(u_angle); vec2 d = vec2(cos(a), sin(a)) * u_length / u_res; vec4 best = T(uv); float bl = luma(best.rgb);
  for(int i = 1; i <= 32; i++){ float k = float(i) / 32.0; vec4 c = tex_edge(u_tex, uv - d * k, 1); float l = luma(c.rgb) * (1.0 - k * 0.5);
    if(luma(c.rgb) > u_threshold && l > bl){ best = mix(best, c, 1.0 - k * 0.6); bl = l; } }
  return best; }""")

shader("scanlines", "stylize", "Simple horizontal or vertical line overlay.", {
    "spacing": P(4.0, "Distance between lines.", min=1, max=200, px=True),
    "amount": P(0.4, "Line darkness.", min=0, max=1),
    "speed": P(0.0, "Scroll speed in lines per second."),
    "vertical": P(False, "Vertical lines instead of horizontal."),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); float c = (u_vertical == 1 ? uv.x * u_res.x : uv.y * u_res.y) / u_spacing + u_time * u_speed;
  return vec4(s.rgb * (1.0 - u_amount * (0.5 + 0.5 * cos(c * TAU))), s.a); }""")
