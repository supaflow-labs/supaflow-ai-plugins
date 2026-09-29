import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { chromium } from 'playwright';

const DEMO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.resolve(
  process.env.CHATGPT_DEMO_PROFILE_DIR ??
    path.join(DEMO_ROOT, 'chatgpt-demo-profile'),
);
const VIDEO_DIR = path.resolve(
  process.env.CHATGPT_DEMO_VIDEO_DIR ?? path.join(DEMO_ROOT, 'videos'),
);
const ARTIFACT_DIR = path.resolve(
  process.env.CHATGPT_DEMO_ARTIFACT_DIR ?? path.join(DEMO_ROOT, 'artifacts'),
);
const CHATGPT_URL = 'https://chatgpt.com';
const PLUGINS_URL = `${CHATGPT_URL}/plugins`;
const ACTION_TIMEOUT_MS = Number(
  process.env.CHATGPT_DEMO_ACTION_TIMEOUT_MS ?? 120_000,
);
const RESPONSE_TIMEOUT_MS = Number(
  process.env.CHATGPT_DEMO_RESPONSE_TIMEOUT_MS ?? 900_000,
);
const PRESENTATION_PAUSE_MS = Number(
  process.env.CHATGPT_DEMO_PRESENTATION_PAUSE_MS ?? 900,
);

const mode = process.argv.includes('--setup-profile')
  ? 'setup-profile'
  : process.argv.includes('--probe-oauth')
    ? 'probe-oauth'
    : process.argv.includes('--record')
      ? 'record'
      : null;

if (!mode) {
  throw new Error(
    'Choose exactly one mode: --setup-profile, --probe-oauth, or --record',
  );
}

await mkdir(PROFILE_DIR, { recursive: true });
await mkdir(VIDEO_DIR, { recursive: true });
await mkdir(ARTIFACT_DIR, { recursive: true });

if (mode === 'setup-profile') {
  await prepareProfileInRegularChrome();
  process.exit(0);
}

const recordedPages = [];
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1920, height: 1080 },
  recordVideo: {
    dir: VIDEO_DIR,
    size: { width: 1920, height: 1080 },
  },
});

context.setDefaultTimeout(ACTION_TIMEOUT_MS);
context.on('page', (page) => recordedPages.push(page));
for (const page of context.pages()) recordedPages.push(page);

let oauthPageMode = 'not-started';
let finalError;

