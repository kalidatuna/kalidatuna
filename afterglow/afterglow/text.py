"""Text layers: font lookup, layout, per-unit rasterisation and kinetic animation.

text spec (layer["text"]):
  content        string, "\\n" for line breaks          (or use `words` for timed captions)
  font           family name ("Arial Bold", "Montserrat ExtraBold") or a .ttf/.otf path
  size           font size in px at full comp resolution
  color, stroke_color, stroke_width, align (left|center|right), line_spacing, tracking, max_width, uppercase
  animate_in / animate_out   {"preset", "unit": char|word|line|all, "stagger", "duration", "ease", "delay", "order"}
  words          [{"text", "start", "end"}, ...]  comp-time word timings for captions
  page_words     how many words are on screen at once (captions)
  highlight      {"color", "scale"} applied to the word being spoken
  word_in        {"preset", "duration", "ease"} entrance for each caption word
"""
from __future__ import annotations

import math
import os
import sys
from collections import OrderedDict

import moderngl
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .props import evaluate, get_ease, num

PRESETS = {
    "fade": {"opacity": 0},
    "pop": {"opacity": 0, "scale": 0.3, "ease": "easeOutBack"},
    "slam": {"opacity": 0, "scale": 2.6, "ease": "easeOutExpo"},
    "slide_up": {"opacity": 0, "offset": [0, 0.8]},
    "slide_down": {"opacity": 0, "offset": [0, -0.8]},
    "slide_left": {"opacity": 0, "offset": [0.8, 0]},
    "slide_right": {"opacity": 0, "offset": [-0.8, 0]},
    "drop": {"opacity": 0, "offset": [0, -1.6], "ease": "easeOutBounce"},
    "rotate_in": {"opacity": 0, "rotation": -60, "scale": 0.5, "ease": "easeOutBack"},
    "typewriter": {"opacity": 0, "ease": "hold"},
    "flip": {"opacity": 0, "scale_y": 0.0, "ease": "easeOutBack"},
}

_font_index = None
_font_objs = {}


