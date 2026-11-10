"""MCP server: exposes the Afterglow engine to an AI editor over stdio.

Run with `afterglow-mcp` (or `python -m afterglow.server`).
"""
from __future__ import annotations

import io
import json
from typing import Any, Optional

try:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP as MCPServer
    from mcp.server.fastmcp import Image as MCPImage
except ImportError:  # mcp 2.x
    from mcp.server.mcpserver import Image as MCPImage
    from mcp.server.mcpserver import MCPServer

from .engine import Engine

INSTRUCTIONS = """Afterglow is a GPU compositing and motion-graphics engine (layers, keyframes, easing, blend modes,
masks, mattes, precomps, 3D rotation, motion blur, ~85 effects, text animation, transitions, speed ramps, audio).
You drive it like a motion designer would drive a layer-based compositor.

Core model
- A project has comps. A comp has layers, listed top-first. Layer types: footage, image, solid, text, shape,
  adjustment (its effects hit everything beneath), comp (a nested comp), null (parent for other layers), audio.
- Every layer is drawn on a comp-sized canvas: masks → effects (in order) → transform → blend onto the stack.
- All times are seconds of comp time. Any numeric/colour property accepts a constant OR an animated value:
  {"keyframes":[{"t":1.0,"v":100,"ease":"easeOutExpo"},{"t":1.4,"v":130}]}, optionally with
  "wiggle":{"freq":12,"amp":20} and/or "expr":"value + sin(t*6)*10". `ease` shapes the segment starting at that key;
  it is an easing name, "hold", or a cubic-bezier [x1,y1,x2,y2].
- Property paths: "transform.position|scale|rotation|rotation_x|rotation_y|opacity|anchor", "speed", "volume",
  "time_remap", "color", "text.size", "shape.size", and "<effectId>.<param>" (e.g. "fx3.amount").
- Sizes/offsets are pixels at full comp resolution; points like `center` are normalised 0..1; rotation is degrees
  clockwise; opacity and scale are percent.

Replicating a reference edit (the main workflow)
1. analyze_reference(path) → pacing, cuts, bpm/beats, a timeline of detected moves (zooms, shakes, whips, flashes,
   RGB splits, blurs) and the colour grade.
2. LOOK at it: media_frames(path, ...) gives contact sheets. View the frames around each cut/effect one frame
   apart (count=0 means every frame) so you can see what the transition or effect really is.
3. motion_profile(path, start, end) gives frame-by-frame curves for one move, so you can copy its amount and easing.
   motion_copy can transplant the measured camera motion directly onto a layer.
4. Build: media_import → sequence_add (cut on detect_beats times of the user's song) → transition_add, hit_apply,
   effect_add + keyframes_set, look_apply, text layers.
5. Verify: preview_frame / preview_strip, and compare_frames against the reference. Iterate until it matches.
6. render_start → render_status.

Habits that make edits look professional
- Put hits (zoom_punch, shake_hit, flash, rgb_hit) exactly on beat/kick times, not near them.
- Use the `transform` and `shake` effects (edge=mirror, motion blur built in) for camera moves instead of the layer
  transform, so frame edges never show.
- Ease everything; linear motion looks amateur. easeOutExpo for snappy arrivals, easeInExpo/easeInCubic for exits.
- Use adjustment layers for global looks, grain, vignette and whole-frame hits.
- If no built-in effect matches what you see, write one with effect_register_custom (GLSL fragment shader).
- Preview at low scale while building (0.25–0.5) and check several frames of every transition before rendering.
- batch runs many tool calls in one request; use it for bulk edits."""

engine = Engine()
mcp = MCPServer("afterglow", instructions=INSTRUCTIONS)
TOOLS = {}


def _img(pil, quality=85, max_side=1800):
    if max(pil.size) > max_side:
        k = max_side / max(pil.size)
        pil = pil.resize((int(pil.width * k), int(pil.height * k)))
    buf = io.BytesIO()
    pil.convert("RGB").save(buf, format="JPEG", quality=quality)
    return MCPImage(data=buf.getvalue(), format="jpeg")


