#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { readRuntimeStatus, requestRuntimeControl } from '../packages/cli/src/server-control.mjs'

const EXPECTED_BRANCH = 'feature/market-evidence-monitor'
const DASHBOARD_PATH = '/market/evidence'

export function parseMacLauncherOptions(argv) {
  const options = {
    check: false,
    demo: false,
    foreground: false,
    full: false,
    noOpen: false,
    home: null,
    open: false,
    status: false,
    stop: false,
    help: false,
  }
  for (const arg of argv) {
    if (arg === '--') continue
    if (arg === '--check') options.check = true
    else if (arg === '--demo') options.demo = true
    else if (arg === '--foreground') options.foreground = true
    else if (arg === '--full') options.full = true
    else if (arg === '--no-open') options.noOpen = true
    else if (arg === '--open') options.open = true
    else if (arg === '--status') options.status = true
    else if (arg === '--stop') options.stop = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('--home=')) {
      const value = arg.slice('--home='.length).trim()
      if (!value) throw new Error('--home requires a directory')
      options.home = resolve(value)
    } else throw new Error(`unknown option: ${arg}`)
  }
  if (options.demo && options.full) throw new Error('--demo and --full cannot be combined')
  const actions = [options.check, options.open, options.status, options.stop].filter(Boolean).length
  const lifecycleActions = [options.open, options.status, options.stop].filter(Boolean).length
  if (actions > 1) throw new Error('--check, --open, --status, and --stop cannot be combined')
  if (lifecycleActions > 0 && (options.demo || options.foreground || options.full || options.noOpen)) {
    throw new Error('lifecycle actions cannot be combined with launch-mode options')
  }
  return options
}

function versionParts(raw) {
  return raw.replace(/^v/, '').split('.').slice(0, 3).map((part) => Number.parseInt(part, 10) || 0)
}

export function versionAtLeast(actual, minimum) {
  const left = versionParts(actual)
  const right = versionParts(minimum)
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index]
  }
  return true
}

export function assessMacEnvironment(input) {
  const errors = []
  const warnings = []
  if (input.platform !== 'darwin') errors.push(`This launcher requires macOS; detected ${input.platform}.`)
  if (!versionAtLeast(input.nodeVersion, '22.19.0')) errors.push(`Node.js 22.19.0 or newer is required; detected ${input.nodeVersion}.`)
  if (!input.pnpmVersion) errors.push('pnpm is unavailable. Enable Corepack or install pnpm 11.')
  else if (!versionAtLeast(input.pnpmVersion, '11.7.0')) errors.push(`pnpm 11.7.0 or newer is required; detected ${input.pnpmVersion}.`)
  if (!input.dependenciesInstalled) errors.push('Project dependencies are missing. Run pnpm install first.')
  if (!input.gitRepository) errors.push('This directory is not a Git checkout of OpenAlice.')
  else if (input.branch !== EXPECTED_BRANCH) warnings.push(`Current branch is ${input.branch || 'detached HEAD'}; the monitor build is maintained on ${EXPECTED_BRANCH}.`)
  return { ok: errors.length === 0, errors, warnings }
}

function packageManager(args) {
  const npmExecPath = process.env['npm_execpath']
  return npmExecPath
    ? { command: process.execPath, args: [npmExecPath, ...args] }
    : { command: 'pnpm', args }
}

async function inspectEnvironment() {
  const branch = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' })
  const pnpm = packageManager(['--version'])
  const pnpmResult = spawnSync(pnpm.command, pnpm.args, { encoding: 'utf8' })
  let dependenciesInstalled = true
  try { await access(resolve('node_modules', '.pnpm')) } catch { dependenciesInstalled = false }
  const input = {
    platform: process.platform,
    nodeVersion: process.version,
    pnpmVersion: pnpmResult.status === 0 ? pnpmResult.stdout.trim() : null,
    dependenciesInstalled,
    gitRepository: branch.status === 0,
    branch: branch.status === 0 ? branch.stdout.trim() : null,
  }
  return { input, assessment: assessMacEnvironment(input) }
}