try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(PLUGINS_URL, { waitUntil: 'domcontentloaded' });
  await waitForChatGptLogin(page);
  await ensureDeveloperMode(page);
  const pluginPage = await openSupaflowPlugin(page);
  const chatPage = await startSupaflowChat(pluginPage);
  oauthPageMode = await connectSupaflow(context, chatPage);

  if (mode === 'record') {
    await runDemo(chatPage);
  }
} catch (error) {
  finalError = error;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  const videoEntries = recordedPages
    .map((page, index) => ({ index, video: page.video(), url: page.url() }))
    .filter(({ video }) => video);

  await context.close();

  const videos = [];
  for (const entry of videoEntries) {
    try {
      videos.push({
        page: entry.index + 1,
        url: entry.url,
        path: await entry.video.path(),
      });
    } catch (error) {
      videos.push({
        page: entry.index + 1,
        url: entry.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = {
    completedAt: new Date().toISOString(),
    mode,
    oauthPageMode,
    continuousBuiltInVideo: oauthPageMode !== 'popup-or-new-tab',
    videos,
    error: finalError instanceof Error ? finalError.message : undefined,
  };

  await writeFile(
    path.join(ARTIFACT_DIR, 'last-run.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );

  for (const video of videos) {
    if (video.path) console.log(`Video: ${video.path}`);
  }
  console.log(`Run report: ${path.join(ARTIFACT_DIR, 'last-run.json')}`);
}

if (finalError) process.exitCode = 1;

async function waitForChatGptLogin(page) {
  if (await isPluginPageReady(page)) return;

  console.log(
    'Sign in to ChatGPT manually in the opened Chromium window. The script will continue when the plugin page is available.',
  );

  await page
    .getByRole('heading', { name: /^Plugins$/i })
    .waitFor({ state: 'visible', timeout: 15 * 60_000 });
}

async function isPluginPageReady(page) {
  return page
    .getByRole('heading', { name: /^Plugins$/i })
    .isVisible()
    .catch(() => false);
}

async function ensureDeveloperMode(page) {
  await page.goto(PLUGINS_URL, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('heading', { name: /^Plugins$/i })
    .waitFor({ state: 'visible' });

  const existingIndicator = page.getByText(/Developer mode/i).first();
  if (await existingIndicator.isVisible().catch(() => false)) {
    const control = page.getByRole('switch', { name: /Developer mode/i });
    if (await control.isVisible().catch(() => false)) {
      if (!(await control.isChecked())) await control.check();
    }
    return;
  }

  const settingsButtons = [
    page.getByRole('button', { name: /^Settings$/i }),
    page.getByRole('button', { name: /plugin settings/i }),
  ];

  for (const button of settingsButtons) {
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click();
    const developerSwitch = page.getByRole('switch', {
      name: /Developer mode/i,
    });
    if (await developerSwitch.isVisible().catch(() => false)) {
      if (!(await developerSwitch.isChecked())) await developerSwitch.check();
      await closeDialogIfPresent(page);
      return;
    }
  }

  throw new Error(
    'Developer mode was not visible. Enable it manually on the ChatGPT Plugins page, then rerun the command.',
  );
}

async function openSupaflowPlugin(page) {
  await page.goto(PLUGINS_URL, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('heading', { name: /^Plugins$/i })
    .waitFor({ state: 'visible' });

  const search = page
    .getByRole('searchbox')
    .or(page.getByPlaceholder(/search/i))
    .first();
  await search.fill('Supaflow');

  const supaflow = page.getByText(/^Supaflow$/i).first();
  await supaflow.waitFor({ state: 'visible' });
  await presentationPause(page);
  await supaflow.click();
  await page
    .getByRole('heading', { name: /^Supaflow$/i })
    .waitFor({ state: 'visible' });
  await presentationPause(page);
  return page;
}

async function startSupaflowChat(pluginPage) {
  const launch = pluginPage
    .getByRole('button', { name: /Try now|Install plugin/i })
    .first();
  await launch.waitFor({ state: 'visible' });
  await launch.click();

  await pluginPage.waitForURL(/chatgpt\.com\/(?!plugins)/, {
    timeout: ACTION_TIMEOUT_MS,
  });
  await findComposer(pluginPage).waitFor({ state: 'visible' });
  return pluginPage;
}

async function connectSupaflow(context, chatPage) {
  const discoveryPrompt =
    'Show my Supaflow sources, destinations, and the Salesforce to Snowflake pipeline.';
  await submitPrompt(chatPage, discoveryPrompt);

  const connect = chatPage
    .getByRole('button', { name: /Connect|Authorize|Sign in/i })
    .first();

  if (!(await connect.isVisible().catch(() => false))) {
    const connectionRequested = await connect
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (!connectionRequested) {
      await waitForResponseComplete(chatPage);
      return 'already-connected';
    }
  }

  const originalUrl = chatPage.url();
  const pagePromise = context
    .waitForEvent('page', { timeout: 10_000 })
    .catch(() => null);
  await connect.click();
  const openedPage = await pagePromise;

  let oauthPage = openedPage;
  let pageMode = 'popup-or-new-tab';
  if (!oauthPage) {
    await chatPage.waitForURL(
      (url) => url.href !== originalUrl && /supa-flow\.io|clerk/i.test(url.href),
      { timeout: ACTION_TIMEOUT_MS },
    );
    oauthPage = chatPage;
    pageMode = 'same-tab';
  }

  await authorizeSupaflow(oauthPage);

  if (pageMode === 'popup-or-new-tab') {
    await oauthPage.waitForEvent('close', { timeout: ACTION_TIMEOUT_MS }).catch(
      () => null,
    );
    await chatPage.bringToFront();
  } else {
    await chatPage.waitForURL(/chatgpt\.com/, { timeout: ACTION_TIMEOUT_MS });
  }

  await findComposer(chatPage).waitFor({ state: 'visible' });
  await presentationPause(chatPage);

  if (
    await chatPage
      .getByRole('button', { name: /Connect|Authorize|Sign in/i })
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await submitPrompt(chatPage, discoveryPrompt);
    await waitForResponseComplete(chatPage);
  }

  return pageMode;
}

async function authorizeSupaflow(page) {
  const email = requiredSecret('SUPAFLOW_DEMO_EMAIL');
  const password = requiredSecret('SUPAFLOW_DEMO_PASSWORD');

  await page.waitForLoadState('domcontentloaded');
  const emailField = page
    .getByRole('textbox', { name: /Email address/i })
    .or(page.getByPlaceholder(/email address/i))
    .first();

  if (await emailField.isVisible().catch(() => false)) {
    await emailField.fill(email);
    await page.getByRole('button', { name: /^Continue$/i }).click();
  }

  const useAnotherMethod = page.getByRole('button', {
    name: /Use another method/i,
  });
  await useAnotherMethod.waitFor({ state: 'visible' });
  await useAnotherMethod.click();

  const passwordMethod = page.getByRole('button', {
    name: /Sign in with your password/i,
  });
  await passwordMethod.waitFor({ state: 'visible' });
  await passwordMethod.click();

  const passwordField = page
    .getByLabel(/^Password$/i)
    .or(page.getByPlaceholder(/password/i))
    .first();
  await passwordField.fill(password);
  await page.getByRole('button', { name: /^Continue$/i }).click();

  const allow = page.getByRole('button', { name: /^Allow$/i });
  await allow.waitFor({ state: 'visible' });
  await presentationPause(page);
  await allow.click();
}

async function runDemo(page) {
  await submitPrompt(
    page,
    'Show my Supaflow sources, destinations, and the Salesforce to Snowflake pipeline.',
  );
  await waitForResponseComplete(page);
  await presentationPause(page, 2_500);

  await submitPrompt(
    page,
    'Run my Salesforce to Snowflake pipeline, monitor it to completion, and summarize the result for Account, Contact, Case, and Opportunity.',
  );
  await waitForResponseComplete(page);
  await page
    .getByText(/Completed|completion|loaded/i)
    .last()
    .waitFor({ state: 'visible', timeout: RESPONSE_TIMEOUT_MS });
  await presentationPause(page, 6_000);
}

async function submitPrompt(page, prompt) {
  const composer = findComposer(page);
  await composer.waitFor({ state: 'visible' });
  await composer.click();
  await composer.pressSequentially(prompt, { delay: 18 });
  await presentationPause(page, 500);
  await composer.press('Enter');
}

function findComposer(page) {
  return page
    .getByRole('textbox', { name: /Message|Prompt/i })
    .or(page.locator('textarea'))
    .or(page.locator('[contenteditable="true"]'))
    .filter({ visible: true })
    .first();
}

async function waitForResponseComplete(page) {
  const stop = page.getByRole('button', { name: /Stop generating|Stop/i });
  const appeared = await stop
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (appeared) {
    await stop.waitFor({ state: 'hidden', timeout: RESPONSE_TIMEOUT_MS });
    return;
  }

  const send = page.getByRole('button', { name: /Send/i });
  await send.waitFor({ state: 'visible', timeout: RESPONSE_TIMEOUT_MS });
}

async function closeDialogIfPresent(page) {
  const close = page.getByRole('button', { name: /Close/i }).first();
  if (await close.isVisible().catch(() => false)) await close.click();
}

async function presentationPause(page, duration = PRESENTATION_PAUSE_MS) {
  await page.waitForTimeout(duration);
}

function requiredSecret(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the environment.`);
  }
  return value;
}

async function prepareProfileInRegularChrome() {
  const chromeBinary =
    process.env.CHATGPT_DEMO_CHROME_BINARY ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  console.log(
    'Opening regular Google Chrome. Sign in to ChatGPT, enable Developer mode on the Plugins page, then quit this Chrome window completely.',
  );

  const child = spawn(
    chromeBinary,
    [
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--new-window',
      PLUGINS_URL,
    ],
    { stdio: 'inherit' },
  );

  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM') {
        resolve();
        return;
      }
      reject(
        new Error(
          `Google Chrome exited before setup completed (code=${code}, signal=${signal}).`,
        ),
      );
    });
  });
}
