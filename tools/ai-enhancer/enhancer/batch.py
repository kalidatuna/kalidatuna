"""Process whole files (images or videos), shared by the CLI and the GUI."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .imageio import IMAGE_EXTS, OUTPUT_FORMATS, VIDEO_EXTS, is_video, load_image, save_image
from .pipeline import Pipeline, Progress, Settings


@dataclass
class OutputOptions:
    folder: str = ""  # empty = next to the source file
    fmt: str = "png"  # png, jpeg, tiff, webp, or "same" for images
    quality: int = 95
    keep_16bit: bool = True
    video_codec: str = "h264"
    video_crf: int = 16
    overwrite: bool = False


def collect_inputs(paths: list[str | Path]) -> list[Path]:
    out: list[Path] = []
    for p in map(Path, paths):
        if p.is_dir():
            out += sorted(f for f in p.iterdir() if f.suffix.lower() in IMAGE_EXTS | VIDEO_EXTS)
        elif p.exists():
            out.append(p)
    return out


def output_path(src: Path, s: Settings, opts: OutputOptions, size: tuple[int, int]) -> Path:
    folder = Path(opts.folder) if opts.folder else src.parent
    if is_video(src):
        ext = ".mov" if opts.video_codec == "prores" else src.suffix if src.suffix.lower() in (".mp4", ".mov", ".mkv") else ".mp4"
    elif opts.fmt == "same":
        ext = src.suffix if src.suffix.lower() in IMAGE_EXTS else ".png"
    else:
        ext = OUTPUT_FORMATS[opts.fmt]
    base = folder / f"{src.stem}-enhanced-{s.model}-{size[0]}x{size[1]}"
    path = base.with_suffix(ext)
    n = 1
    while path.exists() and not opts.overwrite:
        path = Path(f"{base}-{n}{ext}")
        n += 1
    return path


def _fmt_for(path: Path) -> str:
    ext = path.suffix.lower()
    return {".jpg": "jpeg", ".jpeg": "jpeg", ".tif": "tiff", ".tiff": "tiff", ".webp": "webp"}.get(ext, "png")


def enhance_file(src: str | Path, s: Settings, opts: OutputOptions, pipeline: Pipeline,
                 progress: Progress | None = None, cancel: Callable[[], bool] | None = None) -> Path:
    src = Path(src)
    if is_video(src):
        from .video import enhance_video, even_settings, probe

        info = probe(src)
        es = even_settings(s, info.width, info.height)
        dst = output_path(src, s, opts, (es.width, es.height))
        return enhance_video(src, dst, s, pipeline, codec=opts.video_codec, crf=opts.video_crf,
                             progress=progress, cancel=cancel)
    img = load_image(src)
    out, alpha = pipeline.process(img.rgb, s, alpha=img.alpha, progress=progress, cancel=cancel)
    dst = output_path(src, s, opts, (out.shape[1], out.shape[0]))
    bits = img.bits if opts.keep_16bit else 8
    return save_image(dst, out, alpha, fmt=_fmt_for(dst), quality=opts.quality, bits=bits,
                      icc=img.icc, exif=img.exif)
