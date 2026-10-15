---
name: supaflow-code-agents
description: Check, enroll, resume, upgrade, stop, or remove a local Docker Supaflow agent from a local Codex session through the CLI or its stdio MCP server.
---

# Local private agents

Read [entry rules](../using-supaflow-code/SKILL.md) and [setup](../using-supaflow-code/setup.md), including Docker readiness. Hosted OAuth tools cannot perform these operations. Inspect current state first; being offline does not authorize starting, replacing, or removing an agent. Resolve the exact container and workspace, not a broad Docker/process target.

Use local `agent_status` and narrowly scoped `agent_logs` for diagnostics. Inspect current capability/help before changes, especially `agent_upgrade`: an already-running MCP process may predate the installed CLI. No automatic dependency install, Docker start, CLI upgrade, or service restart.

- Start/resume: explain the target and whether enrollment or resuming existing identity is expected; get confirmation. Use existing identity/container when supported rather than deleting it. Enrollment requires organization-admin access via the CLI’s OAuth login or an API key; stop on authorization errors and have the user resolve permissions securely.
- Approval: `approve:true`/`--approve` authorizes the agent to receive tenant jobs and changes routing. Use it only when the user explicitly approves activation. Ordinary deployment approval does not imply routing approval; otherwise leave the agent pending.
- Upgrade: read status, explain the named container/image and interruption, get immediate confirmation, then upgrade. Preserve identity. Use `pull:false`/`--no-pull` only for an explicitly requested local image. Verify status and identity afterward; report failure rather than claiming rollback or success without evidence.
- Stop: confirm the exact container; stopping preserves identity. Do not stop an unrelated container or daemon.
- Remove: confirm forced container removal. With `purge:true`/`--purge`, explain that the identity volume is deleted and the next enrollment creates a new identity requiring approval. Revoked identity cannot be fixed by repeatedly minting tokens: obtain explicit authorization for any purge/re-enrollment and explain any old-record cleanup needed in Settings > Agents.

Agent logs and bootstrap output may contain secrets. Report only redacted diagnostics; never display registration tokens, environment files, or private keys. Connector development is outside this package's current scope.
