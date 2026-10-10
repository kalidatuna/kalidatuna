import json
import shutil

import cv2
import numpy as np
import pytest
import torch

from enhancer import compare, models
from enhancer.batch import OutputOptions, output_path
from enhancer.cli import main
from enhancer.faces import FACE_SIZE, FFHQ_TEMPLATE_512, crop_face, paste_all
from enhancer.imageio import from_array, load_image, save_image
from enhancer.pipeline import Pipeline, Settings
from enhancer.tiling import Cancelled, run_model


def nearest4(tile):
    return np.repeat(np.repeat(tile, 4, axis=0), 4, axis=1)


@pytest.mark.parametrize("tile,overlap", [(16, 4), (20, 8), (64, 0), (7, 3)])
def test_tiling_matches_untiled(gradient, tile, overlap):
    full = run_model(nearest4, gradient, 4, tile=0)
    tiled = run_model(nearest4, gradient, 4, tile=tile, overlap=overlap)
    assert tiled.shape == (48 * 4, 64 * 4, 3)
    np.testing.assert_allclose(tiled, full, atol=1e-6)


def test_tiling_reports_progress_and_cancels(gradient):
    seen = []
    run_model(nearest4, gradient, 4, tile=16, overlap=4, progress=lambda d, t: seen.append((d, t)))
    assert seen[-1][0] == seen[-1][1] > 1
    with pytest.raises(Cancelled):
        run_model(nearest4, gradient, 4, tile=16, overlap=4, cancel=lambda: True)


def test_output_size():
    assert Settings(scale=2).output_size(100, 50) == (200, 100)
    assert Settings(width=300).output_size(100, 50) == (300, 150)
    assert Settings(height=25).output_size(100, 50) == (50, 25)
    assert Settings(width=10, height=20).output_size(100, 50) == (10, 20)


def test_settings_roundtrip_ignores_unknown_keys():
    s = Settings(model="art-cg", sharpen=0.4)
    d = s.to_dict() | {"unknown": 1}
    assert Settings.from_dict(d) == s


@pytest.mark.parametrize("scale,passes", [(1, 1), (2, 1), (4, 1), (6, 2), (16, 2)])
def test_passes_needed(fake_pipeline, scale, passes):
    assert fake_pipeline.passes_needed(Settings(model="standard", scale=scale), 10, 10) == passes


def test_pipeline_sizes_and_alpha(fake_pipeline, gradient):
    alpha = np.full(gradient.shape[:2], 0.5, np.float32)
    for scale in (1, 2.5, 6):
        out, a = fake_pipeline.process(gradient, Settings(scale=scale, tile=16), alpha=alpha)
        w, h = Settings(scale=scale).output_size(64, 48)
        assert out.shape == (h, w, 3) and a.shape == (h, w)
        assert out.dtype == np.float32 and 0 <= out.min() and out.max() <= 1


def test_recover_detail_blends_towards_resized_original(fake_pipeline, gradient):
    from enhancer.pipeline import resize, to_numpy, to_tensor

    s = Settings(scale=4, recover_detail=1.0)
    out, _ = fake_pipeline.process(gradient, s)
    expected = np.clip(to_numpy(resize(to_tensor(gradient, "cpu"), 256, 192)), 0, 1)
    np.testing.assert_allclose(out, expected, atol=1e-5)


def test_preview_patch_matches_full_render(fake_pipeline, gradient):
    s = Settings(scale=4, tile=0, prescale=1.0)
    full, _ = fake_pipeline.process(gradient, s)
    cache = {}
    patch, (x, y, w, h) = fake_pipeline.preview(gradient, s, (10, 8, 20, 16), cache=cache)
    assert (x, y, w, h) == (40, 32, 80, 64)
    np.testing.assert_allclose(patch, full[y:y + h, x:x + w], atol=1e-6)
    # A post-processing change reuses the cached AI result.
    assert len(cache) == 1
    fake_pipeline.preview(gradient, Settings(scale=4, tile=0, sharpen=0.5, prescale=1.0), (10, 8, 20, 16), cache=cache)
    assert len(cache) == 1
    # With a soft-source shrink, the crop is resampled on a slightly different grid: close, not identical.
    s2 = Settings(scale=4, tile=0, prescale=0.5)
    full2, _ = fake_pipeline.process(gradient, s2)
    patch2, (x, y, w, h) = fake_pipeline.preview(gradient, s2, (10, 8, 20, 16))
    assert np.abs(patch2 - full2[y:y + h, x:x + w]).max() < 2 / 255