function printEnvironment({ input, assessment }) {
  console.log(`[market-monitor] macOS: ${input.platform === 'darwin' ? 'ready' : input.platform}`)
  console.log(`[market-monitor] Node: ${input.nodeVersion}`)
  console.log(`[market-monitor] pnpm: ${input.pnpmVersion ?? 'missing'}`)
  console.log(`[market-monitor] dependencies: ${input.dependenciesInstalled ? 'installed' : 'missing'}`)
  console.log(`[market-monitor] branch: ${input.branch ?? 'unavailable'}`)
  for (const warning of assessment.warnings) console.warn(`[market-monitor] WARNING: ${warning}`)
  for (const error of assessment.errors) console.error(`[market-monitor] ERROR: ${error}`)
}

export function dashboardUrlFromLine(line) {
  const match = /\[guardian\]\s+UI\s+[^\n]*?(http:\/\/localhost:\d+)/.exec(line.replace(/\u001b\[[0-9;]*m/g, ''))
  return match ? `${match[1]}${DASHBOARD_PATH}` : null
}

export async function waitForDashboard(url, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch
  const wait = dependencies.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms)))
  const attempts = dependencies.attempts ?? 100
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetcher(url)
      const html = response.ok ? await response.text() : ''
      if (html.includes('id="root"')) return true
    } catch { /* startup in progress */ }
    if (attempt + 1 < attempts) await wait(300)
  }
  return false
}

function streamLines(stream, write, onLine) {
  let pending = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    write(chunk)
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) onLine(line)
  })
  stream.on('end', () => { if (pending) onLine(pending) })
}

function openDashboard(url) {
  const opener = spawn('open', [url], { stdio: 'ignore' })
  opener.on('error', () => undefined)
  opener.unref()
}

export function resolveMacRuntimePaths(options, dependencies = {}) {
  const homeDir = dependencies.homeDir ?? homedir()
  const env = dependencies.env ?? process.env
  const home = options.home ?? env['OPENALICE_HOME'] ?? resolve(homeDir, '.openalice')
  return {
    home: resolve(home),
    log: join(resolve(home), 'state', 'market-monitor.log'),
  }
}

export function dashboardUrlFromStatus(status) {
  const raw = status?.endpoints?.web
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return null
    return `${url.origin}${DASHBOARD_PATH}`
  } catch {
    return null
  }
}

export function isManageableBackgroundStatus(status, projectRoot = process.cwd()) {
  return status?.owner?.surface === 'dev'
    && status.owner.mode === 'detached'
    && resolve(status.owner.launchRoot ?? '') === resolve(projectRoot)
    && status.control?.capabilities?.includes('runtime.stop') === true
}

function runtimeIsPresent(status) {
  return status?.class !== 'absent' && status?.owner != null
}

async function currentRuntime(home) {
  return readRuntimeStatus({ homeRoot: home, timeoutMs: 1_500 })
}

function printRuntimeStatus(status, paths) {
  if (!runtimeIsPresent(status)) {
    console.log(`[market-monitor] OpenAlice is not running for ${paths.home}.`)
    return
  }
  console.log(`[market-monitor] state: ${status.state}`)
  console.log(`[market-monitor] mode: ${status.owner?.mode ?? 'unknown'}`)
  console.log(`[market-monitor] pid: ${status.owner?.pid ?? 'unknown'}`)
  const url = dashboardUrlFromStatus(status)
  if (url) console.log(`[market-monitor] dashboard: ${url}`)
  if (status.owner?.mode === 'detached') console.log(`[market-monitor] log: ${paths.log}`)
}

