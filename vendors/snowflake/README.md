# Snowflake Cortex Agent packaging (experimental)

Snowflake support is experimental and is not part of the supported `0.2.0` release. Do not configure a production connector from this directory yet.

Snowflake uses an account-level API integration and an `EXTERNAL MCP SERVER` object rather than the Codex or Claude plugin manifests. Its static `TYPE = OAUTH2` configuration does not expose the `OAUTH_RESOURCE_URL` setting available to dynamic-client registration, so the current integration has not proven that Snowflake sends the exact resource identifier required by the Supaflow token endpoint.

Before this target can become supported, a live Snowflake test must prove all of the following for both authorization-code and refresh-token grants:

- Snowflake exchanges tokens through `https://app.supa-flow.io/api/mcp/oauth/token`, never directly through Clerk.
- Snowflake requests `offline_access`, `user:org:read`, `supaflow:read`, and `supaflow:write`.
- Snowflake forwards `resource=https://app.supa-flow.io/mcp` exactly once during authorization and both token grants.
- The returned resource-bound Supaflow access token authenticates to `/mcp`, and refresh-token rotation remains intact.

The former executable SQL setup template was intentionally removed because it sent token exchanges directly to Clerk and could only produce access tokens that `/mcp` rejects. `agent-spec.yaml` is retained solely as a non-executable placeholder for future testing.

When the OAuth flow is proven, restore a reviewed setup template, register Snowflake's callback URL (`https://identity.snowflake.com/oauth2/callback`) in its dedicated OAuth client, and test tool discovery plus read/write calls. The hosted endpoint will continue to exclude local Supaflow agent commands.