def test_face_crop_and_paste_roundtrip():
    rng = np.random.default_rng(0)
    img = cv2.GaussianBlur(rng.random((300, 300, 3)).astype(np.float32), (0, 0), 3)
    # Landmarks: the template scaled by 0.4 and shifted, so the face is about 200 px wide.
    lms = FFHQ_TEMPLATE_512 * 0.4 + np.array([40, 30], np.float32)
    crop, m = crop_face(img, lms)
    assert crop.shape == (FACE_SIZE, FACE_SIZE, 3)
    np.testing.assert_allclose(m[:, :2], np.eye(2) / 0.4, atol=1e-3)
    # Pasting the unmodified crop back into a 2x upscale leaves it nearly unchanged.
    up = torch.from_numpy(cv2.resize(img, (600, 600), interpolation=cv2.INTER_LINEAR).transpose(2, 0, 1))[None]
    crop_t = torch.from_numpy(crop.transpose(2, 0, 1).copy())[None]
    out = paste_all(up.clone(), img.shape, [(crop_t, m)], strength=1.0)
    assert (out - up).abs().mean() < 0.01
    # Only the face's bounding box changes; the far corner is untouched.
    blank = paste_all(torch.zeros_like(up), img.shape, [(torch.ones_like(crop_t), m)], strength=1.0)
    assert blank[..., 590:, 590:].abs().max() == 0 and blank[..., 300, 300].min() > 0.99


def test_image_io_roundtrip(tmp_path):
    rng = np.random.default_rng(1)
    rgb = rng.random((20, 30, 3)).astype(np.float32)
    alpha = rng.random((20, 30)).astype(np.float32)
    p16 = save_image(tmp_path / "a.png", rgb, alpha, fmt="png", bits=16)
    li = load_image(p16)
    assert li.bits == 16 and li.alpha is not None
    np.testing.assert_allclose(li.rgb, rgb, atol=1 / 65535 + 1e-6)
    np.testing.assert_allclose(li.alpha, alpha, atol=1 / 65535 + 1e-6)
    p8 = save_image(tmp_path / "b.jpg", rgb, fmt="jpeg", quality=100)
    li8 = load_image(p8)
    assert li8.bits == 8 and li8.alpha is None and li8.size == (30, 20)


def test_exif_orientation_is_applied(tmp_path):
    from PIL import Image

    arr = np.zeros((10, 20, 3), np.uint8)
    arr[:, :5] = 255  # white band on the left
    img = Image.fromarray(arr)
    exif = img.getexif()
    exif[0x0112] = 6  # rotate 90 degrees clockwise for display
    img.save(tmp_path / "r.jpg", exif=exif, quality=100)
    li = load_image(tmp_path / "r.jpg")
    assert li.size == (10, 20)
    assert li.rgb[:5].mean() > 0.9  # the band is now at the top


def test_grayscale_input_becomes_rgb():
    li = from_array(np.full((4, 5), 128, np.uint8))
    assert li.rgb.shape == (4, 5, 3)


def test_metrics_identical_and_different(gradient):
    m = compare.metrics(gradient, gradient)
    assert m["ssim"] == pytest.approx(1.0) and m["psnr"] == float("inf") and m["delta_e"] == 0
    noisy = np.clip(gradient + 0.05 * np.random.default_rng(2).standard_normal(gradient.shape), 0, 1)
    m2 = compare.metrics(noisy.astype(np.float32), gradient)
    assert m2["ssim"] < 0.99 and m2["psnr"] < 40


def test_match_recovers_hidden_settings(fake_pipeline, monkeypatch):
    monkeypatch.setattr(Pipeline, "detector", lambda self: type("D", (), {"detect": lambda _, img: []})())
    rng = np.random.default_rng(3)
    src = cv2.GaussianBlur(rng.random((40, 40, 3)).astype(np.float32), (0, 0), 1.5)
    hidden = Settings(model="art-cg", scale=4, recover_detail=0.3, sharpen=0.2, tile=0)
    ref, _ = fake_pipeline.process(src, hidden)
    results = compare.match(src, ref, fake_pipeline, crop=40, quick=True)
    assert len({json.dumps(r.settings.to_dict(), sort_keys=True) for r in results}) == len(results)
    best = results[0]
    # Recover and sharpen partly cancel out, so check the result, not the exact values.
    assert best.scores["psnr"] > 50
    assert best.settings.recover_detail == pytest.approx(0.3, abs=0.1)
    assert best.settings.scale == 4
    out, _ = fake_pipeline.process(src, best.settings)
    assert compare.psnr(out, ref) > 50


