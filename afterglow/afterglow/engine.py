"""Engine: the full editing API as plain Python methods.

The MCP server exposes these one-to-one; tests and scripts can call them directly.
All GPU work happens on one dedicated thread, so calls are safe from any thread.
"""
from __future__ import annotations

import copy
import os
import queue
import threading
import time
import traceback

import numpy as np
from PIL import Image

from . import analysis, effects, presets
from . import project as P
from .props import ease_names, evaluate, shift_keyframes
from .text import PRESETS as TEXT_PRESETS
from .text import list_fonts


def workspace():
    d = os.environ.get("AFTERGLOW_HOME") or os.path.join(os.path.expanduser("~"), "Afterglow")
    os.makedirs(d, exist_ok=True)
    return d


class RenderThread(threading.Thread):
    """Owns the GL context. Runs submitted calls, and advances export jobs in between."""

    def __init__(self):
        super().__init__(daemon=True, name="afterglow-render")
        self.q = queue.Queue()
        self.jobs = {}
        self.active = []
        self.start()

    def call(self, fn, *a, **k):
        box = {}
        done = threading.Event()
        self.q.put((fn, a, k, box, done))
        done.wait()
        if "err" in box:
            raise box["err"]
        return box.get("out")

    def run(self):
        while True:
            try:
                item = self.q.get(timeout=None if not self.active else 0.0)
            except queue.Empty:
                item = None
            if item is not None:
                fn, a, k, box, done = item
                try:
                    box["out"] = fn(*a, **k)
                except BaseException as e:  # noqa: BLE001 - hand every failure back to the caller
                    box["err"] = e
                done.set()
                continue
            job = self.active[0]
            try:
                if job["cancel"]:
                    job["iter"].close()
                    raise StopIteration({"cancelled": True, "path": job["path"]})
                job["done"], job["total"] = next(job["iter"])
            except StopIteration as stop:
                job["status"] = "cancelled" if job["cancel"] else "finished"
                job["result"] = stop.value
                job["ended"] = time.time()
                self.active.pop(0)
            except Exception as e:  # noqa: BLE001
                job["status"] = "failed"
                job["error"] = f"{e}\n{traceback.format_exc(limit=4)}"
                job["ended"] = time.time()
                self.active.pop(0)


