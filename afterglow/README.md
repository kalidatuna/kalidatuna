# Afterglow

A GPU compositing and motion-graphics engine you control through MCP. It gives Claude the layer-based tools an
After Effects editor works with: keyframes and easing, blend modes, masks, track mattes, precomps, 3D layer
rotation, motion blur, 84 GPU shader effects, text animation, transitions, speed ramps and audio. It also has
**reference analysis**, which measures what a TikTok edit actually does (cut timing, beat sync, zooms, shakes,
whips, flashes, RGB hits, blur types, colour grade) so Claude can rebuild the style instead of guessing.

The usual reason Claude can't copy an editing style is that it is editing blind, with code and no way to watch the
result. Afterglow fixes both sides:

* **Seeing.** `media_frames` turns any part of a reference into a frame-by-frame contact sheet,
  `analyze_reference` / `motion_profile` turn it into numbers, and `preview_strip` / `compare_frames` show Claude
  its own output next to the reference so it can iterate.
* **Doing.** It has a real compositor, so a "zoom punch with motion blur on the kick" is one call
  (`hit_apply zoom_punch times=[...]`) instead of a pile of ffmpeg filters. When nothing built in matches a look,
  Claude can write a new GLSL effect at runtime (`effect_register_custom`).

## Install (Windows)

1. Install **Python 3.11 or newer** from python.org, and tick "Add python.exe to PATH".
2. Update your GPU driver (NVIDIA / AMD / Intel). Afterglow needs OpenGL 3.3, which every GPU from the last ten
   years supports.
3. In PowerShell, from the folder that contains this README:

   ```bash
   pip install -e .
   ```

4. Check that it finds your GPU:

   ```bash
   afterglow info
   ```

   `GL_RENDERER` should name your graphics card. If it says `llvmpipe` or `Microsoft Basic Render`, the driver is
   missing and rendering will be slow.

FFmpeg does not need to be installed separately; PyAV ships its own.

## Connect it to Claude

**Claude Desktop.** Open Settings → Developer → Edit Config and add:

```json
{
  "mcpServers": {
    "afterglow": {
      "command": "afterglow-mcp",
      "env": { "AFTERGLOW_HOME": "C:\\Users\\YOU\\Videos\\Afterglow" }
    }
  }
}
```

If Claude Desktop can't find `afterglow-mcp`, put the full path instead. `where afterglow-mcp` prints it.
Restart Claude Desktop afterwards.

**Claude Code:**

```bash
claude mcp add afterglow -- afterglow-mcp
```

