"""Command line: render a saved project, analyse a reference, check the GPU.

    afterglow info
    afterglow render project.json out.mp4 [--comp main] [--scale 1] [--quality high]
    afterglow analyze reference.mp4
    afterglow effects
"""
from __future__ import annotations

import argparse
import json
import sys


def main(argv=None):
    ap = argparse.ArgumentParser(prog="afterglow")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("info", help="show the GPU and workspace in use")
    r = sub.add_parser("render", help="render a project file to MP4")
    r.add_argument("project")
    r.add_argument("output")
    r.add_argument("--comp")
    r.add_argument("--scale", type=float, default=1.0)
    r.add_argument("--quality", default="high", choices=["draft", "medium", "high", "max"])
    r.add_argument("--codec", default="libx264")
    a = sub.add_parser("analyze", help="print a style report for a reference video")
    a.add_argument("video")
    sub.add_parser("effects", help="list every effect")
    args = ap.parse_args(argv)

    if args.cmd == "effects":
        from .effects import catalog
        for e in catalog():
            print(f"{e['category']:9} {e['name']:20} {e['desc']}")
        return 0
    if args.cmd == "analyze":
        from .analysis import analyze
        print(json.dumps(analyze(args.video), indent=1, default=float))
        return 0
    if args.cmd == "info":
        from .engine import Engine
        print(json.dumps(Engine().system_info(), indent=1))
        return 0
    if args.cmd == "render":
        from . import project as P
        from .export import render_video
        proj = P.load(args.project)
        crf = {"draft": 26, "medium": 21, "high": 17, "max": 13}[args.quality]

        def progress(done, total):
            sys.stderr.write(f"\r{done}/{total} frames")
            sys.stderr.flush()

        res = render_video(proj, args.comp, args.output, scale=args.scale, crf=crf, codec=args.codec, progress=progress)
        sys.stderr.write("\n")
        print(json.dumps(res, indent=1))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
