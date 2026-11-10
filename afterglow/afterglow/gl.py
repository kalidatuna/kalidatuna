"""Thin moderngl wrapper: pooled float render targets and fullscreen shader passes.

Conventions used by every shader in the engine
  * v_uv = (0,0) is the TOP-left of the image, y grows downward.
  * colour is premultiplied RGBA in half-float buffers, display-referred (gamma) values.
"""
from __future__ import annotations

import hashlib

import moderngl
import numpy as np

VERT = """#version 330
in vec2 in_pos;
out vec2 v_uv;
void main(){ v_uv = in_pos * 0.5 + 0.5; gl_Position = vec4(in_pos, 0.0, 1.0); }
"""

PRELUDE = """#version 330
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_tex;
uniform vec2 u_res;      // output size in pixels
uniform float u_time;    // comp time, seconds
uniform float u_ltime;   // seconds since the layer started
uniform float u_frame;   // comp frame number
uniform float u_rscale;  // render scale (1 = full res); pixel params are already scaled
#define PI 3.14159265359
#define TAU 6.28318530718
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 unpre(vec4 c){ return c.a > 1e-5 ? c.rgb / c.a : vec3(0.0); }
vec4 pre(vec3 c, float a){ return vec4(c * a, a); }
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), f.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + 11.7; a *= 0.5; } return s; }
float noise1(float x){ float i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f); return mix(hash11(i), hash11(i+1.0), f) * 2.0 - 1.0; }
vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
// edge modes: 0 transparent, 1 clamp, 2 repeat, 3 mirror
vec2 edge_uv(vec2 uv, int mode){ if(mode == 2) return fract(uv); if(mode == 3) return 1.0 - abs(mod(uv, 2.0) - 1.0); return clamp(uv, 0.0, 1.0); }
vec4 tex_edge(sampler2D t, vec2 uv, int mode){
  if(mode == 0){ vec2 px = fwidth(uv) * 0.5 + 1e-6; vec2 m = smoothstep(-px, px, uv) * smoothstep(-px, px, 1.0 - uv); return texture(t, clamp(uv, 0.0, 1.0)) * m.x * m.y; }
  return texture(t, edge_uv(uv, mode)); }
vec4 T(vec2 uv){ return texture(u_tex, uv); }
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
"""


class Tex:
    __slots__ = ("tex", "fbo", "size", "key")

    def __init__(self, tex, fbo, size, key):
        self.tex, self.fbo, self.size, self.key = tex, fbo, size, key

    @property
    def w(self):
        return self.size[0]

    @property
    def h(self):
        return self.size[1]


class GL:
    def __init__(self, ctx=None):
        self.ctx = ctx or _create_context()
        self.ctx.disable(moderngl.BLEND)
        self.quad = self.ctx.buffer(np.array([-1, -1, 1, -1, -1, 1, 1, 1], dtype="f4").tobytes())
        self._progs = {}
        self._pool = {}
        self.live = 0
        self.info = {k: self.ctx.info.get(k) for k in ("GL_RENDERER", "GL_VERSION", "GL_VENDOR")}

    # ---------------------------------------------------------------- textures
    def acquire(self, size, dtype="f2", comps=4):
        size = (max(1, int(size[0])), max(1, int(size[1])))
        key = (size, dtype, comps)
        free = self._pool.get(key)
        self.live += 1
        if free:
            return free.pop()
        tex = self.ctx.texture(size, comps, dtype=dtype)
        tex.filter = (moderngl.LINEAR, moderngl.LINEAR)
        tex.repeat_x = tex.repeat_y = False
        return Tex(tex, self.ctx.framebuffer(color_attachments=[tex]), size, key)

    def release(self, *texs):
        for t in texs:
            if t is not None:
                self.live -= 1
                self._pool.setdefault(t.key, []).append(t)

    def trim(self, keep=6):
        """Drop pooled textures beyond `keep` per size, to bound VRAM."""
        for lst in self._pool.values():
            while len(lst) > keep:
                t = lst.pop()
                t.fbo.release()
                t.tex.release()

    def upload(self, arr):
        """uint8 array (H, W, 3|4), first row = top of image."""
        h, w, c = arr.shape
        t = self.acquire((w, h), "f1", c)
        t.tex.write(np.ascontiguousarray(arr).tobytes(), alignment=1)
        return t

    def clear(self, size, color=(0.0, 0.0, 0.0, 0.0)):
        t = self.acquire(size)
        t.fbo.clear(*color)
        return t

    def read(self, t):
        """Read back as uint8 (H, W, 4)."""
        data = t.fbo.read(components=4, dtype="f1", alignment=1)
        return np.frombuffer(data, dtype=np.uint8).reshape(t.h, t.w, 4)

    # ---------------------------------------------------------------- programs
    def program(self, frag, vert=VERT):
        key = hashlib.md5((vert + frag).encode()).hexdigest()
        p = self._progs.get(key)
        if p is None:
            try:
                prog = self.ctx.program(vertex_shader=vert, fragment_shader=frag)
            except Exception as e:  # surface readable GLSL errors
                numbered = "\n".join(f"{i + 1:4d}: {l}" for i, l in enumerate(frag.split("\n")))
                raise RuntimeError(f"shader compile failed: {e}\n{numbered}") from None
            vao = self.ctx.vertex_array(prog, [(self.quad, "2f", "in_pos")])
            p = self._progs[key] = (prog, vao)
        return p

    def set_uniforms(self, prog, uniforms):
        unit = 0
        for name, val in uniforms.items():
            u = prog.get(name, None)
            if u is None:
                continue
            if isinstance(val, Tex):
                val.tex.use(unit)
                u.value = unit
                unit += 1
            elif isinstance(val, np.ndarray):
                u.write(np.ascontiguousarray(val, dtype="f4").tobytes())
            else:
                is_int = getattr(u, "fmt", "f").endswith("i")
                if isinstance(val, (list, tuple)):
                    val = tuple(int(x) if is_int else float(x) for x in val)
                    if u.dimension != len(val):
                        val = (val + (1.0,) * 4)[: u.dimension]
                else:
                    val = int(val) if is_int else float(val)
                u.value = val

    def run(self, frag, size, **uniforms):
        """Run a fullscreen fragment shader into a fresh target and return it."""
        out = self.acquire(size)
        self.run_into(out, frag, **uniforms)
        return out

    def run_into(self, out, frag, **uniforms):
        prog, vao = self.program(frag)
        out.fbo.use()
        uniforms.setdefault("u_res", (float(out.w), float(out.h)))
        self.set_uniforms(prog, uniforms)
        vao.render(moderngl.TRIANGLE_STRIP)
        return out

    def copy(self, src, size=None):
        return self.run(COPY, size or src.size, u_tex=src)


COPY = PRELUDE + "void main(){ o = texture(u_tex, v_uv); }"


def _create_context():
    errors = []
    for kwargs in ({}, {"backend": "egl"}):
        try:
            return moderngl.create_context(standalone=True, require=330, **kwargs)
        except Exception as e:  # pragma: no cover - depends on host drivers
            errors.append(f"{kwargs or 'default'}: {e}")
    raise RuntimeError(
        "Could not create an OpenGL 3.3 context. On Windows/macOS update the GPU driver; "
        "on headless Linux run under xvfb-run or install EGL (libegl1). Details: " + "; ".join(errors))
