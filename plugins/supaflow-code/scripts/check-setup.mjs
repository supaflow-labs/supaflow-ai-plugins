#!/usr/bin/env node
// Read-only prerequisite checks. Never emit command output or credentials.
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const invoke = (command, args) => spawnSync(command, args, {
  encoding: 'utf8', timeout: 10000, maxBuffer: 65536, windowsHide: true,
})

function versionAtLeast(value, minimum) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(value.trim())
  if (!match) return false
  const actual = match.slice(1).map(Number)
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i]
  }
  return true
}

export function checkSetup({ run = invoke, agent = false } = {}) {
  const issues = []
  const check = (command, args) => {
    try { return run(command, args) } catch { return { status: null } }
  }
  const node = check('node', ['--version'])
  const nodeReady = node.status === 0 && versionAtLeast(node.stdout || '', [18, 0, 0])
  if (!nodeReady) issues.push('NODE_UNAVAILABLE_OR_UNSUPPORTED')
  const cli = check('supaflow', ['--version'])
  const cliReady = cli.status === 0 && versionAtLeast(cli.stdout || '', [0, 8, 0])
  if (!cliReady) issues.push('CLI_UNAVAILABLE_OR_UNSUPPORTED')
  let credentialsConfigured = false
  let workspaceSelected = false
  if (nodeReady && cliReady) {
    const auth = check('supaflow', ['auth', 'status', '--json'])
    try {
      if (auth.status !== 0) throw new Error('check failed')
      const value = JSON.parse(auth.stdout)
      if (!value || typeof value.authenticated !== 'boolean' || value.error) throw new Error('invalid response')
      credentialsConfigured = value.authenticated
      workspaceSelected = typeof value.workspace_id === 'string' && !!value.workspace_id.trim() && value.workspace_id !== 'null'
      if (!credentialsConfigured) issues.push('AUTHENTICATION_REQUIRED')
      if (!workspaceSelected) issues.push('WORKSPACE_SELECTION_REQUIRED')
    } catch { issues.push('AUTH_STATUS_UNAVAILABLE') }
  }
  let dockerReady = null
  if (agent) {
    const docker = check('docker', ['version', '--format', '{{.Server.Version}}'])
    dockerReady = docker.status === 0 && !!docker.stdout?.trim()
    if (!dockerReady) issues.push('DOCKER_DAEMON_UNAVAILABLE')
  }
  return { ready: issues.length === 0, nodeReady, cliReady, credentialsConfigured, workspaceSelected, dockerReady, issues }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(arg => arg !== '--agent')) {
    console.error('Usage: node check-setup.mjs [--agent]')
    process.exitCode = 2
  } else {
    const result = checkSetup({ agent: process.argv.includes('--agent') })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exitCode = result.ready ? 0 : 1
  }
}