def _j(obj):
    return json.dumps(obj, separators=(",", ":"), default=lambda o: round(float(o), 5))


def tool(fn):
    TOOLS[fn.__name__] = fn
    return mcp.tool()(fn)


# ------------------------------------------------------------------ project

@tool
def project_new(name: str = "untitled", width: int = 1080, height: int = 1920, fps: float = 30.0, duration: float = 10.0) -> str:
    """Start a new project with one comp called "main". Default is vertical 1080x1920 at 30 fps (TikTok/Reels/Shorts).
    The project autosaves after every change to <workspace>/projects/<name>.json."""
    return _j(engine.project_new(name, width, height, fps, duration))


@tool
def project_open(path: str) -> str:
    """Open a saved project (.json). Relative paths resolve inside the workspace."""
    return _j(engine.project_open(path))


@tool
def project_save(path: Optional[str] = None) -> str:
    """Save the project, optionally to a new path."""
    return _j(engine.project_save(path))


@tool
def project_state(comp: Optional[str] = None, layer: Optional[str] = None, verbose: bool = False) -> str:
    """Inspect the project: media, comps and layers (top to bottom). Pass `layer` for one layer's full data including
    every keyframe, or verbose=true for full data on all layers."""
    return _j(engine.project_state(comp, layer, verbose))


@tool
def undo(steps: int = 1) -> str:
    """Undo the last change(s) to the project."""
    return _j(engine.undo(steps))


@tool
def system_info() -> str:
    """GPU/driver in use, workspace folder and effect count. Call once to confirm the GPU is being used."""
    return _j(engine.system_info())


# ------------------------------------------------------------------ media & comps

@tool
def media_import(paths: list[str]) -> str:
    """Import video, image or audio files. Returns a media id (m1, m2, ...) plus size, fps, duration for each.
    Use absolute paths, or paths relative to the workspace."""
    return _j(engine.media_import(paths))


@tool
def comp_create(id: str, width: int = 1080, height: int = 1920, fps: float = 30.0, duration: float = 10.0,
                background: Optional[list[float]] = None) -> str:
    """Create another comp. Add it to a different comp as a layer of type "comp" to use it as a precomp."""
    return _j(engine.comp_create(id, width, height, fps, duration, background))


@tool
def comp_update(props: dict[str, Any], comp: Optional[str] = None) -> str:
    """Change comp settings: width, height, fps, duration, background [r,g,b,a], motion_blur_samples (2-16),
    shutter_angle (degrees, 180 default), perspective (camera distance in px for 3D rotation)."""
    return _j(engine.comp_update(comp, props))


# ------------------------------------------------------------------ layers

@tool
def layer_add(type: str, props: Optional[dict[str, Any]] = None, comp: Optional[str] = None, index: int = 0) -> str:
    """Add a layer (index 0 = top of the stack). type: footage | image | solid | text | shape | adjustment | comp | null | audio.

    Common props: name, start, end or duration, blend (normal, add, screen, multiply, overlay, soft_light, ...),
      transform {position [x,y] or [x,y,z], scale (% or [x%,y%]), rotation, rotation_x, rotation_y, opacity (%), anchor},
      effects [{type, params}], masks [{kind: rect|ellipse|polygon|star, center, size, feather, invert, roundness}],
      matte {layer, mode: alpha|alpha_inverted|luma|luma_inverted}, parent (layer id), motion_blur (true),
      edge (none|mirror|repeat|clamp: what shows when the layer is moved/scaled off its canvas).
    footage/audio: source (media id) or path, source_in (s), speed (1 = normal, negative = reverse, keyframable for
      speed ramps), time_remap (keyframed source time), fit (cover|contain|stretch|none), loop, volume (1 = unity,
      keyframable), muted, frame_blend.
    image: source or path, fit.   solid: color.   comp: source (comp id).
    text: text {content, font, size, color, stroke_color, stroke_width, align, line_spacing, tracking, max_width,
      uppercase, offset, animate_in/animate_out {preset, unit: char|word|line|all, stagger, duration, ease, order},
      and for captions: words [{text,start,end}], page_words, highlight {color, scale}, word_in {preset, duration}}.
      Text is centred on transform.position.
    shape: shape {kind: rect|ellipse|polygon|star, size [w,h], fill, stroke, stroke_width, roundness, sides, inner, feather}.
    Any numeric or colour value can be animated (see server instructions)."""
    return _j(engine.layer_add(type, comp, props, index))


