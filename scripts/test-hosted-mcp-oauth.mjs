#!/usr/bin/env node

import crypto from 'node:crypto';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_MCP_URL = 'http://localhost:3000/mcp';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_JOB_TIMEOUT_MS = 900_000;
const PROTOCOL_VERSION = '2025-11-25';
const OAUTH_SCOPES = [
  'offline_access',
  'user:org:read',
  'supaflow:read',
  'supaflow:write',
];
const TERMINAL_JOB_STATES = new Set([
  'completed',
  'completed_with_warning',
  'failed',
  'cancelled',
  'timed_out',
  'skipped',
]);
const SUCCESS_JOB_STATES = new Set(['completed', 'completed_with_warning']);
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520]);

export class McpTransportError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'McpTransportError';
  }
}

export class McpRetryableError extends Error {
  constructor(message, retryAfterMs = 1_000, options) {
    super(message, options);
    this.name = 'McpRetryableError';
    this.retryAfterMs = Math.max(0, retryAfterMs);
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('OAuth access token is not a JWT');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('OAuth access token JWT payload is malformed');
  }
}

function assertResourceBoundAccessToken(token, { clientId, issuer, resource }) {
  const payload = decodeJwtPayload(token);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== issuer || !audiences.includes(resource)) {
    throw new Error('OAuth access token is not bound to the advertised MCP resource');
  }
  if (payload.client_id !== clientId || payload.token_use !== 'mcp_access') {
    throw new Error('OAuth access token has the wrong client or token use');
  }
  const scopes = new Set(
    typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : [],
  );
  for (const scope of OAUTH_SCOPES.filter((value) => value !== 'offline_access')) {
    if (!scopes.has(scope)) {
      throw new Error(`OAuth access token is missing ${scope}`);
    }
  }
  if (typeof payload.exp !== 'number' || payload.exp <= Date.now() / 1000) {
    throw new Error('OAuth access token is expired or missing exp');
  }
  if ('email' in payload || 'name' in payload) {
    throw new Error('External MCP access token contains unnecessary profile claims');
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(response) {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function readJson(response, label) {
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

function authorizationMetadataUrl(issuer) {
  const url = new URL(issuer);
  const issuerPath = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  url.pathname = `/.well-known/oauth-authorization-server${issuerPath}`;
  url.search = '';
  url.hash = '';
  return url;
}

export function assertCanonicalProtectedResourceMetadata(resourceMetadata, mcpUrl) {
  const expectedResource = new URL(mcpUrl).toString();
  if (resourceMetadata.resource !== expectedResource) {
    throw new Error(
      `Protected-resource metadata must identify the exact MCP endpoint (${expectedResource})`,
    );
  }
  return expectedResource;
}

function waitForAuthorizationCode(redirectUri, expectedState, timeoutMs) {
  const redirect = new URL(redirectUri);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(redirect.hostname)) {
    throw new Error('SUPAFLOW_OAUTH_REDIRECT_URI must use a loopback hostname');
  }
  if (!redirect.port) throw new Error('SUPAFLOW_OAUTH_REDIRECT_URI must include a port');

  let timer;
  let settled = false;
  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const server = http.createServer((request, response) => {
    const received = new URL(request.url || '/', redirect.origin);
    if (received.pathname !== redirect.pathname) {
      response.writeHead(404).end('Not found');
      return;
    }
    const state = received.searchParams.get('state');
    const code = received.searchParams.get('code');
    const oauthError = received.searchParams.get('error');
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    if (oauthError) {
      response.end('<h1>Supaflow authorization failed</h1><p>You can close this tab.</p>');
      if (!settled) {
        settled = true;
        rejectCode(new Error(`Authorization server returned ${oauthError}`));
      }
      return;
    }
    if (state !== expectedState || !code) {
      response.end('<h1>Invalid OAuth callback</h1><p>You can close this tab.</p>');
      if (!settled) {
        settled = true;
        rejectCode(new Error('OAuth callback failed state or code validation'));
      }
      return;
    }
    response.end('<h1>Supaflow authorization complete</h1><p>You can close this tab.</p>');
    if (!settled) {
      settled = true;
      resolveCode(code);
    }
  });
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(redirect.port), redirect.hostname, resolve);
  });
  timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectCode(new Error('Timed out waiting for the OAuth callback'));
    }
  }, timeoutMs);
  return {
    listening,
    code: codePromise.finally(() => {
      clearTimeout(timer);
      server.close();
    }),
  };
}

function parseMcpPayload(text, contentType) {
  if (contentType.includes('text/event-stream')) {
    const payloads = text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice('data: '.length));
    if (payloads.length === 0) throw new Error('MCP returned an empty event stream');
    return JSON.parse(payloads.at(-1));
  }
  return JSON.parse(text);
}

