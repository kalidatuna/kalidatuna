# AI Enhancer

An open-source desktop app for AI photo and video enhancement: upscaling, noise reduction, and face recovery. It covers the same jobs as Topaz Gigapixel, Photo AI, and Video AI, using openly published models. It also includes a tool that measures how close its output is to a Topaz export and finds the settings that match it best.

![Main window: before/after split view with the settings panel](docs/screenshot.jpg)

> **How this relates to Topaz.** This project contains no Topaz code, models, or files, and it does not modify or unlock Topaz software. Topaz's models are proprietary, so pixel-identical output is not possible. Instead, this app uses open models that do the same kinds of work. The `match` tool compares results against a Topaz export of the same image to find the closest settings.

## Features

| Topaz feature | Here | Open model behind it |
| --- | --- | --- |
| Gigapixel "Standard" with noise and blur controls | **Standard** model with a *Reduce noise* slider | Real-ESRGAN general v3. The slider interpolates the weights of the sharp and denoising variants. |
| Gigapixel "High Fidelity" | **High Fidelity** | SwinIR-L (real-world SR, GAN) |
| Gigapixel "Low Resolution" / "Recovery" | **Low Resolution / Heavy Recovery** | Real-ESRGAN x4plus |
| Gigapixel "Art & CG" | **Art & CG** | Real-ESRGAN x4plus anime 6B |
| — | **Social Media HD (best)**: re-compressed TikTok/Instagram footage of people | 4xRealWebPhoto v4 (DAT-2) |
| — | **Social Media (fast)** | 4xNomosWebPhoto (RealPLKSR) |
| Video AI "Proteus"-style fast upscaling | **Fast Video 2x** | 2xNomosUni SPAN (JPEG-trained) |
| — | **High Fidelity 2x** | SwinIR-M real-world x2 |
| Video AI anime | **Anime Video** | Real-ESRGAN anime video v3 |
| Compression artifact removal | **Clean up before upscaling → Remove compression** | FBCNN |
| Photo AI Denoise (Normal / Strong) | **Clean up before upscaling → Denoise / Denoise strong** | SCUNet (PSNR and GAN variants) |
| Face Recovery | **Face recovery** with strength (and fidelity for CodeFormer) | YuNet detector, then GFPGAN v1.4 or CodeFormer |
| Face detail (pores, lashes) | **Face detail** slider | 4xFaceUpSharpLDAT fine detail added on top of the recovered face; colours unchanged |
| "Recover original detail" | **Recover original detail** slider | Blends the Lanczos-resized original back in |
| Sharpen | **Sharpen** slider | Unsharp mask (not an AI deblur model) |
| Video AI upscaling | Video files in the same queue | Per-frame processing through FFmpeg; audio is kept |

App features:

- **Presets** for TikTok edits (balanced, low light, best quality, fast draft) and photos. Every built-in preset uses only models that allow commercial use.
- A queue for images, folders, and videos, with drag and drop.
- A before/after viewer with split, side-by-side, before-only and after-only modes, wheel zoom, and drag to pan.
- **Live preview** of the visible area. It reruns automatically when settings change. Detail, sharpen, and face settings reuse the cached AI result, so they update almost instantly.
- **Reference comparison.** Load a Topaz export of the same image, compare it side by side, score it, and run *Match settings to reference*.
- Any output scale from 0.25x to 16x, or an exact size in pixels. Above the model's native scale, it runs a second AI pass.
- Keeps 16-bit depth, alpha channels, EXIF orientation, ICC profiles, and EXIF metadata.
- Tiled processing with blended seams, so large images fit in limited GPU or CPU memory.
- Runs on NVIDIA CUDA, Apple Metal (MPS), or CPU. Half precision is used on CUDA where the model supports it.
- Saves and loads presets as JSON. The GUI and CLI share the same format.

## Install

Requires Python 3.10 or later. FFmpeg is only needed for video.

```bash
cd tools/ai-enhancer
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
# NVIDIA GPU: install the CUDA build of PyTorch first, from https://pytorch.org/get-started/locally/
pip install -e .
```

Models download automatically on first use, from each project's official release page. Each download is checked against a pinned SHA-256 hash. Files are stored in `~/.cache/ai-enhancer/models` (Windows: `%LOCALAPPDATA%\ai-enhancer\models`); set `ENHANCER_MODEL_DIR` to use a different folder. To download everything in advance (about 1.7 GB):

```bash
ai-enhancer models --download all
```

## Use the app

```bash
ai-enhancer            # or: ai-enhancer-gui, or: python -m enhancer
```

1. Drop images or videos onto the window, or use **Add files** or **Add folder**.
2. Pick an **AI model** and an **output size**. The preview updates for the area you are looking at; zoom in and pan to check other areas.
3. Adjust *Reduce noise*, *Recover original detail*, *Sharpen*, and *Face recovery*. Drag the white divider to compare.
4. Choose the format and folder under **Export**, then click **Export** (all files) or **Export selected**.