class Engine:
    def __init__(self):
        self.project = P.new_project()
        self.path = None
        self.undo_stack = []
        self.thread = None
        self._renderer = None
        self._job_n = 0

    # ------------------------------------------------------------------ plumbing
    def _gpu(self, fn, *a, **k):
        if self.thread is None:
            self.thread = RenderThread()
        return self.thread.call(fn, *a, **k)

    def _r(self):
        """Renderer bound to the current project (call on the render thread only)."""
        from .renderer import Renderer
        if self._renderer is None:
            self._renderer = Renderer(self.project)
        elif self._renderer.project is not self.project:
            self._renderer.close()
            self._renderer.project = self.project
        return self._renderer

    def _resolve(self, path):
        path = os.path.expanduser(path)
        return path if os.path.isabs(path) else os.path.join(workspace(), path)

    def _mutate(self, fn):
        snap = copy.deepcopy(self.project)
        try:
            out = fn()
        except Exception:
            self.project = snap
            raise
        self.undo_stack.append(snap)
        del self.undo_stack[:-40]
        if self.path:
            P.save(self.project, self.path)
        return out

    def _layer(self, comp, layer):
        c = P.get_comp(self.project, comp)
        return c, P.find_layer(c, layer)

    # ------------------------------------------------------------------ project
    def project_new(self, name="untitled", width=1080, height=1920, fps=30.0, duration=10.0):
        self.project = P.new_project(width, height, fps, duration)
        self.path = os.path.join(workspace(), "projects", f"{name}.json")
        self.undo_stack.clear()
        P.save(self.project, self.path)
        return {"project_file": self.path, "comp": "main", "width": width, "height": height, "fps": fps, "duration": duration,
                "workspace": workspace()}

    def project_open(self, path):
        path = self._resolve(path)
        if not os.path.isfile(path) and os.path.isfile(os.path.join(workspace(), "projects", os.path.basename(path))):
            path = os.path.join(workspace(), "projects", os.path.basename(path))
        self.project = P.load(path)
        self.path = path
        self.undo_stack.clear()
        return dict(P.summarize(self.project), project_file=path)

    def project_save(self, path=None):
        if path:
            self.path = self._resolve(path)
        if not self.path:
            self.path = os.path.join(workspace(), "projects", "untitled.json")
        P.save(self.project, self.path)
        return {"saved": self.path}

    def project_state(self, comp=None, layer=None, verbose=False):
        if layer:
            _, l = self._layer(comp, layer)
            return l
        return dict(P.summarize(self.project, comp, verbose), project_file=self.path)

    def undo(self, steps=1):
        n = 0
        for _ in range(max(1, int(steps))):
            if not self.undo_stack:
                break
            self.project = self.undo_stack.pop()
            n += 1
        if self.path and n:
            P.save(self.project, self.path)
        return {"undone": n, "remaining": len(self.undo_stack)}

    # ------------------------------------------------------------------ media & comps
    def media_import(self, paths):
        if isinstance(paths, str):
            paths = [paths]

        def go():
            out = {}
            for p in paths:
                mid = P.add_media(self.project, self._resolve(p))
                out[mid] = {k: v for k, v in self.project["media"][mid].items() if k != "frames"}
            return out
        return self._mutate(go)

    def comp_create(self, id, width=1080, height=1920, fps=30.0, duration=10.0, background=None):
        self._mutate(lambda: P.add_comp(self.project, id, width, height, fps, duration, background))
        return {"comp": id}

    def comp_update(self, comp=None, props=None):
        c = P.get_comp(self.project, comp)
        allowed = {"width", "height", "fps", "duration", "background", "motion_blur_samples", "shutter_angle", "perspective"}
        bad = set(props or {}) - allowed
        if bad:
            raise KeyError(f"unknown comp settings {sorted(bad)}; allowed: {sorted(allowed)}")
        self._mutate(lambda: c.update(props or {}))
        return {k: v for k, v in c.items() if k != "layers"}

    # ------------------------------------------------------------------ layers
    def layer_add(self, type, comp=None, props=None, index=0):
        def go():
            p = dict(props or {})
            if p.get("path") and type in ("footage", "image", "audio"):
                p["source"] = P.add_media(self.project, self._resolve(p.pop("path")))
            return P.summarize_layer(P.add_layer(self.project, comp, type, p, index))
        return self._mutate(go)

    def layer_update(self, layer, props, comp=None):
        """Set layer fields. Keys may be dotted paths ('transform.scale', 'text.size', 'fx2.amount')."""
        c, l = self._layer(comp, layer)

        def go():
            for k, v in props.items():
                if k == "start" and "end" not in props and "duration" not in props:
                    P.move_layer(l, float(v))
                elif k == "duration":
                    l["end"] = float(props.get("start", l["start"])) + float(v)
                    if "start" in props:
                        l["start"] = float(props["start"])
                elif k in ("id", "type"):
                    raise ValueError(f"{k} cannot be changed")
                else:
                    P.set_prop(l, k, v)
            P.validate_layer(l)
            return P.summarize_layer(l, verbose=True)
        return self._mutate(go)

    def layer_remove(self, layers, comp=None):
        c = P.get_comp(self.project, comp)
        ids = [layers] if isinstance(layers, str) else list(layers)

        def go():
            for i in ids:
                c["layers"].remove(P.find_layer(c, i))
            return {"removed": ids}
        return self._mutate(go)

    def layer_duplicate(self, layer, comp=None):
        c, l = self._layer(comp, layer)
        return self._mutate(lambda: P.summarize_layer(P.duplicate_layer(self.project, c, l)))

    def layer_split(self, layer, time, comp=None):
        c, l = self._layer(comp, layer)
        return self._mutate(lambda: {"first": l["id"], "second": P.split_layer(self.project, c, l, float(time))["id"]})

    def layer_reorder(self, layer, index, comp=None):
        c, l = self._layer(comp, layer)

        def go():
            c["layers"].remove(l)
            c["layers"].insert(max(0, min(int(index), len(c["layers"]))), l)
            return {"order_top_to_bottom": [x["id"] for x in c["layers"]]}
        return self._mutate(go)

    def sequence_add(self, clips, comp=None, start=0.0, cut_times=None, fit="cover", index=0):
        """Lay clips end to end. clips: [{"source"|"path", "in": s, "duration": s, "speed": 1.0, ...}].
        With cut_times (e.g. beat times) clip i runs from cut_times[i] to cut_times[i+1]."""
        def go():
            t = float(cut_times[0]) if cut_times else float(start)
            made = []
            for i, c in enumerate(clips):
                c = dict(c)
                src = c.pop("source", None)
                if c.get("path"):
                    src = P.add_media(self.project, self._resolve(c.pop("path")))
                m = self.project["media"].get(src) or {}
                speed = c.pop("speed", 1.0)
                s_in = float(c.pop("in", c.pop("source_in", 0.0)))
                if cut_times and i + 1 < len(cut_times):
                    dur = float(cut_times[i + 1]) - t
                    c.pop("duration", None)
                else:
                    sp = abs(float(speed)) if not isinstance(speed, dict) else 1.0
                    dur = float(c.pop("duration", 0) or (max((m.get("duration") or 3.0) - s_in, 0.1) / (sp or 1.0)
                                                         if m.get("kind") != "image" else 3.0))
                if dur <= 0:
                    continue
                typ = "image" if m.get("kind") == "image" else "footage"
                props = dict(c, source=src, start=t, end=t + dur, fit=c.get("fit", fit))
                if typ == "footage":
                    props.update(source_in=s_in, speed=speed)
                l = P.add_layer(self.project, comp, typ, props, index)
                made.append({"id": l["id"], "start": round(t, 4), "end": round(t + dur, 4), "source": src})
                t += dur
            comp_d = P.get_comp(self.project, comp)
            if t > comp_d["duration"]:
                comp_d["duration"] = round(t, 4)
            return {"layers": made, "end": round(t, 4), "comp_duration": comp_d["duration"]}
        return self._mutate(go)

    # ------------------------------------------------------------------ animation
    def property_set(self, layer, path, value, comp=None):
        c, l = self._layer(comp, layer)

        def go():
            P.set_prop(l, path, value)
            P.validate_layer(l)
            return {"layer": l["id"], "path": path, "value": P.get_prop(l, path)}
        return self._mutate(go)

    def keyframes_set(self, layer, path, keyframes, comp=None, mode="merge"):
        c, l = self._layer(comp, layer)
        return self._mutate(lambda: {"layer": l["id"], "path": path, "property": P.set_keyframes(l, path, keyframes, mode)})

    def keyframes_shift(self, layer, seconds, comp=None, path=None):
        c, l = self._layer(comp, layer)

        def go():
            shift_keyframes(P.get_prop(l, path) if path else l, float(seconds))
            return {"shifted": seconds}
        return self._mutate(go)

    def property_sample(self, layer, path, times, comp=None):
        """Evaluate a property at several times, to check a curve without rendering."""
        c, l = self._layer(comp, layer)
        prop = P.get_prop(l, path)
        return {"values": [{"t": t, "v": evaluate(prop, float(t))} for t in times]}

    # ------------------------------------------------------------------ effects
    def effect_catalog(self, category=None, names=None):
        if names:
            missing = [n for n in names if n not in effects.REGISTRY]
            if missing:
                raise KeyError(f"unknown effects {missing}")
            return {"effects": [effects.REGISTRY[n].describe(True) for n in names]}
        if category:
            return {"effects": effects.catalog(category, full=True)}
        groups = {}
        for e in effects.catalog():
            groups.setdefault(e["category"], []).append(f"{e['name']}: {e['desc']}")
        return {"categories": groups, "hint": "call again with category=... or names=[...] to get parameter details"}

    def effect_add(self, layer, type, params=None, comp=None, index=None):
        c, l = self._layer(comp, layer)
        return self._mutate(lambda: P.add_effect(self.project, l, type, params, index))

    def effect_update(self, layer, effect, params=None, comp=None, enabled=None, index=None):
        c, l = self._layer(comp, layer)

        def go():
            fx = P.find_effect(l, effect)
            spec = effects.REGISTRY[fx["type"]]
            for k, v in (params or {}).items():
                if k not in spec.params:
                    raise KeyError(f"effect {fx['type']!r} has no param {k!r}; valid: {list(spec.params)}")
                fx["params"][k] = v
            if enabled is not None:
                fx["enabled"] = bool(enabled)
            if index is not None:
                l["effects"].remove(fx)
                l["effects"].insert(int(index), fx)
            P.validate_layer(l)
            return fx
        return self._mutate(go)

    def effect_remove(self, layer, effect, comp=None):
        c, l = self._layer(comp, layer)

        def go():
            l["effects"].remove(P.find_effect(l, effect))
            return {"effects": [f"{f['id']}:{f['type']}" for f in l["effects"]]}
        return self._mutate(go)

    def effect_register_custom(self, name, glsl, params=None, description=""):
        """Add a new GLSL effect to the registry and store it in the project."""
        if name in effects.REGISTRY and name not in self.project.get("custom_effects", {}):
            raise ValueError(f"{name!r} is a built-in effect name; choose another")

        def compile_check():
            spec = effects.register_custom(name, glsl, params, description)
            gl = self._r().gl
            src = gl.clear((64, 64), (0.5, 0.4, 0.3, 1.0))
            try:
                from .renderer import Env
                env = Env(self._r(), P.get_comp(self.project), None, 0.0, 1.0, (64, 64), 0)
                p = {k: s.coerce(s.default) for k, s in spec.params.items()}
                out = spec.render(gl, src, p, env)
                gl.release(out)
            finally:
                gl.release(src)
            return spec

        try:
            spec = self._gpu(compile_check)
        except Exception:
            effects.REGISTRY.pop(name, None)
            raise
        self._mutate(lambda: self.project.setdefault("custom_effects", {}).__setitem__(
            name, {"glsl": glsl, "params": params or {}, "desc": description}))
        return spec.describe(True)

    # ------------------------------------------------------------------ presets
    def preset_catalog(self):
        return {
            "hits": {k: (f.__doc__ or "").strip() for k, f in presets.HITS.items()},
            "hit_params": "amount, attack, decay (seconds); velocity: slow, fast, ramp, hold; color_flash: color, blend",
            "looks": {k: v[0] for k, v in presets.LOOKS.items()},
            "transitions": presets.TRANSITIONS,
            "text_animation_presets": list(TEXT_PRESETS),
            "easings": ease_names(),
        }

    def hit_apply(self, preset, layer, times, comp=None, params=None):
        """Apply a beat-hit preset at one or many times."""
        if preset not in presets.HITS:
            raise KeyError(f"unknown hit preset {preset!r}; presets: {list(presets.HITS)}")
        c, l = self._layer(comp, layer)
        ts = [times] if isinstance(times, (int, float)) else list(times)

        def go():
            ids = None
            for t in ts:
                ids = presets.HITS[preset](self.project, c, l, float(t), **(params or {}))
            return {"layer": l["id"], "preset": preset, "times": len(ts), "wrote": ids,
                    "effects": [f"{f['id']}:{f['type']}" for f in l["effects"]]}
        return self._mutate(go)

    def look_apply(self, look, layer=None, comp=None):
        """Apply a colour look to a layer, or to a new adjustment layer on top when no layer is given."""
        def go():
            if layer:
                l = P.find_layer(P.get_comp(self.project, comp), layer)
            else:
                l = P.add_layer(self.project, comp, "adjustment", {"name": f"look {look}"})
            return {"layer": l["id"], "effects": presets.apply_look(self.project, l, look)}
        return self._mutate(go)

    def transition_add(self, from_layer, to_layer, type="whip_left", duration=0.4, comp=None, cut=None):
        return self._mutate(lambda: presets.add_transition(self.project, comp, from_layer, to_layer, type, duration, cut))

    # ------------------------------------------------------------------ preview & render
    def preview_frame(self, time, comp=None, scale=0.5, solo=None):
        arr = self._gpu(lambda: self._r().frame(comp, float(time), float(scale), solo=set(solo) if solo else None))
        return Image.fromarray(arr)

    def preview_strip(self, times=None, start=None, end=None, count=8, comp=None, scale=0.25, columns=None):
        c = P.get_comp(self.project, comp)
        if not times:
            s = 0.0 if start is None else float(start)
            e = c["duration"] if end is None else float(end)
            fps = c["fps"]
            if count is None or count <= 0:
                count = int(round((e - s) * fps))
            count = max(1, min(int(count), 48))
            times = [s + (e - s) * i / max(count - 1, 1) for i in range(count)] if count > 1 else [s]
            times = [min(t, c["duration"] - 0.5 / fps) for t in times]
        frames = self._gpu(lambda: [self._r().frame(comp, float(t), float(scale)) for t in times])
        return analysis.contact_sheet(frames, [f"{t:.2f}s" for t in times], columns, cell_width=max(120, frames[0].shape[1]))

    def render_start(self, output=None, comp=None, start=0.0, end=None, scale=1.0, quality="high", codec="libx264", audio=True):
        from .export import render_iter
        if self.thread is None:
            self.thread = RenderThread()
        cid = comp or ("main" if "main" in self.project["comps"] else next(iter(self.project["comps"])))
        self._job_n += 1
        name = output or f"{os.path.splitext(os.path.basename(self.path or 'untitled'))[0]}_{cid}_{self._job_n}.mp4"
        path = self._resolve(name if os.path.isabs(os.path.expanduser(name)) else os.path.join("renders", name))
        crf = {"draft": 26, "medium": 21, "high": 17, "max": 13}.get(quality, 17)
        snap = copy.deepcopy(self.project)  # later edits don't disturb a running render

        def make():
            from .renderer import Renderer
            r = Renderer(snap, self._r().gl)
            return render_iter(snap, cid, path, start=float(start), end=end, scale=float(scale), crf=crf, codec=codec,
                               preset="veryfast" if quality == "draft" else "medium", audio=audio, renderer=r)

        job = {"id": f"job{self._job_n}", "status": "rendering", "path": path, "done": 0, "total": None, "cancel": False,
               "started": time.time(), "iter": self._gpu(make)}
        self.thread.jobs[job["id"]] = job
        self.thread.active.append(job)
        self.thread.q.put((lambda: None, (), {}, {}, threading.Event()))  # wake the loop
        return {"job": job["id"], "output": path, "status": "rendering", "hint": "poll render_status until finished"}

    def render_status(self, job=None, wait=0.0):
        if self.thread is None or not self.thread.jobs:
            return {"jobs": []}
        deadline = time.time() + min(float(wait), 50.0)
        j = self.thread.jobs.get(job) if job else list(self.thread.jobs.values())[-1]
        if j is None:
            raise KeyError(f"no job {job!r}; jobs: {list(self.thread.jobs)}")
        while j["status"] == "rendering" and time.time() < deadline:
            time.sleep(0.25)
        out = {"job": j["id"], "status": j["status"], "output": j["path"], "frames_done": j["done"], "frames_total": j["total"]}
        el = (j.get("ended") or time.time()) - j["started"]
        out["elapsed_s"] = round(el, 1)
        if j["status"] == "rendering" and j["done"] and j["total"]:
            out["eta_s"] = round(el / j["done"] * (j["total"] - j["done"]), 1)
        if j.get("result"):
            out["result"] = j["result"]
        if j.get("error"):
            out["error"] = j["error"]
        return out

    def render_cancel(self, job=None):
        if self.thread is None or not self.thread.jobs:
            return {"cancelled": None}
        j = self.thread.jobs.get(job) if job else list(self.thread.jobs.values())[-1]
        j["cancel"] = True
        return {"cancelled": j["id"]}

    # ------------------------------------------------------------------ reference analysis
    def analyze_reference(self, path, start=0.0, end=None):
        return analysis.analyze(self._resolve(path), float(start), end)

    def detect_beats(self, path, start=0.0, end=None):
        return analysis.detect_beats(self._resolve(path), float(start), end)

    def detect_cuts(self, path, start=0.0, end=None, sensitivity=1.0):
        return analysis.detect_cuts(self._resolve(path), float(start), end, float(sensitivity))

    def motion_profile(self, path, start, end):
        if float(end) - float(start) > 6.0:
            raise ValueError("keep motion_profile ranges under 6 seconds; analyse one move at a time")
        return analysis.motion_profile(self._resolve(path), float(start), float(end))

    def media_frames(self, path, times=None, start=None, end=None, count=8, columns=None, cell_width=270):
        """Contact sheet of a media file so the model can look at it."""
        path = self._resolve(path)
        info = __import__("afterglow.media", fromlist=["probe"]).probe(path)
        if not times:
            s = 0.0 if start is None else float(start)
            e = (info.get("duration") or 0.0) if end is None else float(end)
            fps = info.get("fps") or 30.0
            if count is None or count <= 0:
                count = int(round((e - s) * fps)) + 1
            count = max(1, min(int(count), 60))
            step = (e - s) / max(count - 1, 1)
            times = [s + step * i for i in range(count)]
            if end is None:
                times = [min(t, max(e - 1.0 / fps, 0.0)) for t in times]
        frames = analysis.media_frames(path, times, width=int(cell_width))
        return analysis.contact_sheet(frames, [f"{t:.2f}s" for t in times], columns, cell_width=int(cell_width))

    def compare_frames(self, reference, reference_time, time, comp=None, scale=0.5):
        ref = analysis.media_frames(self._resolve(reference), [float(reference_time)], width=540)[0]
        mine = self._gpu(lambda: self._r().frame(comp, float(time), float(scale)))
        return analysis.side_by_side(ref, mine, (f"reference {float(reference_time):.2f}s", f"comp {float(time):.2f}s"))

    def motion_copy(self, reference, ref_start, ref_end, layer, at, comp=None, mode="full", strength=1.0):
        """Copy measured camera motion (pan / zoom / rotation) from a reference clip onto a layer."""
        c, l = self._layer(comp, layer)
        st = analysis.frame_stats(self._resolve(reference), float(ref_start), float(ref_end))
        if len(st.get("t", [])) < 3:
            raise ValueError("not enough reference frames in that range")
        cuts, _ = analysis._cuts_from(st)
        n = len(st["t"])
        cx, cy, cz, cr = np.zeros(n), np.zeros(n), np.ones(n), np.zeros(n)
        for i in range(1, n):
            if i in cuts:
                continue
            cx[i], cy[i] = cx[i - 1] + st["tx"][i], cy[i - 1] + st["ty"][i]
            cz[i], cr[i] = cz[i - 1] * st["zoom"][i], cr[i - 1] + st["rot"][i]
        if mode == "shake":  # keep only the jitter: remove the slow drift
            k = max(3, int(round(len(cx) / 6)) | 1)
            sm = lambda a: np.convolve(np.pad(a, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
            cx, cy, cr = cx - sm(cx), cy - sm(cy), cr - sm(cr)
            cz = cz / sm(cz)
        s = float(strength)
        W, H = c["width"], c["height"]
        t0 = float(st["t"][0])

        def go():
            fx = presets._ensure(self.project, l, "transform", "motion_copy", {"edge": "mirror", "motion_blur": 1.0})
            tt = [round(float(at) + float(t) - t0, 4) for t in st["t"]]
            rng = (tt[0], tt[-1])
            P.set_keyframes(l, f"{fx['id']}.offset", [{"t": t, "v": [round(float(x) * W * s, 2), round(float(y) * H * s, 2)]}
                                                     for t, x, y in zip(tt, cx, cy)], clear_range=rng)
            P.set_keyframes(l, f"{fx['id']}.scale", [{"t": t, "v": round(100.0 * (1 + (float(z) - 1) * s), 3)}
                                                    for t, z in zip(tt, cz)], clear_range=rng)
            P.set_keyframes(l, f"{fx['id']}.rotation", [{"t": t, "v": round(float(r) * s, 3)} for t, r in zip(tt, cr)], clear_range=rng)
            return {"layer": l["id"], "effect": fx["id"], "keyframes": len(tt), "from": tt[0], "to": tt[-1],
                    "peak_offset_px": [round(float(np.abs(cx).max() * W * s), 1), round(float(np.abs(cy).max() * H * s), 1)],
                    "zoom_range": [round(float(cz.min()), 3), round(float(cz.max()), 3)]}
        return self._mutate(go)

    def font_list(self, query=""):
        names = list_fonts(query)
        return {"count": len(names), "fonts": names[:200]}

    def system_info(self):
        def info():
            return self._r().gl.info
        return {"gpu": self._gpu(info), "workspace": workspace(), "project_file": self.path,
                "effects": len(effects.REGISTRY)}
