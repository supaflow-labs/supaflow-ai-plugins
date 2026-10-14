#!/usr/bin/env python3
"""Validate cross-vendor Supaflow plugin packaging invariants."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "supaflow"
EXPECTED_MCP_URL = "https://app.supa-flow.io/mcp"
EXPECTED_OPENAI_APP_ID = "asdk_app_6abadf90c69881919b46c92f36bcfc99"
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


def validate_code_package(package: Path) -> None:
    manifest = read_json(package / "plugin.json")
    if manifest.get("$schema") != "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json" or manifest.get("name") != "supaflow-code":
        raise ValueError("Supaflow Code requires its own portable manifest")
    extension = manifest.get("extensions", {}).get("com.openai", {})
    if extension.get("requires_local_executor") is not True:
        raise ValueError("Supaflow Code requires local execution")
    if any(key in manifest or key in extension for key in ("apps", "hooks", "mcpServers")):
        raise ValueError("Supaflow Code must not import hosted bindings or host-specific hooks")
    if any((package / name).exists() for name in (".app.json", "hooks", "commands", ".claude-plugin")):
        raise ValueError("Supaflow Code must not ship Claude commands, hooks, or hosted app bindings")
    mcp = read_json(package / "mcp.json")
    if mcp != {
        "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        "mcpServers": {"supaflow-local": {"type": "stdio", "command": "supaflow", "args": ["mcp"]}},
    }:
        raise ValueError("Supaflow Code must launch only the existing local CLI MCP server")
    expected_skills = {"using-supaflow-code", "supaflow-code-agents", "supaflow-code-datasources", "supaflow-code-pipelines", "supaflow-code-jobs", "supaflow-code-schedules"}
    if {p.parent.name for p in (package / "skills").glob("*/SKILL.md")} != expected_skills:
        raise ValueError("Supaflow Code workflow inventory is incomplete")
    if extension.get("onboardingSkill") != "./skills/using-supaflow-code/SKILL.md":
        raise ValueError("Supaflow Code setup must invoke its local entry skill")
    for name in ("README.md", "LICENSE", "scripts/check-setup.mjs"):
        if not (package / name).is_file():
            raise ValueError(f"Supaflow Code package is missing {name}")


def main() -> None:
    codex = read_json(PLUGIN / ".codex-plugin" / "plugin.json")
    claude = read_json(PLUGIN / ".claude-plugin" / "plugin.json")
    app = read_json(PLUGIN / ".app.json")
    mcp = read_json(PLUGIN / ".mcp.json")
    contract = read_json(ROOT / "contracts" / "hosted-tools.json")
    openai = read_json(ROOT / "vendors" / "openai" / "submission-source.json")
    marketplace = read_json(ROOT / ".agents" / "plugins" / "marketplace.json")

    if codex.get("name") != PLUGIN.name or claude.get("name") != PLUGIN.name:
        raise ValueError("Plugin folder and manifest names must match")
    if codex.get("version") != claude.get("version"):
        raise ValueError("Codex and Claude plugin versions must match")

    expected_app = {
        "apps": {
            "supaflow": {
                "id": EXPECTED_OPENAI_APP_ID,
                "required": True,
            }
        }
    }
    if codex.get("apps") != "./.app.json" or app != expected_app:
        raise ValueError("Codex must bind to the reviewed OpenAI Supaflow app")
    if codex.get("mcpServers") is not None:
        raise ValueError("Codex must not install Supaflow as a duplicate raw MCP server")

    server = mcp.get("mcpServers", {}).get("supaflow", {})
    expected_server = {"type": "http", "url": EXPECTED_MCP_URL}
    if server != expected_server:
        raise ValueError(
            "The Claude MCP config must contain only the hosted endpoint and rely on OAuth discovery"
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
            },
            {
                "name": "supaflow-code",
                "source": {"source": "local", "path": "./plugins/supaflow-code"},
                "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
                "category": "Developer Tools",
            },
        ],
    }
    if marketplace != expected_marketplace:
        raise ValueError("Codex marketplace descriptor is out of sync")
    validate_code_package(ROOT / "plugins" / "supaflow-code")

    interface = codex.get("interface", {})
    if codex.get("author", {}).get("name") != interface.get("developerName"):
        raise ValueError("Codex author name must match the OpenAI developer name")
    presentation_pairs = {
        "displayName": "displayName",
        "developerName": "developerName",
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

    display_name = interface.get("displayName")
    short_description = interface.get("shortDescription")
    long_description = interface.get("longDescription")
    default_prompts = interface.get("defaultPrompt")
    if (
        not isinstance(display_name, str)
        or not display_name
        or len(display_name) > 30
        or "\n" in display_name
    ):
        raise ValueError(
            "OpenAI displayName must be a non-empty single line of at most 30 characters"
        )
    if (
        not isinstance(short_description, str)
        or not short_description
        or len(short_description) > 30
        or "\n" in short_description
    ):
        raise ValueError(
            "OpenAI shortDescription must be a non-empty single line of at most 30 characters"
        )
    if (
        not isinstance(long_description, str)
        or not long_description
        or len(long_description) > 4000
    ):
        raise ValueError("OpenAI longDescription must contain at most 4,000 characters")
    if (
        not isinstance(default_prompts, list)
        or not 1 <= len(default_prompts) <= 3
    ):
        raise ValueError("OpenAI defaultPrompt must contain between one and three prompts")
    if any(
        not isinstance(prompt, str)
        or not prompt
        or len(prompt) > 128
        or "\n" in prompt
        or "@" in prompt
        for prompt in default_prompts
    ):
        raise ValueError(
            "Each OpenAI starter prompt must be a non-empty single line of at most 128 characters without @mentions"
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
