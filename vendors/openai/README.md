# OpenAI packaging

The production submission uses the OpenAI plugin portal's **With MCP** path and points directly to `https://app.supa-flow.io/mcp`.

`submission-source.json` is the repository source of truth for listing fields; it is not an OpenAI upload manifest. The portal scans the MCP endpoint for tools and accepts the provider-neutral skill from `plugins/supaflow/skills/using-supaflow` as part of the same draft.

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

For the installable Codex package, also verify that `.mcp.json` contains the
reviewed public PKCE client ID and the exact server-specific loopback callback.
The matching callback must remain registered in Clerk. Never package the Clerk
client secret.

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

## Local OAuth and tool-catalog test

### Installed production package

Create or refresh an ignored local marketplace copy, install
`supaflow@personal`, and authorize the remote server from a fresh Codex task.
Verify at least `workspaces_list` and `jobs_list` before exercising any write.
The expected redirect is
`http://127.0.0.1:8765/callback/BurW79bZPaVW`, and the authorization request
must contain `resource=https://app.supa-flow.io/mcp` plus `offline_access`,
`user:org:read`, `supaflow:read`, and `supaflow:write`.

If a Codex runtime reports that plugin `callbackPort` is ignored, set its global
MCP OAuth callback listener to port `8765` for that compatibility test. Do not
change the registered callback or package a secret to work around a client-side
listener regression.

### Hosted server lifecycle harness

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
