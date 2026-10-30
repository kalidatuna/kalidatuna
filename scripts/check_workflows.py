#!/usr/bin/env python3
"""Sanity-check the n8n workflow exports in workflows/n8n.

Checks that each export is valid JSON, node names are unique, every
connection points at an existing node, and no credentials are embedded.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_DIR = ROOT / "workflows" / "n8n"


def check(path):
    errors = []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"invalid JSON: {exc}"]

    nodes = data.get("nodes", [])
    names = [node.get("name") for node in nodes]
    if not nodes:
        errors.append("no nodes")
    duplicates = {name for name in names if names.count(name) > 1}
    if duplicates:
        errors.append(f"duplicate node names: {sorted(duplicates)}")

    for source, outputs in data.get("connections", {}).items():
        if source not in names:
            errors.append(f"connection from unknown node {source!r}")
        for branch in outputs.get("main", []):
            for link in branch or []:
                if link.get("node") not in names:
                    errors.append(f"{source!r} connects to unknown node {link.get('node')!r}")

    for node in nodes:
        if node.get("credentials"):
            errors.append(f"node {node.get('name')!r} embeds credentials")

    return errors


def main():
    paths = sorted(WORKFLOW_DIR.glob("*.json"))
    if not paths:
        print("no workflow exports found", file=sys.stderr)
        return 1
    failed = False
    for path in paths:
        errors = check(path)
        rel = path.relative_to(ROOT)
        if errors:
            failed = True
            for error in errors:
                print(f"FAIL {rel}: {error}")
        else:
            print(f"ok   {rel}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
