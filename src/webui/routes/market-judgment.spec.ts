import { expect, it, vi } from 'vitest'
import { createMarketJudgmentRoutes } from './market-judgment.js'
import { judgmentSnapshot } from '../../domain/market-monitor/judgment.fixture.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS } from '../../domain/market-monitor/types.js'

it('serves the selected strategy without scanning and survives independent Jev failures', async () => {
  const monitor = { settings: vi.fn(async () => DEFAULT_MARKET_MONITOR_SETTINGS), snapshots: vi.fn(async () => [judgmentSnapshot()]), receipts: vi.fn(async () => []) }
  const typeSafe = { report: vi.fn().mockRejectedValue(new Error('private detail')) }
  const app = createMarketJudgmentRoutes(monitor, typeSafe, () => new Date('2026-09-20T12:00:00Z'))
  const result = await app.request('/?asset=BTC')
  expect(result.status).toBe(200)
  expect(result.headers.get('cache-control')).toBe('no-store')
  expect(await result.json()).toMatchObject({ snapshotId: 'test-btc', horizons: { medium: { direction: 'bullish' } }, jev: { status: 'unavailable' } })
  expect(monitor.snapshots).toHaveBeenCalledWith('BTC', 1, DEFAULT_MARKET_MONITOR_SETTINGS.strategyId)
  expect((await app.request('/?asset=invalid')).status).toBe(400)
  monitor.snapshots.mockResolvedValueOnce([])
  expect((await app.request('/?asset=BTC')).status).toBe(404)
  monitor.snapshots.mockRejectedValueOnce(new Error('private detail'))
  const failure = await app.request('/?asset=BTC')
  expect(failure.status).toBe(503)
  expect(await failure.text()).not.toContain('private detail')
})
