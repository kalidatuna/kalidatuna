"""Temporal effects: they sample the layer at other moments in time."""
from __future__ import annotations

from ..gl import PRELUDE
from . import P, effect

_ACC = PRELUDE + """
uniform sampler2D u_add; uniform float u_w; uniform int u_mode;
void main(){ vec4 a = texture(u_tex, v_uv), b = texture(u_add, v_uv) * u_w;
  if(u_mode == 0) o = a + b;                       // add
  else if(u_mode == 1) o = max(a, b);              // lighten
  else if(u_mode == 2) o = b + a * (1.0 - b.a);    // newer frames in front
  else o = a + b * (1.0 - a.a);                    // newer frames behind
}"""


@effect("echo", "time", "Trails: overlay earlier (or later) moments of the layer. Ghost trails behind motion, "
        "afterimages on impact frames. Costs one extra layer render per echo.", {
    "count": P(4, "Number of echoes.", min=1, max=16),
    "interval": P(-0.05, "Seconds between echoes (negative = trails from the past).", min=-2, max=2),
    "decay": P(0.6, "Each echo is this much dimmer than the one before.", min=0, max=1),
    "mode": P("lighten", "How echoes combine.", choices=["add", "lighten", "front", "behind"]),
}, temporal=True)
def echo(gl, src, p, env):
    acc = gl.copy(src)
    w = 1.0
    for i in range(1, int(p["count"]) + 1):
        w *= p["decay"]
        if w < 0.01:
            break
        past = env.input_at(env.t + p["interval"] * i)
        nxt = gl.run(_ACC, src.size, u_tex=acc, u_add=past, u_w=w, u_mode=p["mode"])
        gl.release(acc, past)
        acc = nxt
    return acc


@effect("posterize_time", "time", "Lower the layer's frame rate for a choppy stop-motion / stutter feel.", {
    "fps": P(8.0, "Frames per second to hold.", min=0.5, max=60),
}, temporal=True)
def posterize_time(gl, src, p, env):
    step = 1.0 / max(p["fps"], 0.01)
    t = (env.t // step) * step
    if abs(t - env.t) < 1e-6:
        return src
    return env.input_at(t)


_DIFF = PRELUDE + """
uniform sampler2D u_prev; uniform float u_gain; uniform vec4 u_color; uniform float u_keep;
void main(){ vec4 a = texture(u_tex, v_uv), b = texture(u_prev, v_uv);
  float d = clamp(length(a.rgb - b.rgb) * u_gain, 0.0, 1.0);
  o = vec4(a.rgb * u_keep + u_color.rgb * d * a.a, a.a); }"""


@effect("motion_highlight", "time", "Highlight whatever moved since the previous frame in a colour (motion-reactive glow source).", {
    "gain": P(4.0, "Sensitivity.", min=0, max=50),
    "color": P([1.0, 1.0, 1.0, 1.0], "Highlight colour."),
    "keep": P(1.0, "How much of the original image remains (0 = only the motion).", min=0, max=1),
    "interval": P(0.04, "Time difference compared, in seconds.", min=0.001, max=1),
}, temporal=True)
def motion_highlight(gl, src, p, env):
    prev = env.input_at(env.t - p["interval"])
    out = gl.run(_DIFF, src.size, u_tex=src, u_prev=prev, u_gain=p["gain"], u_color=p["color"], u_keep=p["keep"])
    gl.release(prev)
    return out