@tool
def layer_update(layer: str, props: dict[str, Any], comp: Optional[str] = None) -> str:
    """Change fields of a layer. Keys may be dotted paths, e.g. {"transform.scale": 120, "blend": "screen",
    "text.content": "NEW", "fx2.radius": 40, "enabled": false}. Setting only "start" moves the layer and its keyframes."""
    return _j(engine.layer_update(layer, props, comp))


@tool
def layer_remove(layers: list[str], comp: Optional[str] = None) -> str:
    """Delete layers by id."""
    return _j(engine.layer_remove(layers, comp))


@tool
def layer_duplicate(layer: str, comp: Optional[str] = None) -> str:
    """Duplicate a layer (the copy goes directly above the original)."""
    return _j(engine.layer_duplicate(layer, comp))


@tool
def layer_split(layer: str, time: float, comp: Optional[str] = None) -> str:
    """Cut a layer in two at a comp time; footage continues seamlessly in the second half."""
    return _j(engine.layer_split(layer, time, comp))


@tool
def layer_reorder(layer: str, index: int, comp: Optional[str] = None) -> str:
    """Move a layer to a new position in the stack (0 = top)."""
    return _j(engine.layer_reorder(layer, index, comp))


@tool
def sequence_add(clips: list[dict[str, Any]], comp: Optional[str] = None, start: float = 0.0,
                 cut_times: Optional[list[float]] = None, fit: str = "cover") -> str:
    """Lay clips back to back as footage layers: the fast way to build a cut.
    clips: [{"source": "m1" or "path": "...", "in": source start s, "duration": s, "speed": 1.0, ...layer props}].
    With cut_times (for example beat times from detect_beats) clip i runs from cut_times[i] to cut_times[i+1], so every
    cut lands on the music. The comp is extended if the sequence runs past its end."""
    return _j(engine.sequence_add(clips, comp, start, cut_times, fit))


# ------------------------------------------------------------------ animation

@tool
def keyframes_set(layer: str, path: str, keyframes: list[dict[str, Any]], comp: Optional[str] = None, mode: str = "merge") -> str:
    """Write keyframes on a property. keyframes: [{"t": seconds, "v": value, "ease": name | "hold" | [x1,y1,x2,y2]}].
    path examples: "transform.scale", "transform.position", "transform.opacity", "speed", "volume", "fx3.amount".
    mode "merge" adds to existing keys (same-time keys are replaced); "replace" clears the property first.
    Easing names: linear, easeIn/Out/InOut + Sine|Quad|Cubic|Quart|Quint|Expo|Circ|Back|Elastic|Bounce, snap, whip,
    overshoot, easyEase."""
    return _j(engine.keyframes_set(layer, path, keyframes, comp, mode))


@tool
def property_set(layer: str, path: str, value: Any, comp: Optional[str] = None) -> str:
    """Set one property to a constant or to an animated value object, e.g.
    {"value": [540, 960], "wiggle": {"freq": 8, "amp": 25}} or {"expr": "100 + pulse(t, 2.0, 0.03, 0.4) * 20"}.
    Expression names: t, value, lt (seconds since layer start), fps, sin cos abs min max floor clamp lerp smoothstep
    linear(x,x0,x1,v0,v1) pulse(t,at,attack,decay) noise(x) wiggle(freq,amp) ease(name,x)."""
    return _j(engine.property_set(layer, path, value, comp))


