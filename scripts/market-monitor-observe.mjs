#!/usr/bin/env node
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ASSETS = ['BTC', 'TSLA', 'MSTR']
const DEFAULT_BASE_URL = 'http://127.0.0.1:47331'
const DEFAULT_OUTPUT = 'dist/market-monitor-observation.json'

function isLoopbackHost(hostname) {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return value === 'localhost' || value === '::1' || /^127(?:\.\d{1,3}){3}$/.test(value)
}

function durationMs(raw) {
  const match = /^(\d+)(m|h)$/.exec(raw)
  if (!match) throw new Error('--duration must look like 30m, 24h or 72h')
  const value = Number(match[1]) * (match[2] === 'h' ? 3_600_000 : 60_000)
  if (value < 60_000 || value > 72 * 3_600_000) throw new Error('--duration must be between 1m and 72h')
  return value
}

export function parseObservationOptions(argv, env = process.env) {
  const options = {
    baseUrl: env.OPENALICE_MARKET_MONITOR_BASE_URL?.trim() || DEFAULT_BASE_URL,
    output: DEFAULT_OUTPUT,
    duration: '24h',
    durationMs: 24 * 3_600_000,
    sampleSeconds: 60,
    assets: [...ASSETS],
    allowRemote: false,
    help: false,
  }
  for (const arg of argv) {
    if (arg === '--') continue
    if (arg === '--allow-remote') options.allowRemote = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('--base-url=')) options.baseUrl = arg.slice('--base-url='.length)
    else if (arg.startsWith('--output=')) options.output = arg.slice('--output='.length)
    else if (arg.startsWith('--duration=')) {
      options.duration = arg.slice('--duration='.length).toLowerCase()
      options.durationMs = durationMs(options.duration)
    } else if (arg.startsWith('--sample-seconds=')) {
      options.sampleSeconds = Number(arg.slice('--sample-seconds='.length))
    } else if (arg.startsWith('--asset=')) {
      const asset = arg.slice('--asset='.length).toUpperCase()
      if (!ASSETS.includes(asset)) throw new Error('--asset must be BTC, TSLA or MSTR')
      options.assets = [asset]
    } else throw new Error(`unknown option: ${arg}`)
  }
  const url = new URL(options.baseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--base-url must use http or https')
  if (!options.allowRemote && !isLoopbackHost(url.hostname)) throw new Error('remote observation requires --allow-remote; the default is loopback-only')
  if (!Number.isInteger(options.sampleSeconds) || options.sampleSeconds < 15 || options.sampleSeconds > 3600) throw new Error('--sample-seconds must be an integer from 15 to 3600')
  if (!options.output.trim()) throw new Error('--output must not be empty')
  options.baseUrl = url.toString().replace(/\/$/, '')
  return options
}

async function getJson(fetcher, baseUrl, path, timeoutMs = 15_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(`${baseUrl}${path}`, { signal: controller.signal })
    if (!response.ok) throw new Error(`GET ${path} returned ${response.status}: ${(await response.text()).slice(0, 200)}`)
    return await response.json()
  } finally { clearTimeout(timer) }
}

function receiptTime(receipt) {
  return Date.parse(receipt?.completedAt ?? receipt?.requestedAt ?? '')
}

function incident(report, active, seenNow, at, kind, message, asset = null, sourceId = null) {
  const key = `${kind}:${asset ?? ''}:${sourceId ?? ''}`
  seenNow.add(key)
  const current = active.get(key)
  if (current) {
    current.lastSeenAt = at
    current.samples++
    current.message = message
    return
  }
  const next = { kind, asset, sourceId, startedAt: at, lastSeenAt: at, recoveredAt: null, samples: 1, message }
  report.incidents.push(next)
  active.set(key, next)
}

function closeRecovered(active, seenNow, at) {
  for (const [key, current] of active) {
    if (seenNow.has(key)) continue
    current.recoveredAt = at
    active.delete(key)
  }
}

