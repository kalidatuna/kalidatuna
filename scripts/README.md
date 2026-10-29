# Scripts

Small, dependency-free Python checks for this repository. Each uses only the standard library and exits non-zero on failure.

| Script | Purpose |
| --- | --- |
| `check_markdown_links.py [ROOT]` | Verifies relative links and heading anchors in Markdown files. External URLs are skipped so it runs offline. |
| `validate_n8n_workflows.py [FILE_OR_DIR ...]` | Checks n8n workflow exports for required node fields, duplicate IDs or names, and connections to unknown nodes. Defaults to `workflows/n8n`. |

Run everything with `make check` from the repository root.