async function waitForBackgroundDashboard(home, options = {}) {
  const wait = options.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms)))
  const attempts = options.attempts ?? 240
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.shouldStop?.()) return null
    const status = await currentRuntime(home)
    const url = dashboardUrlFromStatus(status)
    if (status?.owner?.mode === 'detached' && status.state === 'running' && url) {
      const ready = await waitForDashboard(url, { attempts: 1 })
      if (ready) return { status, url }
    }
    await wait(500)
  }
  return null
}

async function launchForeground(options) {
  const args = options.demo
    ? ['market-monitor:preview', '--', ...(options.noOpen ? ['--no-open'] : [])]
    : ['dev', ...(options.home ? ['--', `--home=${options.home}`] : [])]
  const invocation = packageManager(args)
  console.log('[market-monitor] Preparing source workspace packages before the UI starts…')
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(options.full || options.demo ? {} : { OPENALICE_LITE_MODE: '1' }) },
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  let opening = false
  let opened = false
  const inspectLine = (line) => {
    if (options.demo || options.noOpen || opening || opened) return
    const url = dashboardUrlFromLine(line)
    if (!url) return
    opening = true
    void waitForDashboard(url).then((ready) => {
      opening = false
      if (!ready || opened) return
      opened = true
      console.log(`[market-monitor] Dashboard ready: ${url}`)
      openDashboard(url)
    })
  }
  streamLines(child.stdout, (chunk) => process.stdout.write(chunk), inspectLine)
  streamLines(child.stderr, (chunk) => process.stderr.write(chunk), inspectLine)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
  const code = await new Promise((done) => child.once('exit', (exitCode) => done(exitCode ?? 1)))
  if (!options.demo && !opened && code !== 0) {
    console.error('[market-monitor] OpenAlice did not reach the dashboard. Review the Guardian error above; an existing runtime can be kept or started with an isolated --home directory.')
  }
  process.exitCode = code
}

async function launchBackground(options) {
  const paths = resolveMacRuntimePaths(options)
  const existing = await currentRuntime(paths.home)
  if (runtimeIsPresent(existing)) {
    printRuntimeStatus(existing, paths)
    if (!isManageableBackgroundStatus(existing)) {
      const guidance = existing.owner?.mode === 'foreground'
        ? 'Stop that foreground process with Control-C, then run this command again.'
        : 'Use the checkout that owns the existing runtime, or select a separate --home directory.'
      throw new Error(`OpenAlice is already owned by another launch context. ${guidance}`)
    }
    const existingUrl = dashboardUrlFromStatus(existing)
    const ready = existing.state === 'running'
      && existingUrl
      && await waitForDashboard(existingUrl, { attempts: 3 })
      ? { status: existing, url: existingUrl }
      : await waitForBackgroundDashboard(paths.home)
    if (!ready?.url) throw new Error(`The existing background runtime did not reach the dashboard. Review ${paths.log}`)
    if (!options.noOpen) openDashboard(ready.url)
    console.log('[market-monitor] Reusing the existing background runtime; this Terminal may close.')
    return
  }

  await mkdir(join(paths.home, 'state'), { recursive: true, mode: 0o700 })
  const logFile = await open(paths.log, 'a', 0o600)
  await logFile.chmod(0o600)
  await logFile.write(`\n[market-monitor] background launch ${new Date().toISOString()}\n`)
  const args = ['dev', ...(options.home ? ['--', `--home=${options.home}`] : [])]
  const invocation = packageManager(args)
  let child
  let childExit = null
  try {
    child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(options.full ? {} : { OPENALICE_LITE_MODE: '1' }),
        OPENALICE_DEV_DETACHED: '1',
      },
      detached: true,
      stdio: ['ignore', logFile.fd, logFile.fd],
    })
    child.once('error', (error) => { childExit = `spawn error: ${error.message}` })
    child.once('exit', (code, signal) => { childExit = `exit code=${code ?? 'null'} signal=${signal ?? 'none'}` })
    child.unref()
  } finally {
    await logFile.close()
  }

  console.log(`[market-monitor] Starting OpenAlice in the background (pid ${child.pid ?? 'pending'})…`)
  const ready = await waitForBackgroundDashboard(paths.home, { shouldStop: () => childExit !== null })
  if (!ready) {
    throw new Error(`OpenAlice did not reach the dashboard${childExit ? ` (${childExit})` : ''}. Review ${paths.log}`)
  }
  console.log(`[market-monitor] Dashboard ready: ${ready.url}`)
  console.log(`[market-monitor] Log: ${paths.log}`)
  console.log('[market-monitor] Background mode is active. This Terminal may close.')
  if (!options.noOpen) openDashboard(ready.url)
}

