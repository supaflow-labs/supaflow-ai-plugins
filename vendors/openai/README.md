# OpenAI packaging

## GitHub-only local Code edition

`plugins/supaflow-code` is a separate local Codex package in the GitHub marketplace. It launches `supaflow mcp` under `supaflow-local`, uses CLI authentication and selected workspace, and requires a local executor. Its six skills and explicit setup check replace Claude-specific commands and SessionStart injection; no hook or permission preapproval is installed. It must not be included in the hosted public ZIP below. Public local-MCP submission requires separate OpenAI eligibility/approval and is outside this release.

The production submission uses the OpenAI plugin portal's **With MCP** path and points directly to `https://app.supa-flow.io/mcp`.

`submission-source.json` records the original MCP-only submission's listing source; it is not an OpenAI upload manifest. Registering or scanning the MCP endpoint does **not** bundle repository skills automatically. The public ZIP source is now [`plugin.json`](plugin.json) and [`mcp.json`](mcp.json), with both shared skills (`setup` and `using-supaflow`) copied from `plugins/supaflow/skills` by the archive builder.

The listing links to the [ChatGPT setup guide](https://www.supa-flow.io/agentic-data-pipelines/chatgpt-plugin) and explains signup and secure credential setup. `extensions.com.openai.onboardingSkill` points to `./skills/setup/SKILL.md`. Users choose to run setup after installation; it verifies account/workspace and lists connections without creating or running resources. This does not replace OAuth consent or automatically authorize mutations.

## Prepare a public skills update

Use a Python virtual environment with PyYAML installed. From the repository root:

```bash
python scripts/validate.py
python -m unittest discover -s scripts -p 'test_openai_submission.py' -v
node --test scripts/test-hosted-mcp-resilience.test.mjs
node --test scripts/test-schema-pagination.test.mjs
python scripts/build_openai_submission.py
```

The builder creates `dist/supaflow-openai-1.1.1.zip`, then reads back and validates the **actual ZIP**. Version 1.1.1 is local next-version preparation only; do not replace the submitted 1.1.0 review or its retained archive without explicit authorization. The pagination trace tests validate traversal invariants against sparse-page and skipped-offset fixtures; they do not prove ChatGPT activation or model behavior. The builder fails if the skill, logo, or portable manifests are missing; if any extra files (including private `.app.json` or compatibility manifests) appear; or if the production endpoint changes or gains OAuth overrides. Existing archives are not overwritten: use a separate `--output-dir` for another review build.

This upload preserves the published package name `app-6abadf90c69881919b46c92f36bcfc99` and uses one remote MCP declaration with the existing endpoint and no authentication overrides. Keep the original app-bound local package unchanged. Do not upload that local package as the public ZIP.

For the existing published plugin, select **Create draft from ZIP**, not a new plugin. After an authorized upload, verify:

1. The saved draft contains both `setup` and `using-supaflow`, the intended candidate version, the onboarding reference, and the ChatGPT landing-page link.
2. The server reuses app `asdk_app_6abadf90c69881919b46c92f36bcfc99`, including its configured OAuth connection. If it instead shows a separate **Connection unknown** entry, stop and report the update as blocked; do not create a duplicate app.
3. Listing, prompts, existing review cases, reviewer access, demo, countries, and translations remain correct. The ZIP deliberately omits review cases and country targeting so it does not replace saved values. Reviewer credentials must remain only in secure portal fields.
4. Run setup against that exact saved draft in a fresh chat and after installing during an existing chat. Verify connected and disconnected accounts, ambiguous and empty workspaces, and missing connections; confirm setup performs only read-only calls. Then run the operational skill workflow. An MCP-only test of published `1.0.0` does not validate either new skill.
5. Resolve applicable scan findings and have the publisher complete current attestations before submitting. Submission and publication remain separate authorized steps.

Future app-only publication can restore an auto-generated package and remove ZIP-added skills. Use the package/ZIP update path for subsequent skill releases and check the saved skill inventory every time.

The release preparation and remaining online checks are recorded in [`release-preparation.md`](release-preparation.md).

Before submission:

1. Deploy the MCP endpoint on stable public HTTPS.
2. Verify OAuth discovery and callback behavior for the OpenAI client.
3. Confirm the Clerk client grants `user:org:read`, `supaflow:read`,
   `supaflow:write`, and `offline_access`.
4. Scan tools and confirm the exact names in `contracts/hosted-tools.json`
   and the read/write OAuth scheme on every descriptor.
5. Confirm every tool has accurate input, output, read-only/idempotent/destructive, and safety metadata.
6. Run the direct, indirect, invalid-input, cross-tenant, and out-of-scope evaluation set.
7. Complete domain and publisher verification in the portal.

For the installable ChatGPT/Codex marketplace package, verify that `.app.json`
binds to the reviewed Supaflow OpenAI app and that the Codex manifest declares
that app instead of a duplicate raw MCP server. The registered OpenAI app owns
the production MCP URL and OAuth callback. Never package a loopback callback,
Clerk client secret, access token, or refresh token.

The hosted plugin does not include or invoke the local Supaflow agent commands.
OpenAI clients should honor typed retry hints only for bounded read/status
polling. After an ambiguous mutation failure, inspect the matching resource or
job state before repeating the write.

The release description must state that the hosted plugin operates existing
Supaflow connections. New datasource creation requires an approved connector
OAuth flow, a Supaflow-encrypted credential envelope, or an existing datasource
whose configuration can be copied. Otherwise, users complete credential setup
in the Supaflow UI. Never ask users to put plaintext datasource credentials in
chat or MCP input.

## Review demo recording

Use the Playwright harness in [`demo/`](demo/README.md) to prepare the persistent
ChatGPT browser profile, probe whether Supaflow OAuth uses the same page or a
popup, and record the reviewer workflow. Enable Developer mode in that
persistent profile before recording. Supaflow sign-in must follow **Use another
method** → **Sign in with your password** so the dedicated review account does
not wait for an email OTP.

## Local OAuth and tool-catalog test

### Installed production package

Create or refresh an ignored local marketplace copy, install
`supaflow@personal`, and connect the required Supaflow app from the plugin page.
Verify that authentication is offered on the plugin/app row and that no
duplicate raw Supaflow MCP entry is installed. From a fresh task, verify at
least `workspaces_list` and `jobs_list` before exercising any write. The
authorization request must contain `resource=https://app.supa-flow.io/mcp`
plus `offline_access`, `user:org:read`, `supaflow:read`, and `supaflow:write`.

The loopback OAuth client remains available only to the hosted-server lifecycle
harness below. It is not part of the installable OpenAI package.

### Hosted server lifecycle harness

For MCP Inspector and reviewer Salesforce fixtures, use the shared
[hosted MCP testing runbook](../../docs/hosted-mcp-testing.md). It runs this same
lifecycle through the Inspector CLI and produces a sanitized coverage report.

The production plugin manifest always points to `https://app.supa-flow.io/mcp`.
For a local run, use a generated, ignored marketplace copy that points to
`http://localhost:3000/mcp`; never change the production manifest to a local
URL and never commit an OAuth client secret.

The end-to-end runner uses an existing public Clerk test client with PKCE. It
keeps access and refresh tokens in memory, prints no Supaflow resource IDs or
resource contents, verifies the resource-bound Supaflow access-token claims,
checks both copies of every tool's read/write OAuth scheme, and invokes every
hosted tool. Before running it, configure the dedicated MCP signing key and the
test client ID in the untracked `supaflow-app/.env.development.local` as described in
`supaflow-app/docs/MCP_HOSTED_SERVER.md`, then restart the user-managed app:

```bash
SUPAFLOW_OAUTH_CLIENT_ID='<public-test-client-id>' \
SUPAFLOW_OAUTH_REDIRECT_URI='<registered-loopback-callback>' \
SUPAFLOW_E2E_SOURCE_DATASOURCE_ID='<docker-backed-source-template-id>' \
SUPAFLOW_E2E_DESTINATION_PROJECT_ID='<snowflake-project-id>' \
SUPAFLOW_E2E_OBJECTS='<object-one>,<object-two>' \
SUPAFLOW_E2E_DESTINATION_WRITES_ACK=I_ACCEPT_TEST_DESTINATION_WRITES \
SUPAFLOW_LIVE_MUTATIONS=true \
node scripts/test-hosted-mcp-oauth.mjs
```

Open the printed authorization URL in a browser, approve access, and leave the
runner active until it reports OAuth, all 47 tool calls, live job completion and cancellation, catalog-reset restoration, and fixture cleanup. Use a Docker-backed source template, a Snowflake destination project, and two to five small explicit objects. The runner copies the source configuration server-side, writes through a unique `mcp_e2e_*` pipeline prefix, creates temporary control-plane resources, verifies catalog reset preserves the selected pipeline objects, and deletes those resources in a `finally` cleanup path. Destination tables or rows can outlive control-plane cleanup, which is why the destination-write acknowledgement is mandatory.

Run `node --test scripts/test-hosted-mcp-resilience.test.mjs` first to inject
transport, retryable HTTP, typed tool, and permanent failures into the polling
client without mutating DEV resources.
