# Test Cortex Code against the local development app

Use a dedicated public Clerk client in the application's development instance,
with PKCE and consent required, the scopes in `mcp.json`, and the exact callback
`http://localhost:8585/callback`. Registration is separate from enabling access
for the selected Supaflow account. Keep production client IDs and manifests
unchanged.

Expose the existing local app through an HTTPS tunnel. Restrict the tunnel to
`/mcp`, `/.well-known/oauth-protected-resource/mcp`,
`/.well-known/oauth-protected-resource`, and
`/.well-known/oauth-authorization-server`. Disable request inspection and body
logging. A suitable ngrok Traffic Policy is:

```json
{"on_http_request":[{"expressions":["!(req.url.path in ['/mcp', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server'])"],"actions":[{"type":"custom-response","config":{"status_code":404,"content":"Not found"}}]}]}
```

```sh
ngrok http 3000 --inspect=false --log=false --traffic-policy-file /path/to/policy.json
```

See [ngrok Traffic Policy](https://ngrok.com/gateway) for expression and response
syntax. Do not expose the entire development dashboard through the tunnel.

In the app's ignored local development environment configuration, set
`CLERK_CORTEX_CODE_OAUTH_CLIENT_ID` to the new public client ID and
`MCP_OAUTH_RESOURCE` to the exact HTTPS tunnel URL plus `/mcp`. Preserve unrelated
configuration. If client admission uses an allowlist, add the same ID there.
Verify the running app picked up the settings; its owner manages any necessary
restart. Do not change the Clerk issuer to the tunnel URL. Clerk still handles
sign-in, consent and both token grants.

Before authorizing, verify protected-resource metadata advertises exactly the
tunnel MCP URL and the intended development Clerk issuer. Unauthenticated MCP
must return 401 with resource metadata; unrelated routes must return 404.
Apply migration 222 to DEV using the platform deployer after authorization.

Build a separate development package:

```sh
python scripts/build_cortex_submission.py --client-id '<PUBLIC_DEV_CLIENT_ID>' \
  --dev-mcp-url 'https://<TUNNEL_HOST>/mcp' --output-dir dist/dev-review
cortex plugin validate dist/dev-review/supaflow-cortex-0.1.0-dev
cortex -c '<CONNECTION>' --private --no-auto-update \
  --only-explicit-plugins --only-explicit-mcp-servers --only-explicit-skills \
  --plugin-dir /absolute/path/to/dist/dev-review/supaflow-cortex-0.1.0-dev
```

The builder uses plugin/server name `supaflow-dev` so development token storage
and configuration do not collide with production. Release validation rejects
this package. Load it locally with `--plugin-dir`; no Snowflake account DDL,
public repository, or marketplace submission is needed for this test.

Use `/mcp` to authenticate the development server. During Codex automation,
intercept the task process's browser-open command and open the authorization URL
in the in-app browser. Do not record tokens, auth codes, or raw callback URLs.
Have the selected account owner enable API access and Snowflake Cortex Code,
then review consent. Test authentication, tool discovery and workspace listing
before selecting disposable fixtures for writes. Keep read-only testing distinct
from full lifecycle/refresh coverage; an authenticated connection alone does not
prove all workflows.

Stop the task-owned tunnel after testing unless the user wants it retained.
Restore the previous local resource override when retiring the tunnel. Retain
or revoke the dedicated DEV client and account grant according to the user's
testing plan. Never remove another task's tunnel or OAuth registration.

## Native App setup skill

The Native App skill uses the existing Snowflake SQL connection; it does not
need the hosted MCP tunnel or access to CoCo's local OAuth cache. Respect a
request to leave Keychain alone: use the logged-in Snowsight session for SQL
checks, and do not launch a CLI OAuth session to test this skill.

For plugin setup testing, use the published Native App in the selected
Snowflake account. The DEV plugin can install it through Snowflake SQL; the
Native App still uses production Supaflow and its own browser OAuth, independent
of the DEV hosted MCP connection. Inspect account, app identity/version,
supported procedures, login configuration, and `CORE.GET_AGENT_STATUS()` before
any mutation. Do not dump service specifications, arbitrary configuration
values, integrations, secrets, or raw logs.

Exercise these cases using the exact packaged skill:

| Case | Expected behavior |
| --- | --- |
| Existing published app | Resume from observed state; no duplicate install or identity. |
| Login configured, service present | Read status; no deploy/restart. Verify approval, connector readiness, and routing separately. |
| App absent or listing unknown | Show verified target/listing and compute plan; no invented listing ID or DDL without authorization. |
| Older app lacks OAuth procedures | Explain version mismatch; no JWT/OTP fallback or automatic upgrade. |
| Timeout or access error | Reconcile state/visibility before retrying mutations. |
| Plugin OAuth connected | Do not infer Native App sign-in, approval, or readiness. |
| DEV plugin, published Native App | Keep the Native App's production OAuth; do not use DEV MCP workspace access as evidence of production agent approval/routing. |
| Controller not selected or declined | Skip optional permissions; no datasource, role, credential, or wake-controller creation. |
| Controller role missing or wrong account | Ask for missing role or resolve account mismatch; never substitute SUPA_ROLE or CoCo's current role. |
| Controller already has direct/inherited access | Verify installed role hierarchy and skip the grant; a visibility error is not a missing grant. |
| Controller access missing | Present the exact target and APP_PUBLIC privileges; execute only the authorized grant with an authorized owner/admin. |
| Grant completed or timed out | Read grants back before retrying; verify status through the actual controller connection if available. Admin status alone is insufficient; no lifecycle or pipeline test. |
| Custom endpoint already covered | Inspect bound integration/rules and skip DDL; never infer coverage from documentation alone. |
| Unbound reference or inaccessible rule list | Resume Network access or resolve visibility; do not create a replacement EAI or treat missing visibility as an empty list. |
| Missing custom S3/Azure/connector host | Resolve exact host/port and customer rule, show complete preserved rule list, and obtain approval before changing egress. |
| Existing rule or concurrent integration update | Inspect ownership/collision, preserve all desired endpoints and current attached rules; no CREATE OR REPLACE or secret-permission changes. |
| Snowflake result-chunk failure | Use the datasource account's STAGE allowlist and exact observed hostname; no guessed region or signed-URL/log disclosure. |
| Rule attached successfully | Verify rule/binding separately from connectivity; retry only authorized small tests after any current job terminates. No automatic full refresh, pipeline, restart or OAuth. |

A read-only Snowsight walkthrough of the packaged instructions verifies SQL
compatibility and decisions, not CLI skill auto-discovery or a fresh install.
Record those distinctions. Full installation testing requires a selected
disposable installation of the published app, reviewed grants/compute, browser
consent, approval, and observed connector readiness/routing in its actual
Supaflow environment. No pipeline run or full catalog refresh is part of this
check. Do not repoint an existing app or silently change the plugin's MCP target.

Only tests that change Native App code or exercise the DEV OAuth backend need
a separately prepared DEV Native App and DEV Supaflow tenant. For those tests,
the Native App repository's `docs/NATIVE_OAUTH_SETUP.md` and
`publish/prepare-native-dev.py` define its endpoint and egress overlay.