function summarize(report, runtimeIntervalMinutes) {
  const successRatio = report.samples.total ? report.samples.succeeded / report.samples.total : 0
  const criticalKinds = new Set(['scheduler-stopped', 'background-disabled', 'scheduler-error', 'scheduler-stale', 'asset-disabled', 'asset-missing'])
  const critical = report.incidents.some((row) => criticalKinds.has(row.kind)) || successRatio < 0.95
  const scheduled = Object.fromEntries(report.assets.map((asset) => [asset, report.observedReceipts.filter((row) => row.asset === asset && row.trigger === 'scheduled' && row.outcome !== 'failed').length]))
  const longEnough = report.elapsedMs >= Math.max(1, runtimeIntervalMinutes ?? 15) * 120_000
  const missingCadence = longEnough && report.assets.some((asset) => scheduled[asset] === 0)
  const attention = report.incidents.some((row) => ['api-unavailable', 'scan-failed', 'source-degraded', 'source-unavailable'].includes(row.kind))
  return {
    probeSuccessPercent: report.samples.total ? Math.round(successRatio * 10_000) / 100 : null,
    incidentEpisodes: report.incidents.length,
    openIncidents: report.incidents.filter((row) => row.recoveredAt == null).length,
    observedScheduledSuccesses: scheduled,
    cadenceAssessment: longEnough ? (missingCadence ? 'missing' : 'observed') : 'insufficient-duration',
    verdict: critical || missingCadence ? 'fail' : attention ? 'attention' : 'pass',
  }
}

/** Observe an already-enabled backend. This function never changes settings or
 * dispatches scans. Its clock/wait/checkpoint seams keep long-run rules testable. */
export async function runObservation(options, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch
  const now = dependencies.now ?? Date.now
  const wait = dependencies.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms)))
  const checkpoint = dependencies.checkpoint ?? (() => Promise.resolve())
  const shouldStop = dependencies.shouldStop ?? (() => false)
  const started = now()
  const report = {
    schemaVersion: 1,
    mode: 'market-monitor-observation',
    baseUrl: options.baseUrl,
    duration: options.duration,
    sampleSeconds: options.sampleSeconds,
    assets: [...options.assets],
    startedAt: new Date(started).toISOString(),
    plannedEndAt: new Date(started + options.durationMs).toISOString(),
    completedAt: null,
    elapsedMs: 0,
    samples: { total: 0, succeeded: 0, failed: 0, firstSuccessAt: null, lastSuccessAt: null, maxLatencyMs: null },
    incidents: [],
    observedReceipts: [],
    finalHealth: {},
    summary: { probeSuccessPercent: null, incidentEpisodes: 0, openIncidents: 0, observedScheduledSuccesses: {}, cadenceAssessment: 'insufficient-duration', verdict: 'incomplete' },
  }
  const active = new Map()
  const receiptIds = new Set()
  let runtimeIntervalMinutes = null
  while (!shouldStop()) {
    const sampleAt = now()
    const seenNow = new Set()
    report.samples.total++
    const requestStarted = now()
    try {
      const [status, ...health] = await Promise.all([
        getJson(fetcher, options.baseUrl, '/api/market-monitor/status'),
        ...options.assets.map((asset) => getJson(fetcher, options.baseUrl, `/api/market-monitor/health?asset=${asset}&hours=72`)),
      ])
      const completed = now()
      const at = new Date(completed).toISOString()
      const latency = Math.max(0, completed - requestStarted)
      runtimeIntervalMinutes = Number.isFinite(status.intervalMinutes) ? status.intervalMinutes : runtimeIntervalMinutes
      report.samples.succeeded++
      report.samples.firstSuccessAt ??= at
      report.samples.lastSuccessAt = at
      report.samples.maxLatencyMs = Math.max(report.samples.maxLatencyMs ?? 0, latency)
      if (!status.running) incident(report, active, seenNow, at, 'scheduler-stopped', 'Background scheduler is stopped.')
      if (!status.backgroundEnabled) incident(report, active, seenNow, at, 'background-disabled', 'Background monitoring is disabled.')
      if (status.error) incident(report, active, seenNow, at, 'scheduler-error', String(status.error))
      const checked = Date.parse(status.checkedAt ?? '')
      if (!Number.isFinite(checked) || completed - checked > 45_000) incident(report, active, seenNow, at, 'scheduler-stale', 'Scheduler check is missing or more than 45 seconds old.')
      options.assets.forEach((asset, index) => {
        const item = status.assets?.find((row) => row.asset === asset)
        if (!item) incident(report, active, seenNow, at, 'asset-missing', `${asset} is absent from scheduler status.`, asset)
        else {
          if (!item.enabled) incident(report, active, seenNow, at, 'asset-disabled', `${asset} is excluded from background monitoring.`, asset)
          if (item.lastError) incident(report, active, seenNow, at, 'scan-failed', String(item.lastError), asset)
        }
        const assetHealth = health[index]
        report.finalHealth[asset] = assetHealth
        for (const receipt of assetHealth.recent ?? []) {
          if (receiptTime(receipt) < started || receiptIds.has(receipt.id)) continue
          receiptIds.add(receipt.id)
          report.observedReceipts.push({ id: receipt.id, asset, trigger: receipt.trigger, outcome: receipt.outcome, requestedAt: receipt.requestedAt, completedAt: receipt.completedAt ?? null, durationMs: receipt.durationMs ?? null, error: receipt.error ?? null })
          if (receipt.outcome === 'failed') incident(report, active, seenNow, at, 'scan-failed', receipt.error ?? 'Scan failed.', asset)
        }
        for (const source of assetHealth.sources ?? []) {
          if (source.latestStatus === 'ok') continue
          incident(report, active, seenNow, at, `source-${source.latestStatus}`, `${source.label} (${source.provider}) is ${source.latestStatus}.`, asset, `${source.id}:${source.provider}`)
        }
      })
      closeRecovered(active, seenNow, at)
    } catch (error) {
      report.samples.failed++
      const at = new Date(now()).toISOString()
      incident(report, active, seenNow, at, 'api-unavailable', error instanceof Error ? error.message : String(error))
      // An unavailable API cannot prove that previously observed scheduler or
      // source incidents recovered. Close them only after a successful probe.
    }
    report.elapsedMs = Math.max(0, now() - started)
    report.summary = { ...summarize(report, runtimeIntervalMinutes), verdict: 'incomplete' }
    await checkpoint(report)
    if (now() >= started + options.durationMs) break
    await wait(Math.min(options.sampleSeconds * 1000, started + options.durationMs - now()))
  }
  report.elapsedMs = Math.max(0, now() - started)
  if (now() >= started + options.durationMs) {
    report.completedAt = new Date(now()).toISOString()
    report.summary = summarize(report, runtimeIntervalMinutes)
  }
  await checkpoint(report)
  return report
}