## TikTok edits

Downloaded TikTok clips are small and heavily compressed. The **TikTok edit** presets first reduce the compression blocks (FBCNN), then upscale 2x with a model trained on re-compressed web footage, then recover faces with GFPGAN at medium strength. A 1080x1920 clip comes out at 2160x3840 (4K vertical).

| Preset | Upscaler | Use it for |
| --- | --- | --- |
| TikTok edit: balanced (recommended) | Social Media (fast) | Most clips. Re-creates hair, fur and fabric texture; light film grain |
| TikTok edit: low light | Social Media (fast) | Dark clips. More grain, slightly softer face recovery so the face matches the background |
| TikTok edit: best quality | Social Media HD | Stills and very short clips; the most natural texture, but slow |
| TikTok edit: fast draft | Fast Video 2x | Checking timing and framing only. About 11x faster, but hair and backgrounds look smooth and "painted" |

**Why backgrounds can look "painted".** TikTok's compression removes most fine detail, especially in dark areas, so no model can bring back the original hair or fur. It has to re-create believable texture. In a side-by-side test on dark, compressed fur, Social Media HD and Social Media (fast) re-created strand texture, while Fast Video 2x and Anime Video produced smooth paint-like areas. GFPGAN rebuilds faces in much more detail than any upscaler does for the rest of the frame. Keeping face strength around 0.5 and adding a little **film grain** makes the face and background look like they belong to the same shot. Grain is stronger in shadows, changes every frame like real film grain, and also hides banding in dark gradients.

Anime Video is for cartoons only: it flattens real-world texture.

For **Alight Motion**, export as H.264 or H.265. For **After Effects**, ProRes 422 HQ keeps the most quality for further editing. On an NVIDIA card, choose *H.264/H.265, NVIDIA GPU encoder* (NVENC): encoding then runs on the GPU. If NVENC is not available, the app falls back to the software encoder and says so. During video export the status bar shows frames per second and the time left.

On GPUs without fast bfloat16 support (NVIDIA GTX/RTX 20-series and older), the Social Media models run in full precision; the other models use half precision on any NVIDIA GPU.

## Command line

```bash
# Upscale 4x with face recovery
ai-enhancer enhance photo.jpg --scale 4 --face gfpgan -o out/

# A whole folder to an exact width, as 16-bit TIFF
ai-enhancer enhance scans/ --model high-fidelity --width 6000 --format tiff -o out/

# Denoise first, then upscale 2x with some original detail kept
ai-enhancer enhance noisy.png --denoise strong --model standard-2x --scale 2 --recover 0.2

# Video: 2x upscale to H.265, audio kept
ai-enhancer enhance clip.mp4 --scale 2 --codec h265 --crf 18 -o out/

# A TikTok clip with the built-in preset, encoded on an NVIDIA GPU for Alight Motion
ai-enhancer enhance clip.mp4 --preset tiktok-fast --codec hevc_nvenc -o out/

# Try the settings on the first 3 seconds only
ai-enhancer enhance clip.mp4 --preset tiktok-balanced --test-seconds 3 -o out/

# Use a saved preset, overriding one value
ai-enhancer enhance photo.jpg --preset best.json --sharpen 0.1
```

Run `ai-enhancer enhance --help` to see every option.

## Matching Topaz output

The models differ, so matching works by measurement:

1. Export one representative image from Topaz, for example at 4x.
2. Run the search on the original and the Topaz export:

   ```bash
   ai-enhancer match original.jpg original-topaz-4x.jpg --save-preset topaz-like.json
   ```

   This tries every model and noise level on a region of the image (the largest face, if there is one). It then fine-tunes detail, sharpening, and face strength. Results are ranked by SSIM, PSNR, and colour difference against the Topaz export.
3. Process your other images with that preset: `ai-enhancer enhance photos/ --preset topaz-like.json`.

In the GUI, the same steps are under **Reference → Load reference image** and **Reference → Match settings to reference**. Setting *Compare with reference* puts the Topaz export on the left of the divider.

To score any two images directly:

```bash
ai-enhancer compare ours.png topaz.png --diff difference.png
```

In testing, `match` recovered hidden settings exactly: model, *Recover* 0.2 and *Sharpen* 0.3, from a reference made with this tool. Against a real Topaz export, expect a close match, not an identical one.

## Speed

What the app does to keep video exports fast:

