# Supaflow Code for local Codex

GitHub-installed local CLI workflows and CLI-backed stdio MCP. Use the separate hosted **Supaflow** plugin for browser chat. This package is not a public-directory submission and does not configure hosted OAuth.

## Enable access before local login

An organization administrator or personal-account owner must select the intended account in [Supaflow Settings > API Keys](https://app.supa-flow.io/settings/api-keys), open **Permissions**, check **Enable API access** and **Supaflow CLI** under **OAuth applications**, then click **Save changes**, review, and **Save access settings**. Access is off by default; administrator status alone does not enable it. API keys are not required for browser OAuth.

For explicitly chosen key-based/headless use, enable **Allow API keys** instead and create a key in the **Keys** tab. Existing keys need this permission too. Local stdio MCP reuses the CLI's login and access settings; selecting hosted **Claude** or **ChatGPT** does not authorize this local path. A key can still be used by the CLI when CLI OAuth is unchecked.

On access denial, have the user or their administrator check the active account and saved permissions before reconnecting. Never change access settings automatically, request credentials in chat, or switch authentication methods to work around a denial. Existing agent identities and dashboard-issued OTP enrollment/recovery remain independent of these settings; CLI-managed operations still need permitted CLI authentication. See the [API access guide](https://www.supa-flow.io/docs/settings/api-keys#enable-api-access-first).

## Install

Install Node.js 18+ and the Supaflow CLI 0.8.0+ separately. Dependency installation requires the user's approval. Docker is needed only for local private-agent operations, not ordinary pipeline operations. Python is not required by this package's setup check.

```bash
npm install -g @getsupaflow/cli
supaflow auth status
```

If needed, run `supaflow auth login` in your own terminal. CLI 0.8.0+ opens browser login with PKCE. Review the account, organization, and permissions in the browser. API keys remain optional for headless use through `SUPAFLOW_API_KEY`; never enter credentials into an AI conversation. Existing API-key logins work only while API access and API keys remain enabled. Older CLI releases may still prompt for a key; upgrade to CLI 0.8.0 or newer. Then run `supaflow workspaces select` and verify the selected workspace.

```bash
codex plugin marketplace add https://github.com/supaflow-labs/supaflow-ai-plugins.git
codex plugin add supaflow-code@supaflow
```

Open a fresh **local Codex session** after installation. The client must be able to resolve `supaflow` on its PATH. The package launches `supaflow mcp` as `supaflow-local`; do not also register a manual server with that name. If an earlier manual registration exists, inspect it and ask the user which installation to retain; never remove it automatically.

Ask: “Check my local Supaflow CLI, selected workspace, and Docker readiness. Explain what is needed to deploy a private agent; ask before making changes.”

The entry skill reads the setup gate before operations. There is no SessionStart hook, automatic dependency installation, login, workspace switch, Docker start, or permission preapproval. The optional read-only setup helper is `node scripts/check-setup.mjs` from this package directory; add `--agent` to check Docker client/daemon availability. It does not validate stored credentials remotely or establish agent-operation permissions.

Local CLI authentication and selected-workspace state are independent of the hosted plugin's OAuth connection. Verify both when switching editions. Missing local tools do not authorize falling back to a hosted tool with the same operation name.

## Verification

From the repository root, run the packaging validator and `node --test scripts/test-supaflow-code.test.mjs`. Offline checks use fake executables and do not log into Supaflow or operate Docker. A real install, MCP discovery, and read-only workspace check in local Codex are still required before claiming live verification.

See [the Supaflow CLI guide](https://www.supa-flow.io/docs/cli) for CLI prerequisites and configuration. Guided connector development is not included in this package.
