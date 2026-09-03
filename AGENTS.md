# Supaflow AI Plugins Guidelines

## Repository scope

- This repository packages Supaflow for AI clients and marketplaces. The hosted MCP runtime remains in `supaflow-app`; the local stdio MCP runtime remains in `supaflow-cli`.
- Keep provider-neutral skills and metadata in `plugins/supaflow`. Put provider-specific submission material under `vendors/`.
- Do not duplicate Supaflow business logic, database access, OAuth token exchange, or MCP tool handlers in this repository.

## Hosted versus local boundary

- The hosted MCP endpoint may expose only reviewed Supaflow control-plane tools that run entirely on Supaflow infrastructure.
- Never advertise or route agent installation, upgrade, start, stop, status, logs, removal, Docker, filesystem, process, credential-bootstrap, or other local runtime controls through the hosted MCP endpoint.
- Local agent workflows belong only to the Supaflow CLI and its local stdio MCP server. Provider packages may explain this boundary, but must not make the local agent a requirement for the hosted plugin's core workflow.

## Packaging and security

- Keep OAuth client secrets, access tokens, refresh tokens, Supabase JWTs, and private keys out of manifests, examples, tests, and documentation. Use obvious placeholders for confidential values.
- All public Supaflow URLs use `supa-flow.io` with the hyphen.
- Keep the shared MCP URL at `https://app.supa-flow.io/mcp` unless the production runtime changes.
- Provider-specific files must accurately describe the capabilities supported by that provider; do not invent a manifest format where the provider uses a portal or SQL configuration instead.
- Validate JSON files, the Codex plugin manifest, provider templates, and the hosted/local tool boundary before handoff.

## Git hygiene

- Preserve user changes and do not commit or push without explicit approval.
- Use Conventional Commits with imperative, scoped messages when a commit is requested.
