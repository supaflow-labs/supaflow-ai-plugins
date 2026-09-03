#!/usr/bin/env python3
"""Validate cross-vendor Supaflow plugin packaging invariants."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "supaflow"
EXPECTED_MCP_URL = "https://app.supa-flow.io/mcp"
EXPECTED_OAUTH_CLIENT_ID = "Rx00poctUvOSSG3L"
EXPECTED_OAUTH_CALLBACK_URL = "http://127.0.0.1:8765/callback/BurW79bZPaVW"
EXPECTED_OAUTH_CALLBACK_PORT = 8765
EXPECTED_TOOLS = [
    "auth_status",
    "workspaces_list",
    "connectors_list",
    "datasources_list",
    "datasources_get",
    "datasources_catalog",
    "datasources_catalog_reset_status",
    "pipelines_list",
    "pipelines_get",
    "pipelines_schema_list",
    "projects_list",
    "jobs_list",
    "jobs_status",
    "jobs_cancel",
    "jobs_get",
    "jobs_logs",
    "schedules_list",
    "schedules_history",
    "docs",
    "datasources_init",
    "datasources_create",
    "datasources_edit",
    "datasources_test",
    "datasources_enable",
    "datasources_disable",
    "datasources_delete",
    "datasources_refresh",
    "datasources_reset_catalog",
    "pipelines_init",
    "pipelines_prepare_create",
    "pipelines_create_from_plan",
    "pipelines_create",
    "pipelines_edit",
    "pipelines_schema_select",
    "pipelines_schema_add",
    "pipelines_enable",
    "pipelines_disable",
    "pipelines_delete",
    "pipelines_sync",
    "projects_create",
    "projects_delete",
    "schedules_create",
    "schedules_edit",
    "schedules_delete",
    "schedules_enable",
    "schedules_disable",
    "schedules_run",
]
FORBIDDEN_REMOTE_FRAGMENTS = (
    "agent_",
    "docker",
    "filesystem",
    "process_control",
    "credential_bootstrap",
)


def read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path.relative_to(ROOT)} must contain a JSON object")
    return value


def main() -> None:
    codex = read_json(PLUGIN / ".codex-plugin" / "plugin.json")
    claude = read_json(PLUGIN / ".claude-plugin" / "plugin.json")
    mcp = read_json(PLUGIN / ".mcp.json")
    contract = read_json(ROOT / "contracts" / "hosted-tools.json")
    openai = read_json(ROOT / "vendors" / "openai" / "submission-source.json")
    marketplace = read_json(ROOT / ".agents" / "plugins" / "marketplace.json")

    if codex.get("name") != PLUGIN.name or claude.get("name") != PLUGIN.name:
        raise ValueError("Plugin folder and manifest names must match")
    if codex.get("version") != claude.get("version"):
        raise ValueError("Codex and Claude plugin versions must match")

    server = mcp.get("mcpServers", {}).get("supaflow", {})
    expected_server = {
        "type": "http",
        "url": EXPECTED_MCP_URL,
        "oauth": {
            "clientId": EXPECTED_OAUTH_CLIENT_ID,
            "callbackUrl": EXPECTED_OAUTH_CALLBACK_URL,
            "callbackPort": EXPECTED_OAUTH_CALLBACK_PORT,
        },
    }
    if server != expected_server:
        raise ValueError(
            "The shared MCP config must contain the hosted endpoint and reviewed public PKCE client"
        )
    if openai.get("mcpEndpoint") != EXPECTED_MCP_URL:
        raise ValueError("OpenAI submission metadata MCP URL is out of sync")

    expected_marketplace = {
        "name": "supaflow",
        "interface": {"displayName": "Supaflow"},
        "plugins": [
            {
                "name": "supaflow",
                "source": {
                    "source": "local",
                    "path": "./plugins/supaflow",
                },
                "policy": {
                    "installation": "AVAILABLE",
                    "authentication": "ON_INSTALL",
                },
                "category": "Data & Analytics",
            }
        ],
    }
    if marketplace != expected_marketplace:
        raise ValueError("Codex marketplace descriptor is out of sync")

    interface = codex.get("interface", {})
    presentation_pairs = {
        "shortDescription": "shortDescription",
        "description": "longDescription",
        "category": "category",
        "capabilities": "capabilities",
        "defaultPrompts": "defaultPrompt",
        "website": "websiteURL",
        "privacyPolicy": "privacyPolicyURL",
        "termsOfService": "termsOfServiceURL",
    }
    for submission_field, manifest_field in presentation_pairs.items():
        if openai.get(submission_field) != interface.get(manifest_field):
            raise ValueError(
                f"OpenAI {submission_field} is out of sync with Codex {manifest_field}"
            )
    if openai.get("logo") != "../../plugins/supaflow/assets/logo.png":
        raise ValueError("OpenAI logo source must reference the packaged Supaflow logo")

    tools = contract.get("tools")
    if tools != EXPECTED_TOOLS or contract.get("access") != "control_plane":
        raise ValueError("Hosted tool contract is not the reviewed control-plane allowlist")
    for tool in tools:
        lowered = tool.lower()
        if any(fragment in lowered for fragment in FORBIDDEN_REMOTE_FRAGMENTS):
            raise ValueError(f"Local capability leaked into hosted tool contract: {tool}")

    skill = (PLUGIN / "skills" / "using-supaflow" / "SKILL.md").read_text(
        encoding="utf-8"
    )
    if not skill.startswith("---\n") or "name: using-supaflow" not in skill:
        raise ValueError("Provider-neutral skill front matter is missing")
    if "retryable: true" not in skill or "Never blindly repeat" not in skill:
        raise ValueError("Provider-neutral skill must document bounded safe retries")

    snowflake_dir = ROOT / "vendors" / "snowflake"
    if (snowflake_dir / "setup.sql.template").exists():
        raise ValueError("Experimental Snowflake packaging must not ship an executable setup template")
    snowflake_readme = (snowflake_dir / "README.md").read_text(encoding="utf-8")
    required_snowflake_markers = (
        "experimental",
        "https://app.supa-flow.io/api/mcp/oauth/token",
        EXPECTED_MCP_URL,
        "supaflow:read",
        "supaflow:write",
        "authorization-code and refresh-token grants",
    )
    for marker in required_snowflake_markers:
        if marker not in snowflake_readme:
            raise ValueError(f"Experimental Snowflake documentation is missing: {marker}")

    print("Supaflow AI plugin packaging validation passed.")


if __name__ == "__main__":
    main()
