"""The compositor: turns a comp + time into pixels.

Per layer:  source → canvas (comp-sized) → masks → effects → transform (2D/3D, motion blur)
            → composite onto the stack with blend mode, opacity and track matte.
Adjustment layers apply their effects to everything beneath them.
"""
from __future__ import annotations

import math

import numpy as np

from . import media
from .effects import REGISTRY
from .gl import GL, PRELUDE
from .project import BLEND_MODES, MATTE_MODES, find_layer, get_comp, source_time
from .props import evaluate, num
from .text import TextEngine

FIT = PRELUDE + """
uniform vec2 u_k; uniform int u_premult;
void main(){ vec2 uv = (v_uv - 0.5) * u_k + 0.5; vec2 px = fwidth(uv) * 0.5 + 1e-6;
  vec2 m = smoothstep(-px, px, uv) * smoothstep(-px, px, 1.0 - uv);
  vec4 r = texture(u_tex, clamp(uv, 0.0, 1.0)); if(u_premult == 1) r.rgb *= r.a; o = r * m.x * m.y; }"""

MIX = PRELUDE + "uniform sampler2D u_b; uniform float u_mix; void main(){ o = mix(texture(u_tex, v_uv), texture(u_b, v_uv), u_mix); }"

TRANSFORM = PRELUDE + """
uniform mat3 u_h[16]; uniform int u_n; uniform int u_edge; uniform vec2 u_src;
void main(){ vec2 p = v_uv * u_res; vec4 acc = vec4(0.0);
  for(int i = 0; i < 16; i++){ if(i >= u_n) break; vec3 q = u_h[i] * vec3(p, 1.0); if(q.z <= 1e-6) continue;
    acc += tex_edge(u_tex, q.xy / q.z / u_src, u_edge); }
  o = acc / float(u_n); }"""

COMPOSITE = PRELUDE + """
uniform sampler2D u_dst; uniform sampler2D u_matte; uniform int u_mode; uniform float u_opacity; uniform int u_matte_mode;
float lum(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipc(vec3 c){ float l = lum(c), n = min(c.r, min(c.g, c.b)), x = max(c.r, max(c.g, c.b));
  if(n < 0.0) c = l + (c - l) * l / (l - n); if(x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l); return c; }
vec3 setlum(vec3 c, float l){ return clipc(c + (l - lum(c))); }
float sat(vec3 c){ return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
vec3 setsat(vec3 c, float s){ float mn = min(c.r, min(c.g, c.b)), mx = max(c.r, max(c.g, c.b)); return mx > mn ? (c - mn) * s / (mx - mn) : vec3(0.0); }
float sl(float b, float s){ if(s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b); float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b); return b + (2.0 * s - 1.0) * (d - b); }
vec3 blend(vec3 b, vec3 s, int m){
  if(m == 2) return b + s - b * s;
  if(m == 3) return b * s;
  if(m == 4) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if(m == 5) return vec3(sl(b.r, s.r), sl(b.g, s.g), sl(b.b, s.b));
  if(m == 6) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s));
  if(m == 7) return min(b / max(1.0 - s, 1e-4), 1.0);
  if(m == 8) return 1.0 - min((1.0 - b) / max(s, 1e-4), 1.0);
  if(m == 9) return min(b, s);
  if(m == 10) return max(b, s);
  if(m == 11) return abs(b - s);
  if(m == 12) return b + s - 2.0 * b * s;
  if(m == 13) return max(b - s, 0.0);
  if(m == 14) return min(b / max(s, 1e-4), 1.0);
  if(m == 15) return max(b + s - 1.0, 0.0);
  if(m == 16) return mix(1.0 - min((1.0 - b) / max(2.0 * s, 1e-4), 1.0), min(b / max(2.0 * (1.0 - s), 1e-4), 1.0), step(0.5, s));
  if(m == 17) return mix(min(b, 2.0 * s), max(b, 2.0 * s - 1.0), step(0.5, s));
  if(m == 18) return setlum(setsat(s, sat(b)), lum(b));
  if(m == 19) return setlum(setsat(b, sat(s)), lum(b));
  if(m == 20) return setlum(s, lum(b));
  if(m == 21) return setlum(b, lum(s));
  return s; }
void main(){
  vec4 d = texture(u_dst, v_uv); vec4 s = texture(u_tex, v_uv) * u_opacity;
  if(u_matte_mode > 0){ vec4 m = texture(u_matte, v_uv); float k = u_matte_mode <= 2 ? m.a : luma(m.rgb);
    if(u_matte_mode == 2 || u_matte_mode == 4) k = 1.0 - k; s *= clamp(k, 0.0, 1.0); }
  if(u_mode == 0){ o = s + d * (1.0 - s.a); return; }
  if(u_mode == 1){ o = vec4(d.rgb + s.rgb, clamp(d.a + s.a, 0.0, 1.0)); return; }
  vec3 cb = clamp(unpre(d), 0.0, 1.0), cs = clamp(unpre(s), 0.0, 1.0); vec3 B = blend(cb, cs, u_mode);
  o = vec4(s.a * (1.0 - d.a) * cs + s.a * d.a * B + (1.0 - s.a) * d.a * cb, s.a + d.a * (1.0 - s.a)); }"""