def test_output_path_naming(tmp_path):
    src = tmp_path / "photo.jpeg"
    p = output_path(src, Settings(model="standard"), OutputOptions(fmt="png"), (200, 100))
    assert p.name == "photo-enhanced-standard-200x100.png"
    p.write_bytes(b"x")
    p2 = output_path(src, Settings(model="standard"), OutputOptions(fmt="png"), (200, 100))
    assert p2.name == "photo-enhanced-standard-200x100-1.png"
    assert output_path(src, Settings(), OutputOptions(fmt="same"), (1, 1)).suffix == ".jpeg"
    clip = tmp_path / "my.clip.mp4"
    assert output_path(clip, Settings(model="video-2x"), OutputOptions(), (2, 4), "-test0.5s").name == \
        "my.clip-enhanced-video-2x-2x4-test0.5s.mp4"


def test_cli_enhance_and_preset(fake_pipeline, tmp_path, capsys):
    src = save_image(tmp_path / "in.png", np.random.default_rng(4).random((16, 12, 3)).astype(np.float32))
    preset = tmp_path / "p.json"
    preset.write_text(json.dumps({"model": "art-cg", "scale": 3}))
    assert main(["enhance", str(src), "-o", str(tmp_path / "out"), "--preset", str(preset), "--sharpen", "0.1"]) == 0
    out = capsys.readouterr().out.strip()
    assert out.endswith("in-enhanced-art-cg-36x48.png")
    assert load_image(out).size == (36, 48)


def test_presets_and_licenses():
    from enhancer.presets import PRESETS, apply

    for key, (_, values) in PRESETS.items():
        s = apply(Settings(device="cuda", tile=512), key)
        assert s.model in models.UPSCALERS and (s.device, s.tile) == ("cuda", 512)
        files = models.UPSCALERS[s.model].files
        if s.denoise_model:
            files += (models.DENOISERS[s.denoise_model][1],)
        if s.face_model:
            files += (models.FACE_MODELS[s.face_model][1],)
        assert models.is_commercial(files), key  # every built-in preset is safe for commercial use
    assert not models.is_commercial(("CodeFormer",))
    assert any("Philip Hofmann" in c for c in models.credits())


def test_cli_accepts_builtin_preset(fake_pipeline, tmp_path, capsys):
    src = save_image(tmp_path / "in.png", np.random.default_rng(5).random((16, 12, 3)).astype(np.float32))
    assert main(["enhance", str(src), "-o", str(tmp_path), "--preset", "tiktok-fast", "--face", ""]) == 0
    assert capsys.readouterr().out.strip().endswith("in-enhanced-video-2x-24x32.png")


def test_video_codec_fallback(monkeypatch):
    from enhancer import video

    monkeypatch.setattr(video, "encoder_works", lambda codec: False)
    assert video.resolve_codec("hevc_nvenc") == "h265"
    assert video.resolve_codec("prores") == "prores"
    assert video.quality_args("h264_nvenc", 18) == ["-cq", "18"]
    assert video.format_eta(3725) == "1h 02m" and video.format_eta(75) == "1m 15s"


def test_registry_is_consistent():
    for up in models.UPSCALERS.values():
        assert all(f in models.FILES for f in up.files)
        assert len(up.files) == (2 if up.denoise_blend else 1)
    for _, key in list(models.DENOISERS.values()) + list(models.FACE_MODELS.values()):
        assert key in models.FILES
    for f in models.FILES.values():
        assert len(f.sha256) == 64 and f.url.startswith("https://")


