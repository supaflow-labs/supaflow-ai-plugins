#!/usr/bin/env python3
"""Build a CoCo plugin with shared hosted skills and Snowflake-specific setup."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "vendors/snowflake/cortex-code"
DRAFT_CLIENT_ID = "REPLACE_WITH_PUBLIC_CORTEX_CLIENT_ID"
MCP_URL = "https://app.supa-flow.io/mcp"
SCOPES = "email profile offline_access user:org:read supaflow:read supaflow:write"
NATIVE_SKILL = "skills/setup-supaflow-native-app/SKILL.md"
INVENTORY = {
    ".cortex-plugin/plugin.json", ".cortex-plugin/activation.md", ".mcp.json",
    "README.md", "SETUP.md", "LICENSE", "NOTICE", "assets/logo.png",
    "skills/setup/SKILL.md", "skills/using-supaflow/SKILL.md",
    NATIVE_SKILL,
}


def development_url(url: str) -> str:
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.path != "/mcp" or parsed.query or parsed.fragment
            or parsed.hostname == "app.supa-flow.io"):
        raise ValueError("Development builds require a separate HTTPS MCP URL without credentials or query")
    return url


def cortex_hosted_skill(name: str) -> bytes:
    """Apply CoCo catalog metadata without editing provider-neutral skill sources."""
    shared = ROOT / "plugins/supaflow/skills" / name / "SKILL.md"
    _, _, body = shared.read_text().split("---\n", 2)
    metadata = json.loads((SOURCE / "hosted-skill-frontmatter.json").read_text())[name]
    if name == "setup":
        reference = "[Supaflow workflow skill](../using-supaflow/SKILL.md)"
        if body.count(reference) != 1:
            raise ValueError("Shared setup workflow reference changed; review the CoCo adaptation")
        body = body.replace(reference, "`using-supaflow` skill bundled with this plugin")
    # JSON values are valid YAML scalars/flow lists; no YAML dependency is needed.
    header = "\n".join(f"{key}: {json.dumps(value)}" for key, value in metadata.items())
    return ("---\n" + header + "\n---\n" + body).encode()


def source_files(client_id: str | None = None, *, dev_mcp_url: str | None = None) -> dict[str, bytes]:
    files = {
        dest: (SOURCE / source).read_bytes()
        for dest, source in {
            ".cortex-plugin/plugin.json": "plugin.json",
            ".cortex-plugin/activation.md": "activation.md",
            "README.md": "README.md", "SETUP.md": "SETUP.md",
            NATIVE_SKILL: NATIVE_SKILL,
        }.items()
    }
    mcp = json.loads((SOURCE / "mcp.json").read_text())
    if client_id is not None:
        mcp["mcpServers"]["supaflow"]["oauth"]["client_id"] = client_id
    if dev_mcp_url is not None:
        server = mcp["mcpServers"].pop("supaflow")
        server["url"] = development_url(dev_mcp_url)
        server["oauth"]["client_name"] = "Supaflow Cortex Code DEV"
        mcp["mcpServers"]["supaflow-dev"] = server
        manifest = json.loads(files[".cortex-plugin/plugin.json"])
        manifest["name"] = "supaflow-dev"
        files[".cortex-plugin/plugin.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
        files["README.md"] = b"# Development test package\n\nNot for publication. Uses a DEV Clerk client and temporary HTTPS tunnel.\n\n" + files["README.md"]
        files["SETUP.md"] = (b"# Development setup override\n\nUse http://localhost:3000/settings/api-keys for this test account, "
                             b"and connect the `supaflow-dev` server. Shared skills retain production "
                             b"documentation links; use the local dashboard for DEV hosted account changes. "
                             b"Native App setup is independent: the published Native App keeps its production "
                             b"Supaflow sign-in and must be verified in that environment.\n\n"
                             + files["SETUP.md"])
    files[".mcp.json"] = (json.dumps(mcp, indent=2) + "\n").encode()
    shared = ROOT / "plugins/supaflow"
    files["assets/logo.png"] = (shared / "assets/logo.png").read_bytes()
    for name in ("setup", "using-supaflow"):
        files[f"skills/{name}/SKILL.md"] = cortex_hosted_skill(name)
    files["LICENSE"] = (SOURCE / "LICENSE").read_bytes()
    files["NOTICE"] = (SOURCE / "NOTICE").read_bytes()
    return files


def validate_bundle(files: dict[str, bytes], *, draft: bool = False, dev_mcp_url: str | None = None) -> dict:
    if draft and dev_mcp_url is not None:
        raise ValueError("Development tests require a registered client, not draft mode")
    plugin_name = "supaflow-dev" if dev_mcp_url is not None else "supaflow"
    if set(files) != INVENTORY:
        raise ValueError("CoCo package must contain exactly the reviewed inventory")
    if any(len(content) > 2 * 1024 * 1024 for content in files.values()) or sum(map(len, files.values())) > 10 * 1024 * 1024:
        raise ValueError("Package exceeds default Cortex Extension file limits")
    manifest = json.loads(files[".cortex-plugin/plugin.json"])
    if set(manifest) != {"name", "version", "description", "author", "skills", "mcpServers"}:
        raise ValueError("Unexpected manifest fields: no hooks, local executors, or app bindings")
    if manifest["name"] != plugin_name or not re.fullmatch(r"\d+\.\d+\.\d+", manifest["version"]):
        raise ValueError("Invalid plugin identity/version")
    if manifest["skills"] != ["./skills"] or manifest["mcpServers"] != "./.mcp.json":
        raise ValueError("Manifest references must resolve inside the package")
    if not manifest["description"] or manifest["author"] != {"name": "Supaflow, LLC", "url": "https://www.supa-flow.io"}:
        raise ValueError("Invalid plugin description or author")
    mcp = json.loads(files[".mcp.json"])
    client_id = mcp.get("mcpServers", {}).get(plugin_name, {}).get("oauth", {}).get("client_id")
    if not isinstance(client_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{3,256}", client_id):
        raise ValueError("Supply a registered public Clerk client ID, never a secret or token")
    if not draft and (client_id == DRAFT_CLIENT_ID or re.search(r"placeholder|replace|example|fixture", client_id, re.I)):
        raise ValueError("Release builds require the real registered public CoCo client ID")
    expected = {"mcpServers": {plugin_name: {
        "type": "http", "url": development_url(dev_mcp_url) if dev_mcp_url is not None else MCP_URL,
        "oauth": {"client_id": client_id, "client_name": "Supaflow Cortex Code DEV" if dev_mcp_url is not None else "Supaflow for Snowflake Cortex Code",
                  "redirect_port": 8585, "scope": SCOPES},
    }}}
    if mcp != expected:
        raise ValueError("Use only hosted HTTP MCP and public OAuth with metadata discovery")
    for name in ("setup", "using-supaflow"):
        path = f"skills/{name}/SKILL.md"
        if files[path] != cortex_hosted_skill(name):
            raise ValueError("Hosted skills must match the reviewed CoCo adaptation of shared sources")
    if files[NATIVE_SKILL] != (SOURCE / NATIVE_SKILL).read_bytes():
        raise ValueError("Native App setup must match the reviewed CoCo-specific source")
    if files["LICENSE"] != (SOURCE / "LICENSE").read_bytes():
        raise ValueError("Preserve the approved CoCo Apache 2.0 license")
    if (files["NOTICE"] != (SOURCE / "NOTICE").read_bytes()
            or (ROOT / "LICENSE").read_bytes() not in files["NOTICE"]):
        raise ValueError("Preserve the shared content's original MIT notice")
    # Every relative Markdown link must resolve in the shipped package.
    for name, content in files.items():
        if not name.endswith(".md"):
            continue
        for target in re.findall(r"\]\(([^)]+)\)", content.decode()):
            if target.startswith(("https://", "#")):
                continue
            from posixpath import normpath
            destination = normpath(str(Path(name).parent / target))
            if destination not in files:
                raise ValueError(f"Unresolved package link in {name}")
    return manifest


def build(output: Path, client_id: str | None = None, *, draft: bool = False, dev_mcp_url: str | None = None) -> Path:
    files = source_files(client_id, dev_mcp_url=dev_mcp_url)
    manifest = validate_bundle(files, draft=draft, dev_mcp_url=dev_mcp_url)
    name = f"supaflow-cortex-{manifest['version']}" + ("-dev" if dev_mcp_url is not None else "-draft" if draft else "")
    directory = output / name
    archive = output / f"{name}.zip"
    if directory.exists() or archive.exists():
        raise FileExistsError("Use a new output directory; existing review artifacts are not overwritten")
    directory.mkdir(parents=True)
    for name, content in sorted(files.items()):
        target = directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    with ZipFile(archive, "x", compression=ZIP_DEFLATED) as bundle:
        for name, content in sorted(files.items()):
            bundle.writestr(name, content)
    with ZipFile(archive) as bundle:
        validate_bundle({name: bundle.read(name) for name in bundle.namelist()}, draft=draft, dev_mcp_url=dev_mcp_url)
    return directory


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    parser.add_argument("--client-id", help="Registered public CoCo client ID (not a secret)")
    parser.add_argument("--draft", action="store_true", help="Allow the placeholder for offline review only")
    parser.add_argument("--dev-mcp-url", help="Build an isolated supaflow-dev test package for an HTTPS tunnel")
    args = parser.parse_args()
    print(build(args.output_dir, args.client_id, draft=args.draft, dev_mcp_url=args.dev_mcp_url))
