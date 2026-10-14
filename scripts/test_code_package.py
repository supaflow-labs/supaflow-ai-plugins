"""Portable Code package validation, including intentionally broken fixtures."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import yaml

from validate import ROOT, validate_code_package


class CodePackageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.package = Path(self.directory.name) / "supaflow-code"
        shutil.copytree(ROOT / "plugins/supaflow-code", self.package)

    def test_complete_portable_package_and_yaml_skill_discovery(self):
        validate_code_package(self.package)
        names = set()
        for path in (self.package / "skills").glob("*/SKILL.md"):
            frontmatter = yaml.safe_load(path.read_text().split("---\n", 2)[1])
            self.assertEqual(frontmatter["name"], path.parent.name)
            self.assertIsInstance(frontmatter["description"], str)
            self.assertTrue(frontmatter["description"].strip())
            names.add(frontmatter["name"])
        self.assertEqual(len(names), 6)

    def test_missing_agent_skill_is_rejected(self):
        (self.package / "skills/supaflow-code-agents/SKILL.md").unlink()
        with self.assertRaises(ValueError):
            validate_code_package(self.package)

    def test_remote_mcp_is_rejected(self):
        (self.package / "mcp.json").write_text(json.dumps({"mcpServers": {"supaflow": {"url": "https://app.supa-flow.io/mcp"}}}))
        with self.assertRaises(ValueError):
            validate_code_package(self.package)

    def test_hosted_binding_is_rejected(self):
        (self.package / ".app.json").write_text('{}')
        with self.assertRaises(ValueError):
            validate_code_package(self.package)

    def test_claude_hook_is_rejected(self):
        (self.package / "hooks").mkdir()
        with self.assertRaises(ValueError):
            validate_code_package(self.package)


if __name__ == "__main__":
    unittest.main()
