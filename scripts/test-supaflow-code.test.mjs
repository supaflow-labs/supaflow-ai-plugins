import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSetup } from '../plugins/supaflow-code/scripts/check-setup.mjs'

const root = fileURLToPath(new URL('../plugins/supaflow-code/', import.meta.url))
const json = name => JSON.parse(readFileSync(resolve(root, name), 'utf8'))
const auth = { authenticated: true, workspace_id: 'fixture-workspace' }

function fixture(overrides = {}) {
  const calls = []
  const results = {
    'node --version': { status: 0, stdout: 'v18.0.0\n' },
    'supaflow --version': { status: 0, stdout: '0.5.0\n' },
    'supaflow auth status --json': { status: 0, stdout: JSON.stringify(auth) },
    'docker version --format {{.Server.Version}}': { status: 0, stdout: '28.0.0\n' },
    ...overrides,
  }
  return {
    calls,
    run(command, args) {
      calls.push([command, ...args].join(' '))
      assert.ok(Object.hasOwn(results, calls.at(-1)), 'unexpected command')
      return results[calls.at(-1)]
    },
  }
}

test('ready CLI setup uses read-only checks and does not require Docker', () => {
  const fake = fixture()
  const result = checkSetup({ run: fake.run })
  assert.equal(result.ready, true)
  assert.equal(result.dockerReady, null)
  assert.deepEqual(fake.calls, ['node --version', 'supaflow --version', 'supaflow auth status --json'])
})

test('agent readiness checks the existing daemon but never starts it', () => {
  const fake = fixture()
  assert.equal(checkSetup({ run: fake.run, agent: true }).dockerReady, true)
  assert.deepEqual(fake.calls.at(-1), 'docker version --format {{.Server.Version}}')
  assert.equal(fake.calls.length, 4)
})

test('Node and CLI minimum versions reject missing, old, malformed and prerelease output', () => {
  for (const [key, bad, code] of [
    ['node --version', 'v17.9.9', 'NODE_UNAVAILABLE_OR_UNSUPPORTED'],
    ['node --version', 'unexpected', 'NODE_UNAVAILABLE_OR_UNSUPPORTED'],
    ['supaflow --version', '0.4.99', 'CLI_UNAVAILABLE_OR_UNSUPPORTED'],
    ['supaflow --version', '0.5.0-beta.1', 'CLI_UNAVAILABLE_OR_UNSUPPORTED'],
  ]) {
    const fake = fixture({ [key]: { status: 0, stdout: bad } })
    const result = checkSetup({ run: fake.run })
    assert.equal(result.ready, false)
    assert.ok(result.issues.includes(code))
    assert.ok(!fake.calls.includes('supaflow auth status --json'))
  }
  const fake = fixture({ 'supaflow --version': { status: null, error: new Error('missing') } })
  assert.equal(checkSetup({ run: fake.run }).ready, false)
})

test('newer major/minor CLI versions remain accepted', () => {
  for (const version of ['0.7.0', '1.0.0', '10.2.3']) {
    const fake = fixture({ 'supaflow --version': { status: 0, stdout: version } })
    assert.equal(checkSetup({ run: fake.run }).ready, true)
  }
})

test('unauthenticated setup never logs in or switches workspaces', () => {
  const fake = fixture({ 'supaflow auth status --json': { status: 0, stdout: JSON.stringify({ authenticated: false, workspace_id: null }) } })
  const result = checkSetup({ run: fake.run })
  assert.deepEqual(result.issues, ['AUTHENTICATION_REQUIRED', 'WORKSPACE_SELECTION_REQUIRED'])
  assert.equal(fake.calls.length, 3)
})

test('missing, empty or null-string workspace fails readiness', () => {
  for (const workspace of [null, '', ' ', 'null', undefined]) {
    const fake = fixture({ 'supaflow auth status --json': { status: 0, stdout: JSON.stringify({ authenticated: true, workspace_id: workspace }) } })
    assert.equal(checkSetup({ run: fake.run }).workspaceSelected, false)
  }
})

