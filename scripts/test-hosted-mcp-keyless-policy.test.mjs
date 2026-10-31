import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKeylessDefault,
  assertKeylessPolicy,
  editPolicyWithoutSync,
  expectKeylessPolicyRejection,
  runLiveParity,
} from './test-hosted-mcp-oauth.mjs';

test('default and creation assertions fail on missing or ignored policy', () => {
  assertKeylessDefault({ structuredContent: { config: { keyless_object_handling: 'UUID' } } }, 'prepare');
  assertKeylessPolicy({ keyless_object_handling: 'ROW_HASH' }, 'ROW_HASH', 'create');
  for (const value of [undefined, null, 'ROW_HASH']) {
    assert.throws(() => assertKeylessDefault({ structuredContent: { config: { keyless_object_handling: value } } }, 'prepare'));
  }
  assert.throws(() => assertKeylessPolicy({ keyless_object_handling: 'UUID' }, 'ROW_HASH', 'create'));
});

test('negative probe tracks an unexpectedly created pipeline before failing', async () => {
  const tracked = [];
  const client = { callTool: async () => ({ structuredContent: { pipeline: { id: 'unexpected' } } }) };
  await assert.rejects(expectKeylessPolicyRejection(client, 'pipelines_create', {}, id => tracked.push(id)), /did not reject/);
  assert.deepEqual(tracked, ['unexpected']);
});

test('negative probe cannot pass on authentication, retryable or transport failure', async () => {
  for (const result of [
    { isError: true, _meta: { 'mcp/www_authenticate': ['challenge'] } },
    { isError: true, structuredContent: { error: { retryable: true } } },
    { isError: true, content: [{ type: 'text', text: 'Pipeline plan has expired' }] },
    { isError: true },
  ]) {
    await assert.rejects(expectKeylessPolicyRejection({ callTool: async () => result }, 'pipelines_edit', {}, () => {}));
  }
  const transport = new Error('transport failed');
  await assert.rejects(expectKeylessPolicyRejection({ callTool: async () => { throw transport; } }, 'pipelines_edit', {}, () => {}), error => error === transport);
  await expectKeylessPolicyRejection({ callTool: async () => ({ isError: true,
    content: [{ type: 'text', text: 'Supaflow could not complete pipelines_edit' }],
  }) }, 'pipelines_edit', {}, () => {});
});

test('policy edit rejects an automatically enqueued job', async () => {
  let reads = 0;
  const client = { callTool: async name => name === 'jobs_list'
    ? { structuredContent: { jobs: ++reads === 1 ? [] : [{ id: 'unexpected-job' }] } }
    : { structuredContent: { pipeline: { updated: ['configs'] } } } };
  await assert.rejects(editPolicyWithoutSync(client, { workspace_id: 'workspace' }, 'pipeline', { keyless_object_handling: 'UUID' }), /unexpectedly enqueued/);
});