async function showStatus(options) {
  const paths = resolveMacRuntimePaths(options)
  printRuntimeStatus(await currentRuntime(paths.home), paths)
}

async function openRunningDashboard(options) {
  const paths = resolveMacRuntimePaths(options)
  const status = await currentRuntime(paths.home)
  const url = dashboardUrlFromStatus(status)
  if (!runtimeIsPresent(status) || !url) throw new Error('OpenAlice is not running or has not published its dashboard yet.')
  if (!(await waitForDashboard(url, { attempts: 3 }))) throw new Error('OpenAlice is running, but its dashboard is not ready yet.')
  openDashboard(url)
  console.log(`[market-monitor] Opened ${url}`)
}

async function stopBackground(options) {
  const paths = resolveMacRuntimePaths(options)
  const status = await currentRuntime(paths.home)
  if (!runtimeIsPresent(status)) {
    console.log('[market-monitor] OpenAlice is already stopped.')
    return
  }
  if (!isManageableBackgroundStatus(status)) {
    throw new Error('Refusing to stop an OpenAlice runtime not owned by this background launcher. A foreground runtime must be stopped with Control-C in its Terminal.')
  }
  await requestRuntimeControl(paths.home, 'runtime.stop', { timeoutMs: 3_000 })
  for (let attempt = 0; attempt < 200; attempt++) {
    await new Promise((done) => setTimeout(done, 100))
    if (!runtimeIsPresent(await currentRuntime(paths.home))) {
      console.log('[market-monitor] OpenAlice background runtime stopped.')
      return
    }
  }
  throw new Error(`OpenAlice did not stop within 20 seconds. Review ${paths.log}`)
}

export function macLauncherHelp() {
  return `Usage: pnpm market-monitor:mac -- [options]

Checks the Mac source environment, starts OpenAlice and opens the Evidence
Monitor dashboard when Vite is ready. The default uses read-only lite mode in
the background, so the launching Terminal can close.

Options:
  --check             Check the environment without starting OpenAlice
  --demo              Open the deterministic demo dashboard in the foreground
  --foreground        Keep the real source stack attached to this Terminal
  --full              Start normal OpenAlice services instead of lite mode
  --home=<directory>  Use an isolated OpenAlice data directory
  --no-open           Start without opening the browser
  --open              Open the dashboard of the running OpenAlice
  --status            Show background runtime status, dashboard, and log
  --stop              Gracefully stop this launcher's background runtime
  --help              Show this message`
}

async function main() {
  const options = parseMacLauncherOptions(process.argv.slice(2))
  if (options.help) return console.log(macLauncherHelp())
  if (options.status) return showStatus(options)
  if (options.open) return openRunningDashboard(options)
  if (options.stop) return stopBackground(options)
  const environment = await inspectEnvironment()
  printEnvironment(environment)
  if (!environment.assessment.ok) {
    process.exitCode = 1
    return
  }
  if (options.check) {
    console.log('[market-monitor] Mac environment is ready.')
    return
  }
  console.log(`[market-monitor] Starting ${options.demo ? 'demo' : options.full ? 'full' : 'read-only lite'} mode…`)
  if (options.demo || options.foreground) return launchForeground(options)
  await launchBackground(options)
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entry === import.meta.url) main().catch((error) => {
  console.error(`[market-monitor] FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
