#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const EXPECTED_BRANCH = 'feature/market-evidence-monitor'
const DASHBOARD_PATH = '/market/evidence'

export function parseMacLauncherOptions(argv) {
  const options = { check: false, demo: false, full: false, noOpen: false, home: null, help: false }
  for (const arg of argv) {
    if (arg === '--') continue
    if (arg === '--check') options.check = true
    else if (arg === '--demo') options.demo = true
    else if (arg === '--full') options.full = true
    else if (arg === '--no-open') options.noOpen = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('--home=')) {
      const value = arg.slice('--home='.length).trim()
      if (!value) throw new Error('--home requires a directory')
      options.home = resolve(value)
    } else throw new Error(`unknown option: ${arg}`)
  }
  if (options.demo && options.full) throw new Error('--demo and --full cannot be combined')
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
    await wait(300)
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
  opener.unref()
}

async function launch(options) {
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

export function macLauncherHelp() {
  return `Usage: pnpm market-monitor:mac -- [options]

Checks the Mac source environment, starts OpenAlice and opens the Evidence
Monitor dashboard when Vite is ready. The default uses read-only lite mode.

Options:
  --check             Check the environment without starting OpenAlice
  --demo              Open the deterministic demo dashboard
  --full              Start normal OpenAlice services instead of lite mode
  --home=<directory>  Use an isolated OpenAlice data directory
  --no-open           Start without opening the browser
  --help              Show this message`
}

async function main() {
  const options = parseMacLauncherOptions(process.argv.slice(2))
  if (options.help) return console.log(macLauncherHelp())
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
  await launch(options)
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entry === import.meta.url) main().catch((error) => {
  console.error(`[market-monitor] FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
