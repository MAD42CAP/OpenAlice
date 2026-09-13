import type { MarketMonitorService } from './service.js'
import { MARKET_MONITOR_ASSETS, type MarketMonitorAsset, type MarketMonitorSchedulerStatus } from './types.js'

type SchedulerService = Pick<MarketMonitorService, 'settings' | 'receipts' | 'scan' | 'isScanning'>

export interface MarketMonitorScheduler {
  start(): void
  stop(): Promise<void>
  tick(): Promise<void>
  status(): Promise<MarketMonitorSchedulerStatus>
}

/** One read-only poller per Alice backend, independent of browser visibility.
 * Missed intervals collapse into one due scan. Completion receipts preserve
 * cadence across restarts, including failures and manually requested scans. */
export function createMarketMonitorScheduler(
  service: SchedulerService,
  options: { now?: () => Date; pollIntervalMs?: number } = {},
): MarketMonitorScheduler {
  const now = options.now ?? (() => new Date())
  const pollIntervalMs = options.pollIntervalMs ?? 15_000
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) throw new Error('Invalid monitor poll interval')
  let running = false
  let timer: ReturnType<typeof setInterval> | undefined
  let activeTick: Promise<void> | undefined
  let checkedAt: string | null = null
  let error: string | null = null
  // If receipt persistence itself fails, still avoid a hot retry loop.
  const lastAttempt = new Map<MarketMonitorAsset, number>()

  const status = async (): Promise<MarketMonitorSchedulerStatus> => {
    const settings = await service.settings()
    const interval = Math.max(1, Math.min(1440, settings.intervalMinutes)) * 60_000
    const assets = await Promise.all(MARKET_MONITOR_ASSETS.map(async (asset) => {
      const lastReceipt = (await service.receipts(asset, 1)).at(-1) ?? null
      const completed = Date.parse(lastReceipt?.completedAt ?? lastReceipt?.requestedAt ?? '')
      const currentTime = now().getTime()
      const attempted = lastAttempt.get(asset) ?? 0
      const last = Math.max(Number.isFinite(completed) && completed <= currentTime ? completed : 0, attempted <= currentTime ? attempted : 0)
      const enabled = settings.enabledAssets.includes(asset)
      const scanning = service.isScanning(asset)
      // Ignore future clock-skewed timestamps; never postpone indefinitely.
      const due = last ? last + interval : currentTime
      return {
        asset, enabled, scanning, lastReceipt,
        nextScanAt: running && settings.backgroundEnabled && enabled && !scanning
          ? new Date(due).toISOString() : null,
      }
    }))
    return { running, backgroundEnabled: settings.backgroundEnabled, intervalMinutes: settings.intervalMinutes, checkedAt, error, assets }
  }

  const tick = (): Promise<void> => {
    if (!running) return Promise.resolve()
    if (activeTick) return activeTick
    activeTick = (async () => {
      try {
        const current = await status()
        checkedAt = now().toISOString()
        error = null
        if (!running || !current.backgroundEnabled) return
        await Promise.all(current.assets.map(async (item) => {
          if (!running || !item.nextScanAt || item.scanning || Date.parse(item.nextScanAt) > now().getTime()) return
          try {
            await service.scan(item.asset, 'scheduled')
          } catch {
            // Service writes the attributed failure receipt; the other asset
            // must still finish and the next interval must remain eligible.
          } finally {
            lastAttempt.set(item.asset, now().getTime())
          }
        }))
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }
    })().finally(() => { activeTick = undefined })
    return activeTick
  }

  return {
    status, tick,
    start() {
      if (running) return
      running = true
      timer = setInterval(() => { void tick() }, pollIntervalMs)
      timer.unref?.()
      void tick()
    },
    async stop() {
      running = false
      if (timer) clearInterval(timer)
      timer = undefined
      await activeTick
    },
  }
}