@tool
def property_sample(layer: str, path: str, times: list[float], comp: Optional[str] = None) -> str:
    """Evaluate an animated property at several times, to check a curve numerically without rendering."""
    return _j(engine.property_sample(layer, path, times, comp))


# ------------------------------------------------------------------ effects

@tool
def effect_catalog(category: Optional[str] = None, names: Optional[list[str]] = None) -> str:
    """List effects. No arguments: every effect with a one-line description, grouped by category
    (blur, light, color, distort, stylize, matte, generate, time, custom). Pass category or names for full parameter
    docs (types, defaults, ranges). Always check parameters here before effect_add."""
    return _j(engine.effect_catalog(category, names))


@tool
def effect_add(layer: str, type: str, params: Optional[dict[str, Any]] = None, comp: Optional[str] = None,
               index: Optional[int] = None) -> str:
    """Add an effect to a layer (effects run top to bottom; index inserts earlier in the stack). Any parameter can be a
    constant or animated value. Every effect also has `mix` (0-1). Returns the effect with its id (e.g. fx4)."""
    return _j(engine.effect_add(layer, type, params, comp, index))


@tool
def effect_update(layer: str, effect: str, params: Optional[dict[str, Any]] = None, comp: Optional[str] = None,
                  enabled: Optional[bool] = None, index: Optional[int] = None) -> str:
    """Change an effect's parameters, toggle it, or move it within the layer's effect stack."""
    return _j(engine.effect_update(layer, effect, params, comp, enabled, index))


@tool
def effect_remove(layer: str, effect: str, comp: Optional[str] = None) -> str:
    """Remove an effect from a layer."""
    return _j(engine.effect_remove(layer, effect, comp))


@tool
def effect_register_custom(name: str, glsl: str, params: Optional[dict[str, Any]] = None, description: str = "") -> str:
    """Create a brand-new effect from a GLSL fragment shader when nothing built-in matches the look you need.
    glsl must define `vec4 fx(vec2 uv)` returning premultiplied RGBA. uv is 0..1 with (0,0) at the TOP-left.
    Available: T(uv) samples the layer; tex_edge(u_tex, uv, mode) with mode 0 transparent/1 clamp/2 repeat/3 mirror;
    uniforms u_res (px), u_time (s), u_ltime, u_frame; helpers luma, unpre, pre, hash11/21/22, vnoise, fbm, noise1,
    rgb2hsv, hsv2rgb, rot2, PI, TAU. Each param becomes uniform u_<name>.
    params: {"amount": {"default": 1.0, "min": 0, "max": 5, "px": false, "desc": "..."}, "tint": {"default": "#ff0000"},
    "center": {"default": [0.5, 0.5]}} (float, int, bool, vec2, colour→vec4). px=true scales with preview resolution.
    The shader is compiled immediately; compile errors are returned with line numbers. Saved with the project."""
    return _j(engine.effect_register_custom(name, glsl, params, description))


# ------------------------------------------------------------------ presets

@tool
def preset_catalog() -> str:
    """List the ready-made building blocks: beat hits, colour looks, transitions, text animation presets and easings."""
    return _j(engine.preset_catalog())


@tool
def hit_apply(preset: str, layer: str, times: list[float], comp: Optional[str] = None,
              params: Optional[dict[str, Any]] = None) -> str:
    """Apply a beat-hit preset at each time (pass beat or kick times to sync to music). Presets: zoom_punch, shake_hit,
    flash, color_flash, rgb_hit, glow_pulse, blur_hit, zoom_blur_hit, bass_bump, glitch_hit, invert_hit, impact (zoom +
    shake + flash + rgb together), velocity (speed ramp: fast → slow-mo at the time → fast), push_in (slow zoom).
    params: amount, attack, decay in seconds (velocity: slow, fast, ramp, hold). Apply to an adjustment layer to hit
    the whole frame. Hits write normal keyframed effects that you can then fine-tune."""
    return _j(engine.hit_apply(preset, layer, times, comp, params))


