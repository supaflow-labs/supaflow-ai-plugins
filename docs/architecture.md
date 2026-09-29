# Architecture

The repository is a packaging layer around one hosted MCP runtime.

```text
ChatGPT / Codex ─┐
Claude           ┴─ OAuth 2.1 ─> https://app.supa-flow.io/mcp ─> Supabase RLS

Snowflake Agent (experimental; exact OAuth resource forwarding not yet validated)

Local CLI / local stdio MCP ─> local Docker agent and local filesystem
```

## Ownership

- `supaflow-app` owns the hosted Streamable HTTP MCP route, Clerk OAuth verification, short-lived Supabase JWT exchange, RLS queries, schemas, safety annotations, and server-side logging.
- `supaflow-cli` owns local commands and the stdio MCP bridge, including all agent, Docker, filesystem, and process operations.
- `supaflow-ai-plugins` owns provider-neutral skills, marketplace metadata, packaging manifests, experimental Snowflake design notes, and the reviewed hosted tool contract.

The packaging repository contains no business logic and no credentials. The
ChatGPT/Codex package binds to the registered Supaflow OpenAI app, while Claude
discovers OAuth from the hosted MCP endpoint. Supported vendors connect to the
same stable hosted endpoint; only their packaging and registration mechanisms
differ. Snowflake is not a supported vendor target until its OAuth flow passes a
live authorization-code and refresh-token test.

## Token lifecycle

The vendor sends the user through Clerk authorization, then exchanges the authorization code or opaque Clerk refresh token through the Supaflow token endpoint. The token endpoint verifies Clerk's result and returns a short-lived, resource-bound Supaflow MCP access token together with Clerk's latest opaque refresh token, which may rotate. Each MCP request presents the Supaflow access token. The hosted server verifies its signature, issuer, audience, client, lifetime, and scopes; revalidates organization membership; and mints a new one-hour Supabase-compatible JWT for that single server-side tool call. The internal JWT is never returned to the vendor. Its expiry cannot break a later MCP call because the next call mints a new internal token.

## Failure and retry contract

Clerk reads and read-only Supabase RPCs use bounded attempts, per-attempt timeouts, jittered backoff, and one overall deadline. When those attempts are exhausted, the hosted server returns `TEMPORARY_UPSTREAM_FAILURE`, `retryable: true`, and `retry_after_ms`. Clients may retry bounded read or status polling after that delay. They must not blindly repeat mutations: after an ambiguous timeout, reconcile the datasource, project, pipeline, schedule, or job state through list/get/status tools before deciding whether another write is safe. The hosted server never automatically retries mutation RPCs.

## Local agent invariant

The private agent is not a hosted MCP resource. Hosted tools cannot install, upgrade, start, stop, inspect, fetch local logs from, or remove it. A request for those actions must be routed to the separately installed local CLI experience. Pipeline and datasource jobs created by hosted tools still use normal Supaflow routing: an eligible private agent when configured, otherwise the public agent.
