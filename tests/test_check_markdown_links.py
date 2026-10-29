import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from check_markdown_links import main, slugify  # noqa: E402


class SlugifyTests(unittest.TestCase):
    def test_matches_github_style_anchors(self):
        self.assertEqual(slugify("Selected work"), "selected-work")
        self.assertEqual(slugify("1. Give every business event a stable identity"),
                         "1-give-every-business-event-a-stable-identity")
        self.assertEqual(slugify('A boolean "processed" flag is too weak'),
                         "a-boolean-processed-flag-is-too-weak")


class CheckLinksTests(unittest.TestCase):
    def run_on(self, files):
        with tempfile.TemporaryDirectory() as tmp:
            for name, text in files.items():
                path = Path(tmp) / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
            return main([tmp])

    def test_valid_links_pass(self):
        self.assertEqual(self.run_on({
            "README.md": "# Home\n[doc](docs/a.md#part-one) [top](#home) [web](https://example.com)\n",
            "docs/a.md": "## Part one\n",
        }), 0)

    def test_missing_file_fails(self):
        self.assertEqual(self.run_on({"README.md": "[x](nope.md)\n"}), 1)

    def test_missing_anchor_fails(self):
        self.assertEqual(self.run_on({"README.md": "# Home\n[x](#away)\n"}), 1)

    def test_links_inside_code_are_ignored(self):
        self.assertEqual(self.run_on({"README.md": "```\n[x](nope.md)\n```\n`[y](nope.md)`\n"}), 0)


if __name__ == "__main__":
    unittest.main()