def test_auto_tile_falls_back_after_out_of_memory(monkeypatch):
    from enhancer import tiling

    monkeypatch.setattr(tiling, "_is_gpu", lambda x: True)
    monkeypatch.setattr(tiling, "_auto_tile", {})
    tried = []

    def fn(t):
        tried.append(max(t.shape[-2:]))
        if max(t.shape[-2:]) > 256:
            raise RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")
        return torch.nn.functional.interpolate(t, scale_factor=2, mode="nearest")

    x = torch.rand(1, 3, 300, 400)
    out = tiling.run_tiled(fn, x, 2, tile=0, auto_key="m")
    assert torch.allclose(out, torch.nn.functional.interpolate(x, scale_factor=2, mode="nearest"), atol=1e-6)
    assert tiling._auto_tile[("m", (300, 400))] == 256
    # The working size is remembered: the next call does not retry the sizes that failed.
    tried.clear()
    tiling.run_tiled(fn, x, 2, tile=0, auto_key="m")
    assert max(tried) <= 256
    # Other errors are not swallowed.
    with pytest.raises(ValueError):
        tiling.run_tiled(lambda t: (_ for _ in ()).throw(ValueError("bad")), x, 2, tile=0, auto_key="n")


def test_half_precision_nan_falls_back_to_full(monkeypatch):
    from enhancer.tiling import descriptor_fn

    class HalfNaN:
        def __init__(self):
            self.model = torch.nn.Conv2d(3, 3, 1).half()

        def __call__(self, t):
            return t * float("nan") if t.dtype == torch.float16 else t * 2

        def float(self):
            self.model.float()

    desc = HalfNaN()
    out = descriptor_fn(desc)(torch.ones(1, 3, 4, 4))
    assert torch.equal(out, torch.full((1, 3, 4, 4), 2.0))
    assert next(desc.model.parameters()).dtype == torch.float32


def test_is_repeat_keeps_local_motion():
    from enhancer.video import is_repeat

    rng = np.random.default_rng(6)
    a = rng.integers(0, 256, (192, 108, 3), dtype=np.uint8)
    noisy = np.clip(a.astype(int) + rng.integers(-1, 2, a.shape), 0, 255).astype(np.uint8)
    blink = a.copy()
    blink[80:88, 40:60] = (blink[80:88, 40:60] * 0.5).astype(np.uint8)
    assert is_repeat(a, a.copy()) and is_repeat(a, noisy)
    assert not is_repeat(a, blink)
    assert not is_repeat(None, a)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs FFmpeg")
def test_video_reuses_repeats_and_limits_duration(fake_pipeline, tmp_path):
    import subprocess

    from enhancer.video import enhance_video

    src = tmp_path / "rep.mp4"
    # 20 different frames at 10 fps, each shown 3 times at 30 fps (lossless, so repeats are exact).
    rng = np.random.default_rng(7)
    for i in range(20):
        cv2.imwrite(str(tmp_path / f"f{i:02d}.png"), rng.integers(0, 256, (48, 64, 3), dtype=np.uint8))
    subprocess.run(["ffmpeg", "-v", "error", "-framerate", "10", "-i", str(tmp_path / "f%02d.png"),
                    "-vf", "fps=30", "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv444p", str(src)], check=True)
    calls = []
    real = fake_pipeline.process_frame
    fake_pipeline.process_frame = lambda f, *a, **k: (calls.append(1), real(f, *a, **k))[1]
    msgs = []
    out = enhance_video(src, tmp_path / "out.mp4", Settings(model="video-2x", scale=2), fake_pipeline,
                        progress=lambda label, f: msgs.append(label))
    probe = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_entries",
                            "stream=width,height,nb_read_frames", "-of", "csv=p=0", str(out)],
                           capture_output=True, text=True).stdout.split(",")
    assert probe[:2] == ["128", "96"] and int(probe[2]) == 60
    assert len(calls) == 20 and "40 repeated frames reused" in msgs[-1]

    calls.clear()
    short = enhance_video(src, tmp_path / "short.mp4", Settings(model="video-2x", scale=2), fake_pipeline,
                          skip_repeats=False, max_seconds=1.0)
    n = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_entries", "stream=nb_read_frames",
                        "-of", "csv=p=0", str(short)], capture_output=True, text=True).stdout.strip()
    assert int(n) == 30 and len(calls) == 30


def test_grain_is_seeded_and_shadow_weighted():
    from enhancer.pipeline import add_grain

    x = torch.cat([torch.full((1, 3, 64, 64), 0.1), torch.full((1, 3, 64, 64), 0.9)], dim=-1)
    assert torch.equal(add_grain(x, 0.0), x)
    a, b, c = add_grain(x, 1.0, seed=1), add_grain(x, 1.0, seed=1), add_grain(x, 1.0, seed=2)
    assert torch.equal(a, b) and not torch.equal(a, c)
    dark, bright = (a - x)[..., :64], (a - x)[..., 64:]
    assert dark.std() > bright.std() * 1.2  # stronger in shadows
    assert abs(float((a - x).mean())) < 0.005  # does not shift brightness
    assert torch.equal((a - x)[:, 0], (a - x)[:, 2])  # luminance only, no colour noise


