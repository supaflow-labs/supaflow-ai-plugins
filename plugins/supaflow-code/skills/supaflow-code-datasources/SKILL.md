---
name: supaflow-code-datasources
description: Configure or inspect Supaflow datasources and catalogs using the local CLI-backed MCP server or CLI in local Codex.
---

# Local datasources

Read [entry rules](../using-supaflow-code/SKILL.md) and [setup](../using-supaflow-code/setup.md). Use local tools, not hosted response contracts.

Discover existing datasources first; prefer direct `datasources_get` for a known identifier. CLI list responses contain `data`, `total`, `limit`, `offset`. Page broad scans rather than assuming the default first 25 items is exhaustive.

For creation, use `datasources_init` or `supaflow datasources init` for connector-specific properties. Generated env files may contain credential material: let the user configure secrets through an approved local flow, never through chat. Review non-secret configuration and obtain approval before creating. Do not run init merely to inspect an existing datasource.

For edits, the CLI replaces the config object: export the existing env file with `datasources_get(output_file:...)` or `supaflow datasources get <identifier> --output <path>`, preserve unchanged encrypted values, and submit through the supported env-file flow. Do not reconstruct a partial config or print the file. File writes need an explicitly resolved local path and must not overwrite unrelated work. Exported encrypted envelopes are still excluded from conversation output.

Local catalog export with `output_file` or CLI `--output` returns file metadata/counts; objects live in the file as an array with `fully_qualified_name`, `selected`, and `fields`. Do not parse the count as the catalog or apply hosted catalog pagination. Default to existing discovery; refresh/test calls create jobs and need request authority. For diagnostics, report safe names, connector types, states, and redacted errors. Confirm deletion and re-read state afterward.