def font_dirs():
    dirs = [os.path.join(os.getcwd(), "fonts"), os.path.join(os.path.dirname(os.path.dirname(__file__)), "fonts")]
    dirs += [d for d in os.environ.get("AFTERGLOW_FONTS", "").split(os.pathsep) if d]
    if sys.platform.startswith("win"):
        dirs += [os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts"),
                 os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Windows", "Fonts")]
    elif sys.platform == "darwin":
        dirs += ["/System/Library/Fonts", "/Library/Fonts", os.path.expanduser("~/Library/Fonts")]
    else:
        dirs += ["/usr/share/fonts", "/usr/local/share/fonts", os.path.expanduser("~/.fonts"),
                 os.path.expanduser("~/.local/share/fonts")]
    return [d for d in dirs if d and os.path.isdir(d)]


def _norm(s):
    return "".join(ch for ch in s.lower() if ch.isalnum())


def font_index(refresh=False):
    """Map of normalised 'family style' → font path for every installed font."""
    global _font_index
    if _font_index is not None and not refresh:
        return _font_index
    idx = {}
    for d in font_dirs():
        for root, _, files in os.walk(d):
            for fn in files:
                if not fn.lower().endswith((".ttf", ".otf", ".ttc")):
                    continue
                path = os.path.join(root, fn)
                try:
                    fam, style = ImageFont.truetype(path, 12).getname()
                except Exception:
                    continue
                idx.setdefault(_norm(f"{fam} {style}"), (f"{fam} {style}", path))
                if style.lower() in ("regular", "book", "roman", "normal"):
                    idx[_norm(fam)] = (fam, path)
                else:
                    idx.setdefault(_norm(fam), (fam, path))
                idx.setdefault(_norm(os.path.splitext(fn)[0]), (f"{fam} {style}", path))
    _font_index = idx
    return idx


def list_fonts(query=""):
    q = _norm(query)
    names = sorted({v[0] for k, v in font_index().items() if q in k})
    return names


FALLBACKS = ["Arial Bold", "Segoe UI Bold", "Helvetica Bold", "Inter Bold", "DejaVu Sans Bold", "Arial", "DejaVu Sans"]


def find_font(name):
    if name and os.path.isfile(name):
        return name
    idx = font_index()
    for cand in ([name] if name else []) + FALLBACKS:
        hit = idx.get(_norm(cand))
        if hit:
            return hit[1]
    if name:
        q = _norm(name)
        for k, v in idx.items():
            if q in k:
                return v[1]
    return next(iter(idx.values()))[1] if idx else None


def get_font(name, size):
    size = max(4, int(round(size)))
    path = find_font(name)
    key = (path, size)
    if key not in _font_objs:
        _font_objs[key] = ImageFont.truetype(path, size) if path else ImageFont.load_default(size)
    return _font_objs[key], path


def _hex(c):
    c = num(c)
    c = (list(c) + [1.0] * 4)[:4] if len(c) < 4 else c
    return tuple(int(max(0.0, min(1.0, x)) * 255 + 0.5) for x in c)


def _wrap(text, font, max_width, tracking):
    lines = []
    for raw in text.split("\n"):
        words = raw.split(" ")
        if not max_width:
            lines.append(words)
            continue
        cur, width = [], 0.0
        space = font.getlength(" ") + tracking
        for w in words:
            wl = font.getlength(w) + tracking * len(w)
            if cur and width + space + wl > max_width:
                lines.append(cur)
                cur, width = [w], wl
            else:
                width += (space if cur else 0.0) + wl
                cur.append(w)
        lines.append(cur)
    return lines


def layout(lines, font, unit, align, line_spacing, tracking):
    """lines: list of word lists. Returns (units, width, height); unit = dict(text, x, y, line, word)."""
    ascent, descent = font.getmetrics()
    lh = (ascent + descent) * line_spacing
    space = font.getlength(" ") + tracking
    rows, maxw = [], 0.0
    for words in lines:
        x, row = 0.0, []
        for w in words:
            row.append((w, x))
            x += font.getlength(w) + tracking * len(w) + space
        width = max(x - space, 0.0)
        rows.append((row, width))
        maxw = max(maxw, width)
    units, wi = [], 0
    for li, (row, width) in enumerate(rows):
        ox = {"left": 0.0, "right": maxw - width}.get(align, (maxw - width) / 2)
        y = li * lh
        if unit == "line":
            units.append({"text": " ".join(w for w, _ in row), "x": ox, "y": y, "line": li, "word": wi})
            wi += len(row)
            continue
        for w, x in row:
            if unit == "char":
                for ci, ch in enumerate(w):
                    units.append({"text": ch, "x": ox + x + font.getlength(w[:ci]) + tracking * ci, "y": y, "line": li, "word": wi})
            elif w:
                units.append({"text": w, "x": ox + x, "y": y, "line": li, "word": wi})
            wi += 1
    if unit == "all":
        units = [{"text": "\n".join(" ".join(w) for w in lines), "x": 0.0, "y": 0.0, "line": 0, "word": 0, "block": True}]
    return units, maxw, lh * (len(rows) - 1) + ascent + descent


QUAD_VERT = """#version 330
in vec2 in_pos; out vec2 v_uv;
uniform vec2 u_size; uniform vec2 u_center; uniform vec2 u_scl; uniform float u_rot; uniform vec2 u_canvas;
void main(){ v_uv = in_pos * 0.5 + 0.5; vec2 p = in_pos * 0.5 * u_size * u_scl;
  float c = cos(u_rot), s = sin(u_rot); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + u_center;
  gl_Position = vec4(p / u_canvas * 2.0 - 1.0, 0.0, 1.0); }"""
QUAD_FRAG = """#version 330
in vec2 v_uv; out vec4 o; uniform sampler2D u_tex; uniform float u_opacity;
void main(){ vec4 c = texture(u_tex, v_uv); o = vec4(c.rgb * c.a, c.a) * u_opacity; }"""


class TextEngine:
    def __init__(self, gl):
        self.gl = gl
        self.cache = OrderedDict()

    def _unit_tex(self, text, font, path, fill, stroke_w, stroke_fill, block=None):
        key = (text, path, font.size, fill, stroke_w, stroke_fill, block)
        hit = self.cache.get(key)
        if hit:
            self.cache.move_to_end(key)
            return hit
        ascent, descent = font.getmetrics()
        pad = int(stroke_w + font.size * 0.2 + 4)
        if block:
            align, spacing = block
            probe = ImageDraw.Draw(Image.new("RGBA", (4, 4)))
            bb = probe.multiline_textbbox((0, 0), text, font=font, align=align, spacing=spacing, stroke_width=stroke_w)
            w, h = int(bb[2] - min(bb[0], 0)) + 2 * pad, int(bb[3] - min(bb[1], 0)) + 2 * pad
            img = Image.new("RGBA", (max(w, 2), max(h, 2)), (0, 0, 0, 0))
            ImageDraw.Draw(img).multiline_text((pad, pad), text, font=font, fill=fill, align=align, spacing=spacing,
                                               stroke_width=stroke_w, stroke_fill=stroke_fill)
        else:
            w = int(math.ceil(font.getlength(text))) + 2 * pad
            img = Image.new("RGBA", (max(w, 2), ascent + descent + 2 * pad), (0, 0, 0, 0))
            ImageDraw.Draw(img).text((pad, pad + ascent), text, font=font, fill=fill, anchor="ls",
                                     stroke_width=stroke_w, stroke_fill=stroke_fill)
        tex = self.gl.upload(np.asarray(img))
        self.gl.live -= 1  # owned by the cache, not by a frame
        self.cache[key] = (tex, pad)
        while len(self.cache) > 600:
            _, (old, _) = self.cache.popitem(last=False)
            self.gl.live += 1
            self.gl.release(old)
        return self.cache[key]

    @staticmethod
    def _anim(spec, i, n, t, t0, size, out=False, t_end=None):
        """Per-unit animation state for an in/out animator. Returns dict(opacity, dx, dy, sx, sy, rot)."""
        st = {"opacity": 1.0, "dx": 0.0, "dy": 0.0, "sx": 1.0, "sy": 1.0, "rot": 0.0}
        if not spec:
            return st
        base = dict(PRESETS.get(spec.get("preset", "fade"), {}))
        base.update(spec.get("from", {}) if not out else spec.get("to", spec.get("from", {})))
        dur = max(float(spec.get("duration", 0.35)), 1e-4)
        stagger = float(spec.get("stagger", 0.03))
        order = spec.get("order", "forward")
        rank = {"reverse": n - 1 - i, "center": abs(i - (n - 1) / 2.0),
                "random": (math.sin(i * 91.7 + 3.3) * 43758.5453) % 1.0 * (n - 1)}.get(order, i)
        if out:
            k = (t - (t_end - dur - (n - 1) * stagger - float(spec.get("delay", 0.0)) + rank * stagger)) / dur
            k = 1.0 - max(0.0, min(1.0, k))
        else:
            k = max(0.0, min(1.0, (t - (t0 + float(spec.get("delay", 0.0)) + rank * stagger)) / dur))
        ease = spec.get("ease", base.get("ease", "easeOutCubic"))
        e = (1.0 if k >= 1.0 else 0.0) if ease == "hold" else get_ease(ease)(k)
        m = 1.0 - e
        off = base.get("offset", [0, 0])
        sc = base.get("scale", 1.0)
        st["opacity"] = 1.0 + (base.get("opacity", 1.0) - 1.0) * (1.0 - min(1.0, k * 3.0) if "opacity" in base and ease != "hold" else m)
        st["dx"], st["dy"] = off[0] * size * m, off[1] * size * m
        st["sx"] = 1.0 + (base.get("scale_x", sc) - 1.0) * m
        st["sy"] = 1.0 + (base.get("scale_y", sc) - 1.0) * m
        st["rot"] = base.get("rotation", 0.0) * m
        return st

    def render(self, layer, t, canvas, scale):
        """Draw a text layer into a new canvas-sized premultiplied texture."""
        gl = self.gl
        spec = layer["text"]
        size = float(evaluate(spec.get("size", 96), t)) * scale
        font, path = get_font(spec.get("font"), size)
        tracking = float(spec.get("tracking", 0.0)) * scale
        fill = _hex(evaluate(spec.get("color", "#ffffff"), t))
        stroke_w = int(round(float(spec.get("stroke_width", 0)) * scale))
        stroke_fill = _hex(spec.get("stroke_color", "#000000"))
        align, spacing = spec.get("align", "center"), float(spec.get("line_spacing", 1.15))
        upper = spec.get("uppercase", False)
        max_w = float(spec.get("max_width", 0)) * scale
        words = spec.get("words")
        a_in, a_out = spec.get("animate_in"), spec.get("animate_out")
        draws = []  # (text, x, y, fill, state, block)

        if words:
            per = int(spec.get("page_words", 0)) or len(words)
            pages = [words[i:i + per] for i in range(0, len(words), per)]
            page = None
            for pi, pg in enumerate(pages):
                nxt = pages[pi + 1][0]["start"] if pi + 1 < len(pages) else layer["end"]
                if pg[0]["start"] <= t < nxt:
                    page = pg
                    break
            out = gl.clear(canvas)
            if page is None:
                return out
            texts = [(w["text"].upper() if upper else w["text"]) for w in page]
            lines = _wrap(" ".join(texts), font, max_w, tracking)
            units, bw, bh = layout(lines, font, "word", align, spacing, tracking)
            hl = spec.get("highlight") or {}
            hl_fill = _hex(hl["color"]) if hl.get("color") else fill
            w_in = spec.get("word_in", {"preset": "pop", "duration": 0.12})
            reveal = spec.get("reveal", "word")
            for u in units:
                w = page[min(u["word"], len(page) - 1)]
                if reveal == "word" and t < w["start"]:
                    continue
                st = self._anim(dict(w_in, stagger=0.0), 0, 1, t, w["start"] if reveal == "word" else page[0]["start"], size)
                active = w["start"] <= t < w["end"]
                if active and hl.get("scale"):
                    k = min(1.0, (t - w["start"]) / 0.08)
                    s = 1.0 + (float(hl["scale"]) - 1.0) * get_ease("easeOutCubic")(k)
                    st["sx"] *= s
                    st["sy"] *= s
                draws.append((u["text"], u["x"], u["y"], hl_fill if active else fill, st, None))
        else:
            content = str(evaluate(spec.get("content", ""), t)) if not isinstance(spec.get("content"), str) else spec.get("content", "")
            if upper:
                content = content.upper()
            unit = (a_in or a_out or {}).get("unit", "all")
            lines = _wrap(content, font, max_w, tracking)
            if unit == "all" and not tracking:
                txt = "\n".join(" ".join(w) for w in lines)
                units, bw, bh = [{"text": txt, "x": 0.0, "y": 0.0, "block": True}], 0.0, 0.0
            else:
                units, bw, bh = layout(lines, font, "word" if unit == "all" else unit, align, spacing, tracking)
            n = len(units)
            for i, u in enumerate(units):
                st = self._anim(a_in, i, n, t, layer["start"], size)
                if a_out:
                    so = self._anim(a_out, i, n, t, layer["start"], size, out=True, t_end=layer["end"])
                    st = {"opacity": st["opacity"] * so["opacity"], "dx": st["dx"] + so["dx"], "dy": st["dy"] + so["dy"],
                          "sx": st["sx"] * so["sx"], "sy": st["sy"] * so["sy"], "rot": st["rot"] + so["rot"]}
                blk = (align, (spacing - 1.0) * sum(font.getmetrics())) if u.get("block") else None
                draws.append((u["text"], u["x"], u["y"], fill, st, blk))

        out = gl.clear(canvas)
        if not draws:
            return out
        prog, vao = gl.program(QUAD_FRAG, QUAD_VERT)
        gl.ctx.enable(moderngl.BLEND)
        gl.ctx.blend_func = (moderngl.ONE, moderngl.ONE_MINUS_SRC_ALPHA)
        out.fbo.use()
        off = spec.get("offset", [0, 0])
        cx0, cy0 = canvas[0] / 2 + off[0] * scale, canvas[1] / 2 + off[1] * scale
        try:
            for text, x, y, col, st, blk in draws:
                if st["opacity"] <= 0.001 or not text.strip():
                    continue
                tex, pad = self._unit_tex(text, font, path, col, stroke_w, stroke_fill, blk)
                if blk:
                    cx, cy = cx0, cy0
                else:
                    cx = cx0 - bw / 2 + x - pad + tex.w / 2
                    cy = cy0 - bh / 2 + y - pad + tex.h / 2
                gl.set_uniforms(prog, {"u_tex": tex, "u_size": (tex.w, tex.h), "u_center": (cx + st["dx"], cy + st["dy"]),
                                       "u_scl": (st["sx"], st["sy"]), "u_rot": math.radians(st["rot"]),
                                       "u_canvas": canvas, "u_opacity": max(0.0, min(1.0, st["opacity"]))})
                vao.render(moderngl.TRIANGLE_STRIP)
        finally:
            gl.ctx.disable(moderngl.BLEND)
        return out
