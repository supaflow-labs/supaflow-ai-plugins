# Snowflake integrations

## Cortex Code hosted plugin

[Cortex Code design](cortex-code/DESIGN.md) and
[submission preparation](cortex-code/SUBMISSION.md) describe the hosted CoCo CLI
plugin. It reuses the shared hosted skills and `https://app.supa-flow.io/mcp`,
with a dedicated public PKCE client and an independent `cortex_code` access
grant. Build its self-contained directory and ZIP with
`scripts/build_cortex_submission.py`. Live OAuth, refresh, and client behavior
must pass before a public release; offline packaging validation is not that proof.

## Cortex Agent packaging (experimental)

Cortex Agents are a different Snowflake product surface. `agent-spec.yaml` is a
non-executable design placeholder, not a supported deployment package. No
executable `setup.sql.template` is supplied.

Earlier notes required token exchanges through
`https://app.supa-flow.io/api/mcp/oauth/token`. That describes the legacy token
facade, not the current new-connection contract. The app now advertises Clerk as
its authorization server and verifies resource-bound Clerk RS256 tokens. Follow
live protected-resource and authorization-server metadata rather than copying
old token endpoint overrides.

A future Cortex Agent integration still needs its own reviewed OAuth registration,
access classification, and live proof for authorization-code and refresh-token
grants. Verify the exact MCP resource, `offline_access`, `user:org:read`,
`supaflow:read`, `supaflow:write`, refresh rotation, and authenticated tool calls.
CoCo's localhost callback and public client are not an account-level Snowflake
API integration or native-agent enrollment client. No CoCo verification should
be presented as evidence that this separate Cortex Agent target works.
