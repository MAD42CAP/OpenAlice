import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseObservationOptions, runObservation, writeObservationReport } from './market-monitor-observe.mjs'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('market monitor long-run observer', () => {
  it('ignores historical fallback aggregates after the current source recovers', async () => {
    let clock = Date.parse('2026-09-13T00:00:00Z')
    const report = await runObservation(parseObservationOptions(['--duration=1m', '--asset=BTC'], {}), {
      now: () => clock, wait: async (ms: number) => { clock += ms },
      fetcher: async (url: string) => url.endsWith('/status')
        ? response({ running: true, backgroundEnabled: true, intervalMinutes: 15, checkedAt: new Date(clock).toISOString(), assets: [{ asset: 'BTC', enabled: true }] })
        : response({ sources: [{ id: 'daily-bars', provider: 'yfinance', latestStatus: 'degraded' }], recent: [{ id: 'current', requestedAt: new Date(clock).toISOString(), outcome: 'stored', sourceHealth: [{ id: 'daily-bars', provider: 'coinbase', status: 'ok' }] }] }),
    })
    expect(report.incidents).toEqual([])
    expect(report.summary.verdict).toBe('pass')
  })

  it('keeps failed scans and missing source telemetry open until a new successful check', async () => {
    let clock = Date.parse('2026-09-13T00:00:00Z'), probe = 0
    const states = [
      { id: '1', outcome: 'failed', sourceHealth: [{ id: 'daily-bars', label: 'Daily', provider: 'yfinance', status: 'unavailable' }] },
      { id: '1', outcome: 'failed', sourceHealth: [{ id: 'daily-bars', label: 'Daily', provider: 'yfinance', status: 'unavailable' }] },
      { id: '2', outcome: 'stored' },
      { id: '3', outcome: 'stored', sourceHealth: [{ id: 'daily-bars', label: 'Daily', provider: 'coinbase', status: 'ok' }] },
    ]
    const checkpoints: number[] = []
    const report = await runObservation({ ...parseObservationOptions(['--duration=1m', '--asset=BTC', '--sample-seconds=15'], {}), durationMs: 45_000 }, {
      now: () => clock, wait: async (ms: number) => { clock += ms },
      checkpoint: async (current: { summary: { openIncidents: number } }) => { checkpoints.push(current.summary.openIncidents) },
      fetcher: async (url: string) => url.endsWith('/status')
        ? response({ running: true, backgroundEnabled: true, intervalMinutes: 15, checkedAt: new Date(clock).toISOString(), assets: [{ asset: 'BTC', enabled: true }] })
        : response({ sources: [], recent: [{ ...states[probe++], requestedAt: new Date(clock).toISOString() }] }),
    })
    expect(checkpoints.slice(0, 4)).toEqual([2, 2, 2, 0])
    expect(report.incidents.find(row => row.kind === 'source-unavailable')?.recoveredAt).toBe('2026-09-13T00:00:45.000Z')
  })

  it('defaults to a local 24-hour read-only observation and validates bounds', () => {
    expect(parseObservationOptions([], {})).toMatchObject({ duration: '24h', durationMs: 86_400_000, sampleSeconds: 60, assets: ['BTC', 'TSLA', 'MSTR'] })
    expect(parseObservationOptions(['--duration=72h', '--sample-seconds=15', '--asset=tsla'], {})).toMatchObject({ durationMs: 259_200_000, assets: ['TSLA'] })
    expect(() => parseObservationOptions(['--duration=73h'], {})).toThrow(/between 1m and 72h/)
    expect(() => parseObservationOptions(['--base-url=https://example.com'], {})).toThrow(/allow-remote/)
  })

  it('observes scheduler cadence and source recovery without dispatching a scan', async () => {
    let clock = Date.parse('2026-09-13T00:00:00Z')
    const fetcher = async (url: string, init?: RequestInit) => {
      expect(init?.method).toBeUndefined()
      if (url.endsWith('/status')) return response({ running: true, backgroundEnabled: true, intervalMinutes: 30, checkedAt: new Date(clock).toISOString(), error: null, assets: [{ asset: 'BTC', enabled: true, scanning: false, lastError: null }] })
      const recovered = clock > Date.parse('2026-09-13T00:00:00Z')
      return response({ asset: 'BTC', sources: [{ id: 'context', label: 'Context', provider: 'fixture', latestStatus: recovered ? 'ok' : 'unavailable' }], recent: [{ id: `scan-${clock}`, asset: 'BTC', trigger: 'scheduled', outcome: 'duplicate', requestedAt: new Date(clock - (recovered ? 0 : 60_000)).toISOString(), durationMs: 20, sourceHealth: [{ id: 'context', label: 'Context', provider: 'fixture', status: recovered ? 'ok' : 'unavailable' }] }] })
    }
    const report = await runObservation({ ...parseObservationOptions(['--duration=1h', '--asset=BTC'], {}), sampleSeconds: 15 }, {
      fetcher, now: () => clock, wait: async () => { clock += 30 * 60_000 }, checkpoint: async () => undefined,
    })
    expect(report.samples).toMatchObject({ total: 3, succeeded: 3, failed: 0 })
    expect(report.observedReceipts).toHaveLength(2)
    expect(report.incidents).toEqual([expect.objectContaining({ kind: 'source-unavailable', recoveredAt: '2026-09-13T00:30:00.000Z' })])
    expect(report.summary).toMatchObject({ cadenceAssessment: 'observed', verdict: 'attention', observedScheduledSuccesses: { BTC: 2 } })
  })

  it('fails completed acceptance when background monitoring is disabled', async () => {
    let clock = Date.parse('2026-09-13T00:00:00Z')
    const fetcher = async (url: string) => url.endsWith('/status')
      ? response({ running: true, backgroundEnabled: false, intervalMinutes: 15, checkedAt: new Date(clock).toISOString(), error: null, assets: [{ asset: 'BTC', enabled: true, scanning: false, lastError: null }] })
      : response({ asset: 'BTC', sources: [], recent: [] })
    const report = await runObservation(parseObservationOptions(['--duration=1m', '--asset=BTC'], {}), { fetcher, now: () => clock, wait: async (ms: number) => { clock += ms } })
    expect(report.completedAt).not.toBeNull()
    expect(report.summary.verdict).toBe('fail')
    expect(report.incidents[0]).toMatchObject({ kind: 'background-disabled', samples: 2 })
  })

  it('does not infer recovery for an existing incident during an API outage', async () => {
    let clock = Date.parse('2026-09-13T00:00:00Z')
    let probes = 0
    const fetcher = async (url: string) => {
      if (++probes > 2) throw new Error('backend offline')
      return url.endsWith('/status')
        ? response({ running: true, backgroundEnabled: false, intervalMinutes: 15, checkedAt: new Date(clock).toISOString(), error: null, assets: [{ asset: 'BTC', enabled: true, scanning: false, lastError: null }] })
        : response({ asset: 'BTC', sources: [], recent: [] })
    }
    const report = await runObservation(parseObservationOptions(['--duration=1m', '--asset=BTC'], {}), { fetcher, now: () => clock, wait: async (ms: number) => { clock += ms } })
    expect(report.incidents.find((row) => row.kind === 'background-disabled')?.recoveredAt).toBeNull()
    expect(report.incidents.find((row) => row.kind === 'api-unavailable')).toBeTruthy()
  })

  it('leaves an atomic, parseable checkpoint for interrupted observations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'monitor-observe-'))
    roots.push(root)
    const file = join(root, 'report.json')
    const report = { schemaVersion: 1, summary: { verdict: 'incomplete' } }
    expect(await writeObservationReport(file, report)).toBe(file)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(report)
  })
})

