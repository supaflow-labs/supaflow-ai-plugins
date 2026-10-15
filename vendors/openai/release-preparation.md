# Supaflow public skills update

Release handoff prepared October 14, 2026. Revalidate before use; retire after publication or November 14, 2026, whichever comes first.

## Change for review

Next-version local candidate: **1.1.1** adds explicit sequential schema pagination, forbids distant/binary-search probes, and requires fixed scope/page size through the first terminal page. Version 1.1.0 was submitted by the user on October 14; do not cancel, replace, or reupload that review for this preparation. Its retained archive is `dist/terminal-job-fix-2026-10-14/supaflow-openai-1.1.0.zip`. The evidence below describes earlier preparation unless dated otherwise. No ChatGPT-host activation test of 1.1.1 has been performed; local trace-contract tests are not model-behavior evidence.

Version 1.1.0 packages the provider-neutral `using-supaflow` skill that was absent from public version 1.0.0, plus a read-only `setup` onboarding skill. It adds identity/workspace verification, safe datasource and pipeline workflows, pagination, terminal job handling, schedule-execution resolution, and recovery boundaries. It does not change the hosted MCP runtime, endpoint, OAuth grants, publisher, or audience.

The public manifest preserves the current public subtitle, original capability description, and three starter prompts, including the HubSpot-to-Snowflake run example. It appends signup/setup instructions, links website/homepage to the new ChatGPT landing page, and declares the bundled onboarding skill. The local app-bound package retains its separate identity and version; Supaflow Code is unchanged.

## Preparation evidence and remaining gates

- Portal inspection: version 1.0.0 is published under package `app-6abadf90c69881919b46c92f36bcfc99`, with **No skills in this version**.
- Existing integration rehearsal: the published MCP-only plugin returned the expected reviewer identity, two datasources, one Salesforce-to-Snowflake pipeline, and Account, Case, Contact, Opportunity selections. This is not evidence that the new skill has run.
- Version 1.1.0 import: both skills and listing updates were verified in saved draft `appsub_6acffecf387c8191abed584115d0dd8f`; its server reused the original configured, authorized app. Both skill checks passed. The user subsequently reported submitting this version. The 1.1.1 candidate remains local only.
- Terminal-job correction: the packaged workflow includes `completed_with_warning` and `timed_out` alongside completed, failed, cancelled, and skipped. All 40 offline tests passed after adding archive-contract and warning/timeout polling regressions. The corrected archive is `dist/terminal-job-fix-2026-10-14/supaflow-openai-1.1.0.zip`; earlier ZIPs do not include this correction.
- Exact-draft onboarding invocation: **Not run**. Test setup from a fresh chat and installation during an existing chat, including disconnected accounts, workspace choice, and empty/missing connections. Check that setup invokes the packaged skill without mutations or credential collection.
- Exact-draft workflow tests: **Not run**. Verify account identity, datasource listing, pipeline inspection across schema pages, failed-job explanation, and safe refusal of local agent lifecycle or plaintext credential requests. A run/monitor test needs separate authorization and a working destination.
- Reviewer fixture health: the read-only rehearsal returned Snowflake datasource state Failed and last pipeline job Failed. Investigate and restore the fixture before relying on a successful sync case; do not represent the read-only test as a successful pipeline run.
- Existing MCP scan findings: the portal lists findings for `datasources_create`, `datasources_edit`, and `pipelines_schema_select`. The expanded `datasources_create` finding says its tool update needs further review before going live. Check each applicable saved-draft finding rather than assuming a skills ZIP resolves server review.
- Existing review cases, demo, secure reviewer credentials, targeting, translations, and commerce declarations: inspect their preserved values in the saved draft; they are intentionally not overwritten by this archive.
- Public listing links: website, support, privacy policy, and website terms were opened without a private login. The published privacy policy includes the AI Integrations, APIs, and Plugins section covering ChatGPT and Claude; the website terms refer product use to the Master Subscription Agreement. No policy or terms changes were made.
- New landing page: `https://www.supa-flow.io/agentic-data-pipelines/chatgpt-plugin` opened successfully on October 14, 2026 and displays account creation, installation, authorization, workspace selection, secure connection setup, and the separate local Code instructions.
- Publisher legal/policy attestations: required in the portal after upload; not made by this preparation.

Do not call the release ready to submit until the remaining online gates pass. Keep the currently published release available while the update is reviewed.
