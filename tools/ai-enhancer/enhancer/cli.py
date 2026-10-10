"""Command-line interface. Run without arguments to open the GUI."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import models


def _settings_from_args(a):
    from .pipeline import Settings
    from .presets import PRESETS, apply

    if not a.preset:
        s = Settings()
    elif a.preset in PRESETS:
        s = apply(Settings(), a.preset)
    else:
        s = Settings.from_dict(json.loads(Path(a.preset).read_text()))
    for name in ("model", "scale", "width", "height", "noise", "denoise_model", "denoise_strength",
                 "recover_detail", "face_model", "face_strength", "face_fidelity", "sharpen", "tile", "device"):
        v = getattr(a, name, None)
        if v is not None:
            setattr(s, name, v)
    return s


def _bar(label: str, frac: float):
    n = int(frac * 30)
    sys.stderr.write(f"\r  [{'#' * n}{'.' * (30 - n)}] {frac * 100:5.1f}% {label[:40]:<40}")
    sys.stderr.flush()


def _download_bar(name: str, done: int, total: int):
    _bar(f"Downloading {name}", done / total if total else 0.0)


def cmd_enhance(a) -> int:
    from .batch import OutputOptions, collect_inputs, enhance_file
    from .pipeline import Pipeline

    s = _settings_from_args(a)
    opts = OutputOptions(folder=a.output or "", fmt=a.format, quality=a.quality, video_codec=a.codec,
                         video_crf=a.crf, video_skip_repeats=not a.no_skip_repeats, overwrite=a.overwrite)
    files = collect_inputs(a.inputs)
    if not files:
        print("No input images or videos found.", file=sys.stderr)
        return 1
    pipe = Pipeline(s.device)
    pipe.download_progress = _download_bar
    print(f"Device: {pipe.device}. Settings: {json.dumps(s.to_dict())}", file=sys.stderr)
    failed = 0
    for f in files:
        print(f"{f}", file=sys.stderr)
        try:
            dst = enhance_file(f, s, opts, pipe, progress=_bar, test_seconds=a.test_seconds)
            sys.stderr.write("\n")
            print(dst)
        except Exception as e:  # keep going with the rest of the batch
            failed += 1
            print(f"\n  failed: {e}", file=sys.stderr)
    return 1 if failed else 0


def cmd_compare(a) -> int:
    from .compare import diff_image, metrics
    from .imageio import load_image, save_image

    ours, ref = load_image(a.ours).rgb, load_image(a.reference).rgb
    m = metrics(ours, ref)
    print(json.dumps(m, indent=2))
    if a.diff:
        save_image(a.diff, diff_image(ours, ref))
        print(f"Difference map: {a.diff}", file=sys.stderr)
    return 0


def cmd_match(a) -> int:
    from .compare import match
    from .imageio import load_image
    from .pipeline import Pipeline

    src, ref = load_image(a.source).rgb, load_image(a.reference).rgb
    pipe = Pipeline(a.device or "auto")
    pipe.download_progress = _download_bar
    results = match(src, ref, pipe, crop=a.crop, quick=a.quick, progress=_bar)
    sys.stderr.write("\n")
    print(f"{'rank':>4}  {'ssim':>6}  {'psnr':>6}  {'dE':>5}  {'sharp':>5}  settings")
    for i, r in enumerate(results[: a.top], 1):
        sc = r.scores
        s = r.settings
        desc = f"model={s.model} noise={s.noise:g} recover={s.recover_detail:g} sharpen={s.sharpen:g} face={s.face_model or '-'}"
        print(f"{i:>4}  {sc['ssim']:.4f}  {sc['psnr']:6.2f}  {sc['delta_e']:5.2f}  {sc['sharpness_ratio']:5.2f}  {desc}")
    if a.save_preset:
        Path(a.save_preset).write_text(json.dumps(results[0].settings.to_dict(), indent=2))
        print(f"Best settings saved to {a.save_preset}", file=sys.stderr)
    return 0


def cmd_models(a) -> int:
    print(f"Model folder: {models.model_dir()}")
    for key, f in models.FILES.items():
        have = (models.model_dir() / f.filename).exists()
        print(f"  [{'x' if have else ' '}] {key:<28} {f.license}")
    if a.download:
        keys = list(models.FILES) if a.download == ["all"] else a.download
        for k in keys:
            models.ensure_file(k, lambda d, t, k=k: _download_bar(k, d, t))
            sys.stderr.write("\n")
    return 0


def _add_settings_args(p: argparse.ArgumentParser):
    from .presets import PRESETS

    p.add_argument("--preset", help="built-in preset (" + ", ".join(PRESETS) + ") or a JSON settings file, "
                   "for example from 'match --save-preset'")
    p.add_argument("--model", choices=list(models.UPSCALERS))
    p.add_argument("--scale", type=float)
    p.add_argument("--width", type=int)
    p.add_argument("--height", type=int)
    p.add_argument("--noise", type=float, help="0..1, built-in noise reduction (Standard model)")
    p.add_argument("--denoise", dest="denoise_model", choices=["", *models.DENOISERS])
    p.add_argument("--denoise-strength", type=float)
    p.add_argument("--recover", dest="recover_detail", type=float, help="0..1, blend original detail back in")
    p.add_argument("--face", dest="face_model", choices=["", *models.FACE_MODELS])
    p.add_argument("--face-strength", type=float)
    p.add_argument("--fidelity", dest="face_fidelity", type=float, help="CodeFormer only, 0..1")
    p.add_argument("--sharpen", type=float)
    p.add_argument("--tile", type=int)
    p.add_argument("--device", help="auto, cpu, cuda, cuda:1, mps")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="ai-enhancer", description="Open-source AI photo and video enhancer.")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("gui", help="open the desktop app (default)")

    p = sub.add_parser("enhance", help="enhance images, folders, or videos")
    p.add_argument("inputs", nargs="+")
    p.add_argument("-o", "--output", help="output folder (default: next to each input)")
    p.add_argument("--format", default="png", choices=["png", "jpeg", "tiff", "webp", "same"])
    p.add_argument("--quality", type=int, default=95)
    p.add_argument("--codec", default="h264", choices=["h264", "h265", "h264_nvenc", "hevc_nvenc", "prores"])
    p.add_argument("--crf", type=int, default=16)
    p.add_argument("--overwrite", action="store_true")
    p.add_argument("--test-seconds", type=float, help="videos: export only the first N seconds, to try settings")
    p.add_argument("--no-skip-repeats", action="store_true",
                   help="videos: process every frame, even exact repeats of the previous one")
    _add_settings_args(p)
    p.set_defaults(func=cmd_enhance)

    p = sub.add_parser("compare", help="score an output against a reference image")
    p.add_argument("ours")
    p.add_argument("reference")
    p.add_argument("--diff", help="write a difference heat map here")
    p.set_defaults(func=cmd_compare)

    p = sub.add_parser("match", help="find the settings closest to a reference (for example a Topaz export)")
    p.add_argument("source", help="the original, unprocessed image")
    p.add_argument("reference", help="the same image processed by the tool you want to match")
    p.add_argument("--crop", type=int, default=160, help="source crop size used for the search")
    p.add_argument("--quick", action="store_true", help="try fewer combinations")
    p.add_argument("--top", type=int, default=10)
    p.add_argument("--save-preset", help="write the best settings to this JSON file")
    p.add_argument("--device")
    p.set_defaults(func=cmd_match)

    p = sub.add_parser("models", help="list or download model files")
    p.add_argument("--download", nargs="*", help="model keys, or 'all'")
    p.set_defaults(func=cmd_models)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd in (None, "gui"):
        from .gui.app import run

        return run()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
