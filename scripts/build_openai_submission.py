#!/usr/bin/env python3
"""Build the public update separately from the registered-app local package."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import yaml

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_NAME = "app-6abadf90c69881919b46c92f36bcfc99"
MCP_URL = "https://app.supa-flow.io/mcp"
REQUIRED_SKILLS = {"using-supaflow", "setup"}
LANDING_URL = "https://www.supa-flow.io/agentic-data-pipelines/chatgpt-plugin"


def validate_bundle(files: dict[str, bytes]) -> dict:
    """Validate the final upload inventory, not just the source manifest."""
    if any(Path(name).is_absolute() or ".." in Path(name).parts for name in files):
        raise ValueError("Archive paths must stay inside the plugin")
    allowed = {"plugin.json", "mcp.json", "assets/logo.png"} | {
        f"skills/{name}/SKILL.md" for name in REQUIRED_SKILLS
    }
    if set(files) != allowed:
        raise ValueError("Public bundle must contain exactly the manifest, MCP config, logo, and required skills")
    manifest = json.loads(files["plugin.json"])
    if manifest.get("$schema") != "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json":
        raise ValueError("Portable plugin schema is required")
    if manifest.get("name") != PACKAGE_NAME:
        raise ValueError("Preserve the published package identity")
    if not re.fullmatch(r"\d+\.\d+\.\d+", manifest.get("version", "")):
        raise ValueError("A semantic release version is required")
    extension = manifest["extensions"]["com.openai"]
    if extension.get("onboardingSkill") != "./skills/setup/SKILL.md":
        raise ValueError("Onboarding must resolve to the bundled setup skill")
    if any(key in manifest for key in ("apps", "skills", "mcpServers", "interface")) or "apps" in extension:
        raise ValueError("Do not include registered app bindings in a public upload")
    interface = extension["interface"]
    if manifest.get("homepage") != LANDING_URL or interface.get("websiteURL") != LANDING_URL:
        raise ValueError("Link the listing to the ChatGPT setup guide")
    for key, limit in (("displayName", 30), ("shortDescription", 30), ("longDescription", 4000), ("developerName", 80)):
        value = interface.get(key)
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ValueError(f"Invalid listing field: {key}")
    for key in ("websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"):
        value = interface.get(key, "")
        if not value.startswith("https://www.supa-flow.io") or len(value) > 1024:
            raise ValueError(f"Invalid listing URL: {key}")
    prompts = interface["defaultPrompt"]
    if not isinstance(prompts, list) or not 1 <= len(prompts) <= 3:
        raise ValueError("Supply one to three starter prompts")
    if any(not isinstance(p, str) or not p.strip() or len(p) > 128 or "\n" in p or "@" in p for p in prompts):
        raise ValueError("Invalid starter prompt")
    if len({" ".join(p.split()) for p in prompts}) != len(prompts):
        raise ValueError("Starter prompts must be unique")
    if interface.get("logo") != "./assets/logo.png" or interface.get("composerIcon") != "./assets/logo.png":
        raise ValueError("Both icons must reference the bundled logo")
    logo = files["assets/logo.png"]
    if not logo.startswith(b"\x89PNG\r\n\x1a\n") or len(logo) > 5 * 1024 * 1024:
        raise ValueError("A square PNG logo up to 5 MiB is required")
    width = int.from_bytes(logo[16:20], "big")
    height = int.from_bytes(logo[20:24], "big")
    if width != height or not 256 <= width <= 4096:
        raise ValueError("The listing logo must be square and 256–4096 pixels")
    mcp = json.loads(files["mcp.json"])
    if mcp != {
        "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        "mcpServers": {"supaflow": {"type": "streamable-http", "url": MCP_URL}},
    }:
        raise ValueError("Reuse the single production MCP endpoint without OAuth overrides")
    tools = set(json.loads((ROOT / "contracts" / "hosted-tools.json").read_text())["tools"])
    for name in REQUIRED_SKILLS:
        skill = files[f"skills/{name}/SKILL.md"].decode("utf-8")
        if len(files[f"skills/{name}/SKILL.md"]) > 1024 * 1024 or not skill.startswith("---\n"):
            raise ValueError("Skill requires UTF-8 YAML frontmatter and must fit within 1 MiB")
        parts = skill.split("---\n", 2)
        if len(parts) != 3:
            raise ValueError("Skill frontmatter must be closed")
        frontmatter = yaml.safe_load(parts[1])
        if not isinstance(frontmatter, dict) or frontmatter.get("name") != name or not isinstance(frontmatter.get("description"), str) or not frontmatter["description"].strip():
            raise ValueError("Skill frontmatter must match its directory and describe when to use it")
        for tool in re.findall(r"`([a-z]+_[a-z_]+)`", parts[2]):
            if tool not in tools and tool not in {"workspace_id", "organization_id", "after_id", "has_more", "with_fields", "retry_after_ms", "maintenance_active", "full_resync", "reset_target", "copy_from_identifier", "completed_with_warning", "timed_out"}:
                raise ValueError(f"Skill references an unknown hosted tool: {tool}")
    return manifest


def source_files() -> dict[str, bytes]:
    files = {
        name: (ROOT / "vendors" / "openai" / name).read_bytes()
        for name in ("plugin.json", "mcp.json")
    }
    plugin = ROOT / "plugins" / "supaflow"
    files["assets/logo.png"] = (plugin / "assets" / "logo.png").read_bytes()
    for name in REQUIRED_SKILLS:
        path = f"skills/{name}/SKILL.md"
        files[path] = (plugin / path).read_bytes()
    return files


def build(output: Path) -> Path:
    files = source_files()
    manifest = validate_bundle(files)
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"supaflow-openai-{manifest['version']}.zip"
    # Do not overwrite a prior review artifact silently.
    with ZipFile(archive, "x", compression=ZIP_DEFLATED) as bundle:
        for name, content in sorted(files.items()):
            bundle.writestr(name, content)
    with ZipFile(archive) as bundle:
        validate_bundle({name: bundle.read(name) for name in bundle.namelist()})
    return archive


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    print(build(parser.parse_args().output_dir))
