PYTHON ?= python3

.PHONY: check test links workflows payloads

check: test links workflows payloads

test:
	$(PYTHON) -m unittest discover -s tests

links:
	$(PYTHON) scripts/check_markdown_links.py

workflows:
	$(PYTHON) scripts/validate_n8n_workflows.py

payloads:
	for f in workflows/n8n/payloads/*.json; do $(PYTHON) -m json.tool "$$f" > /dev/null || exit 1; done
