"""Check that exported n8n workflow files are structurally sound.

Usage: python scripts/validate_n8n_workflows.py [FILE_OR_DIR ...]
Defaults to workflows/n8n when no paths are given.
"""

import json
import sys
from pathlib import Path

REQUIRED_NODE_FIELDS = ("id", "name", "type", "typeVersion", "position", "parameters")


def validate_workflow(data):
    """Return a list of problems found in one parsed workflow."""
    problems = []
    if not isinstance(data, dict):
        return ["top level must be a JSON object"]
    if not data.get("name"):
        problems.append("workflow is missing a name")

    nodes = data.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        return problems + ["workflow has no nodes"]

    ids, names = set(), set()
    for index, node in enumerate(nodes):
        label = node.get("name", f"node #{index}") if isinstance(node, dict) else f"node #{index}"
        if not isinstance(node, dict):
            problems.append(f"{label}: node must be an object")
            continue
        for field in REQUIRED_NODE_FIELDS:
            if field not in node:
                problems.append(f"{label}: missing '{field}'")
        if node.get("id") in ids:
            problems.append(f"{label}: duplicate node id {node['id']!r}")
        if node.get("name") in names:
            problems.append(f"{label}: duplicate node name")
        ids.add(node.get("id"))
        names.add(node.get("name"))

    connections = data.get("connections", {})
    for source, outputs in connections.items():
        if source not in names:
            problems.append(f"connection from unknown node {source!r}")
        for branches in outputs.values():
            for branch in branches:
                for link in branch or []:
                    if link.get("node") not in names:
                        problems.append(f"{source} -> unknown node {link.get('node')!r}")
    return problems


def collect(paths):
    files = []
    for path in paths:
        path = Path(path)
        files.extend(sorted(path.glob("*.json")) if path.is_dir() else [path])
    return files


def main(argv):
    files = collect(argv or ["workflows/n8n"])
    failed = False
    for file in files:
        try:
            data = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            problems = [f"cannot read JSON: {exc}"]
        else:
            problems = validate_workflow(data)
        for problem in problems:
            print(f"{file}: {problem}")
        failed = failed or bool(problems)
    print(f"Checked {len(files)} workflow file(s): {'FAILED' if failed else 'OK'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
