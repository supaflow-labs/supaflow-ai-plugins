import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCanonicalProtectedResourceMetadata,
  createMcpClient,
  McpRetryableError,
  McpTransportError,
  pollCatalogReset,
  pollJob,
} from './test-hosted-mcp-oauth.mjs';

test('OAuth metadata must bind tokens to the exact configured MCP endpoint', () => {
  assert.equal(
    assertCanonicalProtectedResourceMetadata(
      { resource: 'https://app.example.test/mcp' },
      'https://app.example.test/mcp',
    ),
    'https://app.example.test/mcp',
  );
  assert.throws(
    () =>
      assertCanonicalProtectedResourceMetadata(
        { resource: 'https://app.example.test' },
        'https://app.example.test/mcp',
      ),
    /exact MCP endpoint/,
  );
});

test('job polling tolerates bounded transport and typed transient failures', async () => {
  let calls = 0;
  const client = {
    async callTool() {
      calls += 1;
      if (calls === 1) throw new McpTransportError('socket reset');
      if (calls === 2) throw new McpRetryableError('temporary upstream failure', 0);
      return {
        structuredContent: { job: { status: 'completed' } },
      };
    },
  };

  const status = await pollJob(client, 'workspace-test', 'job-test', {
    timeoutMs: 1_000,
    intervalMs: 0,
  });

  assert.equal(status, 'completed');
  assert.equal(calls, 3);
});

test('job polling stops immediately on a permanent tool failure', async () => {
  let calls = 0;
  const permanent = new Error('forbidden');
  const client = {
    async callTool() {
      calls += 1;
      throw permanent;
    },
  };

  await assert.rejects(
    pollJob(client, 'workspace-test', 'job-test', {
      timeoutMs: 1_000,
      intervalMs: 0,
    }),
    (error) => error === permanent,
  );
  assert.equal(calls, 1);
});

test('catalog-reset polling handles a transient response and waits for restoration', async () => {
  let calls = 0;
  const client = {
    async callTool() {
      calls += 1;
      if (calls === 1) throw new McpRetryableError('busy', 0);
      if (calls === 2) {
        return {
          structuredContent: {
            catalog_reset: {
              catalog_state: 'restoration_pending',
              maintenance_active: true,
            },
          },
        };
      }
      return {
        structuredContent: {
          catalog_reset: {
            catalog_state: 'completed',
            maintenance_active: false,
          },
        },
      };
    },
  };

  await pollCatalogReset(client, 'workspace-test', 'job-test', {
    timeoutMs: 1_000,
    intervalMs: 0,
  });
  assert.equal(calls, 3);
});

test('MCP client classifies retryable HTTP and tool responses', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const oauthSession = {
    accessToken: () => 'test-token',
    canRefresh: () => false,
    refresh: async () => {},
  };

  globalThis.fetch = async () =>
    new Response('', { status: 503, headers: { 'retry-after': '0.01' } });
  const httpClient = createMcpClient('https://app.example.test/mcp', oauthSession);
  await assert.rejects(
    httpClient.rpc('tools/list', {}),
    (error) => error instanceof McpRetryableError && error.retryAfterMs === 10,
  );

  globalThis.fetch = async () =>
    Response.json(
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          isError: true,
          structuredContent: {
            error: { retryable: true, retry_after_ms: 750 },
          },
          content: [{ type: 'text', text: 'Try again later' }],
        },
      },
      { status: 200 },
    );
  const toolClient = createMcpClient('https://app.example.test/mcp', oauthSession);
  await assert.rejects(
    toolClient.callTool('jobs_status', {}),
    (error) => error instanceof McpRetryableError && error.retryAfterMs === 750,
  );
});
