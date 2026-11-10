"""Colour correction and grading."""
from __future__ import annotations

import os

import numpy as np

from . import P, build_frag, effect, shader, uniforms

shader("exposure", "color", "Exposure in stops. Keyframe a quick spike (0 → 2 → 0) for a white flash on a beat or cut.", {
    "stops": P(0.0, "Exposure change in stops.", min=-10, max=10),
    "offset": P(0.0, "Flat value added after exposure (lifts blacks).", min=-1, max=1),
}, "vec4 fx(vec2 uv){ vec4 s = T(uv); return vec4(s.rgb * exp2(u_stops) + u_offset * s.a, s.a); }")

shader("brightness_contrast", "color", "Simple brightness and contrast.", {
    "brightness": P(0.0, "Added brightness.", min=-1, max=1),
    "contrast": P(0.0, "Contrast around mid-grey (-1 flat … 1 harsh).", min=-1, max=2),
    "pivot": P(0.5, "Grey level that contrast pivots around.", min=0, max=1),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s);
  c = (c - u_pivot) * (1.0 + u_contrast) + u_pivot + u_brightness; return pre(c, s.a); }""")

shader("levels", "color", "Input/output levels with gamma. Crush blacks, clip whites, lift the black point for a faded look.", {
    "in_black": P(0.0, "Input black point.", min=0, max=1),
    "in_white": P(1.0, "Input white point.", min=0, max=1),
    "gamma": P(1.0, "Midtone gamma (>1 brightens).", min=0.1, max=5),
    "out_black": P(0.0, "Output black point.", min=0, max=1),
    "out_white": P(1.0, "Output white point.", min=0, max=1),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s);
  c = clamp((c - u_in_black) / max(u_in_white - u_in_black, 1e-4), 0.0, 8.0);
  c = pow(c, vec3(1.0 / u_gamma)); c = mix(vec3(u_out_black), vec3(u_out_white), c); return pre(c, s.a); }""")

shader("hue_saturation", "color", "Rotate hue, scale saturation, shift lightness.", {
    "hue": P(0.0, "Hue rotation in degrees. Animate for colour cycling."),
    "saturation": P(1.0, "Saturation multiplier (0 = greyscale, 2 = double).", min=0, max=5),
    "lightness": P(0.0, "Lightness offset.", min=-1, max=1),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 h = rgb2hsv(max(unpre(s), 0.0));
  h.x = fract(h.x + u_hue / 360.0); h.y = clamp(h.y * u_saturation, 0.0, 1.0);
  return pre(hsv2rgb(h) + u_lightness, s.a); }""")

shader("vibrance", "color", "Boost muted colours more than already-saturated ones (kinder to skin than saturation).", {
    "amount": P(0.5, "Vibrance strength.", min=-1, max=3),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float k = 1.0 + u_amount * (1.0 - clamp(mx - mn, 0.0, 1.0));
  return pre(mix(vec3(luma(c)), c, k), s.a); }""")

shader("color_balance", "color", "Lift / gamma / gain colour wheels. Push lift toward teal and gain toward orange for the classic look.", {
    "lift": P([0.0, 0.0, 0.0, 1.0], "RGB added to shadows (around 0; e.g. [-0.02, 0.0, 0.04])."),
    "gamma": P([1.0, 1.0, 1.0, 1.0], "RGB midtone gamma (around 1)."),
    "gain": P([1.0, 1.0, 1.0, 1.0], "RGB highlight multiplier (around 1)."),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s);
  c = c * u_gain.rgb + u_lift.rgb * (1.0 - c);
  c = pow(max(c, 0.0), 1.0 / max(u_gamma.rgb, vec3(0.01))); return pre(c, s.a); }""")

shader("temperature", "color", "White balance: warm/cool and green/magenta shift.", {
    "temperature": P(0.0, "Negative = cooler/blue, positive = warmer/orange.", min=-1, max=1),
    "tint": P(0.0, "Negative = green, positive = magenta.", min=-1, max=1),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s);
  c *= vec3(1.0 + u_temperature * 0.3 + u_tint * 0.1, 1.0 - u_tint * 0.2, 1.0 - u_temperature * 0.3 + u_tint * 0.1);
  return pre(c, s.a); }""")