async function authorize({ clientId, redirectUri, mcpUrl, timeoutMs }) {
  const mcp = new URL(mcpUrl);
  const resourceMetadata = await readJson(
    await fetch(new URL('/.well-known/oauth-protected-resource/mcp', mcp), {
      headers: { Accept: 'application/json' },
    }),
    'Protected-resource metadata',
  );
  const resource = assertCanonicalProtectedResourceMetadata(resourceMetadata, mcpUrl);
  const issuer = resourceMetadata.authorization_servers?.[0];
  if (typeof issuer !== 'string') {
    throw new Error('Protected-resource metadata has no authorization server');
  }
  const authorizationMetadata = await readJson(
    await fetch(authorizationMetadataUrl(issuer), {
      headers: { Accept: 'application/json' },
    }),
    'Authorization-server metadata',
  );
  if (!authorizationMetadata.authorization_endpoint || !authorizationMetadata.token_endpoint) {
    throw new Error('Authorization-server metadata is incomplete');
  }
  if (!authorizationMetadata.code_challenge_methods_supported?.includes('S256')) {
    throw new Error('Authorization server does not advertise PKCE S256');
  }

  const state = base64Url(crypto.randomBytes(24));
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const callback = waitForAuthorizationCode(redirectUri, state, timeoutMs);
  await callback.listening;

  const authorizationUrl = new URL(authorizationMetadata.authorization_endpoint);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('scope', OAUTH_SCOPES.join(' '));
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('code_challenge', challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  authorizationUrl.searchParams.set('resource', resource);
  console.log(`AUTHORIZATION_URL=${authorizationUrl}`);
  console.log('Waiting for browser authorization...');

  const code = await callback.code;
  const tokens = await readJson(
    await fetch(authorizationMetadata.token_endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource,
      }),
    }),
    'Token exchange',
  );
  if (typeof tokens.access_token !== 'string' || !tokens.access_token) {
    throw new Error('Token exchange did not return an access token');
  }
  assertResourceBoundAccessToken(tokens.access_token, {
    clientId,
    issuer,
    resource,
  });
  console.log(
    `PASS oauth_authorization_code_pkce refresh_token=${typeof tokens.refresh_token === 'string'}`,
  );
  let accessToken = tokens.access_token;
  let refreshToken =
    typeof tokens.refresh_token === 'string' && tokens.refresh_token ? tokens.refresh_token : null;

  return {
    accessToken: () => accessToken,
    canRefresh: () => refreshToken !== null,
    async refresh() {
      if (!refreshToken) throw new Error('OAuth token response did not include a refresh token');
      const refreshed = await readJson(
        await fetch(authorizationMetadata.token_endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: refreshToken,
            resource,
          }),
        }),
        'Token refresh',
      );
      if (typeof refreshed.access_token !== 'string' || !refreshed.access_token) {
        throw new Error('Token refresh did not return an access token');
      }
      assertResourceBoundAccessToken(refreshed.access_token, {
        clientId,
        issuer,
        resource,
      });
      accessToken = refreshed.access_token;
      if (typeof refreshed.refresh_token === 'string' && refreshed.refresh_token) {
        refreshToken = refreshed.refresh_token;
      }
      console.log('PASS oauth_refresh_token');
    },
  };
}

