# Contribution notes

Profile repository maintenance notes:

- Keep project descriptions accurate.
- Link to reproducible examples.
- Update documentation as projects evolve.
- Keep workflow samples credential-free and use synthetic data only.

## Local checks

Run these before pushing (Python 3, no dependencies). CI runs the same checks.

```bash
python3 scripts/check_workflows.py
python3 scripts/check_links.py
```
