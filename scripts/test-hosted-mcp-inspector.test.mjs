import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createInspectorClient } from './hosted-mcp-inspector-client.mjs';
import { McpRetryableError, runLiveParity } from './test-hosted-mcp-oauth.mjs';

const result = { content: [{ type: 'text', text: 'private response' }], structuredContent: { private: 'private response' } };
const options = { clientId: 'public-test-client', binary: '/test/inspector' };

test('uses Inspector argv without a shell and requires preauthenticated OAuth', async () => {
  const client = createInspectorClient('https://app.test/mcp', { ...options,
    execute: async (binary, args, config) => {
      assert.equal(binary, options.binary);
      assert.ok(args.includes('--stored-auth-only'));
      assert.ok(!args.includes('--client-secret'));
      assert.equal(config.env.MCP_AUTO_OPEN_ENABLED, 'false');
      assert.equal(args[args.indexOf('--tool-args-json') + 1], JSON.stringify({name:'literal $(command)'}));
      return { stdout: JSON.stringify({ result }) };
    },
  });
  assert.deepEqual(await client.callTool('datasources_create', {name:'literal $(command)'}, {quiet:true}), result);
  assert.deepEqual([...client.invoked], ['datasources_create']);
});

test('tool errors, including allowed errors, never count as successful coverage', async () => {
  const client = createInspectorClient('https://app.test/mcp', { ...options,
    execute: async () => { throw {code:5,stdout:JSON.stringify({result:{...result,isError:true}})}; },
  });
  assert.equal((await client.callTool('jobs_cancel', {}, {allowError:true,quiet:true})).isError, true);
  await assert.rejects(client.callTool('jobs_cancel', {}, {quiet:true}), /tool error/);
  assert.equal(client.invoked.size, 0);
});

test('preserves typed transient tool failures for the existing polling retry logic', async () => {
  const client = createInspectorClient('https://app.test/mcp', { ...options,
    execute: async () => { throw {code:5,stdout:JSON.stringify({result:{...result,isError:true,structuredContent:{error:{retryable:true,retry_after_ms:12}}}})}; },
  });
  await assert.rejects(client.callTool('jobs_status', {}, {quiet:true}), e => e instanceof McpRetryableError && e.retryAfterMs === 12);
});

test('does not replay ambiguous writes or expose subprocess errors', async () => {
  let calls = 0;
  const client = createInspectorClient('https://app.test/mcp', { ...options,
    execute: async () => { calls++; throw Object.assign(new Error('credential-like private text'), {stderr:'credential-like private text'}); },
  });
  await assert.rejects(client.callTool('pipelines_create', {}, {quiet:true}), e => !e.message.includes('private text'));
  assert.equal(calls, 1);
  assert.equal(client.invoked.size, 0);
});

test('rejects CLI errors, nonzero exits and malformed success results', async () => {
  for (const execute of [
    async () => ({stdout:JSON.stringify({error:{message:'private text'}})}),
    async () => { throw {stderr:JSON.stringify({error:{message:'private text'}})}; },
    async () => { throw {stdout:JSON.stringify({result})}; },
    async () => ({stdout:'{}'}),
  ]) {
    const client = createInspectorClient('https://app.test/mcp', {...options,execute});
    await assert.rejects(client.callTool('auth_status',{}, {quiet:true}));
    assert.equal(client.invoked.size,0);
  }
});

