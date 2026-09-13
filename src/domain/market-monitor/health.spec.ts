import { describe, expect, it } from 'vitest'
import { HEALTH_RECEIPT_LIMIT, summarizeMonitorHealth } from './health.js'
import type { MarketMonitorReceipt, SourceHealth } from './types.js'

const now = new Date('2026-09-13T12:00:00Z')
function receipt(id: number, outcome: MarketMonitorReceipt['outcome'], source?: SourceHealth['status']): MarketMonitorReceipt {
  return {
    id: String(id), asset: 'BTC', requestedAt: new Date(now.getTime() - (20 - id) * 60_000).toISOString(),
    trigger: 'scheduled', outcome, durationMs: id * 100,
    ...(source ? { sourceHealth: [{ id: 'btc-context', label: 'BTC context', provider: 'fixture', status: source, asOf: null }] } : {}),
  }
}

describe('operational health reports', () => {
  it('separates successful duplicate scans from unavailable sources', () => {
    const report = summarizeMonitorHealth('BTC', [receipt(1, 'stored', 'ok'), receipt(2, 'duplicate', 'unavailable'), receipt(3, 'failed'), receipt(4, 'duplicate', 'ok')], 24, now)
    expect(report.summary).toMatchObject({ attempts: 4, successful: 3, failed: 1, duplicates: 2, successRatePercent: 75, recoveries: 1, scansWithSourceChecks: 3, scansWithSourceIssues: 1, averageDurationMs: 250, p95DurationMs: 400 })
    expect(report.sources[0]).toMatchObject({ samples: 3, ok: 2, unavailable: 1, recoveries: 0 })
    expect(report.recent[0]?.id).toBe('4')
  })

  it('counts observed source recoveries only between consecutive attributed samples', () => {
    const report = summarizeMonitorHealth('BTC', [receipt(1, 'stored', 'unavailable'), receipt(2, 'duplicate', 'ok'), receipt(3, 'duplicate', 'degraded'), receipt(4, 'duplicate', 'ok')], 24, now)
    expect(report.sources[0]?.recoveries).toBe(2)
  })

  it('does not infer healthy checks or durations from legacy receipts', () => {
    const legacy = receipt(1, 'stored')
    delete legacy.durationMs
    const report = summarizeMonitorHealth('BTC', [legacy], 24, now)
    expect(report.summary).toMatchObject({ attempts: 1, successRatePercent: 100, scansWithSourceChecks: 0, durationSamples: 0, averageDurationMs: null })
    expect(report.sources).toEqual([])
    expect(report.window.firstSampleAt).toBe(legacy.requestedAt)
  })

  it('filters asset/time, sorts records and excludes invalid or future timestamps', () => {
    const rows = [receipt(4, 'failed'), { ...receipt(2, 'stored'), asset: 'TSLA' as const }, receipt(1, 'stored'), { ...receipt(3, 'stored'), requestedAt: 'invalid' }, { ...receipt(5, 'stored'), requestedAt: '2099-01-01' }, { ...receipt(6, 'stored'), requestedAt: '2026-09-11T12:00:00Z' }]
    const report = summarizeMonitorHealth('BTC', rows, 24, now)
    expect(report.summary).toMatchObject({ attempts: 2, consecutiveFailures: 1 })
    expect(summarizeMonitorHealth('BTC', rows, 72, now).summary.attempts).toBe(3)
  })

  it('makes empty and capped windows explicit instead of claiming full coverage', () => {
    expect(summarizeMonitorHealth('BTC', [], 72, now)).toMatchObject({ window: { firstSampleAt: null, lastSampleAt: null, truncated: false }, summary: { attempts: 0, successRatePercent: null } })
    const rows = Array.from({ length: HEALTH_RECEIPT_LIMIT + 1 }, (_, id) => ({ ...receipt(1, 'stored'), id: String(id) }))
    const report = summarizeMonitorHealth('BTC', rows, 72, now)
    expect(report.summary.attempts).toBe(HEALTH_RECEIPT_LIMIT)
    expect(report.window.truncated).toBe(true)
  })
})
