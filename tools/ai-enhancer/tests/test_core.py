import json

import cv2
import numpy as np
import pytest

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
    s = Settings(scale=4, recover_detail=1.0)
    out, _ = fake_pipeline.process(gradient, s)
    lanczos = np.clip(cv2.resize(gradient, (256, 192), interpolation=cv2.INTER_LANCZOS4), 0, 1)
    np.testing.assert_allclose(out, lanczos, atol=1e-5)


def test_preview_patch_matches_full_render(fake_pipeline, gradient):
    s = Settings(scale=4, tile=0)
    full, _ = fake_pipeline.process(gradient, s)
    cache = {}
    patch, (x, y, w, h) = fake_pipeline.preview(gradient, s, (10, 8, 20, 16), cache=cache)
    assert (x, y, w, h) == (40, 32, 80, 64)
    np.testing.assert_allclose(patch, full[y:y + h, x:x + w], atol=1e-6)
    # A post-processing change reuses the cached AI result.
    assert len(cache) == 1
    fake_pipeline.preview(gradient, Settings(scale=4, tile=0, sharpen=0.5), (10, 8, 20, 16), cache=cache)
    assert len(cache) == 1


def test_face_crop_and_paste_roundtrip():
    rng = np.random.default_rng(0)
    img = cv2.GaussianBlur(rng.random((300, 300, 3)).astype(np.float32), (0, 0), 3)
    # Landmarks: the template scaled by 0.4 and shifted, so the face is about 200 px wide.
    lms = FFHQ_TEMPLATE_512 * 0.4 + np.array([40, 30], np.float32)
    crop, m = crop_face(img, lms)
    assert crop.shape == (FACE_SIZE, FACE_SIZE, 3)
    np.testing.assert_allclose(m[:, :2], np.eye(2) / 0.4, atol=1e-3)
    # Pasting the unmodified crop back into a 2x upscale leaves it nearly unchanged.
    up = cv2.resize(img, (600, 600), interpolation=cv2.INTER_LINEAR)
    out = paste_all(up.copy(), img.shape, [(crop, m)], strength=1.0)
    assert np.abs(out - up).mean() < 0.01


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
