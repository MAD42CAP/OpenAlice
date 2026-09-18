import type { MarketMonitorAsset, MarketMonitorHealthReport, MarketMonitorReceipt } from './types.js'

export const HEALTH_RECEIPT_LIMIT = 5000

/** Operational completion and source health are different facts. Missing
 * telemetry is unknown, and sampling never proves uptime or strategy returns. */
export function summarizeMonitorHealth(
  asset: MarketMonitorAsset,
  receipts: MarketMonitorReceipt[],
  hours: 24 | 72,
  now: Date,
): MarketMonitorHealthReport {
  const to = now.getTime()
  const from = to - hours * 3_600_000
  const at = (row: MarketMonitorReceipt) => row.completedAt ?? row.requestedAt
  const eligible = receipts.filter((row) => {
    const time = Date.parse(at(row))
    return row.asset === asset && time >= from && time <= to && ['stored', 'duplicate', 'failed'].includes(row.outcome)
  }).sort((a, b) => Date.parse(at(a)) - Date.parse(at(b)))
  const rows = eligible.slice(-HEALTH_RECEIPT_LIMIT)
  const durations = rows.flatMap((row) => typeof row.durationMs === 'number' && Number.isFinite(row.durationMs) && row.durationMs >= 0 ? [row.durationMs] : []).sort((a, b) => a - b)
  const successful = rows.filter((row) => row.outcome !== 'failed')
  const failed = rows.filter((row) => row.outcome === 'failed')
  let consecutiveFailures = 0
  for (let i = rows.length - 1; i >= 0 && rows[i]!.outcome === 'failed'; i--) consecutiveFailures++
  const sources = new Map<string, MarketMonitorHealthReport['sources'][number] & { lastIndex: number }>()
  rows.forEach((row, index) => {
    const seen = new Set<string>()
    for (const source of row.sourceHealth ?? []) {
      const key = `${source.id}\0${source.provider}`
      if (seen.has(key) || !['ok', 'degraded', 'unavailable'].includes(source.status)) continue
      seen.add(key)
      const previous = sources.get(key)
      const recovered = previous && previous.lastIndex === index - 1 && previous.latestStatus !== 'ok' && source.status === 'ok'
      sources.set(key, {
        id: source.id, label: source.label, provider: source.provider,
        samples: (previous?.samples ?? 0) + 1,
        ok: (previous?.ok ?? 0) + Number(source.status === 'ok'),
        degraded: (previous?.degraded ?? 0) + Number(source.status === 'degraded'),
        unavailable: (previous?.unavailable ?? 0) + Number(source.status === 'unavailable'),
        recoveries: (previous?.recoveries ?? 0) + Number(Boolean(recovered)),
        latestStatus: source.status, lastCheckedAt: at(row), lastDataAt: source.asOf, lastIndex: index,
      })
    }
  })
  return {
    schemaVersion: 1, asset, generatedAt: now.toISOString(),
    window: {
      hours, from: new Date(from).toISOString(), to: now.toISOString(),
      firstSampleAt: rows.length ? at(rows[0]!) : null,
      lastSampleAt: rows.length ? at(rows.at(-1)!) : null,
      sampleLimit: HEALTH_RECEIPT_LIMIT, truncated: eligible.length > HEALTH_RECEIPT_LIMIT,
    },
    summary: {
      attempts: rows.length, successful: successful.length, failed: failed.length,
      stored: rows.filter((row) => row.outcome === 'stored').length,
      duplicates: rows.filter((row) => row.outcome === 'duplicate').length,
      scheduled: rows.filter((row) => row.trigger === 'scheduled').length,
      manual: rows.filter((row) => row.trigger === 'manual').length,
      narration: rows.filter((row) => row.trigger === 'narration').length,
      successRatePercent: rows.length ? Math.round(successful.length / rows.length * 10000) / 100 : null,
      consecutiveFailures,
      recoveries: rows.filter((row, index) => index > 0 && rows[index - 1]!.outcome === 'failed' && row.outcome !== 'failed').length,
      lastSuccessAt: successful.length ? at(successful.at(-1)!) : null,
      lastFailureAt: failed.length ? at(failed.at(-1)!) : null,
      durationSamples: durations.length,
      averageDurationMs: durations.length ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length) : null,
      p95DurationMs: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1]! : null,
      scansWithSourceChecks: rows.filter((row) => row.sourceHealth?.length).length,
      scansWithSourceIssues: rows.filter((row) => row.sourceHealth?.some((source) => source.status !== 'ok')).length,
    },
    sources: [...sources.values()].map(({ lastIndex: _lastIndex, ...source }) => source),
    recent: rows.slice(-12).reverse(),
  }
}
