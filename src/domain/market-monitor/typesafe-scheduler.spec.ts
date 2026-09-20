import { expect, it, vi } from 'vitest'
import { createMarketMonitorScheduler } from './scheduler.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS } from './types.js'
it('runs research after a successful scan without holding scan status or shutdown open', async () => {
  let finish!: () => void
  const afterScan = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const service = { settings: async () => ({ ...DEFAULT_MARKET_MONITOR_SETTINGS, backgroundEnabled: true, enabledAssets: ['BTC'] as const }),
    receipts: async () => [], isScanning: () => false, scan: vi.fn(async () => ({})) }
  const scheduler = createMarketMonitorScheduler(service as never, { afterScan, now: () => new Date('2026-09-20T12:00:00Z') })
  scheduler.start()
  await scheduler.tick()
  expect(service.scan).toHaveBeenCalledWith('BTC', 'scheduled')
  expect(afterScan).toHaveBeenCalledWith('BTC')
  expect((await scheduler.status()).assets[0].scanning).toBe(false)
  await scheduler.stop()
  finish()
})
it('isolates research failure from the successful market scan', async () => {
  const afterScan = vi.fn(async () => { throw new Error('provider unavailable') })
  const service = { settings: async () => ({ ...DEFAULT_MARKET_MONITOR_SETTINGS, backgroundEnabled: true, enabledAssets: ['BTC'] as const }), receipts: async () => [], isScanning: () => false, scan: vi.fn(async () => ({})) }
  const scheduler = createMarketMonitorScheduler(service as never, { afterScan, now: () => new Date('2026-09-20T12:00:00Z') })
  scheduler.start(); await scheduler.tick()
  expect((await scheduler.status()).assets[0].lastError).toBeNull()
  await scheduler.stop()
})
