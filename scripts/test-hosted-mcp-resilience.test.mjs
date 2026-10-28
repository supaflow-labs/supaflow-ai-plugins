import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCanonicalProtectedResourceMetadata,
  assertResourceBoundAccessToken,
  createMcpClient,
  listInventoryById,
  McpRetryableError,
  McpTransportError,
  pollCatalogReset,
  pollJob,
} from './test-hosted-mcp-oauth.mjs';

test('direct Clerk grants need no legacy token-use claim but retain resource and client checks', () => {
  const expected = {
    clientId: 'public-test-client',
    issuer: 'https://clerk.example.test',
    resource: 'https://app.example.test/mcp',
  };
  const claims = {
    iss: expected.issuer, aud: expected.resource, client_id: expected.clientId,
    exp: Math.floor(Date.now() / 1000) + 300,
    scope: 'user:org:read supaflow:read supaflow:write',
  };
  const token = (patch = {}) => `header.${Buffer.from(JSON.stringify({ ...claims, ...patch })).toString('base64url')}.signature`;
  assert.doesNotThrow(() => assertResourceBoundAccessToken(token(), expected));
  for (const patch of [
    { client_id: 'another-client' }, { client_id: undefined },
    { iss: 'https://other.example.test' }, { aud: 'https://app.example.test' },
    { scope: 'user:org:read supaflow:read' }, { exp: 1 },
  ]) {
    assert.throws(() => assertResourceBoundAccessToken(token(patch), expected));
  }
});

test('immutable inventory pagination continues through the terminal empty page', async () => {
  const requests = [];
  const responses = [
    [
      { id: '00000000-0000-0000-0000-000000000001' },
      { id: '00000000-0000-0000-0000-000000000002' },
    ],
    [{ id: '00000000-0000-0000-0000-000000000003' }],
    [],
  ];
  const client = {
    async callTool(toolName, args) {
      requests.push({ toolName, args });
      return { structuredContent: { datasources: responses.shift() } };
    },
  };

  const result = await listInventoryById(
    client,
    'workspace-test',
    'datasources_list',
    'datasources',
    { limit: 2 },
  );

  assert.deepEqual(
    result.items.map((item) => item.id),
    [
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
    ],
  );
  assert.equal(result.pages, 3);
  assert.deepEqual(
    requests.map(({ args }) => args.after_id),
    [
      undefined,
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
    ],
  );
});

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

test('warning and timeout states stop polling with their original outcome', async () => {
  for (const status of ['completed_with_warning', 'timed_out']) {
    let calls = 0;
    const client = {
      async callTool() {
        calls += 1;
        return { structuredContent: { job: { status } } };
      },
    };
    assert.equal(await pollJob(client, 'workspace-test', 'job-test', {
      requireSuccess: false, timeoutMs: 1_000, intervalMs: 0,
    }), status);
    assert.equal(calls, 1);
  }
});

test('success-required monitoring accepts warnings but rejects timeouts', async () => {
  const client = (status) => ({
    async callTool() {
      return { structuredContent: { job: { status } } };
    },
  });
  assert.equal(await pollJob(client('completed_with_warning'), 'workspace-test', 'job-test', {
    timeoutMs: 1_000, intervalMs: 0,
  }), 'completed_with_warning');
  await assert.rejects(pollJob(client('timed_out'), 'workspace-test', 'job-test', {
    timeoutMs: 1_000, intervalMs: 0,
  }), /Job reached terminal status timed_out/);
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

test('cleanup accepts a restored catalog without treating the reset as successful', async () => {
  for (const state of ['restored', 'unchanged']) {
    const client = { async callTool() {
      return { structuredContent: { catalog_reset: {
        catalog_state: state, maintenance_active: false,
      } } };
    } };
    await assert.rejects(pollCatalogReset(client, 'workspace-test', 'job-test', {
      timeoutMs: 1_000, intervalMs: 0,
    }), /unexpected state/);
    await pollCatalogReset(client, 'workspace-test', 'job-test', {
      requireSuccess: false, timeoutMs: 1_000, intervalMs: 0,
    });
  }
  await assert.rejects(pollCatalogReset({ async callTool() {
    return { structuredContent: { catalog_reset: {
      catalog_state: 'unknown', maintenance_active: false,
    } } };
  } }, 'workspace-test', 'job-test', {
    requireSuccess: false, timeoutMs: 1_000, intervalMs: 0,
  }), /unexpected state/);
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
