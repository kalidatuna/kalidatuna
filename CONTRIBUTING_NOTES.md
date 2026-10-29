# Contribution notes

Profile repository maintenance notes:

- Keep project descriptions accurate.
- Link to reproducible examples.
- Update documentation as projects evolve.

## Before committing

Run the repository checks from the root:

```bash
make check
```

This runs:

- `scripts/check_markdown_links.py`: relative links and `#anchors` in every Markdown file.
- `scripts/validate_n8n_workflows.py`: node fields, unique IDs and names, and connections in `workflows/n8n/*.json`.
- A JSON parse of every file in `workflows/n8n/payloads/`.
- The unit tests in `tests/`.

The same checks run in GitHub Actions on pushes to `main` and on pull requests.
