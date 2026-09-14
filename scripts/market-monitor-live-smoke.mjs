#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ASSETS = ['BTC', 'TSLA', 'MSTR']
const DEFAULT_BASE_URL = 'http://127.0.0.1:47331'
const DEFAULT_OUTPUT = 'dist/market-monitor-acceptance.json'

export function parseOptions(argv, env = process.env) {
  const options = {
    baseUrl: env.OPENALICE_MARKET_MONITOR_BASE_URL?.trim() || DEFAULT_BASE_URL,
    output: DEFAULT_OUTPUT,
    scan: false,
    background: false,
    allowRemote: false,
    assets: [...ASSETS],
    help: false,
  }
  for (const arg of argv) {
    if (arg === '--') continue
    if (arg === '--scan') options.scan = true
    else if (arg === '--background') options.background = true
    else if (arg === '--allow-remote') options.allowRemote = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('--base-url=')) options.baseUrl = arg.slice('--base-url='.length)
    else if (arg.startsWith('--output=')) options.output = arg.slice('--output='.length)
    else if (arg.startsWith('--asset=')) {
      const asset = arg.slice('--asset='.length).toUpperCase()
      if (!ASSETS.includes(asset)) throw new Error('--asset must be BTC, TSLA or MSTR')
      options.assets = [asset]
    } else throw new Error(`unknown option: ${arg}`)
  }
  const url = new URL(options.baseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--base-url must use http or https')
  options.baseUrl = url.toString().replace(/\/$/, '')
  if (!options.allowRemote && !isLoopbackHost(url.hostname)) {
    throw new Error('remote acceptance requires --allow-remote; the default is loopback-only')
  }
  if (!options.output.trim()) throw new Error('--output must not be empty')
  return options
}

export function isLoopbackHost(hostname) {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return value === 'localhost' || value === '::1' || /^127(?:\.\d{1,3}){3}$/.test(value)
}

export function validateSnapshot(asset, snapshot, strategyId = 'evidence-chain-v1') {
  if (!snapshot || snapshot.asset !== asset) throw new Error(`${asset}: response has the wrong asset`)
  if (snapshot.strategyId !== strategyId) throw new Error(`${asset}: unexpected strategy identity`)
  if (!snapshot.fingerprint || !snapshot.hypothesis?.id) throw new Error(`${asset}: evidence identity is incomplete`)
  if (!Number.isFinite(snapshot.metrics?.lastPrice)) throw new Error(`${asset}: last price is unavailable`)
  if (!Array.isArray(snapshot.chart?.daily) || snapshot.chart.daily.length < 20) throw new Error(`${asset}: fewer than 20 daily bars were restored`)
  if (!Array.isArray(snapshot.chart?.intraday)) throw new Error(`${asset}: intraday series is not explicit`)
  const health = snapshot.sourceHealth
  if (!Array.isArray(health) || !health.some((source) => source.id === 'daily-bars')) {
    throw new Error(`${asset}: daily source attribution is missing`)
  }
  const hourly = health.find((source) => source.id === 'intraday-bars')
  if (!hourly) throw new Error(`${asset}: hourly source attribution is missing`)
  if (hourly.status === 'unavailable' && snapshot.chart.intraday.length !== 0) {
    throw new Error(`${asset}: unavailable hourly data was replaced by another timeframe`)
  }
}

export function validateScanPair(asset, first, second, strategyId = 'evidence-chain-v1') {
  validateSnapshot(asset, first?.snapshot, strategyId)
  validateSnapshot(asset, second?.snapshot, strategyId)
  for (const result of [first, second]) {
    const expected = result.stored ? 'stored' : 'duplicate'
    if (result.receipt?.asset !== asset || result.receipt?.outcome !== expected) {
      throw new Error(`${asset}: scan receipt does not match its storage outcome`)
    }
  }
  if (first.snapshot.fingerprint === second.snapshot.fingerprint && second.stored) {
    throw new Error(`${asset}: identical semantic evidence created a duplicate observation`)
  }
}

export function validateHealthReport(asset, report) {
  if (report?.schemaVersion !== 1 || report.asset !== asset || report.window?.hours !== 24) throw new Error(`${asset}: invalid health report selection`)
  const summary = report.summary
  if (!summary || !Number.isInteger(summary.attempts) || summary.attempts < 0
    || summary.successful + summary.failed !== summary.attempts
    || summary.stored + summary.duplicates !== summary.successful
    || summary.scansWithSourceChecks > summary.attempts
    || summary.scansWithSourceIssues > summary.scansWithSourceChecks
    || !Array.isArray(report.sources) || !Array.isArray(report.recent)) throw new Error(`${asset}: inconsistent health report counts`)
  if (summary.attempts && (!report.window.firstSampleAt || !report.window.lastSampleAt)) throw new Error(`${asset}: health report omits observed sample times`)
}