export function createMcpClient(
  mcpUrl,
  oauthSession,
  { requestTimeoutMs = Number(process.env.SUPAFLOW_RPC_TIMEOUT_MS || 25_000) } = {},
) {
  let requestId = 0;
  async function rpc(method, params) {
    requestId += 1;
    const body = JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params });
    const send = async () => {
      try {
        return await fetch(mcpUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${oauthSession.accessToken()}`,
            'Content-Type': 'application/json',
            'MCP-Protocol-Version': PROTOCOL_VERSION,
          },
          body,
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown network error';
        throw new McpTransportError(`${method} transport failed: ${message}`, { cause: error });
      }
    };

    let response = await send();
    if (response.status === 401 && oauthSession.canRefresh()) {
      await oauthSession.refresh();
      response = await send();
    }
    if (!response.ok) {
      if (
        RETRYABLE_HTTP_STATUSES.has(response.status) ||
        (response.status >= 500 && response.status <= 599)
      ) {
        throw new McpRetryableError(
          `${method} returned temporary HTTP ${response.status}`,
          retryAfterMilliseconds(response),
        );
      }
      throw new Error(`${method} returned HTTP ${response.status}`);
    }
    const payload = parseMcpPayload(
      await response.text(),
      response.headers.get('content-type') || '',
    );
    if (payload.error) throw new Error(`${method} returned JSON-RPC error ${payload.error.code}`);
    return payload.result;
  }

  const invoked = new Set();
  async function callTool(name, args, { quiet = false, allowError = false } = {}) {
    invoked.add(name);
    const result = await rpc('tools/call', { name, arguments: args });
    if (result?.isError && !allowError) {
      const message = result.content?.find((item) => item.type === 'text')?.text;
      const publicError = result.structuredContent?.error;
      if (publicError?.retryable === true) {
        throw new McpRetryableError(
          `${name} returned a retryable tool error${message ? `: ${message}` : ''}`,
          Number(publicError.retry_after_ms) || 0,
        );
      }
      throw new Error(`${name} returned a tool error${message ? `: ${message}` : ''}`);
    }
    if (!quiet) console.log(`PASS ${name}`);
    return result;
  }
  return { rpc, callTool, invoked };
}

function content(result) {
  return result?.structuredContent || {};
}

export async function pollJob(
  client,
  workspaceId,
  jobId,
  { requireSuccess = true, timeoutMs, intervalMs = 2_000 },
) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  let transientRetries = 0;
  while (Date.now() < deadline) {
    let result;
    try {
      result = await client.callTool(
        'jobs_status',
        { workspace_id: workspaceId, id: jobId },
        { quiet: true },
      );
    } catch (error) {
      if (!(error instanceof McpTransportError || error instanceof McpRetryableError)) {
        throw error;
      }
      transientRetries += 1;
      console.warn(`WARN jobs_status transient retry=${transientRetries}`);
      await sleep(Math.max(intervalMs, error.retryAfterMs || 0));
      continue;
    }
    const status = content(result).job?.status;
    if (status !== lastStatus) {
      console.log(`INFO jobs_status status=${status || 'unknown'}`);
      lastStatus = status;
    }
    if (TERMINAL_JOB_STATES.has(status)) {
      if (requireSuccess && !SUCCESS_JOB_STATES.has(status)) {
        throw new Error(`Job reached terminal status ${status}`);
      }
      console.log(`PASS jobs_status terminal=${status}`);
      return status;
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `Timed out polling a live Supaflow job (last_status=${lastStatus || 'unknown'}, transient_retries=${transientRetries})`,
  );
}

export async function pollCatalogReset(
  client,
  workspaceId,
  jobId,
  { timeoutMs, intervalMs = 2_000 },
) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  let transientRetries = 0;
  while (Date.now() < deadline) {
    let result;
    try {
      result = await client.callTool(
        'datasources_catalog_reset_status',
        { workspace_id: workspaceId, id: jobId },
        { quiet: true },
      );
    } catch (error) {
      if (!(error instanceof McpTransportError || error instanceof McpRetryableError)) {
        throw error;
      }
      transientRetries += 1;
      console.warn(`WARN datasources_catalog_reset_status transient retry=${transientRetries}`);
      await sleep(Math.max(intervalMs, error.retryAfterMs || 0));
      continue;
    }
    const reset = content(result).catalog_reset;
    const state = reset?.catalog_state;
    if (state !== lastState) {
      console.log(
        `INFO datasources_catalog_reset_status state=${state || 'unknown'} maintenance_active=${String(reset?.maintenance_active)}`,
      );
      lastState = state;
    }
    if (reset?.maintenance_active === false) {
      if (state !== 'completed') {
        throw new Error(`Catalog reset finished with unexpected state ${state || 'unknown'}`);
      }
      console.log('PASS datasources_catalog_reset_status terminal=completed');
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `Timed out polling catalog-reset restoration (last_state=${lastState || 'unknown'}, transient_retries=${transientRetries})`,
  );
}

async function listJobsThroughMcp(client) {
  const workspaces = content(await client.callTool('workspaces_list', {})).workspaces || [];
  if (workspaces.length === 0) throw new Error('No accessible workspace is available');
  const preferredWorkspace = process.env.SUPAFLOW_E2E_WORKSPACE_ID?.trim();
  const workspace = workspaces.find((item) => item.id === preferredWorkspace) || workspaces[0];
  const createdAfterValue = process.env.SUPAFLOW_JOBS_CREATED_AFTER?.trim();
  const createdAfter = createdAfterValue ? Date.parse(createdAfterValue) : null;
  if (createdAfterValue && !Number.isFinite(createdAfter)) {
    throw new Error('SUPAFLOW_JOBS_CREATED_AFTER must be an ISO-8601 timestamp');
  }

  const jobs = [];
  for (let offset = 0; offset <= 10_000; offset += 200) {
    const page = content(
      await client.callTool(
        'jobs_list',
        { workspace_id: workspace.id, limit: 200, offset },
        { quiet: true },
      ),
    );
    const pageJobs = page.jobs || [];
    jobs.push(...pageJobs);
    if (jobs.length >= page.total || pageJobs.length < 200) break;
  }

  const filteredJobs = jobs.filter((job) => {
    if (createdAfter === null) return true;
    const createdAt = Date.parse(job.createdAt || '');
    return Number.isFinite(createdAt) && createdAt >= createdAfter;
  });
  console.log(
    JSON.stringify(
      {
        workspace: { id: workspace.id, name: workspace.name },
        returned: filteredJobs.length,
        jobs: filteredJobs,
      },
      null,
      2,
    ),
  );
}

export async function listInventoryById(
  client,
  workspaceId,
  toolName,
  field,
  { limit = 200 } = {},
) {
  const items = [];
  const seenIds = new Set();
  let afterId;
  let pages = 0;
  let previousId;

  for (;;) {
    const result = await client.callTool(
      toolName,
      {
        workspace_id: workspaceId,
        limit,
        sort: 'id',
        ...(afterId ? { after_id: afterId } : {}),
      },
      { quiet: true },
    );
    const payload = content(result);
    const page = Array.isArray(payload[field]) ? payload[field] : [];
    pages += 1;

    if (page.length > limit) {
      throw new Error(`${toolName} returned more than the requested ${limit} rows`);
    }
    for (const item of page) {
      const id = typeof item?.id === 'string' ? item.id : '';
      if (!id) throw new Error(`${toolName} returned an item without an id`);
      if (seenIds.has(id)) throw new Error(`${toolName} repeated id ${id}`);
      if (previousId && id <= previousId) {
        throw new Error(`${toolName} returned non-ascending id ${id} after ${previousId}`);
      }
      seenIds.add(id);
      items.push(item);
      previousId = id;
    }

    if (page.length === 0) break;
    afterId = page.at(-1).id;
  }

  return {
    items,
    pages,
    digest: crypto
      .createHash('sha256')
      .update(items.map((item) => item.id).join('\n'))
      .digest('hex'),
  };
}

async function runInventoryPagination(client) {
  const workspaces = content(await client.callTool('workspaces_list', {})).workspaces || [];
  if (workspaces.length === 0) throw new Error('No accessible workspace is available');
  const preferredWorkspace = process.env.SUPAFLOW_E2E_WORKSPACE_ID?.trim();
  const workspace = workspaces.find((item) => item.id === preferredWorkspace) || workspaces[0];

  const [datasources, pipelines] = await Promise.all([
    listInventoryById(client, workspace.id, 'datasources_list', 'datasources'),
    listInventoryById(client, workspace.id, 'pipelines_list', 'pipelines'),
  ]);
  console.log(
    `PASS inventory_id_pagination ${JSON.stringify({
      workspace_id: workspace.id,
      datasources: {
        count: datasources.items.length,
        pages: datasources.pages,
        digest: datasources.digest,
      },
      pipelines: {
        count: pipelines.items.length,
        pages: pipelines.pages,
        digest: pipelines.digest,
      },
    })}`,
  );
}

async function runLiveParity(
  client,
  contract,
  jobTimeoutMs,
  sourceDatasourceId,
  destinationProjectId,
  requestedObjectNames,
) {
  if (process.env.SUPAFLOW_LIVE_MUTATIONS !== 'true') {
    throw new Error('Set SUPAFLOW_LIVE_MUTATIONS=true to authorize isolated live resource mutations');
  }

  const cleanup = { workspaceId: null, datasourceId: null, projectId: null, pipelines: [], scheduleId: null };
  const createdFixtures = {
    datasourceIds: new Set(),
    projectIds: new Set(),
    pipelineIds: new Set(),
    scheduleIds: new Set(),
  };
  const activeJobs = new Set();
  const activeCatalogResetJobs = new Set();
  try {
    const auth = content(await client.callTool('auth_status', {}));
    const workspaces = content(await client.callTool('workspaces_list', {})).workspaces || [];
    if (workspaces.length === 0) throw new Error('No accessible workspace is available');
    const preferredWorkspace = process.env.SUPAFLOW_E2E_WORKSPACE_ID?.trim();
    const workspace = workspaces.find((item) => item.id === preferredWorkspace) || workspaces[0];
    const workspaceId = workspace.id;
    cleanup.workspaceId = workspaceId;
    if (!auth.authenticated) throw new Error('auth_status did not confirm authentication');

    const base = { workspace_id: workspaceId };
    await client.callTool('connectors_list', base);
    await client.callTool('docs', { ...base, topic: 'ingestion-pipelines' });
    await client.callTool('schedules_list', base);
    await client.callTool('jobs_list', { ...base, limit: 10, offset: 0 });

    await client.callTool('pipelines_list', { ...base, limit: 200, offset: 0 });
    const projects = content(
      await client.callTool('projects_list', { ...base, limit: 200, offset: 0 }),
    ).projects || [];
    const destinationProject = projects.find((item) => item.id === destinationProjectId);
    if (!destinationProject?.destinationDatasourceId) {
      throw new Error(
        'SUPAFLOW_E2E_DESTINATION_PROJECT_ID must identify a project with a Snowflake destination',
      );
    }
    if (destinationProject.destinationConnectorName !== 'Snowflake') {
      throw new Error('The E2E destination project must use Snowflake');
    }

    const source = content(
      await client.callTool('datasources_get', {
        ...base,
        identifier: sourceDatasourceId,
      }),
    ).datasource;
    if (!source || source.connectorType !== 'MYSQL') {
      throw new Error(
        'SUPAFLOW_E2E_SOURCE_DATASOURCE_ID must identify the Docker-backed MySQL fixture',
      );
    }
    await client.callTool('datasources_init', {
      ...base,
      connector: source.connectorType,
    });
    await client.callTool('datasources_list', {
      ...base,
      connector_type: source.connectorType,
      limit: 25,
      offset: 0,
    });

    const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const pipelinePrefix = `mcp_e2e_${suffix}`;
    const datasourceName = `MCP E2E Source ${suffix}`;
    const createdDatasource = content(
      await client.callTool('datasources_create', {
        ...base,
        name: datasourceName,
        api_name: `mcp_e2e_source_${suffix}`,
        description: 'Temporary hosted MCP parity test datasource',
        copy_from_identifier: sourceDatasourceId,
        test_connection: false,
      }),
    ).datasource;
    cleanup.datasourceId = createdDatasource.id;
    createdFixtures.datasourceIds.add(createdDatasource.id);
    await client.callTool('datasources_get', { ...base, identifier: createdDatasource.id });
    await client.callTool('datasources_edit', {
      ...base,
      identifier: createdDatasource.id,
      name: `${datasourceName} Edited`,
      description: 'Temporary hosted MCP parity test datasource (edited)',
    });
    await client.callTool('datasources_disable', { ...base, identifier: createdDatasource.id });
    await client.callTool('datasources_enable', { ...base, identifier: createdDatasource.id });

    const testJobId = content(
      await client.callTool('datasources_test', { ...base, identifier: createdDatasource.id }),
    ).job_id;
    activeJobs.add(testJobId);
    await pollJob(client, workspaceId, testJobId, { timeoutMs: jobTimeoutMs });
    activeJobs.delete(testJobId);

    const refreshJobId = content(
      await client.callTool('datasources_refresh', { ...base, identifier: createdDatasource.id }),
    ).job_id;
    if (!refreshJobId) throw new Error('Datasource refresh did not enqueue a job');
    activeJobs.add(refreshJobId);
    await pollJob(client, workspaceId, refreshJobId, { timeoutMs: jobTimeoutMs });
    activeJobs.delete(refreshJobId);

    const catalog = content(
      await client.callTool('datasources_catalog', {
        ...base,
        identifier: createdDatasource.id,
        refresh: false,
        with_fields: false,
        limit: 25,
        offset: 0,
      }),
    ).objects || [];
    if (catalog.length === 0) throw new Error('Refreshed datasource catalog is empty');
    const objectNames = catalog
      .map((item) => item.fully_qualified_name)
      .filter((name) => typeof name === 'string');
    const selectedObjectNames = requestedObjectNames.filter((name) =>
      objectNames.includes(name),
    );
    if (selectedObjectNames.length !== requestedObjectNames.length) {
      throw new Error('One or more requested E2E objects were not found after datasource refresh');
    }

    const projectName = `MCP E2E Project ${suffix}`;
    const project = content(
      await client.callTool('projects_create', {
        ...base,
        name: projectName,
        api_name: `mcp_e2e_project_${suffix}`,
        destination: destinationProject.destinationDatasourceId,
        type: 'pipeline',
      }),
    ).project;
    cleanup.projectId = project.id;
    createdFixtures.projectIds.add(project.id);

    await client.callTool('pipelines_init', {
      ...base,
      source: createdDatasource.id,
      project: project.id,
    });
    const plan = content(
      await client.callTool('pipelines_prepare_create', {
        ...base,
        source: createdDatasource.id,
        project: project.id,
        object_preview_limit: 25,
      }),
    );
    const plannedPipeline = content(
      await client.callTool('pipelines_create_from_plan', {
        ...base,
        plan_id: plan.plan_id,
        name: `MCP E2E Planned Pipeline ${suffix}`,
        description: 'Temporary hosted MCP planned-create test',
        confirmed: true,
        config_patch: {
          pipeline_prefix: pipelinePrefix,
          is_custom_prefix: true,
        },
        object_selection: { mode: 'subset', include: selectedObjectNames },
      }),
    ).pipeline;
    cleanup.pipelines.push(plannedPipeline.id);
    createdFixtures.pipelineIds.add(plannedPipeline.id);

    const pipeline = content(
      await client.callTool('pipelines_create', {
        ...base,
        name: `MCP E2E Smoke Pipeline ${suffix}`,
        source: createdDatasource.id,
        project: project.id,
        description: 'Temporary hosted MCP live smoke pipeline',
        config: {
          pipeline_prefix: pipelinePrefix,
          is_custom_prefix: true,
        },
        objects: [
          {
            fully_qualified_name: selectedObjectNames[0],
            selected: true,
            fields: null,
          },
        ],
      }),
    ).pipeline;
    cleanup.pipelines.push(pipeline.id);
    createdFixtures.pipelineIds.add(pipeline.id);
    await client.callTool('pipelines_get', { ...base, identifier: pipeline.id });
    await client.callTool('pipelines_schema_list', {
      ...base,
      identifier: pipeline.id,
      all: true,
      with_fields: false,
      limit: 25,
      offset: 0,
    });
    await client.callTool('pipelines_schema_add', {
      ...base,
      identifier: pipeline.id,
      object: selectedObjectNames[1],
    });
    await client.callTool('pipelines_schema_select', {
      ...base,
      identifier: pipeline.id,
      objects: selectedObjectNames.map((name) => ({
        fully_qualified_name: name,
        selected: true,
        fields: null,
      })),
    });

    const catalogResetJobId = content(
      await client.callTool('datasources_reset_catalog', {
        ...base,
        identifier: createdDatasource.id,
        confirmed: true,
      }),
    ).job_id;
    if (!catalogResetJobId) throw new Error('Datasource catalog reset did not enqueue a job');
    activeJobs.add(catalogResetJobId);
    activeCatalogResetJobs.add(catalogResetJobId);
    await pollCatalogReset(client, workspaceId, catalogResetJobId, {
      timeoutMs: jobTimeoutMs,
    });
    activeJobs.delete(catalogResetJobId);
    activeCatalogResetJobs.delete(catalogResetJobId);

    const resetCatalog = content(
      await client.callTool(
        'datasources_catalog',
        {
          ...base,
          identifier: createdDatasource.id,
          refresh: false,
          with_fields: false,
          limit: 25,
          offset: 0,
        },
        { quiet: true },
      ),
    ).objects || [];
    const resetCatalogNames = new Set(
      resetCatalog.map((item) => item.fully_qualified_name).filter(Boolean),
    );
    if (!selectedObjectNames.every((name) => resetCatalogNames.has(name))) {
      throw new Error('Catalog reset did not rediscover every selected E2E object');
    }

    const resetSelections = content(
      await client.callTool(
        'pipelines_schema_list',
        {
          ...base,
          identifier: pipeline.id,
          all: true,
          with_fields: false,
          limit: 25,
          offset: 0,
        },
        { quiet: true },
      ),
    ).objects || [];
    const selectedAfterReset = new Set(
      resetSelections
        .filter((item) => item.selected === true)
        .map((item) => item.fully_qualified_name),
    );
    if (!selectedObjectNames.every((name) => selectedAfterReset.has(name))) {
      throw new Error('Catalog reset did not preserve every selected pipeline object');
    }
    console.log('PASS catalog_reset_preserved_pipeline_selections');

    await client.callTool('pipelines_disable', { ...base, identifier: pipeline.id });
    await client.callTool('pipelines_enable', { ...base, identifier: pipeline.id });

    const smokeJobId = content(
      await client.callTool('pipelines_sync', {
        ...base,
        identifier: pipeline.id,
        full_resync: false,
        reset_target: false,
      }),
    ).job_id;
    activeJobs.add(smokeJobId);
    await pollJob(client, workspaceId, smokeJobId, { timeoutMs: jobTimeoutMs });
    activeJobs.delete(smokeJobId);
    await client.callTool('jobs_get', { ...base, id: smokeJobId });
    await client.callTool('jobs_logs', { ...base, id: smokeJobId });

    await client.callTool('pipelines_edit', {
      ...base,
      identifier: pipeline.id,
      name: `MCP E2E Smoke Pipeline Edited ${suffix}`,
      description: 'Temporary hosted MCP live smoke pipeline (edited after first run)',
      config_patch: { trigger_auto_re_sync_on_new_column: false },
    });

    let cancelJobId = null;
    for (let attempt = 0; attempt < 3 && !cancelJobId; attempt += 1) {
      const candidate = content(
        await client.callTool(
          'pipelines_sync',
          {
            ...base,
            identifier: pipeline.id,
            full_resync: false,
            reset_target: false,
          },
          { quiet: true },
        ),
      ).job_id;
      activeJobs.add(candidate);
      const cancelled = await client.callTool(
        'jobs_cancel',
        { ...base, id: candidate },
        { allowError: true, quiet: true },
      );
      if (!cancelled?.isError) {
        cancelJobId = candidate;
        console.log('PASS jobs_cancel');
      } else {
        activeJobs.delete(candidate);
      }
    }
    if (!cancelJobId) throw new Error('Could not obtain a cancellable live job');
    await pollJob(client, workspaceId, cancelJobId, {
      requireSuccess: false,
      timeoutMs: jobTimeoutMs,
    });
    activeJobs.delete(cancelJobId);

    const schedule = content(
      await client.callTool('schedules_create', {
        ...base,
        name: `MCP E2E Schedule ${suffix}`,
        cron: '0 0 1 1 *',
        pipeline: pipeline.id,
        timezone: 'UTC',
        description: 'Temporary hosted MCP schedule test',
      }),
    ).schedule;
    cleanup.scheduleId = schedule.id;
    createdFixtures.scheduleIds.add(schedule.id);
    await client.callTool('schedules_edit', {
      ...base,
      identifier: schedule.id,
      cron: '5 0 1 1 *',
      description: 'Temporary hosted MCP schedule test (edited)',
    });
    await client.callTool('schedules_disable', { ...base, identifier: schedule.id });
    await client.callTool('schedules_enable', { ...base, identifier: schedule.id });
    const jobsBeforeScheduleRun = content(
      await client.callTool(
        'jobs_list',
        { ...base, pipeline_id: pipeline.id, limit: 25, offset: 0 },
        { quiet: true },
      ),
    ).jobs || [];
    const knownJobIds = new Set(jobsBeforeScheduleRun.map((job) => job.id));
    await client.callTool('schedules_run', { ...base, identifier: schedule.id });
    let scheduleJob = null;
    for (let attempt = 0; attempt < 10 && !scheduleJob; attempt += 1) {
      await sleep(500);
      const jobs = content(
        await client.callTool(
          'jobs_list',
          { ...base, pipeline_id: pipeline.id, limit: 25, offset: 0 },
          { quiet: true },
        ),
      ).jobs || [];
      scheduleJob = jobs.find((job) => !knownJobIds.has(job.id)) || null;
    }
    if (!scheduleJob) throw new Error('Schedule run did not create a pipeline job');
    activeJobs.add(scheduleJob.id);
    await pollJob(client, workspaceId, scheduleJob.id, {
      requireSuccess: false,
      timeoutMs: jobTimeoutMs,
    });
    activeJobs.delete(scheduleJob.id);
    await client.callTool('schedules_history', {
      ...base,
      identifier: schedule.id,
      limit: 10,
    });
    await client.callTool('schedules_delete', { ...base, identifier: schedule.id });
    cleanup.scheduleId = null;

    await client.callTool('pipelines_delete', { ...base, identifier: pipeline.id });
    cleanup.pipelines = cleanup.pipelines.filter((id) => id !== pipeline.id);
    await client.callTool('pipelines_delete', {
      ...base,
      identifier: plannedPipeline.id,
    });
    cleanup.pipelines = cleanup.pipelines.filter((id) => id !== plannedPipeline.id);
    await client.callTool('projects_delete', { ...base, identifier: project.id });
    cleanup.projectId = null;
    const finalRefreshJobId = content(
      await client.callTool('datasources_refresh', {
        ...base,
        identifier: createdDatasource.id,
      }),
    ).job_id;
    if (!finalRefreshJobId) throw new Error('Final datasource refresh did not enqueue a job');
    activeJobs.add(finalRefreshJobId);
    await pollJob(client, workspaceId, finalRefreshJobId, {
      timeoutMs: jobTimeoutMs,
    });
    activeJobs.delete(finalRefreshJobId);
    await client.callTool('datasources_catalog', {
      ...base,
      identifier: createdDatasource.id,
      refresh: false,
      with_fields: false,
      limit: 25,
      offset: 0,
    });
    await client.callTool('datasources_delete', {
      ...base,
      identifier: createdDatasource.id,
    });
    cleanup.datasourceId = null;

    const missing = contract.tools.filter((name) => !client.invoked.has(name));
    if (missing.length > 0) {
      throw new Error(`Live parity suite did not invoke: ${missing.join(', ')}`);
    }
    console.log(`PASS hosted_mcp_live_parity tools=${contract.tools.length}`);
  } finally {
    if (cleanup.workspaceId) {
      const base = { workspace_id: cleanup.workspaceId };
      const cleanupFailures = [];
      const cleanupTool = async (name, args, { required = true } = {}) => {
        try {
          const result = await client.callTool(name, args, {
            quiet: true,
            allowError: true,
          });
          if (result?.isError) {
            const message = result.content?.find((item) => item.type === 'text')?.text;
            throw new Error(message || 'tool returned isError=true');
          }
        } catch (error) {
          console.error(`WARN cleanup failed for ${name}`);
          if (required) {
            cleanupFailures.push(
              `${name}: ${error instanceof Error ? error.message : 'unknown error'}`,
            );
          }
        }
      };
      for (const jobId of activeJobs) {
        await cleanupTool('jobs_cancel', { ...base, id: jobId }, { required: false });
      }
      for (const jobId of activeCatalogResetJobs) {
        try {
          await pollCatalogReset(client, cleanup.workspaceId, jobId, {
            timeoutMs: jobTimeoutMs,
          });
        } catch {
          console.error('WARN cleanup could not verify catalog-reset restoration');
          cleanupFailures.push('catalog reset restoration could not be verified');
        }
      }
      if (cleanup.scheduleId) {
        await cleanupTool('schedules_delete', {
          ...base,
          identifier: cleanup.scheduleId,
        });
      }
      for (const pipelineId of [...cleanup.pipelines].reverse()) {
        await cleanupTool('pipelines_delete', { ...base, identifier: pipelineId });
      }
      if (cleanup.projectId) {
        await cleanupTool('projects_delete', {
          ...base,
          identifier: cleanup.projectId,
        });
      }
      if (cleanup.datasourceId) {
        await cleanupTool('datasources_delete', {
          ...base,
          identifier: cleanup.datasourceId,
        });
      }

      const listAll = async (toolName, field) => {
        const items = [];
        let offset = 0;
        for (;;) {
          const result = await client.callTool(
            toolName,
            { ...base, limit: 200, offset },
            { quiet: true },
          );
          const payload = content(result);
          const page = Array.isArray(payload[field]) ? payload[field] : [];
          items.push(...page);
          const total = Number(payload.total);
          offset += page.length;
          if (page.length < 200 || (Number.isFinite(total) && offset >= total)) {
            return items;
          }
        }
      };
      try {
        const [datasources, projects, pipelines, schedules] = await Promise.all([
          listAll('datasources_list', 'datasources'),
          listAll('projects_list', 'projects'),
          listAll('pipelines_list', 'pipelines'),
          listAll('schedules_list', 'schedules'),
        ]);
        const remaining = [
          ...datasources
            .filter((item) => createdFixtures.datasourceIds.has(item.id))
            .map((item) => `datasource:${item.id}`),
          ...projects
            .filter((item) => createdFixtures.projectIds.has(item.id))
            .map((item) => `project:${item.id}`),
          ...pipelines
            .filter(
              (item) =>
                createdFixtures.pipelineIds.has(item.id) && item.state !== 'deleted',
            )
            .map((item) => `pipeline:${item.id}`),
          ...schedules
            .filter((item) => createdFixtures.scheduleIds.has(item.id))
            .map((item) => `schedule:${item.id}`),
        ];
        if (remaining.length > 0) {
          cleanupFailures.push(`fixtures remain active: ${remaining.join(', ')}`);
        }
      } catch (error) {
        cleanupFailures.push(
          `fixture absence verification failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }

      if (cleanupFailures.length > 0) {
        throw new Error(`Live fixture cleanup failed: ${cleanupFailures.join('; ')}`);
      }
      console.log('PASS live_fixture_cleanup');
    }
  }
}

