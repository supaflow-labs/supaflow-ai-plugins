# Supaflow AI plugins

Cross-vendor packaging for the official Supaflow hosted MCP integration.

The repository publishes one provider-neutral Supaflow package and keeps vendor-specific submission material separate:

| Target                  | Packaging                                                                 |
| ----------------------- | ------------------------------------------------------------------------- |
| ChatGPT / Codex         | `.codex-plugin/plugin.json`, registered OpenAI app binding, and shared skill |
| Claude                  | `.claude-plugin/plugin.json`, shared skill, and `.mcp.json`               |
| Snowflake Cortex Agents | Experimental design notes; OAuth resource forwarding is not yet validated |

The supported Codex and Claude targets connect to `https://app.supa-flow.io/mcp`. The hosted server exposes the reviewed Supaflow control plane: workspace and connector discovery, safe datasource management including restoration-aware catalog reset, project and pipeline management, pipeline runs, job monitoring/cancellation, and schedules. Snowflake packaging remains experimental until its OAuth client is proven to forward the exact MCP resource during authorization-code and refresh-token exchanges.

The hosted integration operates existing Supaflow connections. Creating a new
datasource is supported when the user selects an approved connector OAuth flow,
provides a Supaflow-encrypted credential envelope, or copies an existing
datasource configuration. When none of those paths is available, credential or
connector OAuth setup must be completed in the Supaflow UI first. Plaintext
credentials are never accepted through chat or MCP tool input.

## Local agent boundary

The Supaflow agent is always local or customer-hosted. This repository does not package agent installation or lifecycle commands into the hosted plugin. Agent, Docker, filesystem, process, and local log operations remain in `supaflow-cli` and its local stdio MCP server.

## Layout

- `plugins/supaflow`: installable provider-neutral plugin package.
- `contracts/hosted-tools.json`: reviewed hosted tool allowlist.
- `vendors/openai`: OpenAI portal listing source and submission notes.
- `vendors/claude`: Claude packaging notes.
- `vendors/snowflake`: experimental Snowflake Cortex Agent design notes; not a supported deployment package.
- `docs/architecture.md`: runtime ownership and token flow.

## Validate

Run the repository validator:

```bash
python3 scripts/validate.py
```

Then validate the Codex plugin package with the current OpenAI plugin validator before release.

## Install in Codex

The repository is a Codex marketplace with one installable plugin:

```bash
codex plugin marketplace add https://github.com/supaflow-labs/supaflow-ai-plugins.git
codex plugin add supaflow@supaflow
```

The package binds to the registered Supaflow OpenAI app. Its marketplace policy
requests authentication on install, so users connect Supaflow from the plugin
experience instead of configuring a separate raw MCP server. The registered app
connects to `https://app.supa-flow.io/mcp` with OAuth 2.1 and PKCE.

The checked-in OpenAI package contains no loopback callback, OAuth client
secret, access token, or refresh token. Loopback callbacks are reserved for the
separate local end-to-end harness.

## Release status

Version `0.2.0` adds the reviewed hosted control-plane surface for Codex and Claude. The exact contract is validated from `contracts/hosted-tools.json`; local agent lifecycle commands and local workspace selection remain CLI-only. Snowflake support is explicitly experimental and excluded from this release claim.