- **Everything stays on the GPU.** Tiling, blending, detail recovery, sharpening, and face pasting run on the graphics card. Frames are converted to 8-bit on the GPU before they are copied back.
- **Automatic tile size.** With *Tile size: Auto* (the default), the app processes each frame in one piece when it fits in GPU memory. After an out-of-memory error it tries smaller tiles and remembers the size that worked.
- **Half precision (fp16)** on NVIDIA GPUs for every model that stays accurate in it. Social Media (fast) was checked against full precision (at most 1.6/255 apart). Social Media HD gives NaN in fp16, so it stays in fp32. If any model ever produces NaN in fp16, that frame is redone in fp32 and the model stays in fp32.
- **Parallel stages.** Decoding, AI processing, and encoding run in separate threads, so the GPU does not wait for FFmpeg.
- **Repeated frames are reused.** Frames with no visible change from the last processed frame reuse its result. The check works on 16x16 blocks, so a blink still counts as motion. It is strict: in a heavily compressed test clip it caught about half of the true repeats and none of the real motion. You can turn it off under *Export*.
- **Test 3 s** exports only the first 3 seconds of the selected video, so you can check the look and the time before a full export.
- Picking a slow model for a video shows a warning that suggests a faster preset. The status bar shows whether the AI runs on the GPU or the CPU.

Measured on a 4-core CPU (no GPU), for one 270x480 frame:

| Preset | Before these changes | Now |
| --- | --- | --- |
| TikTok edit: fast draft | 6.5 s | 4.5 s |
| TikTok edit: balanced | 23.9 s | 10.2 s |

The output stayed visually identical: 62 dB and 45 dB PSNR against the old version. GPU timings have not been measured yet. If you run out of GPU memory, set a fixed **Tile size** under *Performance*.

Relative cost of the TikTok presets on the same frame: *best* is about 23 times slower than *fast draft*, and *balanced* about 4 times. Use *balanced* for final exports and *fast draft* only to check timing and framing.

## Limitations

- Results are close to Topaz but not identical: the models are different.
- Video is processed frame by frame. GAN models can flicker slightly between frames, and there is no temporal model or frame interpolation (slow motion / FPS conversion) yet.
- Sharpening is a classic unsharp mask, not an AI motion or lens-blur model.
- Face recovery works on faces the detector finds (frontal or near-frontal, roughly 20 px wide or larger in the source).

## Models and licenses

The code in this folder is MIT-licensed. Each model has its own license:

| Model | Source | License |
| --- | --- | --- |
| Real-ESRGAN (general v3, x4plus, x2plus, anime 6B) | [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | BSD-3-Clause |
| SwinIR-L real-world SR | [JingyunLiang/SwinIR](https://github.com/JingyunLiang/SwinIR) | Apache-2.0 |
| SCUNet | [cszn/SCUNet](https://github.com/cszn/SCUNet) | Apache-2.0 |
| GFPGAN v1.4 | [TencentARC/GFPGAN](https://github.com/TencentARC/GFPGAN) | Apache-2.0 |
| CodeFormer | [sczhou/CodeFormer](https://github.com/sczhou/CodeFormer) | S-Lab License 1.0, **non-commercial use only** |
| 4xRealWebPhoto v4, 4xNomosWebPhoto, 2xNomosUni SPAN | [Phhofm/models](https://github.com/Phhofm/models) by Philip Hofmann | CC-BY-4.0 (credit required) |
| SwinIR-M real-world x2 | [JingyunLiang/SwinIR](https://github.com/JingyunLiang/SwinIR) | Apache-2.0 |
| Real-ESRGAN anime video v3 | [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | BSD-3-Clause |
| FBCNN | [jiaxi-jiang/FBCNN](https://github.com/jiaxi-jiang/FBCNN) | Apache-2.0 |
| YuNet face detector | [opencv/opencv_zoo](https://github.com/opencv/opencv_zoo) | MIT |

Models are loaded with [spandrel](https://github.com/chaiNNer-org/spandrel).

**Commercial use.** CodeFormer is hidden unless you turn on *Help → Show non-commercial models*; every other model allows commercial use. The CC-BY-4.0 models require credit to their author. *Help → About* lists the credits for every model, so keep that (or an equivalent credits page) in anything you distribute. This is a summary, not legal advice: check each license before you sell or distribute the app.

## Development

```bash
pip install -e ".[dev]"
pytest              # 44 tests, offline; a fake model stands in for real checkpoints
pyflakes enhancer tests
```

GUI tests run headless (`QT_QPA_PLATFORM=offscreen`). On a minimal Linux system they need `libegl1`, and they are skipped if Qt cannot start.

| Module | Role |
| --- | --- |
| `enhancer/models.py` | Model registry, verified downloads, loading, weight interpolation |
| `enhancer/tiling.py` | Tiled inference on the GPU with blended seams, automatic tile size, fp16 NaN guard |
| `enhancer/pipeline.py` | Clean-up, upscale, recover detail, faces, sharpen; cached region preview |
| `enhancer/presets.py` | Built-in presets (TikTok edits incl. low light, photo) |
| `enhancer/faces.py` | Face detection, FFHQ alignment, restoration, feathered paste-back |
| `enhancer/video.py` | Threaded FFmpeg decode/encode, repeated-frame reuse, NVENC with fallback, audio passthrough, ETA |
| `enhancer/compare.py` | SSIM, PSNR, ΔE, and the settings search |
| `enhancer/gui/` | PySide6 app: main window, viewer, settings panel, background jobs |
