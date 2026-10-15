import { Hono } from 'hono'
import { z } from 'zod'
import { buildGuardedMarketJudgment } from '../../domain/market-monitor/judgment.js'
import { reviewSessionDate } from '../../domain/market-monitor/review.js'
import type { ForwardReport } from '../../domain/market-monitor/forecast-validation-types.js'
import type { MarketMonitorService } from '../../domain/market-monitor/service.js'
import type { TypeSafeService } from '../../domain/market-monitor/typesafe-service.js'
import { MARKET_MONITOR_ASSETS } from '../../domain/market-monitor/types.js'

export function createMarketJudgmentRoutes(monitor: Pick<MarketMonitorService, 'settings' | 'snapshots' | 'receipts'>, typeSafe: Pick<TypeSafeService, 'report'>, now = () => new Date(), forward?: { report(asset: typeof MARKET_MONITOR_ASSETS[number]): Promise<ForwardReport> }) {
  const app = new Hono()
  app.get('/', async c => {
    c.header('Cache-Control', 'no-store')
    const asset = z.enum(MARKET_MONITOR_ASSETS).safeParse(c.req.query('asset'))
    if (!asset.success) return c.json({ error: 'Select BTC, TSLA or MSTR' }, 400)
    try {
      const settings = await monitor.settings()
      const [snapshots, jev, receipts, validation] = await Promise.all([
        monitor.snapshots(asset.data, 1, settings.strategyId),
        forward ? null : typeSafe.report(asset.data).catch(() => null),
        monitor.receipts(asset.data, 10).catch(() => []),
        forward?.report(asset.data).catch(() => null),
      ])
      const snapshot = snapshots.at(-1)
      if (!snapshot) return c.json({ error: 'Run a market scan first' }, 404)
      const receipt = receipts.filter(r => r.strategyId === snapshot.strategyId).at(-1)
      const at = now(), report = buildGuardedMarketJudgment(snapshot, at, jev, receipt)
      if (forward) {
        const latest = validation?.asset === asset.data ? validation.latest : null, candidate = latest?.candidate
        const currentSession = candidate && reviewSessionDate(asset.data, candidate.issuedAt) === reviewSessionDate(asset.data, at.toISOString())
        report.jev = { policy: 'jev-base-rate-v2', status: !validation ? 'unavailable' : !candidate ? 'missing' : !currentSession ? 'stale' : latest!.publication.basis.snapshotId !== snapshot.id ? 'different-basis' : 'current',
          issuedAt: candidate?.issuedAt ?? null, directions: candidate ? Object.fromEntries((['short', 'medium', 'long'] as const).map(h => [h, candidate.decisions[h].choice ?? 'insufficient'])) as NonNullable<typeof report.jev.directions> : null }
      }
      return c.json(report)
    } catch { return c.json({ error: 'Market judgment could not be loaded' }, 503) }
  })
  return app
}