ADJUST = PRELUDE + """
uniform sampler2D u_fx; uniform sampler2D u_cov; uniform float u_opacity; uniform int u_use_cov;
void main(){ float k = u_opacity * (u_use_cov == 1 ? texture(u_cov, v_uv).a : 1.0);
  o = mix(texture(u_tex, v_uv), texture(u_fx, v_uv), clamp(k, 0.0, 1.0)); }"""

SDF = """
uniform int u_kind; uniform vec2 u_center; uniform vec2 u_size; uniform float u_rot; uniform float u_round;
uniform vec2 u_pts[48]; uniform int u_npts;
float sd_poly(vec2 p){ float d = dot(p - u_pts[0], p - u_pts[0]); float s = 1.0;
  for(int i = 0, j = u_npts - 1; i < u_npts; j = i, i++){ vec2 e = u_pts[j] - u_pts[i]; vec2 w = p - u_pts[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0); d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= u_pts[i].y, p.y < u_pts[j].y, e.x * w.y > e.y * w.x); if(all(c) || all(not(c))) s *= -1.0; }
  return s * sqrt(d); }
float sdf(vec2 px){ vec2 p = rot2(u_rot) * (px - u_center);
  if(u_kind == 0){ vec2 h = u_size * 0.5; float r = min(u_round, min(h.x, h.y)); vec2 q = abs(p) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  if(u_kind == 1){ vec2 h = max(u_size * 0.5, vec2(1e-3)); float k = length(p / h); return (k - 1.0) * min(h.x, h.y); }
  return sd_poly(p) - u_round; }
"""

MASK = PRELUDE + SDF + """
uniform float u_feather; uniform float u_expand; uniform int u_invert; uniform float u_opacity;
void main(){ float f = max(u_feather, 0.75); float m = 1.0 - smoothstep(-f, f, sdf(v_uv * u_res) - u_expand);
  if(u_invert == 1) m = 1.0 - m; o = texture(u_tex, v_uv) * mix(1.0, m, u_opacity); }"""

SHAPE = PRELUDE + SDF + """
uniform vec4 u_fill; uniform vec4 u_stroke; uniform float u_stroke_w; uniform float u_feather;
void main(){ float d = sdf(v_uv * u_res); float f = max(u_feather, 0.75);
  float fa = (1.0 - smoothstep(-f, f, d)) * u_fill.a;
  float sa = u_stroke_w > 0.0 ? (1.0 - smoothstep(-f, f, abs(d) - u_stroke_w * 0.5)) * u_stroke.a : 0.0;
  vec4 c = vec4(u_fill.rgb * fa, fa); c = vec4(u_stroke.rgb * sa, sa) + c * (1.0 - sa); o = c; }"""