async function request(fetcher, baseUrl, path, init, timeoutMs = 45_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(`${baseUrl}${path}`, { ...init, signal: controller.signal })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500)
      throw new Error(`${init?.method ?? 'GET'} ${path} returned ${response.status}: ${detail}`)
    }
    return response
  } finally {
    clearTimeout(timer)
  }
}

async function json(fetcher, baseUrl, path, init) {
  return request(fetcher, baseUrl, path, init).then((response) => response.json())
}

/** Explicit opt-in only. No scan POST: prove the backend itself dispatches.
 * Only a paused runtime is eligible; never interrupt an existing schedule. */
export async function runBackgroundProbe(options, settings, dependencies = {}) {
  if (settings.backgroundEnabled) throw new Error('Pause background monitoring before running --background acceptance')
  const fetcher = dependencies.fetcher ?? fetch
  const wait = dependencies.wait ?? ((ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms)))
  const now = dependencies.now ?? Date.now
  const path = '/api/market-monitor/settings'
  const temporary = { ...settings, backgroundEnabled: true, enabledAssets: options.assets, intervalMinutes: 1 }
  const put = (body) => json(fetcher, options.baseUrl, path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const before = new Map(await Promise.all(options.assets.map(async (asset) => {
    const result = await json(fetcher, options.baseUrl, `/api/market-monitor/receipts?asset=${asset}&limit=1`)
    return [asset, result.receipts?.at(-1)?.id ?? null]
  })))
  const receipts = new Map()
  try {
    // The finally also handles an ambiguous PUT response after a server write.
    await put(temporary)
    const deadline = now() + 150_000
    while (now() < deadline) {
      for (const asset of options.assets) {
        const result = await json(fetcher, options.baseUrl, `/api/market-monitor/receipts?asset=${asset}&limit=1`)
        const receipt = result.receipts?.at(-1)
        if (!receipt || receipt.id === before.get(asset) || receipt.trigger !== 'scheduled') continue
        if (receipt.outcome === 'failed') throw new Error(`${asset}: background scan failed: ${receipt.error ?? 'unknown error'}`)
        if (!['stored', 'duplicate'].includes(receipt.outcome)) throw new Error(`${asset}: invalid background receipt`)
        receipts.set(asset, receipt)
      }
      if (receipts.size === options.assets.length) return { success: true, receipts: [...receipts.values()] }
      await wait(2000)
    }
    throw new Error('Background monitor did not produce scheduled receipts within 150 seconds')
  } finally {
    const current = await json(fetcher, options.baseUrl, path)
    const unchanged = Object.keys(temporary).every((key) => JSON.stringify(current[key]) === JSON.stringify(temporary[key]))
    if (unchanged) await put(settings)
    else if (Object.keys(settings).some((key) => JSON.stringify(current[key]) !== JSON.stringify(settings[key]))) {
      // Never overwrite changes made by another operator during acceptance.
      throw new Error('Settings changed during background acceptance; preserved the newer settings. Check background monitoring in the dashboard.')
    }
  }
}

