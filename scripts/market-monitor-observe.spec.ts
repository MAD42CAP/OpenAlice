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
  it('defaults to a local 24-hour read-only observation and validates bounds', () => {
    expect(parseObservationOptions([], {})).toMatchObject({ duration: '24h', durationMs: 86_400_000, sampleSeconds: 60, assets: ['BTC', 'TSLA'] })
    expect(parseObservationOptions(['--duration=72h', '--sample-seconds=15', '--asset=tsla'], {})).toMatchObject({ durationMs: 259_200_000, assets: ['TSLA'] })
    expect(() => parseObservationOptions(['--duration=73h'], {})).toThrow(/between 1m and 72h/)
    expect(() => parseObservationOptions(['--base-url=https://example.com'], {})).toThrow(/allow-remote/)
  })

  it('observes scheduler cadence and source recovery without dispatching a scan', async () => {
    let clock = Date.parse('2026-09-13T00:00:00Z')
    const fetcher = async (url: string, init?: RequestInit) => {
      expect(init?.method).toBeUndefined()
      if (url.endsWith('/status')) return response({ running: true, backgroundEnabled: true, intervalMinutes: 15, checkedAt: new Date(clock).toISOString(), error: null, assets: [{ asset: 'BTC', enabled: true, scanning: false, lastError: null }] })
      const recovered = clock > Date.parse('2026-09-13T00:00:00Z')
      return response({ asset: 'BTC', sources: [{ id: 'context', label: 'Context', provider: 'fixture', latestStatus: recovered ? 'ok' : 'unavailable' }], recent: recovered ? [{ id: `scan-${clock}`, asset: 'BTC', trigger: 'scheduled', outcome: 'duplicate', requestedAt: new Date(clock).toISOString(), durationMs: 20 }] : [] })
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
