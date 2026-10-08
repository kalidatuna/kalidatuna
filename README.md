# Hi, I'm Datuna

I work on software engineering, automation, and open-source development, with a focus on Python and JavaScript tools.

## Selected projects

| Project | What it does | Current scope |
| --- | --- | --- |
| [Offline Toolbox](https://github.com/kalidatuna/offline-toolbox) | Provides 17 Python command-line utilities and 8 browser tools for everyday file, text, and data tasks. | Python tools use the standard library; browser tools are standalone HTML files. Most tools work offline; `sitecheck` makes network requests. |
| [Git Worklog](https://github.com/kalidatuna/git-worklog) | Turns local Git history into Markdown or JSON work summaries, grouped by UTC day and author. | Dependency-free Python CLI; reads local history and skips merge commits by default. |
| [Invoice Validation for n8n](https://github.com/kalidatuna/n8n-invoice-validation-sample) | Checks extracted invoice fields, exact decimal totals, dates, and duplicates before human review. | Synthetic demonstration with local tests and an inactive example workflow; every result requires human review. |
| [PDF Print Preflight](https://github.com/kalidatuna/pdf-print-check-sample) | Reports embedded-image resolution and possible gray page borders in a PDF. | Read-only Python diagnostic using Poppler; flags need human review and do not repair the document. |
| [Bounty Scout](https://github.com/kalidatuna/bounty-scout) | Summarizes GitHub issues, repository activity, and linked pull requests to help review development opportunities. | Command-line prototype with a heuristic score; reward terms require manual verification. |
| [RGBlink VUE / Companion PoC](https://github.com/kalidatuna/rgblink-vue-companion-poc) | Generates VISCA camera commands and exposes actions through a Bitfocus Companion module skeleton. | Offline packet and action tests; live camera transport remains unverified. |
| [DeyeCloud EMS PoC](https://github.com/kalidatuna/deyecloud-ems-poc) | Provides station discovery, telemetry, and explicit opt-in control requests for DeyeCloud. | Diagnostic prototype with fake-transport tests; deployment requires device-specific validation. |

## Current focus

- Practical developer automation and tools for reviewing open-source issues.
- Small, testable integrations with clear examples and documented limitations.
- Python and JavaScript projects that make external services easier to inspect and use.

## Contributions

I contribute through documentation improvements, reproducible issue reports, and small code changes that improve project clarity and reliability.

Each repository documents its setup, validation steps, and remaining work. For project-specific questions or reproducible bug reports, use that repository's issue tracker.