def test_video_grain_changes_per_frame(fake_pipeline):
    frame = np.full((32, 32, 3), 60, np.uint8)
    s = Settings(model="video-2x", scale=2, grain=0.5)
    f0 = fake_pipeline.process_frame(frame, s, index=0)
    assert np.array_equal(f0, fake_pipeline.process_frame(frame, s, index=0))
    assert not np.array_equal(f0, fake_pipeline.process_frame(frame, s, index=1))


def test_to_half_uses_tested_override_without_spandrel_refusal():
    from enhancer.models import to_half

    class Refuses(Exception):
        pass

    class Desc:  # mimics spandrel: .half() refuses when supports_half is False
        def __init__(self, arch, supports_half):
            self.architecture = type("A", (), {"id": arch})()
            self.supports_half = supports_half
            self.model = torch.nn.Conv2d(3, 3, 1)

        def half(self):
            if not self.supports_half:
                raise Refuses("does not support half precision (fp16)")
            self.model.half()

    dtype = lambda d: next(d.model.parameters()).dtype
    plksr = Desc("PLKSR", False)
    assert to_half(plksr) and dtype(plksr) == torch.float16
    dat = Desc("DAT", False)
    assert not to_half(dat) and dtype(dat) == torch.float32
    span = Desc("SPAN", True)
    assert to_half(span) and dtype(span) == torch.float16


def test_softness_detection_separates_sharp_and_blurry():
    from enhancer import softness

    rng = np.random.default_rng(8)
    sharp = cv2.GaussianBlur(rng.random((256, 192, 3)).astype(np.float32), (0, 0), 0.7)
    blurry = cv2.GaussianBlur(sharp, (0, 0), 2.5)
    to8 = lambda a: (np.clip(a, 0, 1) * 255).astype(np.uint8)
    assert softness.detect([to8(sharp)]) == 1.0
    f = softness.detect([to8(blurry), to8(blurry)])
    assert f in (0.5, 0.4, 0.33)
    assert softness.detect([]) == 1.0


def test_prescale_keeps_output_size_and_uses_one_pass(fake_pipeline, gradient):
    s = Settings(model="social-fast", scale=2, prescale=0.4, tile=0)
    assert fake_pipeline.passes_needed(s, 64, 48, 0.4) == 1  # 5x needed: one 4x pass + small resize
    assert fake_pipeline.passes_needed(Settings(model="social-fast", scale=6), 64, 48) == 2  # unchanged otherwise
    out, _ = fake_pipeline.process(gradient, s)
    assert out.shape == (96, 128, 3)
    resolved = fake_pipeline.resolve(Settings(prescale=0.0), [(gradient * 255).astype(np.uint8)])
    assert resolved.prescale in (1.0, 0.5, 0.4, 0.33)
    assert fake_pipeline.resolve(Settings(prescale=0.5), []).prescale == 0.5


def test_linux_shortcut_points_at_this_python(monkeypatch, tmp_path):
    import sys

    from enhancer import shortcut

    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(shortcut.os, "name", "posix")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "share"))
    desk = tmp_path / "Desktop"
    desk.mkdir()
    monkeypatch.setattr(shortcut, "desktop_dir", lambda: desk)
    monkeypatch.setattr(shortcut.shutil, "which", lambda name: None)
    made = shortcut.create_shortcuts()
    assert made == [tmp_path / "share" / "applications" / "swanaz.desktop", desk / "swanaz.desktop"]
    text = made[1].read_text()
    assert f"Exec=\"{sys.executable}\" \"-m\" \"enhancer\" %F" in text
    assert "Name=Swanaz" in text and shortcut.ICON_PNG.exists() and f"Icon={shortcut.ICON_PNG}" in text
    assert made[1].stat().st_mode & 0o111


def test_files_passed_to_the_command_open_the_app(monkeypatch, tmp_path):
    from enhancer.gui import app as gui_app

    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"x")
    seen = []
    monkeypatch.setattr(gui_app, "run", lambda argv=None: seen.append(argv) or 0)
    assert main([str(clip)]) == 0 and seen == [["swanaz", str(clip)]]