shader("tint", "color", "Remap black and white to two colours (monochrome tint / duotone).", {
    "black": P([0.0, 0.0, 0.0, 1.0], "Colour that black maps to."),
    "white": P([1.0, 1.0, 1.0, 1.0], "Colour that white maps to."),
    "amount": P(1.0, "Blend with the original colour.", min=0, max=1),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s);
  return pre(mix(c, mix(u_black.rgb, u_white.rgb, clamp(luma(c), 0.0, 1.0)), u_amount), s.a); }""")

shader("gradient_map", "color", "Map shadows / midtones / highlights to three colours. Bold stylised tritone grading.", {
    "shadows": P([0.05, 0.0, 0.2, 1.0], "Colour for dark areas."),
    "midtones": P([0.9, 0.2, 0.4, 1.0], "Colour for mid greys."),
    "highlights": P([1.0, 0.9, 0.6, 1.0], "Colour for bright areas."),
    "amount": P(1.0, "Blend with the original.", min=0, max=1),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s); float l = clamp(luma(c), 0.0, 1.0);
  vec3 g = l < 0.5 ? mix(u_shadows.rgb, u_midtones.rgb, l * 2.0) : mix(u_midtones.rgb, u_highlights.rgb, l * 2.0 - 2.0 + 1.0);
  return pre(mix(c, g, u_amount), s.a); }""")

shader("split_tone", "color", "Tint shadows one colour and highlights another while keeping the image's contrast.", {
    "shadows": P([0.0, 0.35, 0.5, 1.0], "Shadow tint (teal by default)."),
    "highlights": P([1.0, 0.6, 0.25, 1.0], "Highlight tint (orange by default)."),
    "balance": P(0.5, "Luma level where the two tints cross.", min=0, max=1),
    "amount": P(0.3, "Strength.", min=0, max=1),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s); float l = luma(c);
  float k = smoothstep(u_balance - 0.4, u_balance + 0.4, l);
  vec3 t = mix(u_shadows.rgb, u_highlights.rgb, k);
  vec3 r = c + (t - vec3(luma(t))) * u_amount * (1.0 - abs(l * 2.0 - 1.0) * 0.5);
  return pre(r, s.a); }""")

shader("black_white", "color", "Greyscale with channel weights.", {
    "amount": P(1.0, "0 = colour, 1 = fully black and white.", min=0, max=1),
    "weights": P([0.2126, 0.7152, 0.0722, 1.0], "RGB contribution to the grey value."),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s);
  return pre(mix(c, vec3(dot(c, u_weights.rgb)), u_amount), s.a); }""")

shader("invert", "color", "Invert colours. Keyframe amount with hold keys for negative-flash hits.", {
    "amount": P(1.0, "0 = normal, 1 = inverted.", min=0, max=1),
}, "vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s); return pre(mix(c, 1.0 - c, u_amount), s.a); }")

shader("posterize", "color", "Reduce the number of tonal steps per channel.", {
    "levels": P(5.0, "Number of steps.", min=2, max=64),
}, "vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s); return pre(floor(c * u_levels + 0.5) / u_levels, s.a); }")

shader("threshold", "color", "Hard two-tone cutoff by brightness.", {
    "level": P(0.5, "Brightness cutoff.", min=0, max=1),
    "softness": P(0.02, "Edge softness.", min=0, max=0.5),
    "dark": P([0.0, 0.0, 0.0, 1.0], "Colour below the cutoff."),
    "light": P([1.0, 1.0, 1.0, 1.0], "Colour above the cutoff."),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); float l = luma(unpre(s));
  return pre(mix(u_dark.rgb, u_light.rgb, smoothstep(u_level - u_softness, u_level + u_softness + 1e-4, l)), s.a); }""")

shader("fade", "color", "Faded film look: lifted blacks, softened whites, slight desaturation.", {
    "amount": P(0.3, "Fade strength.", min=0, max=1),
    "color": P([0.1, 0.1, 0.13, 1.0], "Colour of the lifted blacks."),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s);
  c = mix(c, vec3(luma(c)), u_amount * 0.25);
  c = mix(c, c * (1.0 - u_amount * 0.12) + u_color.rgb * (1.0 - c), u_amount); return pre(c, s.a); }""")

