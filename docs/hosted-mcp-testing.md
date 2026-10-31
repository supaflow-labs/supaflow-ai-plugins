# Hosted MCP development testing

Run commands from the `supaflow-ai-plugins` repository root. The reviewed tool
list is `contracts/hosted-tools.json`; the suite currently covers 47 hosted tools.
Inspector and the direct OAuth runner share `scripts/test-hosted-mcp-oauth.mjs`,
including catalog reset recovery, job polling, cancellation, and cleanup.

## Local regression checks

These tests need no credentials, running app, database, or destination compute:

```sh
node --test scripts/test-hosted-mcp-inspector.test.mjs scripts/test-hosted-mcp-resilience.test.mjs scripts/test-hosted-mcp-keyless-policy.test.mjs
python3 scripts/validate.py
```

Run them when changing the adapter or lifecycle. Run the live suite against the
intended deployed app before claiming end-to-end coverage. Unit tests alone do
not satisfy a marketplace requirement to execute every tool.

## Inspector setup and authentication

Install the tested Inspector version from npm, retaining the install-script policy:

```sh
npm install --global --ignore-scripts @modelcontextprotocol/inspector@2.12.0
mcp-inspector --version
```

Alternatively, point `SUPAFLOW_INSPECTOR_BIN` at an existing installation's
`mcp-inspector` executable. This is an executable path, not a shell command.
The harness does not install or upgrade Inspector automatically.

Provision a Clerk public PKCE OAuth client with the registered loopback callback
`http://127.0.0.1:6276/oauth/callback` and the scopes `email`, `profile`,
`offline_access`, `user:org:read`, `supaflow:read`, and `supaflow:write`. The target
app must have `CLERK_MCP_INSPECTOR_OAUTH_CLIENT_ID` set to that exact client ID and
support the `mcp_inspector` policy key (migration 221). The account owner or
organization administrator must explicitly enable MCP Inspector in API access.
Registration by itself does not grant access. These setup changes are separate
from running the test; the harness never modifies access policy.

Select the endpoint and public client ID explicitly, then authenticate using
Inspector. For local development, use the existing user-managed app; do not
start or restart it as part of this test.

```sh
export SUPAFLOW_MCP_URL='http://localhost:3000/mcp'
export SUPAFLOW_OAUTH_CLIENT_ID='<public-inspector-client-id>'
export MCP_STORAGE_DIR="$HOME/.mcp-inspector-supaflow-review"
export MCP_AUTO_OPEN_ENABLED=false
mcp-inspector --cli \
  --server-url "$SUPAFLOW_MCP_URL" --transport http \
  --client-id "$SUPAFLOW_OAUTH_CLIENT_ID" \
  --callback-url http://127.0.0.1:6276/oauth/callback \
  --method tools/list --format json
```

Open Inspector's printed authorization URL in the Codex in-app browser, verify
the reviewer account and target organization, and authorize. Keep the CLI alive
until the callback completes. For an explicitly authorized production run, set
`SUPAFLOW_MCP_URL=https://app.supa-flow.io/mcp` before authentication and testing.
A session for a different endpoint/account is not interchangeable.

Inspector owns token exchange, refresh, and storage. Use its default OS keychain
where available. If the keychain is unavailable, use Inspector's encrypted file
store with `MCP_INSPECTOR_SECRET_STORE=file` and
`MCP_INSPECTOR_SECRET_KEY_FILE` pointing to a private key file outside this
repository. Set those same variables for authentication and the test run. Do not
print tokens, use bearer-token command arguments, or put OAuth files in Git.
See [Inspector secret storage](https://github.com/modelcontextprotocol/inspector/blob/main/docs/secret-storage.md).

The test adapter uses `--stored-auth-only`; missing/expired auth fails rather than
opening an unattended login or falling back to another account. Reauthenticate
through Inspector when necessary. It never reads the secret store itself.

A read-only connection/catalog check is available before fixtures are selected:

```sh
SUPAFLOW_MCP_TEST_CLIENT=inspector SUPAFLOW_OAUTH_ONLY=true \
  node scripts/test-hosted-mcp-oauth.mjs
```

This checks the catalog and OAuth scope metadata; it does not execute all tools.
Its coverage report correctly remains incomplete.

## Full lifecycle run

Use a dedicated reviewer/test account with an accessible workspace, an existing
source fixture, and an existing project using a working Snowflake destination.
Never use customer datasets. Choose two to five distinct, small objects visible
in the source catalog's first 25 entries (the shared lifecycle's bounded preview).

The default source type is `MYSQL` for the existing Docker-backed fixture flow.
Set `SUPAFLOW_E2E_SOURCE_CONNECTOR_TYPE=SALESFORCE` for a reviewer Salesforce
fixture. The suite verifies that the source has the selected type. For example,
`Account,AccountContactRole` can be used when both exist in the reviewer fixture.
IDs are configuration, not hardcoded test constants. Obtain them using the
reviewer account's inventory; never copy credentials out of a datasource.

