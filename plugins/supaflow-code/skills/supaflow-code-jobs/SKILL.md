---
name: supaflow-code-jobs
description: Inspect, monitor, diagnose, or cancel a Supaflow job using local CLI-backed MCP or CLI in local Codex.
---

# Local jobs

Read [entry rules](../using-supaflow-code/SKILL.md) and [setup](../using-supaflow-code/setup.md). Reuse the exact job ID returned by the triggering operation. Poll `jobs_status` or `supaflow jobs status <id> --json`, not full job details. Follow the user's monitoring time limit; if observation must stop, report the last actual state and ID rather than claiming completion. Do not invent a job ID from a pipeline or schedule ID.

Local status fields: `id`, `job_status`, `status_message`, `job_response`. Terminal statuses include `completed`, `completed_with_warning`, `failed`, `cancelled`, and `skipped`; stop polling on all of them. A skipped job is not a successful sync. Retrieve `jobs_get` once terminal for `execution_duration_ms`, `ended_at`, `job_response`, and `object_details`. Report returned metrics only. Per-object names use `fully_qualified_source_object_name`; metrics use stage-specific fields such as `ingestion_metrics.output_row_count`. Local logs use `status`, `message`, `response`, unlike status/get. Redact credential-shaped data and do not dump full logs into chat.

Shell polling must use `job_status`/`poll_status`, never zsh's read-only `status` variable. Do not repeat a sync to keep monitoring. Stop on permanent/auth errors; reconcile uncertain outcomes before retrying operations.

For cancellation, require the actual local `jobs_cancel` capability or CLI command help. Read the current job and continue only for `queued`, `picked`, or `running`. Explain the exact job and impact, obtain immediate explicit confirmation, cancel once, and re-read status. A tool permission prompt alone is not cancellation confirmation. Do not cancel a terminal or inaccessible job.
