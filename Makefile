PYTHON ?= python3

.PHONY: check test links workflows

check: test links workflows

test:
	$(PYTHON) -m unittest discover -s tests

links:
	$(PYTHON) scripts/check_markdown_links.py

workflows:
	$(PYTHON) scripts/validate_n8n_workflows.py