shader("color_splash", "color", "Keep one hue in colour and turn everything else black and white.", {
    "hue": P(0.0, "Hue to keep, in degrees (0 red, 60 yellow, 120 green, 180 cyan, 240 blue, 300 magenta)."),
    "range": P(25.0, "Hue tolerance in degrees.", min=0, max=180),
    "softness": P(15.0, "Falloff in degrees.", min=0, max=90),
    "desaturate": P(1.0, "How grey the rest of the image becomes.", min=0, max=1),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s); vec3 h = rgb2hsv(max(c, 0.0));
  float d = abs(fract(h.x - u_hue / 360.0 + 0.5) - 0.5) * 360.0;
  float keep = (1.0 - smoothstep(u_range, u_range + u_softness + 1e-3, d)) * smoothstep(0.08, 0.25, h.y);
  return pre(mix(mix(c, vec3(luma(c)), u_desaturate), c, keep), s.a); }""")

shader("vignette", "color", "Darken (or tint) the frame edges.", {
    "amount": P(0.5, "Strength (negative values brighten the edges).", min=-1, max=1),
    "size": P(0.5, "Radius of the clear centre.", min=0, max=1.5),
    "softness": P(0.5, "Falloff width.", min=0.01, max=2),
    "roundness": P(1.0, "1 = follows the frame shape, 0 = circular.", min=0, max=1),
    "color": P([0.0, 0.0, 0.0, 1.0], "Vignette colour."),
    "center": P([0.5, 0.5], "Centre of the vignette, normalised."),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec2 p = (uv - u_center) * 2.0;
  p.x *= mix(u_res.x / u_res.y, 1.0, u_roundness);
  float v = smoothstep(u_size, u_size + u_softness, length(p) * 0.7071);
  vec3 c = unpre(s);
  c = u_amount >= 0.0 ? mix(c, u_color.rgb, v * u_amount) : c * (1.0 + v * -u_amount);
  return pre(c, s.a); }""")

shader("channel_mixer", "color", "Rebuild each output channel from a mix of the input channels.", {
    "red": P([1.0, 0.0, 0.0, 1.0], "Output red = dot(rgb, this)."),
    "green": P([0.0, 1.0, 0.0, 1.0], "Output green = dot(rgb, this)."),
    "blue": P([0.0, 0.0, 1.0, 1.0], "Output blue = dot(rgb, this)."),
}, """vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = unpre(s);
  return pre(vec3(dot(c, u_red.rgb), dot(c, u_green.rgb), dot(c, u_blue.rgb)), s.a); }""")


# --------------------------------------------------------------------------- curves

def _curve_lut(points, n=256):
    """Monotone cubic interpolation through control points [[x, y], ...] in 0..1."""
    pts = sorted([(float(x), float(y)) for x, y in (points or [[0, 0], [1, 1]])])
    if pts[0][0] > 0:
        pts.insert(0, (0.0, pts[0][1]))
    if pts[-1][0] < 1:
        pts.append((1.0, pts[-1][1]))
    xs = np.array([p[0] for p in pts])
    ys = np.array([p[1] for p in pts])
    h = np.diff(xs)
    h[h == 0] = 1e-6
    d = np.diff(ys) / h
    m = np.zeros(len(xs))
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, len(xs) - 1):
        m[i] = 0.0 if d[i - 1] * d[i] <= 0 else 2 * d[i - 1] * d[i] / (d[i - 1] + d[i])
    x = np.linspace(0, 1, n)
    idx = np.clip(np.searchsorted(xs, x, side="right") - 1, 0, len(xs) - 2)
    t = (x - xs[idx]) / h[idx]
    t2, t3 = t * t, t * t * t
    y = ((2 * t3 - 3 * t2 + 1) * ys[idx] + (t3 - 2 * t2 + t) * h[idx] * m[idx]
         + (-2 * t3 + 3 * t2) * ys[idx + 1] + (t3 - t2) * h[idx] * m[idx + 1])
    return np.clip(y, 0, 1)


