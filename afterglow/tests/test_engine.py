"""Core tests. Run: python -m pytest tests   (needs an OpenGL 3.3 context; on headless Linux use xvfb-run)."""
import os
import tempfile

import numpy as np
import pytest

from afterglow import effects
from afterglow import project as P
from afterglow.props import evaluate, get_ease


@pytest.fixture(scope="module")
def gl():
    from afterglow.gl import GL
    return GL()


def test_easing_endpoints():
    for name in ("linear", "easeOutExpo", "easeInOutBack", "snap", "easyEase"):
        f = get_ease(name)
        assert abs(f(0.0)) < 1e-6 and abs(f(1.0) - 1.0) < 1e-6


def test_keyframes_hold_loop_expr_wiggle():
    prop = {"keyframes": [{"t": 0, "v": 0, "ease": "hold"}, {"t": 1, "v": 10}]}
    assert evaluate(prop, 0.5) == 0 and evaluate(prop, 1.5) == 10
    loop = {"keyframes": [{"t": 0, "v": 0}, {"t": 1, "v": 10}], "loop": "pingpong"}
    assert abs(evaluate(loop, 1.5) - 5) < 1e-6
    assert evaluate({"value": 2, "expr": "value * 3 + t"}, 1.0) == 7
    w = [evaluate({"value": 0, "wiggle": {"freq": 5, "amp": 10}}, t / 10) for t in range(30)]
    assert max(abs(x) for x in w) > 0.5 and max(abs(x) for x in w) <= 10


def test_expression_sandbox():
    with pytest.raises(ValueError):
        evaluate({"value": 0, "expr": "__import__('os')"}, 0)
    with pytest.raises(ValueError):
        evaluate({"value": 0, "expr": "(lambda: 1)()"}, 0)


def test_speed_ramp_source_time():
    proj = P.new_project(duration=4)
    layer = {"id": "x", "start": 0.0, "end": 4.0, "source_in": 0.0,
             "speed": {"keyframes": [{"t": 0, "v": 2.0}, {"t": 4, "v": 2.0}]}}
    assert abs(P.source_time(layer, 2.0) - 4.0) < 1e-3
    layer["speed"] = 0.5
    assert abs(P.source_time(layer, 2.0) - 1.0) < 1e-9
    assert proj["comps"]["main"]["duration"] == 4


def test_every_effect_renders(gl):
    from afterglow.renderer import Env
    arr = (np.random.default_rng(0).random((72, 128, 4)) * 255).astype("uint8")
    up = gl.upload(arr)
    src = gl.copy(up)

    class Dummy:
        pass

    comp = {"fps": 30.0}
    for name, spec in effects.REGISTRY.items():
        p = {k: s.coerce(s.default) for k, s in spec.params.items()}
        env = Env(Dummy(), comp, {"start": 0.0, "effects": [{"type": name}]}, 0.5, 1.0, src.size, 0)
        env.input_at = lambda t: gl.copy(src)
        env.params_at = lambda t, p=p: p
        out = spec.render(gl, src, p, env)
        px = gl.read(out)
        assert px.shape == (72, 128, 4), name
        if out is not src:
            gl.release(out)


def test_full_comp_render_and_export(gl, tmp_path):
    from afterglow.export import render_video
    from afterglow.renderer import Renderer
    proj = P.new_project(320, 568, 24, 1.0)
    P.add_layer(proj, "main", "solid", {"color": "#204080"})
    P.add_layer(proj, "main", "shape", {"shape": {"kind": "star", "size": [200, 200], "fill": "#ffcc00"},
                                        "transform": {"rotation": {"keyframes": [{"t": 0, "v": 0}, {"t": 1, "v": 90}]}},
                                        "motion_blur": True})
    t = P.add_layer(proj, "main", "text", {"text": {"content": "HI", "size": 80,
                                                     "animate_in": {"preset": "pop", "unit": "char"}}})
    P.add_effect(proj, t, "glow", {"intensity": 1.5})
    adj = P.add_layer(proj, "main", "adjustment", {})
    from afterglow import presets
    presets.zoom_punch(proj, proj["comps"]["main"], adj, 0.3)
    r = Renderer(proj, gl)
    f = r.frame("main", 0.5, 1.0)
    assert f.shape == (568, 320, 3) and f.std() > 5
    res = render_video(proj, "main", str(tmp_path / "o.mp4"), renderer=r, scale=0.5)
    assert res["frames"] == 24 and os.path.getsize(res["path"]) > 1000


def test_transitions_and_split():
    proj = P.new_project(duration=4)
    a = P.add_layer(proj, "main", "solid", {"start": 0, "end": 2, "color": "#ff0000"})
    b = P.add_layer(proj, "main", "solid", {"start": 2, "end": 4, "color": "#0000ff"})
    from afterglow import presets
    for typ in presets.TRANSITIONS:
        presets.add_transition(proj, "main", a["id"], b["id"], typ, 0.4, cut=2.0)
    c = proj["comps"]["main"]
    second = P.split_layer(proj, c, b, 3.0)
    assert second["start"] == 3.0 and b["end"] == 3.0


def test_save_load_custom_effect(gl):
    effects.register_custom("test_tint", "vec4 fx(vec2 uv){ return T(uv) * u_k; }", {"k": {"default": 0.5}})
    proj = P.new_project()
    proj["custom_effects"]["test_tint"] = {"glsl": "vec4 fx(vec2 uv){ return T(uv) * u_k; }", "params": {"k": {"default": 0.5}}}
    d = tempfile.mkdtemp()
    P.save(proj, os.path.join(d, "p.json"))
    effects.REGISTRY.pop("test_tint")
    P.load(os.path.join(d, "p.json"))
    assert "test_tint" in effects.REGISTRY
