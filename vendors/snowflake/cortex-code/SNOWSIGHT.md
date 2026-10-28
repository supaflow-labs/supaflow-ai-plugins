# Test Supaflow in CoCo on Snowsight

CoCo in Snowsight can use Supaflow through a custom external MCP connector.
It cannot currently install or use the CLI plugin in chat. Shared skills are a
separate Snowsight feature; this procedure does not install them. See Snowflake's
[skills and plugins documentation](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-snowsight/skills-and-plugins)
and [Snowsight MCP connector documentation](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-snowsight/mcp-connectors).

## Configuration

For DEV, retain the restricted HTTPS tunnel and exact resource configuration in
[DEV-TESTING.md](DEV-TESTING.md). Register
`https://identity.snowflake.com/oauth2/callback` on the dedicated public Clerk
CoCo client, preserving its CLI callback and PKCE requirement. The Supaflow
account must already grant API access and Snowflake Cortex Code access.

Create an API integration and an external MCP server in the explicitly selected
test account/schema. Replace the placeholders below with the verified DEV
metadata and public client ID. Do not use CREATE OR REPLACE against existing
resources or add broad grants. No client secret is required.

```sql
CREATE API INTEGRATION <TEST_INTEGRATION>
  API_PROVIDER = EXTERNAL_MCP
  API_ALLOWED_PREFIXES = ('https://<TUNNEL_HOST>/mcp')
  API_USER_AUTHENTICATION = (
    TYPE = OAUTH2
    OAUTH_CLIENT_ID = '<PUBLIC_DEV_CLIENT_ID>'
    OAUTH_CLIENT_AUTH_METHOD = NONE
    OAUTH_AUTHORIZATION_ENDPOINT = 'https://<DEV_CLERK_ISSUER>/oauth/authorize?prompt=consent'
    OAUTH_TOKEN_ENDPOINT = 'https://<DEV_CLERK_ISSUER>/oauth/token'
    OAUTH_ALLOWED_SCOPES = ('email', 'profile', 'offline_access',
      'user:org:read', 'supaflow:read', 'supaflow:write')
    OAUTH_REFRESH_TOKEN_VALIDITY = 86400
    OAUTH_RESOURCE = 'https://<TUNNEL_HOST>/mcp'
  )
  ENABLED = TRUE;

CREATE EXTERNAL MCP SERVER <DATABASE>.<SCHEMA>.<TEST_SERVER>
  WITH DISPLAY_NAME = 'Supaflow DEV local tunnel test'
  URL = 'https://<TUNNEL_HOST>/mcp'
  API_INTEGRATION = <TEST_INTEGRATION>;
```

The explicit resource binds OAuth grants to the MCP endpoint. The finite refresh
validity avoids Snowflake's default of zero. See the official
[custom connector configuration](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-mcp-connectors#custom-mcp-connectors).
Read back the server configuration and ownership/grants after creation. Additional
users require separately reviewed privileges and their own authorization.

## Verification

In Snowsight user settings, open MCP connectors and connect the test server.
Refresh the settings page if a newly created server is absent. Check the selected
Supaflow identity and account during OAuth. A connected badge is not sufficient:
ask CoCo to call `auth_status` and `workspaces_list` and inspect actual results.
Then list datasources/projects and read the selected source catalog.

Use explicitly approved DEV fixtures for writes. A representative web test creates
a temporary project, prepares and confirms a pipeline with a two-object subset
and a unique destination prefix, reads back the selection, edits and toggles the
pipeline, runs/monitors it, and deletes only the test resources. Preserve tool
outcomes and cleanup evidence, not tokens, signed plan IDs, or raw source data.
Use the [shared lifecycle runner](../../../docs/hosted-mcp-testing.md) for complete
contract coverage rather than maintaining another lifecycle implementation.

The web connection and native CLI credential refresh are independent tests.
Do not read or modify native credential storage to infer a refresh. Record native
refresh as unverified until the supported client flow actually refreshes a token.

At closeout, record whether the test connector is retained. If retiring it, remove
only the task-created external MCP server and API integration, disconnect its
user session, and follow the tunnel cleanup procedure. Never drop user fixtures.