test('reports missing tools and lifecycle failure without persisting raw data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'inspector-report-test-'));
  try {
    const client = createInspectorClient('https://app.test/mcp', {...options,
      execute:async (_binary,args) => ({stdout:JSON.stringify(args.includes('tools/list') ? {
        tools:[{name:'auth_status'}], schemaFindings:[{toolName:'auth_status',findings:[{rule:'untyped-schema',severity:'warning',schema:'inputSchema',path:'properties.config',issue:'private text'}]}],
      } : {result})}),
    });
    assert.equal((await client.rpc('tools/list')).tools.length,1);
    await client.callTool('auth_status',{}, {quiet:true});
    const path=join(dir,'report.json');
    let report=await client.writeReport(path,['auth_status','docs'],true);
    assert.equal(report.status,'incomplete');
    assert.deepEqual(report.missing_tools,['docs']);
    report=await client.writeReport(path,['auth_status'],false);
    assert.equal(report.status,'incomplete'); // includes cleanup failures
    report=await client.writeReport(path,['auth_status'],true);
    assert.equal(report.status,'passed');
    assert.equal(report.schema_warnings.length,1);
    const saved=await readFile(path,'utf8');
    assert.ok(!saved.includes('private'));
    assert.ok(!saved.includes('public-test-client'));
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('live lifecycle refuses writes without both opt-ins and validates fixture selection before calls', async () => {
  const original={...process.env};
  let called=false;
  const client={callTool:async()=>{called=true;throw Error('must not connect');}};
  try {
    delete process.env.SUPAFLOW_LIVE_MUTATIONS;
    await assert.rejects(runLiveParity(client,{},100,'source','project',['Account','AccountContactRole'],'SALESFORCE'), /SUPAFLOW_LIVE_MUTATIONS/);
    process.env.SUPAFLOW_LIVE_MUTATIONS='true';
    delete process.env.SUPAFLOW_E2E_DESTINATION_WRITES_ACK;
    await assert.rejects(runLiveParity(client,{},100,'source','project',['Account','AccountContactRole'],'SALESFORCE'), /DESTINATION_WRITES_ACK/);
    process.env.SUPAFLOW_E2E_DESTINATION_WRITES_ACK='I_ACCEPT_TEST_DESTINATION_WRITES';
    await assert.rejects(runLiveParity(client,{},100,'source','project',['Account','Account'],'SALESFORCE'), /distinct/);
    await assert.rejects(runLiveParity(client,{},100,'source','project',['Account','Contact'],'UNKNOWN'), /Unsupported/);
    assert.equal(called,false);
  } finally {process.env=original;}
});

test('shared entrypoint selects Inspector and emits incomplete coverage for a read-only run', async () => {
  const dir=await mkdtemp(join(tmpdir(),'inspector-entry-test-'));
  try {
    const contract=JSON.parse(await readFile(new URL('../contracts/hosted-tools.json',import.meta.url),'utf8'));
    const tools=contract.tools.map(name=>({name,annotations:{readOnlyHint:true},securitySchemes:[{type:'oauth2',scopes:['user:org:read','supaflow:read']}],_meta:{securitySchemes:[{type:'oauth2',scopes:['user:org:read','supaflow:read']}]}}));
    const binary=join(dir,'inspector');
    await writeFile(binary,'#!/usr/bin/env node\nif(!process.argv.includes("--stored-auth-only"))process.exit(2);\nconsole.log('+JSON.stringify(JSON.stringify({result:{tools}}))+');\n',{mode:0o700});
    const report=join(dir,'report.json');
    const env={...process.env,SUPAFLOW_MCP_TEST_CLIENT:'inspector',SUPAFLOW_INSPECTOR_BIN:binary,SUPAFLOW_OAUTH_CLIENT_ID:'public-fixture',SUPAFLOW_MCP_URL:'https://app.test/mcp',SUPAFLOW_OAUTH_ONLY:'true',SUPAFLOW_MCP_TEST_REPORT:report};
    delete env.SUPAFLOW_OAUTH_REDIRECT_URI;
    const {stdout}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./test-hosted-mcp-oauth.mjs',import.meta.url))],{env});
    assert.match(stdout,/PASS tools\/list count=47/);
    const saved=JSON.parse(await readFile(report,'utf8'));
    assert.equal(saved.status,'incomplete');
    assert.equal(saved.missing_tools.length,47);
  } finally {await rm(dir,{recursive:true,force:true});}
});