FINAL = PRELUDE + """
uniform vec4 u_bg;
void main(){ vec4 c = texture(u_tex, v_uv); vec3 rgb = c.rgb + u_bg.rgb * u_bg.a * (1.0 - c.a);
  rgb += (hash21(v_uv * u_res) - 0.5) / 255.0; o = vec4(clamp(rgb, 0.0, 1.0), 1.0); }"""

MAX_DEPTH = 8


def _T(x, y, z=0.0):
    m = np.eye(4)
    m[:3, 3] = (x, y, z)
    return m


def _vec2(v, default=None):
    if v is None:
        return list(default)
    if isinstance(v, (int, float)):
        return [float(v), float(v)]
    return [float(x) for x in v]


def color4(v):
    v = num(v)
    if not isinstance(v, (list, tuple)):
        v = [v, v, v, 1.0]
    v = [float(x) for x in v]
    return (v + [1.0] * 4)[:4] if len(v) < 4 else v[:4]


class Env:
    """Per-effect render context handed to effect render functions."""

    def __init__(self, renderer, comp, layer, t, scale, canvas, index):
        self.renderer, self.comp, self.layer, self.t, self.scale = renderer, comp, layer, t, scale
        self.fps = float(comp["fps"])
        self.size = canvas
        self.index = index
        self.uniforms = {"u_time": float(t), "u_ltime": float(t - (layer["start"] if layer else 0.0)),
                         "u_frame": float(round(t * self.fps)), "u_rscale": float(scale)}

    def input_at(self, t):
        """The layer as it enters this effect, rendered at another comp time (for temporal effects)."""
        return self.renderer.layer_content(self.comp, self.layer, t, self.scale, upto=self.index, adj_src=None)

    def params_at(self, t):
        fx = self.layer["effects"][self.index]
        return self.renderer.resolve_params(fx, t, self.scale, self)


