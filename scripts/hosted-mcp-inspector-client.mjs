import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { McpRetryableError } from './test-hosted-mcp-oauth.mjs';

const executeFile = promisify(execFile);

// Inspector owns OAuth and its secret store. Never accept bearer tokens or
// client secrets as arguments, print subprocess output, or persist tool payloads.
export function createInspectorClient(mcpUrl, {
  binary = process.env.SUPAFLOW_INSPECTOR_BIN || 'mcp-inspector',
  clientId = process.env.SUPAFLOW_OAUTH_CLIENT_ID,
  timeoutMs = Number(process.env.SUPAFLOW_RPC_TIMEOUT_MS || 90_000),
  execute = executeFile,
} = {}) {
  if (!clientId) throw new Error('SUPAFLOW_OAUTH_CLIENT_ID is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid Inspector timeout');
  const invoked = new Set();
  const calls = [];
  let schemaWarnings = [];

  async function rpc(method, params = {}) {
    if (!['tools/list', 'tools/call'].includes(method)) throw new Error('Unsupported Inspector method');
    const args = ['--cli', '--server-url', mcpUrl, '--transport', 'http',
      '--client-id', clientId, '--stored-auth-only', '--method', method, '--format', 'json', '--quiet'];
    if (method === 'tools/list') args.push('--strict');
    if (method === 'tools/call') args.push('--tool-name', params.name, '--tool-args-json', JSON.stringify(params.arguments));
    let output;
    let failed = false;
    try {
      output = await execute(binary, args, {
        env: { ...process.env, MCP_AUTO_OPEN_ENABLED: 'false' },
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (error) {
      failed = true;
      output = error;
    }
    let envelope;
    try {
      // Inspector JSON output wraps results; accept direct payloads too.
      // CLI failures can put their JSON error envelope on stderr instead.
      envelope = JSON.parse(output.stdout?.trim() || output.stderr?.trim());
    } catch {
      throw new Error(`Inspector ${method} failed without a JSON response; check Inspector authentication and connectivity`);
    }
    if (envelope.error) throw new Error(`Inspector ${method} returned an error; check Inspector authentication and connectivity`);
    if (method === 'tools/list') {
      // Retain only schema locations/rules, never arbitrary payloads or messages.
      schemaWarnings = (envelope.schemaFindings || []).flatMap(({ toolName, findings }) =>
        findings.map(({ rule, severity, schema, path }) => ({ tool: toolName, rule, severity, schema, path })));
    }
    const result = envelope.result ?? envelope;
    // Inspector exits 5 for a typed tool error while still returning its result.
    // Preserve that result for allowError and the shared polling retry handling.
    if (failed && !(output.code === 5 && method === 'tools/call' && result?.isError === true)) {
      throw new Error(`Inspector ${method} exited unsuccessfully`);
    }
    if (method === 'tools/list' && !Array.isArray(result.tools)) throw new Error('Inspector returned no tool catalog');
    if (method === 'tools/call' && (!result || (!Array.isArray(result.content) && !result.structuredContent))) {
      throw new Error('Inspector returned no tool result');
    }
    return result;
  }

  async function callTool(name, args, { quiet = false, allowError = false } = {}) {
    const started = Date.now();
    let status = 'failed';
    try {
      const result = await rpc('tools/call', { name, arguments: args });
      if (result.isError) {
        if (!quiet) console.log(`FAIL ${name}`);
        if (allowError) return result;
        if (result.structuredContent?.error?.retryable === true) {
          throw new McpRetryableError(`${name} returned a retryable tool error`, Number(result.structuredContent.error.retry_after_ms) || 0);
        }
        throw new Error(`${name} returned a tool error`);
      }
      invoked.add(name);
      status = 'passed';
      if (!quiet) console.log(`PASS ${name}`);
      return result;
    } finally {
      calls.push({ tool: name, status, duration_ms: Date.now() - started });
    }
  }

  async function writeReport(path, expectedTools, completed) {
    const passed = [...invoked].sort();
    const missing = expectedTools.filter(name => !invoked.has(name));
    const report = {
      client: 'MCP Inspector', generated_at: new Date().toISOString(),
      status: completed && missing.length === 0 ? 'passed' : 'incomplete',
      lifecycle_completed: completed, expected_tool_count: expectedTools.length,
      passed_tools: passed, missing_tools: missing, calls, schema_warnings: schemaWarnings,
      destination_cleanup: 'Control-plane cleanup does not delete destination tables or rows.',
    };
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    return report;
  }
  return { rpc, callTool, invoked, writeReport };
}