test('auth errors, malformed JSON and invalid shapes fail closed without exposing output', () => {
  for (const value of ['not-json', 'null', '[]', '{}', '{"authenticated":"true"}', '{"authenticated":true,"error":{"message":"fixture-sensitive-marker"}}']) {
    const fake = fixture({ 'supaflow auth status --json': { status: 0, stdout: value, stderr: 'fixture-sensitive-marker' } })
    const result = checkSetup({ run: fake.run })
    assert.equal(result.ready, false)
    assert.deepEqual(result.issues, ['AUTH_STATUS_UNAVAILABLE'])
    assert.ok(!JSON.stringify(result).includes('fixture-sensitive-marker'))
  }
  const fake = fixture({ 'supaflow auth status --json': { status: 1, stdout: JSON.stringify(auth) } })
  assert.ok(checkSetup({ run: fake.run }).issues.includes('AUTH_STATUS_UNAVAILABLE'))
})

test('successful auth output is reduced to flags, never credentials or identity', () => {
  const fake = fixture({ 'supaflow auth status --json': { status: 0, stdout: JSON.stringify({ ...auth, api_key: 'fixture-sensitive-marker', email: 'fixture-sensitive-marker' }) } })
  const output = JSON.stringify(checkSetup({ run: fake.run }))
  assert.ok(!output.includes('fixture-sensitive-marker'))
  assert.ok(!output.includes('fixture-workspace'))
})

test('Docker failure blocks only an agent readiness request', () => {
  const fake = fixture({ 'docker version --format {{.Server.Version}}': { status: 1, stderr: 'fixture-sensitive-marker' } })
  const result = checkSetup({ run: fake.run, agent: true })
  assert.equal(result.ready, false)
  assert.deepEqual(result.issues, ['DOCKER_DAEMON_UNAVAILABLE'])
  assert.ok(!JSON.stringify(result).includes('fixture-sensitive-marker'))
})

test('process exceptions are sanitized and fail readiness', () => {
  const result = checkSetup({ run() { throw new Error('fixture-sensitive-marker') } })
  assert.equal(result.ready, false)
  assert.ok(!JSON.stringify(result).includes('fixture-sensitive-marker'))
})

test('Code package uses local MCP without hosted bindings, hooks, commands, or tool preapproval', () => {
  const manifest = json('plugin.json')
  assert.equal(manifest.name, 'supaflow-code')
  assert.equal(manifest.extensions['com.openai'].requires_local_executor, true)
  assert.deepEqual(json('mcp.json').mcpServers, {
    'supaflow-local': { type: 'stdio', command: 'supaflow', args: ['mcp'] },
  })
  for (const name of ['.app.json', 'hooks', 'commands', '.claude-plugin']) assert.equal(existsSync(resolve(root, name)), false)
  for (const skill of readdirSync(resolve(root, 'skills'))) {
    const source = readFileSync(resolve(root, 'skills', skill, 'SKILL.md'), 'utf8')
    assert.ok(!source.includes('allowed-tools:'))
    assert.ok(!source.includes('mcp__supaflow__'))
    assert.ok(!source.includes('/supaflow-code:'))
  }
})

test('all packaged relative skill references resolve within the self-contained package', () => {
  for (const skill of readdirSync(resolve(root, 'skills'))) {
    const dir = resolve(root, 'skills', skill)
    for (const file of readdirSync(dir).filter(name => name.endsWith('.md'))) {
      const full = resolve(dir, file)
      for (const [, target] of readFileSync(full, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
        if (/^https?:/.test(target)) continue
        const destination = resolve(dirname(full), target)
        const contained = relative(root, destination)
        assert.ok(!contained.startsWith('..') && !isAbsolute(contained), target)
        assert.ok(existsSync(destination), target)
      }
    }
  }
  assert.ok(existsSync(resolve(root, json('plugin.json').extensions['com.openai'].onboardingSkill)))
})

test('marketplace includes both editions once without changing hosted app binding', () => {
  const marketplace = JSON.parse(readFileSync(new URL('../.agents/plugins/marketplace.json', import.meta.url), 'utf8'))
  assert.deepEqual(marketplace.plugins.map(p => [p.name, p.source.path]), [
    ['supaflow', './plugins/supaflow'], ['supaflow-code', './plugins/supaflow-code'],
  ])
  const binding = JSON.parse(readFileSync(new URL('../plugins/supaflow/.app.json', import.meta.url), 'utf8'))
  assert.equal(binding.apps.supaflow.id, 'asdk_app_6abadf90c69881919b46c92f36bcfc99')
})