it.each([false, true])('detects missing progress despite a live scheduler heartbeat (scanning=%s)', async scanning => {
  let clock = Date.parse('2026-09-17T00:00:00Z')
  const at = new Date(clock).toISOString()
  const receipt = { id: 'once', asset: 'BTC', trigger: 'scheduled', outcome: 'stored', requestedAt: at, completedAt: at, sourceHealth: [{ id: 'daily-bars', provider: 'coinbase', status: 'ok' }] }
  const report = await runObservation(parseObservationOptions(['--duration=1h', '--asset=BTC'], {}), {
    now: () => clock, wait: async (ms: number) => { clock += ms },
    fetcher: async (url: string) => url.endsWith('/status')
      ? response({ running: true, backgroundEnabled: true, intervalMinutes: 15, checkedAt: new Date(clock).toISOString(), assets: [{ asset: 'BTC', enabled: true, scanning, scanStartedAt: scanning ? at : null, lastReceipt: receipt }] })
      : response({ recent: [receipt] }),
  })
  expect(report.summary.verdict).toBe('fail')
  expect(report.summary.cadenceAssessment).toBe('interrupted')
  expect(report.incidents).toEqual(expect.arrayContaining([expect.objectContaining({ kind: scanning ? 'scan-stalled' : 'scan-overdue', recoveredAt: null })]))
})

it('detects a dispatch gap even when a healthy new scan arrives before the next probe', async () => {
  const start = Date.parse('2026-09-17T00:00:00Z')
  let clock = start
  const receipt = (at: number) => ({ id: String(at), asset: 'BTC', trigger: 'scheduled', outcome: 'duplicate', requestedAt: new Date(at).toISOString(), completedAt: new Date(at).toISOString(), sourceHealth: [{ id: 'daily-bars', provider: 'coinbase', status: 'ok' }] })
  const report = await runObservation(parseObservationOptions(['--duration=1h', '--asset=BTC'], {}), {
    now: () => clock, wait: async () => { clock += 30 * 60_000 },
    fetcher: async (url: string) => url.endsWith('/status')
      ? response({ running: true, backgroundEnabled: true, intervalMinutes: 15, checkedAt: new Date(clock).toISOString(), assets: [{ asset: 'BTC', enabled: true, scanning: false }] })
      : response({ recent: [receipt(clock)] }),
  })
  expect(report.summary.verdict).toBe('fail')
  expect(report.summary.cadence.BTC.maxIdleGapMs).toBe(30 * 60_000)
  expect(report.incidents.some(row => row.kind === 'scan-gap')).toBe(true)
})

it('does not count daily interpretation scans as periodic scheduler successes', async () => {
  let clock = Date.parse('2026-09-17T00:00:00Z')
  const report = await runObservation(parseObservationOptions(['--duration=1h', '--asset=BTC'], {}), {
    now: () => clock, wait: async (ms: number) => { clock += ms },
    fetcher: async (url: string) => url.endsWith('/status')
      ? response({ running: true, backgroundEnabled: true, intervalMinutes: 15, checkedAt: new Date(clock).toISOString(), assets: [{ asset: 'BTC', enabled: true, scanning: false }] })
      : response({ recent: [{ id: String(clock), asset: 'BTC', trigger: 'narration', outcome: 'stored', requestedAt: new Date(clock).toISOString(), sourceHealth: [{ id: 'daily-bars', provider: 'coinbase', status: 'ok' }] }] }),
  })
  expect(report.summary.observedScheduledSuccesses.BTC).toBe(0)
  expect(report.summary.cadence.BTC.narrationScans).toBeGreaterThan(0)
  expect(report.summary.cadenceAssessment).toBe('missing')
})