export async function runAcceptance(options, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch
  const startedAt = new Date().toISOString()
  const page = await request(fetcher, options.baseUrl, '/market/evidence')
  const html = await page.text()
  if (!html.includes('id="root"')) throw new Error('market page did not return the OpenAlice application shell')
  const settings = await json(fetcher, options.baseUrl, '/api/market-monitor/settings')
  const strategies = await json(fetcher, options.baseUrl, '/api/market-monitor/strategies')
  const contextProviders = await json(fetcher, options.baseUrl, '/api/market-monitor/context-providers')
  const runtime = await json(fetcher, options.baseUrl, '/api/market-monitor/status')
  if (typeof runtime.running !== 'boolean' || typeof runtime.backgroundEnabled !== 'boolean' || !Array.isArray(runtime.assets)) {
    throw new Error('background monitor status response is invalid')
  }
  if (!Array.isArray(settings.enabledAssets) || !Number.isFinite(settings.intervalMinutes) || typeof settings.strategyId !== 'string') {
    throw new Error('monitor settings response is invalid')
  }
  if (!strategies.strategies?.some((strategy) => strategy.id === settings.strategyId)) {
    throw new Error(`configured strategy is not registered: ${settings.strategyId}`)
  }
  for (const asset of options.assets) {
    if (!contextProviders.providers?.some((provider) => provider.assets?.includes(asset))) {
      throw new Error(`${asset}: no registered context provider`)
    }
  }

  if (options.background && !runtime.running) throw new Error('Background monitor is not running in this backend')
  const background = options.background ? await runBackgroundProbe(options, settings, dependencies) : null

  const assets = []
  for (const asset of options.assets) {
    const historyPath = `/api/market-monitor/snapshots?asset=${asset}&limit=1000&strategyId=${encodeURIComponent(settings.strategyId)}`
    const before = await json(fetcher, options.baseUrl, historyPath)
    let first = null
    let second = null
    if (options.scan) {
      const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asset, trigger: 'manual' }) }
      first = await json(fetcher, options.baseUrl, '/api/market-monitor/scan', init)
      second = await json(fetcher, options.baseUrl, '/api/market-monitor/scan', init)
      validateScanPair(asset, first, second, settings.strategyId)
    }
    const snapshots = await json(fetcher, options.baseUrl, historyPath)
    const receipts = await json(fetcher, options.baseUrl, `/api/market-monitor/receipts?asset=${asset}&limit=1000`)
    const alerts = await json(fetcher, options.baseUrl, `/api/market-monitor/alerts?asset=${asset}&limit=1000`)
    const evaluation = await json(fetcher, options.baseUrl, `/api/market-monitor/evaluation?asset=${asset}`)
    const health = await json(fetcher, options.baseUrl, `/api/market-monitor/health?asset=${asset}&hours=24`)
    validateHealthReport(asset, health)
    if (options.scan && [first, second].some((result) => !health.recent.some((receipt) => receipt.id === result.receipt.id && Number.isFinite(receipt.durationMs) && receipt.sourceHealth?.length))) {
      throw new Error(`${asset}: health report is missing telemetry for acceptance scans`)
    }
    const latest = snapshots.snapshots?.at(-1)
    if (latest) validateSnapshot(asset, latest, settings.strategyId)
    if (options.scan && (!latest || snapshots.count < before.count || receipts.count < 2)) {
      throw new Error(`${asset}: persisted histories did not reflect the acceptance scans`)
    }
    assets.push({
      asset,
      beforeSnapshots: before.count,
      afterSnapshots: snapshots.count,
      receipts: receipts.count,
      alerts: alerts.count,
      evaluationSamples: evaluation.samples,
      health,
      firstOutcome: first?.receipt?.outcome ?? null,
      secondOutcome: second?.receipt?.outcome ?? null,
      latestFingerprint: latest?.fingerprint ?? null,
      sources: latest?.sourceHealth?.map(({ id, status, provider }) => ({ id, status, provider })) ?? [],
    })
  }
  return {
    schemaVersion: 1,
    success: true,
    mode: options.background ? 'background-scan' : options.scan ? 'live-scan' : 'read-only',
    baseUrl: options.baseUrl,
    startedAt,
    completedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    modules: {
      strategyId: settings.strategyId,
      strategies: strategies.strategies.map((strategy) => strategy.id),
      contextProviders: contextProviders.providers.map((provider) => provider.id),
    },
    runtime,
    background,
    assets,
  }
}

export function helpText() {
  return `Usage: pnpm market-monitor:acceptance -- [options]

Checks a running OpenAlice Market Evidence Monitor.

Options:
  --scan                 Run two real read-only market scans per asset
  --background           Test backend scheduling; temporarily enable a paused
                         monitor at 1 minute, then restore its original settings
  --asset=BTC|TSLA|MSTR  Limit acceptance to one asset
  --base-url=<url>       OpenAlice Web endpoint (default ${DEFAULT_BASE_URL})
  --output=<path>        Receipt path (default ${DEFAULT_OUTPUT})
  --allow-remote         Permit a non-loopback endpoint
  --help                 Show this message`
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) {
    console.log(helpText())
    return
  }
  const report = await runAcceptance(options)
  const output = resolve(options.output)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  for (const asset of report.assets) {
    console.log(`[market-monitor] ${asset.asset}: snapshots ${asset.beforeSnapshots} -> ${asset.afterSnapshots}; scans ${asset.firstOutcome ?? 'not run'} / ${asset.secondOutcome ?? 'not run'}`)
  }
  console.log(`[market-monitor] PASS (${report.mode}) -> ${output}`)
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(`[market-monitor] FAIL: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
