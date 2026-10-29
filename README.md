# Supaflow AI plugins

Packaging for hosted Supaflow integrations and local Supaflow Code workflows.

The repository offers hosted Supaflow and a separate GitHub-installed Supaflow Code package for local Codex. Vendor-specific public submission material stays separate:

| Target                  | Packaging                                                                 |
| ----------------------- | ------------------------------------------------------------------------- |
| ChatGPT / Codex         | `.codex-plugin/plugin.json`, registered OpenAI app binding, and shared skill |
| Local Codex            | `plugins/supaflow-code`: portable manifest, local stdio MCP, local workflow skills and setup checks |
| Claude                  | `.claude-plugin/plugin.json`, shared skill, and `.mcp.json`               |
| Snowflake Cortex Code CLI | Hosted OAuth candidate assembled from shared skills; [design and submission](vendors/snowflake/cortex-code/DESIGN.md) |
| Snowflake Cortex Agents | Experimental design notes; OAuth resource forwarding is not yet validated |

The hosted Codex and Claude targets connect to `https://app.supa-flow.io/mcp`. Supaflow Code instead launches the installed `supaflow mcp` locally; it does not use that hosted connection. The hosted server exposes the reviewed Supaflow control plane: workspace and connector discovery, safe datasource management including restoration-aware catalog reset, project and pipeline management, pipeline runs, job monitoring/cancellation, and schedules. The CoCo candidate uses the same hosted endpoint with a dedicated public OAuth client; live CoCo authorization and refresh remain release gates. Cortex Agents are a separate experimental target.

The hosted integration operates existing Supaflow connections. Creating a new
datasource is supported when the user selects an approved connector OAuth flow,
provides a Supaflow-encrypted credential envelope, or copies an existing
datasource configuration. When none of those paths is available, credential or
connector OAuth setup must be completed in the Supaflow UI first. Plaintext
credentials are never accepted through chat or MCP tool input.

## Enable account access before connecting

Access is off by default. An organization administrator or personal-account owner must select the intended account in [Supaflow Settings > API Keys](https://app.supa-flow.io/settings/api-keys), open **Permissions**, check **Enable API access**, and select the supported hosted application under **OAuth applications**: **ChatGPT** for the ChatGPT integration or **Claude** for the Claude integration. Click **Save changes**, review, then **Save access settings** before connecting. API keys are not required for hosted OAuth. Unknown or unchecked OAuth clients are denied; a different host is not automatically allowed because it uses MCP.

Local Supaflow Code uses **Supaflow CLI** OAuth or **Allow API keys**, independently of hosted application selection. See the [API access guide](https://www.supa-flow.io/docs/settings/api-keys#enable-api-access-first). On denial, check account, administrator role and saved permissions before reconnecting; a connected label alone does not verify access. Do not enable access automatically. Native agents and OTP enrollment/recovery remain independent.

## Local agent boundary

The Supaflow agent is always local or customer-hosted. This repository does not package agent installation or lifecycle commands into the hosted plugin. Agent, Docker, filesystem, process, and local log operations remain in `supaflow-cli` and its local stdio MCP server.

## Layout

- `plugins/supaflow`: installable provider-neutral plugin package.
- `plugins/supaflow-code`: self-contained GitHub-installed local Codex package; see its README for CLI setup and installation.
- `contracts/hosted-tools.json`: reviewed hosted tool allowlist.
- `vendors/openai`: OpenAI portal listing source and submission notes.
- `vendors/claude`: Claude packaging notes.
- `vendors/snowflake`: separate Cortex Code packaging and experimental Cortex Agent notes.
- `docs/architecture.md`: runtime ownership and token flow.

## Validate

Run the repository validator:

```bash
python3 scripts/validate.py
node --test scripts/test-supaflow-code.test.mjs
```

Then validate the Codex plugin package with the current OpenAI plugin validator before release.

For CoCo, follow [the build and submission checklist](vendors/snowflake/cortex-code/SUBMISSION.md).
The builder emits a self-contained directory and ZIP, excludes other providers'
bindings, and adapts the shared hosted skills with CoCo catalog metadata without
editing the ChatGPT/Claude sources. Draft artifacts cannot be released
without a dedicated registered public client ID and the live OAuth checks.

### Test all hosted tools through MCP Inspector

Follow [the hosted MCP testing runbook](docs/hosted-mcp-testing.md) for Inspector
installation, reviewer OAuth setup, fixture selection, the full lifecycle suite,
and sanitized coverage reports. Both Inspector and the direct OAuth client use
the same lifecycle and cleanup code.

### Test OAuth without Snowflake compute

Use a registered public development OAuth client with the loopback redirect
below. Run against the existing local Supaflow app:

```bash
SUPAFLOW_OAUTH_CLIENT_ID='<PUBLIC_DEV_CLIENT_ID>' \
SUPAFLOW_OAUTH_REDIRECT_URI='http://127.0.0.1:8765/callback' \
SUPAFLOW_MCP_URL='http://localhost:3000/mcp' \
SUPAFLOW_OAUTH_ONLY=true \
node scripts/test-hosted-mcp-oauth.mjs
```

Open the printed authorization URL and sign in with a development account.
This mode checks PKCE authorization, resource-bound token claims, refresh, and
authenticated tool discovery, then exits before any data operations. Tokens
remain in process memory. It does not start Streamlit or Snowflake compute and
does not prove Snowflake's own OAuth client or native-agent enrollment.

## Install in Codex

The repository is a Codex marketplace with two distinct editions. For hosted Supaflow:

```bash
codex plugin marketplace add https://github.com/supaflow-labs/supaflow-ai-plugins.git
codex plugin add supaflow@supaflow
```

The package binds to the registered Supaflow OpenAI app. Its marketplace policy
requests authentication on install, so users connect Supaflow from the plugin
experience instead of configuring a separate raw MCP server. The registered app
connects to `https://app.supa-flow.io/mcp` with OAuth 2.1 and PKCE.

For local CLI/private-agent workflows, install **Supaflow Code** instead:

```bash
codex plugin marketplace add https://github.com/supaflow-labs/supaflow-ai-plugins.git
codex plugin add supaflow-code@supaflow
```

Use a local Codex session with Node.js 18+, Supaflow CLI 0.5.0+, CLI authentication, and a selected workspace. Docker is needed only for agent operations. Follow [the Code package setup](plugins/supaflow-code/README.md). No Claude-specific hooks, slash commands, or tool preapprovals are carried over. Both editions can coexist, but their accounts and execution contracts are separate. Do not add a duplicate manual `supaflow-local` registration. Code is GitHub-only; do not include it in the hosted public submission ZIP or imply browser/cloud support.

The checked-in OpenAI package contains no loopback callback, OAuth client
secret, access token, or refresh token. Loopback callbacks are reserved for the
separate local end-to-end harness.

## Release status

Version `0.2.0` adds the reviewed hosted control-plane surface for Codex and Claude. The exact contract is validated from `contracts/hosted-tools.json`; local agent lifecycle commands and local workspace selection remain CLI-only. The separate CoCo candidate and experimental Cortex Agent work are excluded from this release claim.