async function main() {
  const clientId = requiredEnvironment('SUPAFLOW_OAUTH_CLIENT_ID');
  const redirectUri = requiredEnvironment('SUPAFLOW_OAUTH_REDIRECT_URI');
  const listJobsOnly = process.env.SUPAFLOW_LIST_JOBS_ONLY === 'true';
  const listInventoryOnly = process.env.SUPAFLOW_LIST_INVENTORY_ONLY === 'true';
  const mcpUrl = process.env.SUPAFLOW_MCP_URL?.trim() || DEFAULT_MCP_URL;
  const timeoutMs = Number(process.env.SUPAFLOW_OAUTH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const jobTimeoutMs = Number(
    process.env.SUPAFLOW_JOB_TIMEOUT_MS || DEFAULT_JOB_TIMEOUT_MS,
  );
  const oauthSession = await authorize({ clientId, redirectUri, mcpUrl, timeoutMs });
  await oauthSession.refresh();
  const client = createMcpClient(mcpUrl, oauthSession);

  const contractUrl = new URL('../contracts/hosted-tools.json', import.meta.url);
  const contract = JSON.parse(await readFile(fileURLToPath(contractUrl), 'utf8'));
  const toolList = await client.rpc('tools/list', {});
  const actualNames = toolList.tools?.map((tool) => tool.name) || [];
  if (JSON.stringify(actualNames) !== JSON.stringify(contract.tools)) {
    throw new Error('tools/list does not match contracts/hosted-tools.json');
  }
  if (actualNames.some((name) => name.startsWith('agent_'))) {
    throw new Error('Hosted MCP advertised a forbidden local-agent tool');
  }
  for (const tool of toolList.tools || []) {
    const expectedAccessScope =
      tool.annotations?.readOnlyHint === true ? 'supaflow:read' : 'supaflow:write';
    for (const schemes of [tool.securitySchemes, tool._meta?.securitySchemes]) {
      const oauth = schemes?.find((scheme) => scheme.type === 'oauth2');
      if (
        !oauth ||
        !oauth.scopes?.includes('user:org:read') ||
        !oauth.scopes?.includes(expectedAccessScope)
      ) {
        throw new Error(
          `${tool.name} is missing its ${expectedAccessScope} OAuth security scheme`,
        );
      }
    }
  }
  console.log(`PASS tools/list count=${actualNames.length}`);
  if (listJobsOnly) {
    await listJobsThroughMcp(client);
    return;
  }
  if (listInventoryOnly) {
    await runInventoryPagination(client);
    return;
  }

  const sourceDatasourceId = requiredEnvironment('SUPAFLOW_E2E_SOURCE_DATASOURCE_ID');
  const destinationProjectId = requiredEnvironment(
    'SUPAFLOW_E2E_DESTINATION_PROJECT_ID',
  );
  const requestedObjectNames = requiredEnvironment('SUPAFLOW_E2E_OBJECTS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (requestedObjectNames.length < 2 || requestedObjectNames.length > 5) {
    throw new Error('SUPAFLOW_E2E_OBJECTS must contain between two and five objects');
  }
  if (
    process.env.SUPAFLOW_E2E_DESTINATION_WRITES_ACK !==
    'I_ACCEPT_TEST_DESTINATION_WRITES'
  ) {
    throw new Error(
      'Set SUPAFLOW_E2E_DESTINATION_WRITES_ACK=I_ACCEPT_TEST_DESTINATION_WRITES after approving possible residual writes in the fixture destination',
    );
  }
  await runLiveParity(
    client,
    contract,
    jobTimeoutMs,
    sourceDatasourceId,
    destinationProjectId,
    requestedObjectNames,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`FAIL ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exitCode = 1;
  });
}