class Renderer:
    def __init__(self, project, gl=None):
        self.project = project
        self.gl = gl or GL()
        self.readers = {}
        self.images = {}
        self.text = TextEngine(self.gl)
        self.decode_oversample = 1.0

    def close(self):
        for r in self.readers.values():
            r.close()
        self.readers.clear()

    # ------------------------------------------------------------------ public
    def frame(self, comp_id, t, scale=1.0, solo=None):
        """Render one frame → uint8 RGB array (H, W, 3)."""
        comp = get_comp(self.project, comp_id)
        tex = self.render_comp(comp, t, scale, solo=solo)
        out = self.gl.run(FINAL, tex.size, u_tex=tex, u_bg=color4(comp.get("background", [0, 0, 0, 1])))
        arr = self.gl.read(out)[:, :, :3].copy()
        self.gl.release(tex, out)
        return arr

    def canvas(self, comp, scale):
        return (max(2, int(round(comp["width"] * scale))), max(2, int(round(comp["height"] * scale))))

    # ------------------------------------------------------------------ comp
    def render_comp(self, comp, t, scale=1.0, depth=0, solo=None):
        gl = self.gl
        canvas = self.canvas(comp, scale)
        acc = gl.clear(canvas)
        if depth > MAX_DEPTH:
            return acc
        matte_ids = {l["matte"]["layer"] for l in comp["layers"] if l.get("matte")}
        for layer in reversed(comp["layers"]):
            if solo and layer["id"] not in solo:
                continue
            if not layer.get("enabled", True) or layer["type"] in ("null", "audio"):
                continue
            if not (layer["start"] - 1e-6 <= t < layer["end"] - 1e-6):
                continue
            if layer["id"] in matte_ids and not layer.get("visible_matte"):
                continue
            opacity = float(evaluate(layer.get("transform", {}).get("opacity", 100.0), t)) / 100.0
            if opacity <= 0.0:
                continue
            if layer["type"] == "adjustment":
                fx = self.layer_content(comp, layer, t, scale, adj_src=acc, depth=depth)
                cov = None
                if layer.get("masks") or self._has_transform(layer, t):
                    white = gl.clear(canvas, (1.0, 1.0, 1.0, 1.0))
                    masked = self.apply_masks(layer, white, t, scale)
                    cov = self.transformed(comp, layer, masked, t, scale)
                    gl.release(*{white, masked} - {cov})
                out = gl.run(ADJUST, canvas, u_tex=acc, u_fx=fx, u_cov=cov or acc, u_opacity=opacity, u_use_cov=int(cov is not None))
                gl.release(acc, cov)
                if fx is not acc:
                    gl.release(fx)
                acc = out
                continue
            tex = self.layer_final(comp, layer, t, scale, depth)
            matte, mmode = None, 0
            if layer.get("matte"):
                try:
                    ml = find_layer(comp, layer["matte"]["layer"])
                    matte = self.layer_final(comp, ml, t, scale, depth)
                    mmode = MATTE_MODES.index(layer["matte"].get("mode", "alpha")) + 1
                except KeyError:
                    pass
            out = gl.run(COMPOSITE, canvas, u_tex=tex, u_dst=acc, u_matte=matte or tex, u_matte_mode=mmode,
                         u_mode=BLEND_MODES.index(layer.get("blend", "normal")), u_opacity=opacity)
            gl.release(acc, tex, matte)
            acc = out
        return acc

    def layer_final(self, comp, layer, t, scale, depth=0):
        content = self.layer_content(comp, layer, t, scale, depth=depth)
        out = self.transformed(comp, layer, content, t, scale)
        if out is not content:
            self.gl.release(content)
        return out

    # ------------------------------------------------------------------ layer content
    def layer_content(self, comp, layer, t, scale, upto=None, adj_src=None, depth=0):
        """Layer canvas after masks and effects[:upto]. Always returns a texture the caller owns."""
        gl = self.gl
        canvas = self.canvas(comp, scale)
        if layer["type"] == "adjustment":
            if adj_src is None:  # temporal effect on an adjustment layer: re-render what is beneath it
                sub = dict(comp, layers=comp["layers"][comp["layers"].index(layer) + 1:])
                cur = self.render_comp(sub, t, scale, depth + 1)
            else:
                cur = gl.copy(adj_src)
        else:
            src = self.layer_source(comp, layer, t, scale, canvas, depth)
            cur = self.apply_masks(layer, src, t, scale)
            if cur is not src:
                gl.release(src)
        effects = layer.get("effects", [])
        for i, fx in enumerate(effects if upto is None else effects[:upto]):
            if not fx.get("enabled", True):
                continue
            env = Env(self, comp, layer, t, scale, canvas, i)
            p = self.resolve_params(fx, t, scale, env)
            spec = REGISTRY[fx["type"]]
            mix = max(0.0, min(1.0, float(p.get("mix", 1.0))))
            if mix <= 0.0:
                continue
            out = spec.render(gl, cur, p, env)
            if out is not cur:
                if mix < 1.0:
                    blended = gl.run(MIX, canvas, u_tex=cur, u_b=out, u_mix=mix)
                    gl.release(out)
                    out = blended
                gl.release(cur)
                cur = out
        return cur

    def resolve_params(self, fx, t, scale, env=None):
        spec = REGISTRY.get(fx["type"])
        if spec is None:
            raise KeyError(f"effect type {fx['type']!r} is not registered")
        layer = env.layer if env else None
        names = {"fps": env.fps if env else 30.0, "start": layer["start"] if layer else 0.0,
                 "end": layer["end"] if layer else 0.0, "lt": t - (layer["start"] if layer else 0.0)}
        p = {}
        for k, ps in spec.params.items():
            raw = fx.get("params", {}).get(k, ps.default)
            if k == "fps" and k not in fx.get("params", {}) and env and fx["type"] == "shake":
                raw = env.fps
            v = raw if ps.kind in ("text", "points") else evaluate(raw, t, names)
            p[k] = ps.coerce(v, scale)
        return p

    # ------------------------------------------------------------------ sources
    def reader(self, mid):
        if mid not in self.readers:
            self.readers[mid] = media.VideoReader(self.project["media"][mid]["path"])
        return self.readers[mid]

    def _fit(self, tex, src_size, canvas, fit, scale, premult):
        sw, sh = src_size
        cw, ch = canvas
        if fit == "stretch":
            kx, ky = cw / sw, ch / sh
        elif fit == "none":
            kx = ky = scale
        else:
            kx = ky = (max if fit == "cover" else min)(cw / sw, ch / sh)
        return self.gl.run(FIT, canvas, u_tex=tex, u_k=(cw / (sw * kx), ch / (sh * ky)), u_premult=int(premult))

    def _decode_size(self, src_size, canvas, fit, scale):
        sw, sh = src_size
        if fit == "none":
            k = scale
        elif fit == "stretch":
            k = max(canvas[0] / sw, canvas[1] / sh)
        else:
            k = (max if fit == "cover" else min)(canvas[0] / sw, canvas[1] / sh)
        k = min(1.0, k * self.decode_oversample)
        return (max(2, int(round(sw * k / 2)) * 2), max(2, int(round(sh * k / 2)) * 2))

    def layer_source(self, comp, layer, t, scale, canvas, depth=0):
        gl = self.gl
        typ = layer["type"]
        if typ == "solid":
            c = color4(evaluate(layer.get("color", [0, 0, 0, 1]), t))
            return gl.clear(canvas, (c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]))
        if typ == "text":
            return self.text.render(layer, t, canvas, scale)
        if typ == "shape":
            return self._shape(layer, t, canvas, scale)
        fit = layer.get("fit", "cover")
        if typ == "image":
            m = self.project["media"][layer["source"]]
            tex = self.images.get(m["path"])
            if tex is None:
                tex = gl.upload(media.load_image(m["path"]))
                gl.live -= 1
                self.images[m["path"]] = tex
            return self._fit(tex, (m["width"], m["height"]), canvas, fit, scale, True)
        if typ == "comp":
            sub = self.project["comps"][layer["source"]]
            st = source_time(layer, t)
            if layer.get("loop") and sub["duration"] > 0:
                st %= sub["duration"]
            k = (max if fit == "cover" else min)(canvas[0] / sub["width"], canvas[1] / sub["height"]) if fit != "none" else scale
            tex = self.render_comp(sub, st, min(k, 1.0) if fit != "stretch" else scale, depth + 1)
            out = self._fit(tex, (sub["width"], sub["height"]), canvas, fit, scale, False)
            gl.release(tex)
            return out
        if typ == "footage":
            m = self.project["media"][layer["source"]]
            if m["kind"] == "image":
                return self.layer_source(comp, dict(layer, type="image"), t, scale, canvas, depth)
            rd = self.reader(layer["source"])
            st = source_time(layer, t)
            dur = rd.duration
            if layer.get("loop") and dur > 0:
                st %= dur
            st = max(0.0, min(st, dur - 0.5 / rd.fps))
            size = (m["width"], m["height"])
            dsize = self._decode_size(size, canvas, fit, scale)
            tex = gl.upload(rd.frame(st, dsize))
            out = self._fit(tex, size, canvas, fit, scale, rd.alpha)
            gl.release(tex)
            if layer.get("frame_blend"):
                frac = st * rd.fps - math.floor(st * rd.fps + 1e-4)
                if 0.02 < frac < 0.98:
                    tex2 = gl.upload(rd.frame(st + 1.0 / rd.fps, dsize))
                    b = self._fit(tex2, size, canvas, fit, scale, rd.alpha)
                    mixed = gl.run(MIX, canvas, u_tex=out, u_b=b, u_mix=frac)
                    gl.release(tex2, b, out)
                    out = mixed
            return out
        return gl.clear(canvas)

    # ------------------------------------------------------------------ shapes & masks
    @staticmethod
    def _poly_points(kind, sides, inner, radius, custom, scale):
        if custom:
            pts = [[float(x) * scale, float(y) * scale] for x, y in custom][:48]
        else:
            n = max(3, min(24, int(sides)))
            pts = []
            for i in range(n * (2 if kind == "star" else 1)):
                a = -math.pi / 2 + i * math.pi * 2 / (n * (2 if kind == "star" else 1))
                r = radius * (inner if kind == "star" and i % 2 else 1.0)
                pts.append([math.cos(a) * r, math.sin(a) * r])
        arr = np.zeros((48, 2), np.float32)
        arr[: len(pts)] = pts
        return arr, len(pts)

    def _sdf_uniforms(self, s, t, canvas, scale, default_center):
        kind = s.get("kind", s.get("shape", "rect"))
        size = _vec2(evaluate(s.get("size", [400, 400]), t), [400, 400])
        center = _vec2(evaluate(s.get("center", default_center), t), default_center)
        u = {"u_kind": {"rect": 0, "ellipse": 1}.get(kind, 2), "u_center": (center[0] * scale, center[1] * scale),
             "u_size": (size[0] * scale, size[1] * scale), "u_rot": math.radians(float(evaluate(s.get("rotation", 0.0), t))),
             "u_round": float(evaluate(s.get("roundness", 0.0), t)) * scale, "u_npts": 0, "u_pts": np.zeros((48, 2), np.float32)}
        if u["u_kind"] == 2:
            pts, n = self._poly_points(kind, s.get("sides", 5), float(evaluate(s.get("inner", 0.5), t)),
                                       min(size) * scale / 2, s.get("points"), scale)
            u["u_pts"], u["u_npts"] = pts, n
            if s.get("points"):
                u["u_center"] = (0.0, 0.0) if "center" not in s else u["u_center"]
        return u

    def _shape(self, layer, t, canvas, scale):
        s = layer["shape"]
        comp_center = [canvas[0] / scale / 2, canvas[1] / scale / 2]
        u = self._sdf_uniforms(s, t, canvas, scale, comp_center)
        fill = color4(evaluate(s["fill"], t)) if s.get("fill") is not None else [0, 0, 0, 0]
        stroke = color4(evaluate(s["stroke"], t)) if s.get("stroke") is not None else [0, 0, 0, 0]
        return self.gl.run(SHAPE, canvas, u_fill=fill, u_stroke=stroke,
                           u_stroke_w=float(evaluate(s.get("stroke_width", 0.0), t)) * scale,
                           u_feather=float(evaluate(s.get("feather", 0.0), t)) * scale, **u)

    def apply_masks(self, layer, tex, t, scale):
        cur = tex
        for m in layer.get("masks", []) or []:
            canvas = cur.size
            u = self._sdf_uniforms(m, t, canvas, scale, [canvas[0] / scale / 2, canvas[1] / scale / 2])
            out = self.gl.run(MASK, canvas, u_tex=cur, u_feather=float(evaluate(m.get("feather", 0.0), t)) * scale,
                              u_expand=float(evaluate(m.get("expand", 0.0), t)) * scale, u_invert=int(bool(m.get("invert"))),
                              u_opacity=float(evaluate(m.get("opacity", 100.0), t)) / 100.0, **u)
            if cur is not tex:
                self.gl.release(cur)
            cur = out
        return cur

    # ------------------------------------------------------------------ transform
    def _has_transform(self, layer, t):
        return bool(layer.get("parent")) or any(k != "opacity" for k in layer.get("transform", {}))

    def layer_matrix(self, comp, layer, t, _seen=None):
        """4x4 matrix from layer canvas pixels to comp pixels (before perspective)."""
        W, H = comp["width"], comp["height"]
        tr = layer.get("transform", {})
        anchor = _vec2(evaluate(tr.get("anchor"), t) if "anchor" in tr else None, [W / 2, H / 2])
        pos = evaluate(tr.get("position"), t) if "position" in tr else [W / 2, H / 2]
        pos = [float(x) for x in pos] + [0.0] * (3 - len(pos))
        sc = _vec2(evaluate(tr.get("scale"), t) if "scale" in tr else None, [100.0, 100.0])
        rz = math.radians(float(evaluate(tr.get("rotation", 0.0), t)))
        rx = math.radians(float(evaluate(tr.get("rotation_x", 0.0), t)))
        ry = math.radians(float(evaluate(tr.get("rotation_y", 0.0), t)))
        S = np.diag([sc[0] / 100.0, sc[1] / 100.0, 1.0, 1.0])
        cz, sz = math.cos(rz), math.sin(rz)
        Rz = np.array([[cz, -sz, 0, 0], [sz, cz, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1.0]])
        cx, sx = math.cos(rx), math.sin(rx)
        Rx = np.array([[1, 0, 0, 0], [0, cx, -sx, 0], [0, sx, cx, 0], [0, 0, 0, 1.0]])
        cy, sy = math.cos(ry), math.sin(ry)
        Ry = np.array([[cy, 0, sy, 0], [0, 1, 0, 0], [-sy, 0, cy, 0], [0, 0, 0, 1.0]])
        M = _T(pos[0], pos[1], pos[2]) @ Rz @ Ry @ Rx @ S @ _T(-anchor[0], -anchor[1])
        pid = layer.get("parent")
        if pid:
            seen = (_seen or set()) | {layer["id"]}
            try:
                parent = find_layer(comp, pid)
            except KeyError:
                parent = None
            if parent is not None and parent["id"] not in seen:
                # parent space: a child at the comp centre sits on the parent's anchor
                P = self.layer_matrix(comp, parent, t, seen)
                M = P @ M
        return M

    def _inv_homography(self, comp, layer, t, scale):
        W, H = comp["width"], comp["height"]
        M = self.layer_matrix(comp, layer, t)
        d = float(comp.get("perspective", 0) or 1.6 * max(W, H))
        P = np.array([[1, 0, -W / 2 / d, 0], [0, 1, -H / 2 / d, 0], [0, 0, 1, 0], [0, 0, -1 / d, 1.0]])
        F = P @ M
        Hm = F[np.ix_([0, 1, 3], [0, 1, 3])]
        S = np.diag([scale, scale, 1.0])
        Hs = S @ Hm @ np.linalg.inv(S)
        try:
            return np.linalg.inv(Hs)
        except np.linalg.LinAlgError:
            return None

    def transformed(self, comp, layer, content, t, scale):
        """Apply the layer transform. Returns `content` itself when the transform is the identity."""
        edge = {"none": 0, "transparent": 0, "clamp": 1, "repeat": 2, "mirror": 3}.get(layer.get("edge", "none"), 0)
        if not self._has_transform(layer, t) and edge == 0:
            return content
        mb = layer.get("motion_blur", False)
        n = max(2, min(16, int(comp.get("motion_blur_samples", 12)))) if mb else 1
        shutter = float(comp.get("shutter_angle", 180.0)) / 360.0 / float(comp["fps"])
        if mb and isinstance(mb, (int, float)) and not isinstance(mb, bool):
            shutter *= float(mb)
        mats = np.zeros((16, 3, 3), np.float32)
        count = 0
        for i in range(n):
            ti = t + ((i / (n - 1)) - 0.5) * shutter if n > 1 else t
            inv = self._inv_homography(comp, layer, ti, scale)
            if inv is None:
                continue
            mats[count] = inv.T  # GLSL is column-major
            count += 1
        if count == 0:
            return self.gl.clear(content.size)
        if count == 1 and edge == 0 and np.allclose(mats[0], np.eye(3), atol=1e-7):
            return content
        return self.gl.run(TRANSFORM, content.size, u_tex=content, u_h=mats, u_n=count, u_edge=edge,
                           u_src=(float(content.w), float(content.h)))