```sh
export SUPAFLOW_MCP_TEST_CLIENT=inspector
export SUPAFLOW_E2E_WORKSPACE_ID='<test-workspace-uuid>'
export SUPAFLOW_E2E_SOURCE_DATASOURCE_ID='<test-source-uuid>'
export SUPAFLOW_E2E_SOURCE_CONNECTOR_TYPE=SALESFORCE
export SUPAFLOW_E2E_DESTINATION_PROJECT_ID='<snowflake-test-project-uuid>'
export SUPAFLOW_E2E_OBJECTS='Account,AccountContactRole'
export SUPAFLOW_LIVE_MUTATIONS=true
export SUPAFLOW_E2E_DESTINATION_WRITES_ACK=I_ACCEPT_TEST_DESTINATION_WRITES
node scripts/test-hosted-mcp-oauth.mjs
```

Both opt-ins are mandatory. The lifecycle copies the source configuration
server-side and creates a temporary project, two pipelines, and a schedule. It
uses a unique `mcp_e2e_*` destination prefix. It tests connection/catalog refresh,
both pipeline creation paths, schema edits, enable/disable, catalog reset with
selection restoration, live sync, cancellation, schedule execution/history, and
deletion. Source data is read; existing pipelines and schedules are not edited.

### Keyless policy coverage

The shared lifecycle checks the keyless policy added in the app's pipeline
configuration. Both Inspector and direct OAuth execute these checks:

- `pipelines_init` and `pipelines_prepare_create` return `UUID` as the default.
- Direct creation without a policy returns `UUID`; guided creation with
  `ROW_HASH` returns that policy. The existing Snowflake fixture supports both.
- Direct creation, guided creation and editing reject invalid policy values,
  including the retired `HASH_AND_MERGE` value, lowercase `uuid`, empty strings,
  booleans and numbers. Authentication challenges, retryable errors and transport
  failures fail the test rather than counting as validation success. The hosted
  service redacts generic validation errors, so these probes verify rejection,
  not the internal reason; positive calls use the same valid fixture context.
- Editing accepts `ROW_HASH`, an unrelated config patch, `UUID` and explicit
  `null`. The lifecycle compares this disposable pipeline's job inventory before
  and after each edit to check that Save does not enqueue a sync. No schedule is
  attached to the pipeline during these assertions.
- A normal explicit sync runs under Row hash, then another after changing to
  Generate UUID, both with `full_resync: false` and `reset_target: false`.

An unexpected successful create in a negative test is registered for the same
`finally` cleanup before the assertion fails. Expected validation calls remain
recorded as failed tool calls in Inspector's report; they never count as successful
tool coverage. The corresponding rejection assertion is printed separately.

These checks do **not** prove saved-value preservation after edit, unsupported
destination rejection, reset-token consumption, or destination row/ID correctness.
`pipelines_get` does not return saved configuration and `jobs_get` does not expose
resolved reset flags. Create responses return the assembled configuration, not an
independent database readback. Existing app tests cover handler persistence and
destination-capability validation; SQL and destination tests cover reset behavior.
Do not infer those results from a successful MCP call or terminal job status.
Even a fully keyed fixture can exercise the configuration calls above; testing an
actual reset also requires a selected keyless fixture and separate reset/load
evidence. Extending the hosted response contract or adding direct database access
to this runner is outside this change.

The `finally` block cancels outstanding test jobs, waits for catalog-reset
restoration, deletes created control-plane resources, and verifies their absence.
A cleanup failure fails the run. Avoid forcibly killing the process because that
prevents `finally` cleanup; inspect and remove only task-created fixtures if a
process is interrupted. Destination tables/rows can outlive control-plane cleanup.
Review destination cleanup separately; the harness does not execute destination
SQL or claim that it removes those tables.

`SUPAFLOW_JOB_TIMEOUT_MS` defaults to 900000. Inspector calls default to a 90000 ms
process timeout, configurable through `SUPAFLOW_RPC_TIMEOUT_MS`. The adapter does
not automatically replay failed writes. Existing polling handles typed retryable
read errors; an ambiguous write result stops the run rather than risking a duplicate.

## Results and release evidence

Inspector mode writes `artifacts/hosted-mcp/inspector-report.json`, including on
failure after client setup. Override the location with `SUPAFLOW_MCP_TEST_REPORT`.
Reports include successful/missing tool names, call outcomes and durations,
schema warning locations, and whether the lifecycle (including cleanup) finished.
They contain no raw tool payloads, credentials, resource IDs, or source data.
Reports are ignored by Git. Keep Inspector storage outside the repository even
though reports are ignored.

A tool error or failed CLI process does not count toward successful coverage.
The report is `passed` only when every contract tool succeeded and the full
lifecycle completed. Read-only modes produce an incomplete report. A recovered
earlier failure stays visible in call history. Schema portability errors fail
the catalog check; warnings remain visible in the report without changing the
JSON contract merely to silence a diagnostic.

For release/submission evidence, retain the sanitized report and note the tested
app revision separately. Do not claim a new integrated runner was live-validated
using a report from an earlier temporary adapter. Re-run the integrated command
against authorized fixtures when new runtime behavior needs live verification.

The existing direct OAuth mode remains available with
`SUPAFLOW_MCP_TEST_CLIENT=direct` (the default), using
`SUPAFLOW_OAUTH_REDIRECT_URI`. See the [OpenAI lifecycle instructions](../vendors/openai/README.md#hosted-server-lifecycle-harness).
