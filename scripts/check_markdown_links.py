"""Check relative links and #anchors in the repository's Markdown files.

External links (http, https, mailto) are skipped so the check works offline.
Usage: python scripts/check_markdown_links.py [ROOT]
"""

import re
import sys
from pathlib import Path

LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
EXTERNAL = ("http://", "https://", "mailto:")


def strip_code(text):
    """Drop fenced code blocks and inline code so their contents are ignored."""
    lines, in_fence = [], False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            lines.append("")
            continue
        lines.append("" if in_fence else re.sub(r"`[^`]*`", "", line))
    return lines


def slugify(heading):
    """Approximate GitHub's heading anchor algorithm."""
    heading = re.sub(r"[*_`]", "", heading).strip().lower()
    heading = re.sub(r"[^\w\- ]", "", heading)
    return heading.replace(" ", "-")


def anchors(path, cache={}):
    if path not in cache:
        found, counts = set(), {}
        for line in strip_code(path.read_text(encoding="utf-8")):
            match = HEADING.match(line)
            if match:
                slug = slugify(match.group(2))
                n = counts.get(slug, 0)
                counts[slug] = n + 1
                found.add(slug if n == 0 else f"{slug}-{n}")
        cache[path] = found
    return cache[path]


def check_file(path, root):
    problems = []
    for lineno, line in enumerate(strip_code(path.read_text(encoding="utf-8")), 1):
        for target in LINK.findall(line):
            if target.startswith(EXTERNAL):
                continue
            file_part, _, anchor = target.partition("#")
            dest = (path.parent / file_part).resolve() if file_part else path
            if root not in dest.parents and dest != root:
                problems.append(f"{path}:{lineno}: link leaves repository: {target}")
            elif not dest.exists():
                problems.append(f"{path}:{lineno}: missing file: {target}")
            elif anchor and dest.suffix == ".md" and anchor not in anchors(dest):
                problems.append(f"{path}:{lineno}: missing anchor: {target}")
    return problems


def main(argv):
    root = Path(argv[0] if argv else ".").resolve()
    files = sorted(p for p in root.rglob("*.md") if ".git" not in p.parts)
    problems = [p for f in files for p in check_file(f, root)]
    for problem in problems:
        print(problem)
    print(f"Checked {len(files)} Markdown file(s): {'FAILED' if problems else 'OK'}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
