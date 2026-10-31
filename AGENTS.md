# Supaflow AI Plugins Guidelines

## SDLC, PR requirements, and review

- For ordinary work, use a task branch and a PR to `main`; preserve existing changes and keep unrelated commits out of the PR. Read applicable scoped instructions, implement the smallest agreed change, run the relevant local checks, and review the whole diff. Commit/push only within explicit user approval; merge only when authorized, using a merge commit. Separately authorized release-script exceptions below remain exceptions.
- Fill in [.github/pull_request_template.md](.github/pull_request_template.md). Include the request/specification source, testable acceptance criteria, before/after behavior, deliberate product constraints with rationale, non-goals, verification evidence and gaps, and relevant cross-repository dependencies. Copy essential decisions into the PR; reviewers may not have the workspace or conversation. Update the description when scope or decisions change.
- Reviewers must assess the implementation against that contract and this repository's invariants. Report a defect only with a concrete scenario, code evidence, and a violated requirement or invariant. Accepted product constraints are not missing features; optional enhancements and ambiguous requirements are separate questions. An intentional constraint cannot excuse a regression, security flaw, or data-integrity defect.
- Address valid findings with focused fixes and appropriate regression coverage. For a disputed finding, record the requirement and evidence supporting its disposition before resolving it; involve the owner when the requirement is unclear. Do not repeatedly reopen a resolved decision without new evidence, change product behavior merely to quiet a reviewer, or dismiss unresolved defects to pass a gate.
- Before merging, require successful applicable checks, resolved conversations, and completed review of the current PR head/base. New commits need fresh evidence. Do not bypass GitHub rules, forge a passing status, or substitute a review request/reaction for completed review. After merge, return to clean updated `main`, remove only this task's merged branches/worktrees, and preserve unrelated work.

- The workspace `../AGENTS.md` applies when available. Ordinary changes use PRs to `main`; record package validation and applicable offline test evidence. Verify the main-branch gates described below.
- Keep hosted/local package boundaries in the PR acceptance criteria. Validate the changed package/provider surface using the existing scripts and testing runbooks. A merge does not authorize submission to a marketplace, live authenticated tests, or installation into a user's environment.

## Repository scope

- This repository packages Supaflow for AI clients and marketplaces. The hosted MCP runtime remains in `supaflow-app`; the local stdio MCP runtime remains in `supaflow-cli`.
- Keep provider-neutral skills and metadata in `plugins/supaflow`. Put provider-specific submission material under `vendors/`.
- Do not duplicate Supaflow business logic, database access, OAuth token exchange, or MCP tool handlers in this repository.
- `plugins/supaflow-code` is a self-contained GitHub-installed local Codex package using the existing CLI-backed stdio MCP server. Keep hosted OAuth/app bindings, Claude-specific commands/hooks, automatic setup mutations, and tool preapprovals out of it. Preserve the hosted package and public submission archive as separate surfaces. Run `node --test scripts/test-supaflow-code.test.mjs`, Python package tests, and the repository validator after changes to its manifests, skills, or setup checks.

## Hosted versus local boundary

- The hosted MCP endpoint may expose only reviewed Supaflow control-plane tools that run entirely on Supaflow infrastructure.
- Never advertise or route agent installation, upgrade, start, stop, status, logs, removal, Docker, filesystem, process, credential-bootstrap, or other local runtime controls through the hosted MCP endpoint.
- Local agent workflows belong only to the Supaflow CLI and its local stdio MCP server. Provider packages may explain this boundary, but must not make the local agent a requirement for the hosted plugin's core workflow.

## Packaging and security

- Keep OAuth client secrets, access tokens, refresh tokens, Supabase JWTs, and private keys out of manifests, examples, tests, and documentation. Use obvious placeholders for confidential values.
- All public Supaflow URLs use `supa-flow.io` with the hyphen.
- Keep the shared MCP URL at `https://app.supa-flow.io/mcp` unless the production runtime changes.
- Provider-specific files must accurately describe the capabilities supported by that provider; do not invent a manifest format where the provider uses a portal or SQL configuration instead.
- Validate JSON files, the Codex plugin manifest, provider templates, and the hosted/local tool boundary before handoff.

## Git hygiene

- Preserve user changes and do not commit or push without explicit approval.
- Use Conventional Commits with imperative, scoped messages when a commit is requested.

## Hosted MCP verification

- Use `docs/hosted-mcp-testing.md` for hosted lifecycle testing through MCP Inspector or the direct OAuth client. Reuse the shared lifecycle and cleanup in `scripts/test-hosted-mcp-oauth.mjs`; do not fork provider-specific copies.
- Run `node --test scripts/test-hosted-mcp-inspector.test.mjs scripts/test-hosted-mcp-resilience.test.mjs` when changing the Inspector adapter or shared lifecycle. Live runs require an explicitly selected account, endpoint, disposable fixtures, and mutation/destination-write opt-ins.
- Keep Inspector OAuth storage outside the repository. Coverage reports must contain tool names and outcomes only, never credentials, fixture configuration, or raw responses.

## Main branch enforcement

- The main-branch protection rollout requires PRs, resolved conversations, merge commits, `PR checks` and `Codex review / main`, with no bypass actors. Verify live rule activation and successful current-head evidence before claiming enforcement.
- `.github/workflows/pr-checks.yml` defines the offline CI coverage. These checks do not prove live credentials, deployments, or database/data correctness. No live test or publication is authorized by CI.
- Keep the Codex connector enabled for this repository and request a fresh review when necessary. Missing or incomplete review is not a pass.

- Choose the intended target branch when opening a PR. If its base branch is changed, close it and open a new PR against the intended base; the review gate rejects retargeted PRs because review summaries identify the head but not the reviewed base.