`AFTERGLOW_HOME` is the workspace folder. Projects are saved to `projects\`, renders to `renders\`, and any
`.ttf`/`.otf` you drop into `fonts\` can be used by name. If you leave it unset, it defaults to
`%USERPROFILE%\Afterglow`.

## How to use it

Talk to Claude normally. Give it full paths to your clips and to the reference video:

> Here's a reference edit `C:\refs\ref.mp4` and my clips in `C:\clips\`. Song is `C:\music\song.mp3`.
> Copy the style of the reference.

The server instructions tell Claude how to work. In short:

1. `analyze_reference`: pacing, cut list, BPM and how many cuts land on the beat, a timeline of detected moves
   with sizes and easing, and the grade.
2. `media_frames` around each cut and effect, one frame apart, so Claude can see what the transition really is.
3. `motion_profile` on single moves to copy their exact curve, or `motion_copy` to transplant the measured
   camera motion onto your footage.
4. Build it: `detect_beats` on your song, then `sequence_add` with `cut_times` on the beats, `transition_add`,
   `hit_apply` on kicks, `look_apply`, text layers and captions.
5. Check it with `preview_strip` and `compare_frames` against the reference, and iterate.
6. `render_start` writes an MP4 in the background. `codec: "h264_nvenc"` uses NVIDIA hardware encoding.

You can also drive it by hand: everything is in `afterglow/engine.py` as plain Python methods, and
`afterglow render project.json out.mp4` re-renders a saved project.

## What's in it

### Compositor

| | |
|---|---|
| Layers | footage, image, solid, text, shape, adjustment, nested comp (precomp), null (parenting), audio |
| Transform | position (with z), scale, rotation, X/Y rotation in 3D perspective, anchor, opacity, parenting |
| Motion blur | real multi-sample shutter on layer transforms and inside the `transform` / `shake` effects |
| Blend modes | all 22 After Effects-style modes: normal, add, screen, multiply, overlay, soft/hard/vivid/pin light, dodge, burn, difference, exclusion, subtract, divide, hue, saturation, color, luminosity… |
| Masks | rect / ellipse / polygon / star, feather, expansion, invert, animatable |
| Track mattes | alpha, alpha inverted, luma, luma inverted |
| Animation | keyframes on every property, 30+ easings plus cubic-bezier, hold keys, loop/ping-pong, wiggle, sandboxed expressions (`pulse`, `noise`, `linear`, …) |
| Time | speed (constant, reverse, keyframed ramps with frame blending), time remap, freeze, loop, layer split |
| Audio | follows speed and remap, keyframable volume, mixed into the MP4 |
| Text | any installed font, stroke, per-char/word/line animators (pop, slam, slide, drop, typewriter, flip…), timed word-by-word captions with an active-word highlight |

### Effects (84, all GPU shaders)

| Category | Effects |
|---|---|
| **blur** (7) | `bokeh_blur`, `directional_blur`, `gaussian_blur`, `sharpen`, `spin_blur`, `tilt_shift`, `zoom_blur` |
| **light** (8) | `diffusion`, `glint`, `glow`, `halation`, `lens_flare`, `light_leak`, `light_rays`, `light_sweep` |
| **color** (20) | `black_white`, `brightness_contrast`, `channel_mixer`, `color_balance`, `color_splash`, `curves`, `exposure`, `fade`, `gradient_map`, `hue_saturation`, `invert`, `levels`, `lut` (.cube), `posterize`, `split_tone`, `temperature`, `threshold`, `tint`, `vibrance`, `vignette` |
| **distort** (14) | `bulge`, `flip`, `kaleidoscope`, `lens_distort`, `mirror`, `ripple`, `shake`, `shockwave`, `slit_stretch`, `tile`, `transform`, `turbulent_displace`, `twirl`, `wave_warp` |
| **stylize** (17) | `cartoon`, `crt`, `dither`, `edge_detect`, `emboss`, `film_grain`, `glitch`, `halftone`, `letterbox`, `neon_edges`, `old_film`, `pixelate`, `rgb_split`, `scanlines`, `smear`, `strobe`, `vhs` |
| **matte** (8) | `alpha_levels`, `chroma_key`, `drop_shadow`, `fill`, `luma_key`, `round_corners`, `stroke`, `wipe` |
| **generate** (7) | `color_overlay`, `fractal_noise`, `gradient`, `grid`, `particles`, `speed_lines`, `stripes` |
| **time** (3) | `echo`, `motion_highlight`, `posterize_time` |

These are written from scratch. They cover the job of the BCC / Sapphire effects editors use most on short-form
content (Glow, Glint, Rays, Flare, LensFlare, Shake, RGB split / Chromatic Aberration, Glitch, VHS, Film Grain,
Halation, Directional/Zoom/Spin Blur, Light Leaks, Wipes), but they are not copies of those plugins and won't
match them pixel for pixel.

### Presets

* **Hits**, placed on beat times: `zoom_punch`, `shake_hit`, `flash`, `color_flash`, `rgb_hit`, `glow_pulse`,
  `blur_hit`, `zoom_blur_hit`, `bass_bump`, `glitch_hit`, `invert_hit`, `impact`, `velocity` (speed ramp),
  `push_in`.
* **Transitions**: whip left/right/up/down, zoom in/out, spin cw/ccw, flash, dip to black, blur, glitch, shake,
  rgb, dissolve, wipes, iris, clock, noise dissolve.
* **Looks**: teal_orange, moody_dark, vintage_film, vhs_tape, dreamy, cyberpunk_neon, bw_contrast, anime_vivid,
  warm_golden, cold_blue, clean_pop.

Presets only write ordinary effects and keyframes, so Claude can fine-tune anything they produce.

### Reference analysis

`analyze_reference` reports cuts (including cuts hidden inside whip and spin transitions), shot lengths, BPM, beat
and kick times, drops, the share of cuts on the beat, and a timeline of `zoom_punch`, `zoom_in/out`, `whip_pan`,
`shake`, `spin`, `flash`, `rgb_split` and `blur` events. Blur events are classified as horizontal, vertical,
radial (zoom) or rotational (spin). It also gives the grade: shadow/midtone/highlight tints and black/white points.

On a test edit with known contents (zoom punch, shake, whip-left transition, flash, RGB hit, spin transition)
it found every move with no false positives. Measured sizes run somewhat low, for example a 50 px shake reads
as about 33 px, so treat the numbers as starting points and confirm by looking at frames.

## Limits

* No AI rotoscoping, subject segmentation or motion tracking yet, so no "effect only on the person" or text that
  sticks to an object unless you provide a matte video. These would be the next big additions.
* No 3D camera or lights. Layers can rotate in perspective, but there is no scene camera to fly through.
* Speed ramps use frame blending, not optical flow, so very slow slow-motion on 30 fps footage will look steppy.
* `particles` is a lightweight procedural generator, not a full particle system like Trapcode Particular.
* Analysis is heuristic. It works best on clear camera moves and hard hits, and dissolves are not counted as
  cuts. Always check with `media_frames`.

## Development

```bash
pip install -e . pytest
python -m pytest tests
python tests/mcp_smoke.py path\to\any_video.mp4
```

`mcp_smoke.py` starts the real MCP server over stdio and drives an edit through it. On headless Linux, run both
under `xvfb-run`.

Layout: `props.py` (keyframes/easing/expressions), `gl.py` (GPU passes), `effects/` (the effect library),
`renderer.py` (compositor), `text.py`, `media.py` (decode/encode), `export.py`, `analysis.py`, `presets.py`,
`engine.py` (the API), `server.py` (MCP tools).
