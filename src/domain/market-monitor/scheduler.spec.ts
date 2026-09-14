import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarketMonitorScheduler } from './scheduler.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS, type MarketMonitorAsset, type MarketMonitorReceipt } from './types.js'

function fixture() {
  let settings = { ...DEFAULT_MARKET_MONITOR_SETTINGS, enabledAssets: [...DEFAULT_MARKET_MONITOR_SETTINGS.enabledAssets] }
  const receipts: MarketMonitorReceipt[] = []
  const service = {
    settings: vi.fn(async () => settings),
    isScanning: vi.fn(() => false),
    receipts: vi.fn(async (asset?: MarketMonitorAsset) => receipts.filter((row) => row.asset === asset).slice(-1)),
    scan: vi.fn(async (asset: MarketMonitorAsset, trigger: 'manual' | 'scheduled') => {
      const at = new Date().toISOString()
      const receipt: MarketMonitorReceipt = { id: `${asset}-${at}`, asset, trigger, requestedAt: at, completedAt: at, outcome: 'stored' }
      receipts.push(receipt)
      return { receipt, snapshot: {} as never, stored: true, alert: null }
    }),
  }
  const scheduler = createMarketMonitorScheduler(service)
  return { service, scheduler, receipts, configure: (patch: Partial<typeof settings>) => { settings = { ...settings, ...patch } } }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-13T00:00:00Z')) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('market monitor background scheduler', () => {
  it('starts paused by default and does not require a browser after opt-in', async () => {
    const { scheduler, service, configure } = fixture()
    scheduler.start()
    await scheduler.tick()
    expect(service.scan).not.toHaveBeenCalled()
    configure({ backgroundEnabled: true, enabledAssets: ['BTC'], intervalMinutes: 1 })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(service.scan).toHaveBeenCalledExactlyOnceWith('BTC', 'scheduled')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(service.scan).toHaveBeenCalledTimes(2)
    await scheduler.stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(service.scan).toHaveBeenCalledTimes(2)
    expect((await scheduler.status()).running).toBe(false)
  })

  it('resumes from persisted manual receipts and collapses missed intervals', async () => {
    const { scheduler, service, configure } = fixture()
    configure({ backgroundEnabled: true, enabledAssets: ['TSLA'], intervalMinutes: 1 })
    await service.scan('TSLA', 'manual')
    service.scan.mockClear()
    scheduler.start()
    scheduler.start()
    await scheduler.tick()
    expect(service.scan).not.toHaveBeenCalled()
    await scheduler.stop()
    vi.setSystemTime(new Date('2026-09-14T00:00:00Z'))
    const restarted = createMarketMonitorScheduler(service)
    restarted.start()
    await restarted.tick()
    expect(service.scan).toHaveBeenCalledTimes(1)
    await restarted.tick()
    expect(service.scan).toHaveBeenCalledTimes(1)
    await restarted.stop()
  })

  it('honors pause, enabled assets and interval edits on the next tick', async () => {
    const { scheduler, service, configure } = fixture()
    configure({ backgroundEnabled: true, enabledAssets: ['BTC'] })
    scheduler.start()
    await scheduler.tick()
    configure({ backgroundEnabled: false })
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(service.scan).toHaveBeenCalledTimes(1)
    configure({ backgroundEnabled: true, enabledAssets: ['TSLA'], intervalMinutes: 1 })
    await scheduler.tick()
    expect(service.scan).toHaveBeenLastCalledWith('TSLA', 'scheduled')
    expect((await scheduler.status()).assets.find((row) => row.asset === 'BTC')?.nextScanAt).toBeNull()
    await scheduler.stop()
  })

  it('isolates a failed asset and does not hot-loop even when receipt storage fails', async () => {
    const { scheduler, service, configure } = fixture()
    configure({ backgroundEnabled: true, intervalMinutes: 1 })
    service.scan.mockRejectedValueOnce(new Error('BTC provider/storage unavailable'))
    scheduler.start()
    await scheduler.tick()
    expect(service.scan).toHaveBeenCalledTimes(3)
    expect((await scheduler.status()).assets.find((row) => row.asset === 'BTC')?.lastError).toBe('BTC provider/storage unavailable')
    await vi.advanceTimersByTimeAsync(45_000)
    expect(service.scan).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(service.scan).toHaveBeenCalledTimes(6)
    expect((await scheduler.status()).assets.find((row) => row.asset === 'BTC')?.lastError).toBeNull()
    await scheduler.stop()
  })

  it('never overlaps ticks or assets already being scanned', async () => {
    const { scheduler, service, configure } = fixture()
    configure({ backgroundEnabled: true, enabledAssets: ['BTC'] })
    service.isScanning.mockReturnValue(true)
    scheduler.start()
    await scheduler.tick()
    expect(service.scan).not.toHaveBeenCalled()
    service.isScanning.mockReturnValue(false)
    let release!: () => void
    service.scan.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { receipt: {} as never, snapshot: {} as never, stored: true, alert: null }
    })
    const pending = scheduler.tick()
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(service.scan).toHaveBeenCalledTimes(1)
    release()
    await pending
    await scheduler.stop()
  })

  it('keeps scanning TSLA while a BTC request is still pending', async () => {
    const { scheduler, service, configure } = fixture()
    configure({ backgroundEnabled: true, intervalMinutes: 1 })
    let release!: () => void
    service.scan.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { receipt: {} as never, snapshot: {} as never, stored: true, alert: null }
    })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    try {
      await vi.advanceTimersByTimeAsync(120_000)
      expect(service.scan.mock.calls.filter(([asset]) => asset === 'BTC')).toHaveLength(1)
      expect(service.scan.mock.calls.filter(([asset]) => asset === 'TSLA')).toHaveLength(3)
      expect(service.scan.mock.calls.filter(([asset]) => asset === 'MSTR')).toHaveLength(3)
      expect((await scheduler.status()).assets.find((row) => row.asset === 'BTC')?.scanning).toBe(true)
    } finally {
      release()
      await scheduler.stop()
    }
  })

  it('makes settings failures visible and recovers without losing its timer', async () => {
    const { scheduler, service, configure } = fixture()
    configure({ backgroundEnabled: true })
    service.settings.mockRejectedValueOnce(new Error('settings unavailable'))
    scheduler.start()
    await scheduler.tick()
    expect((await scheduler.status()).error).toBe('settings unavailable')
    await vi.advanceTimersByTimeAsync(15_000)
    expect((await scheduler.status()).error).toBeNull()
    expect(service.scan).toHaveBeenCalledTimes(3)
    await scheduler.stop()
  })

  it('ignores future clock-skewed receipts rather than delaying forever', async () => {
    const { scheduler, service, configure, receipts } = fixture()
    configure({ backgroundEnabled: true, enabledAssets: ['BTC'] })
    receipts.push({ id: 'future', asset: 'BTC', trigger: 'manual', requestedAt: '2099-01-01T00:00:00Z', outcome: 'stored' })
    scheduler.start()
    await scheduler.tick()
    expect(service.scan).toHaveBeenCalledTimes(1)
    await scheduler.stop()
  })
})
