import { expect, it, vi } from 'vitest'
import { createMarketJudgmentRoutes } from './market-judgment.js'
import { judgmentSnapshot } from '../../domain/market-monitor/judgment.fixture.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS } from '../../domain/market-monitor/types.js'
import type { ForwardReport } from '../../domain/market-monitor/forecast-validation-types.js'

it('uses the new effective Jev decision and never falls back to legacy probabilities', async () => {
  const at = new Date('2026-09-20T12:00:00Z')
  const monitor = { settings: vi.fn(async () => DEFAULT_MARKET_MONITOR_SETTINGS), snapshots: vi.fn(async () => [judgmentSnapshot()]), receipts: vi.fn(async () => []) }
  const legacy = { report: vi.fn() }
  const validation = { asset: 'BTC', latest: { publication: { basis: { snapshotId: 'test-btc' } }, candidate: { issuedAt: at.toISOString(), decisions: { short: { rawChoice: 'flat', choice: null }, medium: { rawChoice: 'up', choice: 'up' }, long: { rawChoice: 'flat', choice: null } } } } } as unknown as ForwardReport
  const forward = { report: vi.fn(async () => validation) }
  const app = createMarketJudgmentRoutes(monitor, legacy, () => at, forward)
  expect(await (await app.request('/?asset=BTC')).json()).toMatchObject({ protocol: 'evidence-summary-v2', validation: { status: 'experimental' }, jev: { policy: 'jev-base-rate-v2', status: 'current', directions: { short: 'insufficient', medium: 'up', long: 'insufficient' } } })
  expect(legacy.report).not.toHaveBeenCalled()
  forward.report.mockRejectedValueOnce(new Error('private error'))
  expect(await (await app.request('/?asset=BTC')).json()).toMatchObject({ jev: { policy: 'jev-base-rate-v2', status: 'unavailable', directions: null } })
  expect(legacy.report).not.toHaveBeenCalled()
})

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
