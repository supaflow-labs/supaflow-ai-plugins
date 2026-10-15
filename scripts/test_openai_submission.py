"""Offline regressions for the public OpenAI update archive."""

import copy
import json
import re
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from build_openai_submission import build, source_files, validate_bundle


class SubmissionBundleTests(unittest.TestCase):
    def setUp(self):
        self.files = source_files()

    def alter_manifest(self, change):
        manifest = json.loads(self.files["plugin.json"])
        change(manifest)
        self.files["plugin.json"] = json.dumps(manifest).encode()

    def test_final_zip_contains_the_shared_skill_and_no_private_bindings(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = build(Path(directory))
            with ZipFile(archive) as bundle:
                files = {name: bundle.read(name) for name in bundle.namelist()}
                self.assertEqual(files, self.files)
                self.assertEqual(len(files), 5)
                self.assertEqual(validate_bundle(files)["version"], "1.1.1")

    def test_onboarding_reference_resolves_to_a_packaged_skill(self):
        manifest = validate_bundle(self.files)
        path = manifest["extensions"]["com.openai"]["onboardingSkill"]
        self.assertIn(path.removeprefix("./"), self.files)
        del self.files["skills/setup/SKILL.md"]
        with self.assertRaises(ValueError):
            validate_bundle(self.files)

    def test_packaged_monitoring_contract_includes_all_terminal_states(self):
        skill = self.files["skills/using-supaflow/SKILL.md"].decode()
        terminal_clause = re.search(r"Terminal job states are: ([^.]+)\.", skill)
        self.assertIsNotNone(terminal_clause)
        self.assertEqual(set(re.findall(r"`([^`]+)`", terminal_clause.group(1))), {
            "completed", "completed_with_warning", "failed", "cancelled", "skipped", "timed_out",
        })

    def test_invalid_or_missing_onboarding_reference_is_rejected(self):
        for path in (None, "./skills/missing/SKILL.md", "../setup/SKILL.md", "/skills/setup/SKILL.md", "https://example.com/setup"):
            with self.subTest(path=path):
                self.files = source_files()
                self.alter_manifest(lambda m: m["extensions"]["com.openai"].update(onboardingSkill=path))
                with self.assertRaises(ValueError):
                    validate_bundle(self.files)
        self.files = source_files()
        self.alter_manifest(lambda m: m["extensions"]["com.openai"].pop("onboardingSkill"))
        with self.assertRaises(ValueError):
            validate_bundle(self.files)

    def test_listing_uses_the_chatgpt_landing_page(self):
        for field in ("homepage", "websiteURL"):
            with self.subTest(field=field):
                self.files = source_files()
                target = lambda m: m if field == "homepage" else m["extensions"]["com.openai"]["interface"]
                self.alter_manifest(lambda m: target(m).update({field: "https://www.supa-flow.io"}))
                with self.assertRaises(ValueError):
                    validate_bundle(self.files)

    def test_missing_skill_fails_instead_of_silently_shipping_mcp_only(self):
        del self.files["skills/using-supaflow/SKILL.md"]
        with self.assertRaises(ValueError):
            validate_bundle(self.files)

    def test_private_app_binding_is_excluded(self):
        self.files[".app.json"] = b'{}'
        with self.assertRaises(ValueError):
            validate_bundle(self.files)

    def test_app_declaration_is_rejected_even_without_binding_file(self):
        for field in ("apps", "skills", "mcpServers", "interface"):
            with self.subTest(field=field):
                files = copy.deepcopy(self.files)
                manifest = json.loads(files["plugin.json"])
                manifest[field] = "./.app.json"
                files["plugin.json"] = json.dumps(manifest).encode()
                with self.assertRaises(ValueError):
                    validate_bundle(files)
        self.alter_manifest(lambda m: m["extensions"]["com.openai"].update(apps="./.app.json"))
        with self.assertRaises(ValueError):
            validate_bundle(self.files)

    def test_old_app_update_cannot_change_endpoint_or_oauth(self):
        for change in ({"url": "http://localhost:3000/mcp"}, {"extensions": {"com.openai": {"auth": {"type": "oauth"}}}}):
            with self.subTest(change=change):
                files = copy.deepcopy(self.files)
                mcp = json.loads(files["mcp.json"])
                mcp["mcpServers"]["supaflow"].update(change)
                files["mcp.json"] = json.dumps(mcp).encode()
                with self.assertRaises(ValueError):
                    validate_bundle(files)

    def test_published_package_identity_is_preserved(self):
        self.alter_manifest(lambda m: m.update(name="supaflow"))
        with self.assertRaises(ValueError):
            validate_bundle(self.files)

    def test_skill_frontmatter_is_parsed_as_yaml(self):
        path = "skills/using-supaflow/SKILL.md"
        self.files[path] = b'---\nname: other-skill\ndescription: test\n---\nBody\n'
        with self.assertRaises(ValueError):
            validate_bundle(self.files)

    def test_unknown_hosted_tool_is_rejected(self):
        for name in ("setup", "using-supaflow"):
            with self.subTest(skill=name):
                self.files = source_files()
                self.files[f"skills/{name}/SKILL.md"] += b'\nCall `agents_install`.\n'
                with self.assertRaises(ValueError):
                    validate_bundle(self.files)

    def test_listing_limits_and_required_support_url(self):
        self.alter_manifest(lambda m: m["extensions"]["com.openai"]["interface"].update(shortDescription="x" * 31))
        with self.assertRaises(ValueError):
            validate_bundle(self.files)
        self.files = source_files()
        self.alter_manifest(lambda m: m["extensions"]["com.openai"]["interface"].pop("supportURL"))
        with self.assertRaises(ValueError):
            validate_bundle(self.files)

    def test_review_artifacts_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = build(Path(directory))
            original = archive.read_bytes()
            with self.assertRaises(FileExistsError):
                build(Path(directory))
            self.assertEqual(archive.read_bytes(), original)

if __name__ == "__main__":
    unittest.main()
