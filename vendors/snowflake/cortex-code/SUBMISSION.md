# Cortex Code submission preparation

This is a release checklist, not a claim of publication or live OAuth readiness.
See [DESIGN.md](DESIGN.md) for architecture, dependencies, and the distinction
between account sharing and public distribution.
For local development with a dedicated DEV client and HTTPS tunnel, follow
[DEV-TESTING.md](DEV-TESTING.md). Development packages must not be published.
The separate [Snowsight MCP connector](SNOWSIGHT.md) uses the same runtime but
is not an installation of this CLI plugin. Describe those surfaces separately.

## Listing draft

- Name: **Supaflow**
- Publisher: **Supaflow, LLC**
- Summary: **ETL data pipelines & dbt core**
- Category, where supported: **Data & Analytics**
- Description: Build and run data pipelines directly in Cortex Code. Move data
  across SaaS apps, databases, data warehouses, and data lakes. Transform data
  using dbt Core™ models and sync data to your business apps with reverse ETL.
  Orchestrate pipelines, manage schedules, and troubleshoot issues—all through
  conversation.
- Snowflake-specific benefit: Pair Cortex Code with the Supaflow Native App to
  run ETL pipelines inside your Snowflake account. The Native App's agent
  executes pipelines on your Snowflake compute using Snowpark Container
  Services; Cortex Code lets you prepare, run, schedule, and monitor them through
  conversation. Requires a separately installed and linked Native App, an
  approved agent, and workspace routing configured to use it. The plugin alone
  does not automatically deploy a native agent or choose the execution environment.
  Use the CoCo-only Native App setup skill for guided installation, browser
  sign-in, agent approval, and readiness checks through CoCo's Snowflake connection.
- Getting started: create a Supaflow account or sign in, install the plugin, and
  authorize Supaflow. Ask for help getting started to verify your workspace and
  available connections. Configure source and destination credentials securely
  in Supaflow before creating or running a pipeline; never paste credentials
  into chat. Use the package's `SETUP.md` for Cortex Code setup.
- Website/docs: `https://www.supa-flow.io/docs`
- Support: `support@supa-flow.io`
- Privacy: `https://www.supa-flow.io/legal/privacy-policy`
- Terms: `https://www.supa-flow.io/legal/terms-of-use`
- Logo: `plugins/supaflow/assets/logo.png` in this repository.