_CURVES = {
    "master": P([[0, 0], [1, 1]], "Control points [[in, out], ...] applied to all channels, values 0..1. "
                "An S-curve like [[0,0],[0.25,0.18],[0.75,0.85],[1,1]] adds contrast.", kind="points"),
    "red": P([[0, 0], [1, 1]], "Red channel curve.", kind="points"),
    "green": P([[0, 0], [1, 1]], "Green channel curve.", kind="points"),
    "blue": P([[0, 0], [1, 1]], "Blue channel curve.", kind="points"),
}
_CURVES_FRAG = build_frag(_CURVES, """
uniform sampler2D u_lut;
vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = clamp(unpre(s), 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0;
  return pre(vec3(texture(u_lut, vec2(c.r, 0.5)).r, texture(u_lut, vec2(c.g, 0.5)).g, texture(u_lut, vec2(c.b, 0.5)).b), s.a); }""")


@effect("curves", "color", "Tone curves from control points, per channel and master. The most precise grading tool here.", _CURVES)
def curves(gl, src, p, env):
    master = _curve_lut(p["master"])
    lut = np.zeros((1, 256, 3), np.float32)
    for i, ch in enumerate(("red", "green", "blue")):
        c = _curve_lut(p[ch])
        lut[0, :, i] = np.interp(c, np.linspace(0, 1, 256), master)
    t = gl.upload((lut * 255.0 + 0.5).astype(np.uint8))
    out = gl.run(_CURVES_FRAG, src.size, u_tex=src, u_lut=t, **env.uniforms)
    gl.release(t)
    return out


# --------------------------------------------------------------------------- LUT

_lut_cache = {}


def _load_cube(path):
    key = (path, os.path.getmtime(path))
    if key not in _lut_cache:
        size, rows = 0, []
        with open(path, "r", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                up = line.upper()
                if up.startswith("LUT_3D_SIZE"):
                    size = int(line.split()[-1])
                elif line[0].isdigit() or line[0] in "-.":
                    parts = line.split()
                    if len(parts) >= 3:
                        rows.append([float(parts[0]), float(parts[1]), float(parts[2])])
        if not size or len(rows) != size ** 3:
            raise ValueError(f"{path}: not a valid 3D .cube LUT")
        _lut_cache[key] = (size, np.array(rows, np.float32))
    return _lut_cache[key]


_LUT = {
    "path": P("", "Path to a .cube 3D LUT file.", kind="text"),
    "amount": P(1.0, "Blend with the original.", min=0, max=1),
}
_LUT_FRAG = build_frag(_LUT, """
uniform sampler3D u_lut; uniform float u_n;
vec4 fx(vec2 uv){ vec4 s = T(uv); vec3 c = clamp(unpre(s), 0.0, 1.0);
  vec3 g = texture(u_lut, c * ((u_n - 1.0) / u_n) + 0.5 / u_n).rgb; return pre(mix(c, g, u_amount), s.a); }""")
_lut_tex = {}


@effect("lut", "color", "Apply a .cube 3D LUT file (film emulation and creator LUT packs).", _LUT)
def lut(gl, src, p, env):
    if not p["path"]:
        return src
    size, data = _load_cube(p["path"])
    tex = _lut_tex.get((id(gl), p["path"]))
    if tex is None:
        import moderngl
        tex = gl.ctx.texture3d((size, size, size), 3, data.tobytes(), dtype="f4")
        tex.filter = (moderngl.LINEAR, moderngl.LINEAR)
        tex.repeat_x = tex.repeat_y = tex.repeat_z = False
        _lut_tex[(id(gl), p["path"])] = tex
    out = gl.acquire(src.size)
    prog, vao = gl.program(_LUT_FRAG)
    out.fbo.use()
    gl.set_uniforms(prog, {"u_tex": src, "u_res": (float(out.w), float(out.h)), "u_n": float(size), "u_amount": p["amount"]})
    tex.use(1)
    if prog.get("u_lut", None) is not None:
        prog["u_lut"].value = 1
    import moderngl
    vao.render(moderngl.TRIANGLE_STRIP)
    return out
