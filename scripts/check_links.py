#!/usr/bin/env python3
"""Check that relative links in Markdown files point at existing files."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)\)")
FENCE = re.compile(r"```.*?```", re.S)


def main():
    failed = False
    for md in sorted(ROOT.rglob("*.md")):
        if ".git" in md.parts:
            continue
        text = FENCE.sub("", md.read_text(encoding="utf-8"))
        for target in LINK.findall(text):
            if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("#"):
                continue
            path = target.split("#", 1)[0]
            if not (md.parent / path).exists():
                failed = True
                print(f"FAIL {md.relative_to(ROOT)}: broken link {target}")
    if not failed:
        print("ok   all relative Markdown links resolve")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