@tool
def look_apply(look: str, layer: Optional[str] = None, comp: Optional[str] = None) -> str:
    """Apply a colour look (teal_orange, moody_dark, vintage_film, vhs_tape, dreamy, cyberpunk_neon, bw_contrast,
    anime_vivid, warm_golden, cold_blue, clean_pop). Without `layer`, a new adjustment layer is added on top so the look
    covers the whole comp. Looks are plain effect stacks; adjust them afterwards with effect_update."""
    return _j(engine.look_apply(look, layer, comp))


@tool
def transition_add(from_layer: str, to_layer: str, type: str = "whip_left", duration: float = 0.4,
                   comp: Optional[str] = None, cut: Optional[float] = None) -> str:
    """Build a transition between two clips where the second starts as the first ends. Types: whip_left/right/up/down,
    zoom_in, zoom_out, spin_cw, spin_ccw, flash, dip_black, blur, glitch, shake, rgb, dissolve, wipe_left/right/up/down,
    iris, clock, noise_dissolve. duration is the total length centred on the cut. Check it with
    preview_strip(start=cut-0.3, end=cut+0.3, count=0)."""
    return _j(engine.transition_add(from_layer, to_layer, type, duration, comp, cut))


# ------------------------------------------------------------------ preview & render

@tool
def preview_frame(time: float, comp: Optional[str] = None, scale: float = 0.5, solo: Optional[list[str]] = None):
    """Render one frame of the comp and return it as an image. scale 0.5 = half resolution. solo: only these layers."""
    return _img(engine.preview_frame(time, comp, scale, solo))


@tool
def preview_strip(times: Optional[list[float]] = None, start: Optional[float] = None, end: Optional[float] = None,
                  count: int = 8, comp: Optional[str] = None, scale: float = 0.25, columns: Optional[int] = None):
    """Render several frames as one labelled contact sheet: the way to judge motion, timing and transitions.
    Give explicit times, or start/end with count evenly spaced frames (count=0 → every frame in the range, max 48)."""
    return _img(engine.preview_strip(times, start, end, count, comp, scale, columns))


@tool
def render_start(output: Optional[str] = None, comp: Optional[str] = None, start: float = 0.0, end: Optional[float] = None,
                 scale: float = 1.0, quality: str = "high", codec: str = "libx264", audio: bool = True) -> str:
    """Start rendering the comp to an MP4 in the background (H.264 + AAC). quality: draft | medium | high | max.
    codec "h264_nvenc" uses NVIDIA hardware encoding. Output defaults to <workspace>/renders/. Returns a job id;
    poll render_status. Editing can continue while it renders (the render uses a snapshot)."""
    return _j(engine.render_start(output, comp, start, end, scale, quality, codec, audio))


@tool
def render_status(job: Optional[str] = None, wait: float = 20.0) -> str:
    """Progress of a render job (latest job by default). Waits up to `wait` seconds for it to finish before answering."""
    return _j(engine.render_status(job, wait))


@tool
def render_cancel(job: Optional[str] = None) -> str:
    """Cancel a running render."""
    return _j(engine.render_cancel(job))


# ------------------------------------------------------------------ reference analysis

@tool
def analyze_reference(path: str, start: float = 0.0, end: Optional[float] = None) -> str:
    """Measure a reference edit: cut times and shot lengths, bpm and whether cuts sit on beats, a timeline of detected
    moves (zoom_in/out, whip_pan, shake, spin, flash, rgb_split, blur) with amounts and easing shape, and the colour
    grade (shadow/midtone/highlight tints, black/white points). Start here when asked to copy a style, then look at
    the frames with media_frames."""
    return _j(engine.analyze_reference(path, start, end))


