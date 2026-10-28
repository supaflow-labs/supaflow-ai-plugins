# Hosted Supaflow plugin for Cortex Code

## Scope

Match the hosted ChatGPT and Claude experience: browser OAuth, explicit Supaflow
workspace selection, and the existing reviewed control-plane tools. This is a
CoCo CLI plugin, separate from Cortex Agents, Snowflake Native Apps, and the
local CLI-backed Supaflow Code edition. No new MCP server, OAuth broker, CLI
dependency, hook, or tool preapproval is introduced. An optional CoCo-only
Native App setup skill uses CoCo's existing Snowflake SQL capability and browser
consent. It does not add SQL or agent administration to hosted Supaflow MCP.

Snowsight is a separate integration surface. Its chat currently cannot install
the CLI plugin archive. It can call the same hosted Supaflow tools through a
custom external MCP connector configured in the Snowflake account. See
[SNOWSIGHT.md](SNOWSIGHT.md) for setup and verification; a working web connector
does not establish that the packaged skills are installed in Snowsight.

```text
CoCo CLI + Supaflow plugin
  -> browser consent for a dedicated public PKCE OAuth client
  -> Clerk token exchange and refresh, with the Supaflow MCP resource
  -> https://app.supa-flow.io/mcp
  -> existing tenant/workspace authorization and pipeline runtime
```

## Packaging

Provider source stays here. `scripts/build_cortex_submission.py` assembles one
self-contained directory and review ZIP. It copies the canonical `setup` and
`using-supaflow` skills from `plugins/supaflow` without maintaining forks.
The package contains one hidden directory, `.cortex-plugin`, plus `.mcp.json`,
README, SETUP, license and notices, logo, and three skills: the two unchanged shared skills
plus `setup-supaflow-native-app` from this provider directory. OpenAI bindings, Claude
manifests, local executors, and contributor runbooks are excluded.

Use `.cortex-plugin/plugin.json`, HTTP transport, and an explicit public OAuth
client ID. Leave authorization-server and token endpoints to protected-resource
and authorization-server metadata discovery. Current production metadata names
Clerk as the authorization server and uses its token endpoint. The app verifies
Clerk RS256 tokens bound to the MCP resource; the former Supaflow token facade
is retained for legacy clients only. Do not override discovery to that facade.
Do not configure
`snowflake_connection` on the MCP server: Snowflake credentials are not Supaflow
credentials. The reviewer selects a connection with `cortex -c <connection>`;
package contents never depend on that machine-specific name.

Draft builds permit an obvious placeholder. Release builds require a public
client ID and reject placeholders. This proves packaging only, not that the
registration exists or has passed OAuth verification. The ZIP is a review
artifact; it is not asserted to be a Snowflake Marketplace upload format.

## Native App setup

The provider skill inspects an existing app before proposing installation and
uses the Native App's existing `CORE` procedures around Snowsight's required
network-access and OAuth consent steps. Successful sign-in normally triggers
deployment; approval, connector readiness, and workspace routing are verified
separately. It neither implements an OAuth client nor stores credentials.
Native App registration remains separate from the hosted plugin's public client.

Fresh installation requires a verified Marketplace listing and explicit target
and compute authorization. Existing app repair reconciles state before retrying;
no automatic drop/reinstall, pipeline smoke run, or full catalog refresh occurs.
The DEV plugin can guide setup of the published Native App, which retains its
production origin and OAuth flow. Its approval and workspace routing must be
verified in production, separately from the plugin's DEV hosted workspace.
Only Native App/backend development tests require an isolated app and reviewed
endpoint/egress overlay. The hosted MCP tunnel does not reconfigure a Native App.

## OAuth and access control

Register a dedicated Clerk **public** client with PKCE and consent required,
authorization-code and refresh-token grants, JWT access tokens, audience support,
and `http://localhost:8585/callback`. Request `email`, `profile`, `offline_access`,
`user:org:read`, `supaflow:read`, and `supaflow:write`. No client secret belongs in
the package. Do not reuse ChatGPT, Claude, Inspector, CLI, or native-agent clients.

Bind the exact ID through `CLERK_CORTEX_CODE_OAUTH_CLIENT_ID` in `supaflow-app`.
The distinct policy key is `cortex_code`, displayed as **Snowflake Cortex Code**.
Migration 222 adds that key to the existing policy validator; it does not grant
access to any tenant. Preserve the historical `snowflake` key as read-compatible
only. Its old grants must never authorize CoCo. Unknown clients, missing bindings,
ambiguous bindings, missing API permission, and unselected applications fail
closed. Existing native registration rules and DCR restrictions stay unchanged.

If the target deployment uses `CLERK_OAUTH_ALLOWED_CLIENT_IDS`, add the public ID
to that reviewed allowlist too. An owner/admin must separately save API access
and the CoCo application grant for the intended account. Deploy SQL before the
app catalog changes become available to users. No app or database deployment is
performed by the package builder.

CoCo 1.1.104's installed OAuth implementation uses localhost callbacks, a
preferred port of 8585 with fallback ports, metadata discovery, and resource
parameters on authorization and token grants. Static inspection is supporting
evidence only: actual authorization, code exchange, refresh rotation, and MCP
access must pass in CoCo. Keep the preferred callback port free; do not assume
Clerk's variable-port allowance for IP loopback also applies to localhost.

## Publishing paths

1. **Git distribution:** distribute the extracted, reviewed package through a
   plugin-root Git source or supported subdirectory source, and verify a clean
   install before documenting its exact command. Do not point a root-only
   installer at this multi-provider repository.
2. **Same-account sharing:** `cortex plugin publish` creates/updates a Cortex
   Extension. Select a fully qualified destination, roles, and discoverability
   separately. `PUBLIC` means users in that account, not a global marketplace.
3. **Public contribution:** Snowflake Labs documents a plugin PR under
   `plugins/<name>` in `coco-skills`. Its contribution guidance asks community
   contributions to use Apache 2.0. This CoCo contribution uses Apache 2.0 and
   retains the original MIT notice for shared skills and logo in `NOTICE`.
   The shared ChatGPT/Claude packages keep their existing license. Acceptance
   there must not be represented as automatic global marketplace availability.

## Evidence and release gates

Offline tests validate exact archive inventory, hosted-only transport, OAuth
configuration, shared-skill and provider-skill parity, provider isolation,
relative links, and release placeholder
rejection. App tests cover exact client binding, explicit independent grants,
unavailable registration UI, and isolation from historical Snowflake grants.
The SQL regression replays the complete migration twice in a transaction,
checks defaults, approvals, invalid inputs, ownership/ACL, and rolls back.

Before public release, complete the CoCo OAuth and behavior checks in
[SUBMISSION.md](SUBMISSION.md). Reuse the shared hosted lifecycle harness for
tool coverage; never fork a Snowflake-specific business-logic implementation.
No shared lifecycle result substitutes for testing CoCo's own OAuth client.

## References

- [CoCo CLI plugins](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-plugins)
- [HTTP MCP OAuth](https://docs.snowflake.com/en/user-guide/cortex-code/extensibility#model-context-protocol-mcp)
- [Account sharing](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-skill-plugin-sharing)
- [Snowflake Labs plugin contributions](https://github.com/Snowflake-Labs/coco-skills/blob/main/plugins/README.md)
- [Contribution requirements](https://github.com/Snowflake-Labs/coco-skills/blob/main/CONTRIBUTING.md)
