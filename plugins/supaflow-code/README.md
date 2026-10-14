# Supaflow Code for local Codex

GitHub-installed local CLI workflows and CLI-backed stdio MCP. Use the separate hosted **Supaflow** plugin for browser chat. This package is not a public-directory submission and does not configure hosted OAuth.

## Install

Install Node.js 18+ and the Supaflow CLI 0.5.0+ separately. Dependency installation requires the user's approval. Docker is needed only for local private-agent operations, not ordinary pipeline operations. Python is not required by this package's setup check.

```bash
npm install -g @getsupaflow/cli
supaflow auth status
```

If needed, run `supaflow auth login` in your own terminal. It prompts for an API key created in Supaflow under Settings > API Keys; do not enter it into an AI conversation or a command argument. Then run `supaflow workspaces select` and verify the selected workspace.

```bash
codex plugin marketplace add https://github.com/supaflow-labs/supaflow-ai-plugins.git
codex plugin add supaflow-code@supaflow
```

Open a fresh **local Codex session** after installation. The client must be able to resolve `supaflow` on its PATH. The package launches `supaflow mcp` as `supaflow-local`; do not also register a manual server with that name. If an earlier manual registration exists, inspect it and ask the user which installation to retain; never remove it automatically.

Ask: “Check my local Supaflow CLI, selected workspace, and Docker readiness. Explain what is needed to deploy a private agent; ask before making changes.”

The entry skill reads the setup gate before operations. There is no SessionStart hook, automatic dependency installation, login, workspace switch, Docker start, or permission preapproval. The optional read-only setup helper is `node scripts/check-setup.mjs` from this package directory; add `--agent` to check Docker client/daemon availability. It does not validate the API key remotely or establish agent-operation permissions.

Local CLI authentication and selected-workspace state are independent of the hosted plugin's OAuth connection. Verify both when switching editions. Missing local tools do not authorize falling back to a hosted tool with the same operation name.

## Verification

From the repository root, run the packaging validator and `node --test scripts/test-supaflow-code.test.mjs`. Offline checks use fake executables and do not log into Supaflow or operate Docker. A real install, MCP discovery, and read-only workspace check in local Codex are still required before claiming live verification.

See [the Supaflow CLI guide](https://www.supa-flow.io/docs/cli) for CLI prerequisites and configuration. Guided connector development is not included in this package.
