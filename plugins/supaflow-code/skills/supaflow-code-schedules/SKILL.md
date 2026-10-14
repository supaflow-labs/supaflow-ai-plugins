---
name: supaflow-code-schedules
description: Create or inspect Supaflow schedules and resolve schedule executions to jobs using local CLI-backed MCP or CLI in local Codex.
---

# Local schedules

Read [entry rules](../using-supaflow-code/SKILL.md) and [setup](../using-supaflow-code/setup.md). Discover the existing target and schedules before changes. Read current schema/help for supported target types and flags. Local schedule fields include `cron_schedule`, `timezone`, `target_type`, and `target_id`; do not invent a target name field.

For creation, ask for missing cadence and timezone, show the resolved target, cron, timezone, and intended timing, then obtain approval before saving. Do not silently use the host timezone or run the schedule after creation. Verify the saved schedule with a read.

`schedules_run` or `supaflow schedules run` can acknowledge a trigger without returning an underlying pipeline job. Read `schedules_history` for the matching execution, identify its target/job using returned history, and poll that actual job through the jobs skill. Never pass a schedule ID or execution ID to `jobs_status`, or rerun a schedule just to obtain a job ID. If correlation is ambiguous or no job is available, report that state and ask rather than monitoring an unrelated run. Failed/skipped executions may never create a pipeline job.

For edit/disable/enable, preserve unspecified fields and verify the result. Explain and obtain confirmation before deletion.