export async function writeObservationReport(file, report) {
  const output = resolve(file)
  await mkdir(dirname(output), { recursive: true })
  const temp = `${output}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await rename(temp, output)
  return output
}

export function observationHelp() {
  return `Usage: pnpm market-monitor:observe -- [options]

Observes an already-enabled OpenAlice Market Evidence Monitor without changing
settings or dispatching scans. A checkpoint is saved after every probe.

Options:
  --duration=24h|72h      Observation duration (default 24h; 1m–72h accepted)
  --sample-seconds=60     Probe interval from 15 to 3600 seconds
  --asset=BTC|TSLA|MSTR   Limit observation to one asset
  --base-url=<url>        OpenAlice Web endpoint (default ${DEFAULT_BASE_URL})
  --output=<path>         Report path (default ${DEFAULT_OUTPUT})
  --allow-remote          Permit a non-loopback endpoint
  --help                  Show this message`
}

async function main() {
  const options = parseObservationOptions(process.argv.slice(2))
  if (options.help) return console.log(observationHelp())
  let stopping = false
  const stop = () => { stopping = true }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  let lastLogged = 0
  const output = resolve(options.output)
  const report = await runObservation(options, {
    shouldStop: () => stopping,
    checkpoint: async (current) => {
      await writeObservationReport(output, current)
      if (current.samples.total !== lastLogged) {
        lastLogged = current.samples.total
        console.log(`[market-monitor] ${current.samples.succeeded}/${current.samples.total} probes reached the backend; ${current.observedReceipts.length} new receipts -> ${output}`)
      }
    },
  })
  const label = report.completedAt ? report.summary.verdict.toUpperCase() : 'INCOMPLETE'
  console.log(`[market-monitor] ${label}: ${report.duration} observation -> ${output}`)
  if (report.completedAt && report.summary.verdict === 'fail') process.exitCode = 1
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entry === import.meta.url) main().catch((error) => {
  console.error(`[market-monitor] FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