Listing copy was checked against the live [ChatGPT Supaflow listing](https://chatgpt.com/plugins/plugin_asdk_app_6abadf90c69881919b46c92f36bcfc99)
on 2026-10-26 (displayed version 1.1.0). Match its title, summary, publisher,
category, logo, core product description, getting-started wording, and the three
shared example prompts in `README.md`. Add the Native App benefit and its setup
requirements for the Snowflake audience, plus the native-workspace example.
Adapt the host name and setup destination:
ChatGPT's host-specific landing page is not a CoCo setup guide. Privacy and terms
links match the published listing.

The CoCo manifest keeps the technical ID `supaflow`, uses the published tagline
as its `description`, and carries the publisher in `author`. The display title,
long description, category, prompts, and links are provided here and in the
shipped README for listing surfaces that accept them; do not add OpenAI-only
interface fields to the CoCo manifest. Final rendering must be checked in the
selected Snowflake distribution surface before publication.

## Build and inspect

Use an existing Python virtual environment with PyYAML for the repository tests.
The CoCo builder itself uses only the standard library. From the repository root:

```sh
python -m unittest discover -s scripts -p 'test_*.py'
python scripts/validate.py
python scripts/build_cortex_submission.py --draft
cortex plugin validate dist/supaflow-cortex-0.1.0-draft
```

Once the dedicated public client is registered and configured, build into a new
output location using `--client-id '<REGISTERED_PUBLIC_CLIENT_ID>'` without
`--draft`. Never supply a secret. Existing artifacts are intentionally not
overwritten. Inspect the extracted package and ZIP; only the eleven reviewed
files belong in either. Validate that exact extracted release with CoCo.
The third skill, `setup-supaflow-native-app`, must come from the CoCo provider
source. Shared ChatGPT/Claude skills remain unchanged. Test Native App setup
separately from hosted MCP using the bounded checks in [DEV-TESTING.md](DEV-TESTING.md).

## Enablement and live verification

1. Review and deploy migration 222 and the matching app changes. Run the SQL
   regression on DEV with transaction rollback before deployment. Follow the
   platform migration runbook, including its copy-only baseline commit.
2. Register the dedicated public PKCE client described in DESIGN. Configure its
   exact app binding and any deployment-level allowlist; never relax dynamic
   registration or resource checks. Registering a client is not a tenant grant.
3. Choose a reviewer Supaflow account and workspace. Have its owner/admin enable
   **Snowflake Cortex Code**. Keep production credentials out of this repository.
4. Launch `cortex -c <connection> --plugin-dir /absolute/path/to/the/release/package`
   for the explicitly selected review connection. Use the interactive `/mcp`
   connection flow. In Codex-driven testing, capture the authorization URL and
   use the in-app browser; do not silently launch an external browser. Browser
   consent remains the user's decision. Do not use bypass/automatic approvals.
5. Verify `resource=https://app.supa-flow.io/mcp` exactly once on authorization,
   code exchange, and refresh; both token grants must reach the token endpoint
   discovered from the Clerk issuer (`https://clerk.supa-flow.io/oauth/token`
   in current production). Do not pin the legacy Supaflow token facade. Verify rotation and a fresh
   authenticated MCP call after refresh without exposing tokens in evidence.
6. Verify `auth_status`, workspace selection, read-only connection/pipeline/job
   discovery, workspace scoping, and denied access for an unselected application.
   Confirm no local-agent capabilities appear and no Snowflake credential is
   used as Supaflow authorization. Confirm the loaded skills' entry points.
7. Run [the shared hosted lifecycle suite](../../../docs/hosted-mcp-testing.md)
   with explicitly selected disposable fixtures and mutation/destination-write
   opt-ins. Its Inspector OAuth is separate from the CoCo OAuth proof. Preserve
   sanitized coverage and cleanup evidence. Do not alter existing customer data.
8. Review a clean install from the intended distribution source and collect a
   demo showing consent, workspace selection, a reviewed pipeline, and job
   status. Document any unsupported CoCo surface. Do not claim Desktop or
   Snowsight support based on a CLI pass.

## Account publishing, if selected

After reviewing the final package, destination, audience and discoverability:

```sh
cortex plugin publish /absolute/path/to/the/release/package -c '<CONNECTION>' \
  --push-to-fqn '<DATABASE>.<SCHEMA>.SUPAFLOW' \
  --to-role '<REVIEWED_ROLE>' --discoverable
```

Replace all placeholders with approved values and quote identifiers correctly.
Do not default to PUBLIC, omit a known FQN, or use `--force-abort-live`. The
role flag replaces the grant set. Read the resulting object/version, grants,
and discoverability back before reporting availability. This shares within the
Snowflake account; it does not submit to a global marketplace.

## Public contribution, if selected

The CoCo contribution uses Apache 2.0 with the shared content's MIT notice retained
in `NOTICE`. Preserve both files when preparing the upstream contribution. Prepare
a PR adding the exact extracted package at `plugins/supaflow/` and a row in the
upstream Plugins table. Follow the current Snowflake Labs contributor review
skill and requirements. Keep the source commit, package hash, native validation,
OAuth evidence, functional evidence and limitations with the submission.
Opening that PR or contacting maintainers requires a separate explicit request.

Suggested PR title: `feat(supaflow): add hosted data pipeline plugin`

Suggested body: Adds Supaflow's hosted MCP plugin for Cortex Code. Users connect
through browser OAuth, select a workspace, and operate pipelines with reviewed
object scope. The package reuses the existing hosted runtime and does not install
executables or expose local-agent controls. Attach actual validation and live
OAuth results here before submission; do not substitute planned tests.