// Run the actual shared lifecycle with a stateful fake control plane. This checks
// integration/order/cleanup; it is not evidence of a real database reset or load.
test('shared lifecycle exercises both policies and cleans up even if validation regresses', async () => {
  const originalEnv = { ...process.env };
  process.env.SUPAFLOW_LIVE_MUTATIONS = 'true';
  process.env.SUPAFLOW_E2E_DESTINATION_WRITES_ACK = 'I_ACCEPT_TEST_DESTINATION_WRITES';
  process.env.SUPAFLOW_E2E_WORKSPACE_ID = 'workspace';
  try {
    for (const acceptInvalid of [false, true]) {
      const calls = [];
      const pipelines = new Map();
      const jobs = [];
      let nextId = 0;
      let datasource = false;
      let project = false;
      let schedule = false;
      const objects = ['public.orders', 'public.events'].map(fully_qualified_name => ({ fully_qualified_name, selected: true }));
      const client = {
        invoked: new Set(),
        async callTool(name, args) {
          calls.push({ name, args });
          this.invoked.add(name);
          const result = value => ({ structuredContent: value });
          if (['pipelines_create', 'pipelines_create_from_plan', 'pipelines_edit'].includes(name)) {
            const patch = args.config ?? args.config_patch ?? {};
            const policy = patch.keyless_object_handling;
            const invalid = policy !== undefined && policy !== null && !['UUID', 'ROW_HASH'].includes(policy);
            if (invalid && !acceptInvalid) return { isError: true,
              content: [{ type: 'text', text: `Supaflow could not complete ${name}` }],
            };
            if (name === 'pipelines_edit') {
              const previous = pipelines.get(args.identifier);
              pipelines.set(args.identifier, { ...previous, ...patch,
                keyless_object_handling: policy === undefined ? previous.keyless_object_handling : policy ?? 'UUID' });
              return result({ pipeline: { id: args.identifier, updated: ['configs'] } });
            }
            const id = `pipeline-${++nextId}`;
            const config = { ...patch, keyless_object_handling: policy ?? 'UUID' };
            pipelines.set(id, config);
            return result({ pipeline: { id, config } });
          }
          switch (name) {
            case 'auth_status': return result({ authenticated: true });
            case 'workspaces_list': return result({ workspaces: [{ id: 'workspace' }] });
            case 'projects_list': return result({ projects: project ? [{ id: 'created-project' }, { id: 'destination', destinationDatasourceId: 'snowflake', destinationConnectorName: 'Snowflake' }] : [{ id: 'destination', destinationDatasourceId: 'snowflake', destinationConnectorName: 'Snowflake' }] });
            case 'datasources_get': return result({ datasource: { id: args.identifier, connectorType: 'MYSQL' } });
            case 'datasources_create': datasource = true; return result({ datasource: { id: 'created-source' } });
            case 'projects_create': project = true; return result({ project: { id: 'created-project' } });
            case 'datasources_test': case 'datasources_refresh': case 'datasources_reset_catalog': return result({ job_id: `source-job-${++nextId}` });
            case 'jobs_status': return result({ job: { status: 'completed' } });
            case 'datasources_catalog_reset_status': return result({ catalog_reset: { catalog_state: 'completed', maintenance_active: false } });
            case 'datasources_catalog': case 'pipelines_schema_list': return result({ objects });
            case 'pipelines_init': case 'pipelines_prepare_create': return result({ plan_id: 'plan', config: { keyless_object_handling: 'UUID' } });
            case 'jobs_list': return result({ jobs: jobs.filter(job => !args.pipeline_id || job.pipelineId === args.pipeline_id) });
            case 'pipelines_sync': {
              const job = { id: `job-${++nextId}`, pipelineId: args.identifier, policy: pipelines.get(args.identifier).keyless_object_handling };
              jobs.push(job);
              return result({ job_id: job.id });
            }
            case 'schedules_create': schedule = true; return result({ schedule: { id: 'created-schedule' } });
            case 'schedules_run': jobs.push({ id: `schedule-job-${++nextId}`, pipelineId: [...pipelines.keys()].at(-1) }); break;
            case 'schedules_delete': schedule = false; break;
            case 'pipelines_delete': pipelines.delete(args.identifier); break;
            case 'projects_delete': project = false; break;
            case 'datasources_delete': datasource = false; break;
            case 'pipelines_list': return result({ pipelines: [...pipelines.keys()].map(id => ({ id })) });
            case 'datasources_list': return result({ datasources: datasource ? [{ id: 'created-source' }] : [] });
            case 'schedules_list': return result({ schedules: schedule ? [{ id: 'created-schedule' }] : [] });
          }
          return result({});
        },
      };
      const run = runLiveParity(client, { tools: [] }, 1_000, 'source', 'destination', objects.map(object => object.fully_qualified_name));
      if (acceptInvalid) {
        await assert.rejects(run, /did not reject/);
      } else {
        await run;
        assert.deepEqual(jobs.slice(0, 2).map(job => job.policy), ['ROW_HASH', 'UUID']);
        const creates = calls.filter(call => ['pipelines_create', 'pipelines_create_from_plan'].includes(call.name));
        assert.ok(creates.some(call => call.name === 'pipelines_create_from_plan' && call.args.config_patch.keyless_object_handling === 'ROW_HASH'));
        assert.ok(creates.some(call => call.name === 'pipelines_create' && call.args.config.keyless_object_handling === undefined));
        assert.ok(calls.some(call => call.name === 'pipelines_edit' && call.args.config_patch?.keyless_object_handling === null));
      }
      assert.equal(pipelines.size, 0);
      assert.equal(datasource, false);
      assert.equal(project, false);
      assert.equal(schedule, false);
    }
  } finally {
    process.env = originalEnv;
  }
});
