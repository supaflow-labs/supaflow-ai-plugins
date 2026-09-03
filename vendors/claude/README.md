# Claude packaging

Package `plugins/supaflow` as the Claude plugin. It contains:

- `.claude-plugin/plugin.json` for Claude marketplace metadata.
- `.mcp.json` pointing to the hosted Streamable HTTP MCP endpoint.
- A provider-neutral skill under `skills/using-supaflow`.

The legacy `supaflow-claude-plugin` repository continues to package the local CLI and stdio MCP experience. This repository's Claude package is the hosted, OAuth-backed experience and deliberately excludes local agent commands.