@tool
def detect_beats(path: str, start: float = 0.0, end: Optional[float] = None) -> str:
    """Analyse the audio of a video or audio file: bpm, beat times, strongest onsets, kick times, loudness curve and
    drops. Use the beat/kick times for cut_times and hit_apply."""
    return _j(engine.detect_beats(path, start, end))


@tool
def detect_cuts(path: str, start: float = 0.0, end: Optional[float] = None, sensitivity: float = 1.0) -> str:
    """Find shot boundaries and flash frames in a video. Raise sensitivity above 1 to catch subtler cuts."""
    return _j(engine.detect_cuts(path, start, end, sensitivity))


@tool
def motion_profile(path: str, start: float, end: float) -> str:
    """Frame-by-frame camera motion for a short range (max 6 s): per-frame pan (dx, dy), zoom_step, rot_step, cumulative
    values within each shot, brightness, sharpness and RGB split. Use it to copy the exact size and easing of one move."""
    return _j(engine.motion_profile(path, start, end))


@tool
def media_frames(path: str, times: Optional[list[float]] = None, start: Optional[float] = None, end: Optional[float] = None,
                 count: int = 8, columns: Optional[int] = None, cell_width: int = 270):
    """Look at a video or image file: returns a labelled contact sheet. Give explicit times, or start/end with count
    evenly spaced frames (count=0 → every frame in the range, max 60). Use small ranges around cuts and effects to see
    exactly what a reference does frame by frame."""
    return _img(engine.media_frames(path, times, start, end, count, columns, cell_width))


@tool
def compare_frames(reference: str, reference_time: float, time: float, comp: Optional[str] = None, scale: float = 0.5):
    """Side-by-side image: a reference video frame next to a frame of your comp. Use it to match grade, framing and
    effect strength."""
    return _img(engine.compare_frames(reference, reference_time, time, comp, scale))


@tool
def motion_copy(reference: str, ref_start: float, ref_end: float, layer: str, at: float, comp: Optional[str] = None,
                mode: str = "full", strength: float = 1.0) -> str:
    """Transplant the measured camera motion of a reference range (pan, zoom, rotation, per frame) onto a layer, starting
    at comp time `at`. mode "full" copies everything; "shake" keeps only the jitter. Writes a keyframed transform effect."""
    return _j(engine.motion_copy(reference, ref_start, ref_end, layer, at, comp, mode, strength))


@tool
def font_list(query: str = "") -> str:
    """List installed fonts (optionally filtered). Use the returned names in text.font. Drop extra .ttf/.otf files into
    <workspace>/fonts or set AFTERGLOW_FONTS to add more."""
    return _j(engine.font_list(query))


@tool
def batch(ops: list[dict[str, Any]]) -> str:
    """Run many tool calls in one request: ops = [{"tool": "layer_add", "args": {...}}, ...]. Stops at the first error
    and reports which op failed. Image-returning tools are not allowed here."""
    results = []
    for i, op in enumerate(ops):
        name = op.get("tool")
        if name not in TOOLS or name in ("batch", "preview_frame", "preview_strip", "media_frames", "compare_frames"):
            return _j({"completed": results, "failed_at": i, "error": f"tool {name!r} is not available in batch"})
        try:
            results.append({"tool": name, "result": json.loads(TOOLS[name](**(op.get("args") or {})))})
        except Exception as e:  # noqa: BLE001
            return _j({"completed": results, "failed_at": i, "tool": name, "error": f"{type(e).__name__}: {e}"})
    return _j({"completed": results})


def main():
    import os

    from .text import font_dirs  # noqa: F401
    from .engine import workspace
    os.makedirs(os.path.join(workspace(), "fonts"), exist_ok=True)
    os.environ.setdefault("AFTERGLOW_FONTS", os.path.join(workspace(), "fonts"))
    mcp.run()


if __name__ == "__main__":
    main()
