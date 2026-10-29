import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from validate_n8n_workflows import main, validate_workflow  # noqa: E402


def node(name, node_id):
    return {
        "id": node_id,
        "name": name,
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [0, 0],
        "parameters": {},
    }


class ValidateWorkflowTests(unittest.TestCase):
    def test_valid_workflow_has_no_problems(self):
        data = {
            "name": "Demo",
            "nodes": [node("A", "1"), node("B", "2")],
            "connections": {"A": {"main": [[{"node": "B", "type": "main", "index": 0}]]}},
        }
        self.assertEqual(validate_workflow(data), [])

    def test_reports_missing_fields(self):
        data = {"name": "Demo", "nodes": [{"id": "1", "name": "A"}]}
        problems = validate_workflow(data)
        self.assertIn("A: missing 'type'", problems)
        self.assertIn("A: missing 'position'", problems)

    def test_reports_duplicate_ids_and_names(self):
        data = {"name": "Demo", "nodes": [node("A", "1"), node("A", "1")]}
        problems = validate_workflow(data)
        self.assertIn("A: duplicate node id '1'", problems)
        self.assertIn("A: duplicate node name", problems)

    def test_reports_connection_to_unknown_node(self):
        data = {
            "name": "Demo",
            "nodes": [node("A", "1")],
            "connections": {"A": {"main": [[{"node": "Missing"}]]}},
        }
        self.assertIn("A -> unknown node 'Missing'", validate_workflow(data))

    def test_empty_workflow_is_rejected(self):
        self.assertEqual(validate_workflow({}), ["workflow is missing a name", "workflow has no nodes"])

    def test_repository_samples_are_valid(self):
        root = Path(__file__).resolve().parents[1]
        self.assertEqual(main([str(root / "workflows" / "n8n")]), 0)


if __name__ == "__main__":
    unittest.main()
