# OpenAI review demo recording

This harness records a browser-based ChatGPT demo of the production Supaflow
plugin. It deliberately keeps the ChatGPT browser profile, Supaflow test
credentials, OAuth tokens, screenshots, and videos outside Git.

## One-time setup

From this directory:

```bash
npm install --ignore-scripts
npm run install-video-runtime
npm run setup-profile
```

The setup command opens ordinary Google Chrome—not a Playwright-controlled
browser—with the dedicated persistent demo profile. This avoids Google rejecting
an automated browser during manual ChatGPT sign-in. Sign in to ChatGPT, open
the plugin page, enable **Developer mode**, and then quit that Chrome window
completely. The script does not automate or store ChatGPT credentials.

The OAuth probe and recording commands reopen the same authenticated profile
under Playwright control. Do not keep the setup Chrome window open while either
command is running.

## Test credentials

Export the dedicated Supaflow review account immediately before running the
probe or recording. Never put these values in this repository:

```bash
export SUPAFLOW_DEMO_EMAIL='<review-account-email>'
export SUPAFLOW_DEMO_PASSWORD='<review-account-password>'
```

If the credentials already live in an approved local environment file, source
that file in the same shell without printing it, then map its variables to the
two names above.

The Supaflow login defaults to an email OTP. The harness intentionally follows
this password path:

1. Enter the review-account email and continue.
2. On **Check your email**, choose **Use another method**.
3. Choose **Sign in with your password**.
4. Enter the review-account password and continue.
5. Approve the Supaflow OAuth consent screen.

Device verification must remain disabled for the dedicated review account
flow. Ordinary passwordless users can continue signing in with their emailed
OTP.

## Probe OAuth before recording

Disconnect Supaflow in ChatGPT if it is already connected, then run:

```bash
npm run probe-oauth
```

The probe records whether OAuth stayed in the ChatGPT page or opened another
page. If it opens a popup or new tab, use OBS or another window-level recorder
for the final continuous demo; Playwright's built-in video recorder creates one
file per page.

## Record the demo

Start from a disconnected Supaflow plugin and run:

```bash
npm run record
```

The recording demonstrates selecting Supaflow from ChatGPT's plugin page,
completing OAuth using the password alternative, and running these prompts in
order:

1. `List the available datasources in my Supaflow workspace. Group them into
   sources and destinations, and show each datasource's name, connector type,
   and status.`
2. `List my Supaflow pipelines. Show each pipeline's name, source, destination,
   and current state.`
3. `Show my five most recent Supaflow jobs, newest first. Include the pipeline
   name, job status, start time, duration, and rows processed.`
4. `Show me the configuration for my Salesforce-to-Snowflake pipeline,
   including its source, destination, and selected objects.`
5. `Run my Salesforce-to-Snowflake pipeline using a normal sync. Monitor the
   job until it finishes, then summarize its status, duration, rows processed,
   and any warnings or errors.`

These prompts deliberately request only fields exposed by the current tools.
For example, the pipeline listing returns its current state, while the pipeline
configuration does not return a refresh-mode field.

Recordings are finalized when the browser context closes and are written to
`videos/`. Run metadata, including the detected OAuth page mode and the exact
video paths, is written to `artifacts/last-run.json`.

The profile and outputs are ignored by Git. Before another attempt, disconnect
Supaflow from ChatGPT and confirm that the previous pipeline job has finished.
Do not delete the seeded Salesforce source, Snowflake destination, or pipeline.
