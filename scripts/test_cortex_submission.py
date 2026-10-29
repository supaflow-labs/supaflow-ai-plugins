"""Regression tests for CoCo packaging and provider-specific skill isolation."""
import copy
import json
import re
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

import yaml

from build_cortex_submission import build, source_files, validate_bundle, INVENTORY, NATIVE_SKILL, ROOT, SOURCE
from build_openai_submission import source_files as openai_source_files


class CortexSubmissionTests(unittest.TestCase):
    def setUp(self):
        self.files = source_files()

    def test_draft_build_and_extracted_package_match_reviewed_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            package = build(Path(directory), draft=True)
            self.assertTrue(package.name.endswith('-draft'))
            extracted = {str(p.relative_to(package)): p.read_bytes() for p in package.rglob('*') if p.is_file()}
            self.assertEqual(extracted, self.files)
            with ZipFile(package.parent / f'{package.name}.zip') as archive:
                self.assertEqual(set(archive.namelist()), INVENTORY)
                self.assertEqual({name: archive.read(name) for name in archive.namelist()}, extracted)

    def test_release_rejects_placeholder_and_missing_client(self):
        with self.assertRaises(ValueError):
            validate_bundle(self.files)
        for value in ('', '<PUBLIC_CLIENT_ID>', 'example-client', 'token.with.dots', 'client\nsecret', '${CLIENT_ID}'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_bundle(source_files(value))

    def test_release_binds_public_client_without_oauth_secret(self):
        files = source_files('registered-public-client-123')
        validate_bundle(files)
        oauth = json.loads(files['.mcp.json'])['mcpServers']['supaflow']['oauth']
        self.assertEqual(oauth['client_id'], 'registered-public-client-123')
        self.assertNotIn('client_secret', oauth)

    def test_unreviewed_files_and_missing_shared_skills_fail(self):
        for name in ('.env', '.app.json', '.claude-plugin/plugin.json', 'hooks/hooks.json', '../outside', 'scripts/bootstrap.sh'):
            files = dict(self.files, **{name: b'{}'})
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate_bundle(files, draft=True)
        for name in INVENTORY:
            files = dict(self.files)
            del files[name]
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate_bundle(files, draft=True)

    def test_local_process_credentials_and_discovery_overrides_are_rejected(self):
        for change in ({'command':'supaflow','args':['mcp']}, {'url':'http://localhost:3000/mcp'}, {'headers':{'Authorization':'fixture-token'}}, {'snowflake_connection':'sales'}):
            files = copy.deepcopy(self.files)
            mcp = json.loads(files['.mcp.json'])
            mcp['mcpServers']['supaflow'].update(change)
            files['.mcp.json'] = json.dumps(mcp).encode()
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_bundle(files, draft=True)
        for change in ({'client_secret':'fixture-secret'}, {'authorization_server_url':'https://wrong.test'}, {'redirect_port':9000}, {'scope':'read'}):
            files = copy.deepcopy(self.files)
            mcp = json.loads(files['.mcp.json'])
            mcp['mcpServers']['supaflow']['oauth'].update(change)
            files['.mcp.json'] = json.dumps(mcp).encode()
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_bundle(files, draft=True)

    def test_shared_workflow_cannot_silently_drift(self):
        self.files['skills/using-supaflow/SKILL.md'] += b'\nextra instruction'
        with self.assertRaises(ValueError):
            validate_bundle(self.files, draft=True)

    def test_cortex_license_preserves_shared_mit_notice(self):
        self.assertIn(b'Apache License', self.files['LICENSE'])
        self.assertIn((ROOT / 'LICENSE').read_bytes(), self.files['NOTICE'])
        for path in ('LICENSE', 'NOTICE'):
            files = dict(self.files)
            files[path] = b'replaced license'
            with self.subTest(path=path), self.assertRaises(ValueError):
                validate_bundle(files, draft=True)

    def test_native_setup_is_packaged_only_for_cortex(self):
        self.assertEqual({p for p in self.files if p.startswith('skills/')}, {
            'skills/setup/SKILL.md', 'skills/using-supaflow/SKILL.md',
            'skills/setup-supaflow-native-app/SKILL.md',
        })
        self.assertEqual(self.files[NATIVE_SKILL], (SOURCE / NATIVE_SKILL).read_bytes())
        self.assertNotIn(NATIVE_SKILL, openai_source_files())
        shared = ROOT / 'plugins/supaflow/skills'
        self.assertEqual({p.name for p in shared.iterdir() if p.is_dir()}, {'setup', 'using-supaflow'})
        for name in ('setup', 'using-supaflow'):
            path = f'skills/{name}/SKILL.md'
            shared = openai_source_files()[path].decode().split('---\n', 2)[2]
            if name == 'setup':
                shared = shared.replace(
                    '[Supaflow workflow skill](../using-supaflow/SKILL.md)',
                    '`using-supaflow` skill bundled with this plugin')
            self.assertEqual(self.files[path].decode().split('---\n', 2)[2], shared)

    def test_all_cortex_skills_have_catalog_metadata_and_trigger_descriptions(self):
        required = {'name', 'id', 'title', 'summary', 'description', 'tools', 'prompt',
                    'language', 'status', 'author', 'authors', 'type', 'categories'}
        for path in sorted(p for p in self.files if p.endswith('/SKILL.md')):
            with self.subTest(path=path):
                metadata = yaml.safe_load(self.files[path].decode().split('---\n', 2)[1])
                self.assertEqual(set(metadata), required)
                self.assertEqual(metadata['name'], Path(path).parent.name)
                self.assertEqual(metadata['id'], metadata['name'])
                self.assertLessEqual(len(metadata['title']), 30)
                self.assertLessEqual(len(metadata['summary']), 140)
                self.assertTrue(metadata['description'].startswith('Use when'))
                self.assertIn('Triggers:', metadata['description'])
                self.assertNotRegex(metadata['description'], r'\b(I|[Mm]y|[Ww]e|[Oo]ur|[Uu]s)\b')
                self.assertEqual(metadata['type'], 'community')
                self.assertEqual(metadata['status'], 'Published')
                self.assertEqual(metadata['authors'], ['Supaflow LLC'])
                self.assertTrue(metadata['categories'])
                self.assertNotIn('allowed-tools', metadata)
                self.assertEqual(metadata['tools'], ['sql_execute'] if path == NATIVE_SKILL else [])

    def test_onboarding_does_not_reference_files_outside_its_skill_directory(self):
        body = self.files['skills/setup/SKILL.md'].decode().split('---\n', 2)[2]
        self.assertIn('`using-supaflow` skill bundled with this plugin', body)
        self.assertNotIn('../', body)
        self.assertIn(b'../using-supaflow/SKILL.md', openai_source_files()['skills/setup/SKILL.md'])

    def test_setup_explains_release_client_is_public_and_preconfigured(self):
        setup = self.files['SETUP.md'].decode()
        self.assertIn('Keep that value unchanged', setup)
        self.assertIn('not a client secret', setup)
        self.assertIn('offline draft template', setup)

    def test_native_setup_cannot_silently_drift(self):
        self.files[NATIVE_SKILL] += b'\nextra instruction'
        with self.assertRaisesRegex(ValueError, 'CoCo-specific source'):
            validate_bundle(self.files, draft=True)

    def test_native_skill_is_discoverable_without_tool_preapproval(self):
        frontmatter = yaml.safe_load(self.files[NATIVE_SKILL].decode().split('---\n', 2)[1])
        self.assertNotIn('allowed-tools', frontmatter)
        self.assertEqual(frontmatter['tools'], ['sql_execute'])
        self.assertEqual(frontmatter['name'], Path(NATIVE_SKILL).parent.name)
        self.assertIsInstance(frontmatter['description'], str)
        self.assertTrue(frontmatter['description'].strip())
        manifest = validate_bundle(self.files, draft=True)
        self.assertEqual(manifest['skills'], ['./skills'])

    def test_native_setup_is_identical_in_dev_and_release_without_new_mcp_server(self):
        release = source_files('registered-public-client-123')
        dev = source_files('registered-dev-client-123', dev_mcp_url='https://cortex-test.example/mcp')
        self.assertEqual(release[NATIVE_SKILL], dev[NATIVE_SKILL])
        expected_mcp = json.loads((SOURCE / 'mcp.json').read_text())
        expected_mcp['mcpServers']['supaflow']['oauth']['client_id'] = 'registered-public-client-123'
        self.assertEqual(json.loads(release['.mcp.json']), expected_mcp)
        self.assertEqual(set(json.loads(dev['.mcp.json'])['mcpServers']), {'supaflow-dev'})

    def test_controller_permission_sql_is_limited_to_inspection_and_one_scoped_grant(self):
        skill = self.files[NATIVE_SKILL].decode()
        section = skill.split('## Optional: grant an existing controller access\n', 1)[1].split('\n## ', 1)[0]
        statements = [statement.strip() for block in re.findall(r'```sql\n(.*?)```', section, re.S)
                      for statement in block.split(';') if statement.strip()]
        self.assertEqual(statements, [
            'SELECT CURRENT_ACCOUNT(), CURRENT_ROLE()',
            'SHOW GRANTS TO ROLE <CONTROLLER_ROLE>',
            'SHOW GRANTS TO APPLICATION ROLE <APP>.APP_PUBLIC',
            'SHOW GRANTS OF APPLICATION ROLE <APP>.APP_PUBLIC',
            'GRANT APPLICATION ROLE <APP>.APP_PUBLIC TO ROLE <CONTROLLER_ROLE>',
        ])

    def test_controller_permission_guardrails_ship_in_dev_and_release_only(self):
        for dev_url in (None, 'https://cortex-test.example/mcp'):
            with self.subTest(dev_url=dev_url), tempfile.TemporaryDirectory() as directory:
                package = build(Path(directory), 'registered-public-client-123', dev_mcp_url=dev_url)
                with ZipFile(package.parent / f'{package.name}.zip') as archive:
                    skill = archive.read(NATIVE_SKILL).decode()
                    section = ' '.join(skill.split('## Optional: grant an existing controller access\n', 1)[1]
                                       .split('\n## ', 1)[0].split())
                    for rule in (
                        'If no controller is selected or the user declines, skip this step',
                        'Do not assume `SUPA_ROLE`',
                        'If the controller connects to a different Snowflake account, stop this step',
                        'If access already exists, report it and skip the grant',
                        'Execute only the approved statement',
                        'After a timeout, reconcile these grants before any retry',
                        "An administrator's successful status call does not prove controller access",
                        'Do not start, stop, restart, or run a pipeline to test permissions',
                    ):
                        self.assertIn(rule, section)
                    for shared in ('setup', 'using-supaflow'):
                        self.assertNotIn(b'## Optional: grant an existing controller access',
                                         archive.read(f'skills/{shared}/SKILL.md'))

    def test_custom_network_sql_preserves_existing_rules_and_uses_bound_integration(self):
        section = self.files[NATIVE_SKILL].decode().split(
            '## Optional: add custom connector network access\n', 1)[1].split('\n## ', 1)[0]
        blocks = re.findall(r'```sql\n(.*?)```', section, re.S)
        sql = ' '.join(' '.join(blocks).split())
        self.assertIn('SHOW REFERENCES IN APPLICATION <APP>;', sql)
        self.assertIn('DESCRIBE INTEGRATION <BOUND_INTEGRATION_NAME>', sql)
        self.assertIn("WHERE \"property\" IN ('ALLOWED_NETWORK_RULES', 'ENABLED')", sql)
        self.assertIn("WHERE value:type::STRING = 'STAGE'", sql)
        statements = [statement.strip() for statement in sql.split(';') if statement.strip()]
        mutations = [statement for statement in statements if not statement.startswith(
            ('SELECT ', 'SHOW ', 'DESCRIBE '))]
        self.assertEqual(mutations, [
            'CREATE NETWORK RULE <CUSTOMER_DB>.<CUSTOMER_SCHEMA>.<CUSTOM_RULE> '
            "MODE = EGRESS TYPE = HOST_PORT VALUE_LIST = ('<EXACT_HOST>:<PORT>')",
            'ALTER EXTERNAL ACCESS INTEGRATION <BOUND_INTEGRATION_NAME> '
            'SET ALLOWED_NETWORK_RULES = ( <ALL_CURRENT_RULES>, '
            '<CUSTOMER_DB>.<CUSTOMER_SCHEMA>.<CUSTOM_RULE> )',
        ])

    def test_custom_network_workflow_and_safety_boundaries_ship_only_in_cortex(self):
        title = '## Optional: add custom connector network access'
        for dev_url in (None, 'https://cortex-test.example/mcp'):
            with self.subTest(dev_url=dev_url), tempfile.TemporaryDirectory() as directory:
                package = build(Path(directory), 'registered-public-client-123', dev_mcp_url=dev_url)
                with ZipFile(package.parent / f'{package.name}.zip') as archive:
                    skill = archive.read(NATIVE_SKILL).decode()
                    section = ' '.join(skill.split(title + '\n', 1)[1].split('\n## ', 1)[0].split())
                    for rule in (
                        '`object_name` of the exact `SUPA_AGENT_EXTERNAL_ACCESS` reference',
                        'do not create a replacement integration',
                        'Do not substitute the app-owned OAuth security integration',
                        'If endpoints are already covered, skip DDL',
                        'Missing visibility is not an empty rule list',
                        "**datasource's Snowflake account**",
                        'never schemes, paths, credentials, tokens, or signed download URLs',
                        'Private endpoints require separate private-connectivity setup',
                        'complete resulting rule list for approval',
                        '`SET ALLOWED_NETWORK_RULES` replaces the complete list',
                        'preserve any concurrent additions',
                        'Preserve existing endpoints unless their removal was explicitly approved',
                        'After a timeout, inspect rule and binding state before retrying',
                        'connectivity remains unverified until tested',
                        'do not run a full catalog refresh or pipeline automatically',
                    ):
                        self.assertIn(rule, section)
                    for shared in ('setup', 'using-supaflow'):
                        self.assertNotIn(title.encode(), archive.read(f'skills/{shared}/SKILL.md'))
        self.assertNotIn(NATIVE_SKILL, openai_source_files())

    def test_manifest_cannot_add_hooks_or_escape_package(self):
        for change in ({'hooks':{}}, {'skills':['../skills']}, {'mcpServers':'../mcp.json'}, {'apps':{}}):
            files = copy.deepcopy(self.files)
            manifest = json.loads(files['.cortex-plugin/plugin.json'])
            manifest.update(change)
            files['.cortex-plugin/plugin.json'] = json.dumps(manifest).encode()
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_bundle(files, draft=True)

    def test_build_never_overwrites_review_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            build(Path(directory), draft=True)
            with self.assertRaises(FileExistsError):
                build(Path(directory), draft=True)

    def test_development_package_isolated_from_release_and_archive_matches(self):
        url = 'https://cortex-test.ngrok-free.dev/mcp'
        with tempfile.TemporaryDirectory() as directory:
            package = build(Path(directory), 'registered-dev-client-123', dev_mcp_url=url)
            self.assertTrue(package.name.endswith('-dev'))
            with ZipFile(package.parent / f'{package.name}.zip') as archive:
                files = {name: archive.read(name) for name in archive.namelist()}
            manifest = validate_bundle(files, dev_mcp_url=url)
            self.assertEqual(manifest['name'], 'supaflow-dev')
            self.assertEqual(json.loads(files['.mcp.json'])['mcpServers']['supaflow-dev']['url'], url)
            self.assertEqual(files, source_files('registered-dev-client-123', dev_mcp_url=url))
            with self.assertRaises(ValueError):
                validate_bundle(files)
            with self.assertRaises(ValueError):
                validate_bundle(files, dev_mcp_url='https://other.test/mcp')

    def test_development_requires_real_client_and_separate_https_endpoint(self):
        for url in ('http://localhost:3000/mcp', 'https://app.supa-flow.io/mcp',
                    'https://user:password@test.dev/mcp', 'https://test.dev/mcp?token=bad',
                    'https://test.dev/mcp#fragment', 'https://test.dev/other'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                source_files('registered-dev-client-123', dev_mcp_url=url)
        url = 'https://test.dev/mcp'
        with self.assertRaises(ValueError):
            validate_bundle(source_files(dev_mcp_url=url), dev_mcp_url=url)
        with self.assertRaises(ValueError):
            validate_bundle(source_files(dev_mcp_url=url), draft=True, dev_mcp_url=url)


if __name__ == '__main__':
    unittest.main()
