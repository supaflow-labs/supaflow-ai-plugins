---
name: supaflow-code-pipelines
description: Prepare, create, edit, or sync Supaflow pipelines through local CLI-backed MCP or CLI in local Codex, with reviewed config and object scope.
---

# Local pipelines

Read [entry rules](../using-supaflow-code/SKILL.md) and [setup](../using-supaflow-code/setup.md). Resolve existing source, destination project, and duplicate pipelines before creation. Local list results use `data`; pipeline rows contain nested `source`, `destination`, and `project`. Prefer direct get for a known identifier.

For local MCP, prefer `pipelines_prepare_create` then `pipelines_create_from_plan`. Preparation writes host files but does not create a pipeline. Show actual `config_summary`, configuration changes, and object count/preview. A preview may be truncated; inspect the host catalog or ask for exact objects instead of assuming the preview is complete. Require explicit all/subset selection and final creation approval before `confirmed:true`. Do not reuse a plan for a different account/workspace or silently repair rejected plans.

For the terminal alternative, run `supaflow pipelines init --help`, then init using actual supported parameters. Inspect generated defaults and catalog, prepare the exact object file, present the final configuration/scope, and create only after approval. Never invent a universal config template or default to every object. Do not copy hosted signed-plan fields into the local flow.

For selection edits, read current selected schema with fields first, preserve unrequested field selections, show the proposed change, and verify afterward. Local `pipelines schema list --json` returns an array of `fully_qualified_name`, `selected`, `fields`, not the hosted wrapper. Request `--all` only when deselected objects are needed.

For a requested normal sync, preserve current scope and omit reset flags. Full resync resets cursors; target reset can drop/recreate destination tables. Explain the exact impact and get immediate confirmation before either. Capture the returned `job_id` and follow [job monitoring](../supaflow-code-jobs/SKILL.md). Do not automatically schedule, rerun, or reset after failure. Before deletion, show the resolved pipeline and get confirmation; verify afterward.
