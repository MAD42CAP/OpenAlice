import type { MarketMonitorService } from './service.js'
import { MARKET_MONITOR_ASSETS, type MarketMonitorAsset, type MarketMonitorSchedulerStatus } from './types.js'

type SchedulerService = Pick<MarketMonitorService, 'settings' | 'receipts' | 'scan' | 'isScanning'> & Partial<Pick<MarketMonitorService, 'scanStartedAt'>>

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
  let activePoll: Promise<void> | undefined
  const activeScans = new Map<MarketMonitorAsset, Promise<void>>()
  const activeStarted = new Map<MarketMonitorAsset, string>()
  let checkedAt: string | null = null
  let error: string | null = null
  // If receipt persistence itself fails, still avoid a hot retry loop.
  const lastAttempt = new Map<MarketMonitorAsset, number>()
  const lastFailure = new Map<MarketMonitorAsset, { receiptId: string | null; message: string }>()

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
      const scanning = activeScans.has(asset) || service.isScanning(asset)
      const failure = lastFailure.get(asset)
      const lastError = failure && failure.receiptId === (lastReceipt?.id ?? null)
        ? failure.message : lastReceipt?.error ?? null
      // Ignore future clock-skewed timestamps; never postpone indefinitely.
      const due = last ? last + interval : currentTime
      const scanStartedAt = scanning ? service.scanStartedAt?.(asset) ?? activeStarted.get(asset) ?? null : null
      const stalled = scanning && scanStartedAt && currentTime - Date.parse(scanStartedAt) > 120_000
      const overdue = running && settings.backgroundEnabled && enabled && !scanning && last > 0 && currentTime - due > 120_000
      return {
        asset, enabled, scanning, lastReceipt,
        lastError: lastError ?? (stalled ? 'Scan has not completed within two minutes.' : overdue ? 'Scan is more than two minutes overdue.' : null),
        scanStartedAt,
        nextScanAt: running && settings.backgroundEnabled && enabled && !scanning
          ? new Date(due).toISOString() : null,
      }
    }))
    return { running, backgroundEnabled: settings.backgroundEnabled, intervalMinutes: settings.intervalMinutes, checkedAt, error, assets }
  }

  const poll = (): Promise<void> => {
    if (!running) return Promise.resolve()
    if (activePoll) return activePoll
    activePoll = (async () => {
      try {
        const current = await status()
        checkedAt = now().toISOString()
        error = null
        if (!running || !current.backgroundEnabled) return
        for (const item of current.assets) {
          if (!running || !item.nextScanAt || item.scanning || activeScans.has(item.asset) || Date.parse(item.nextScanAt) > now().getTime()) continue
          activeStarted.set(item.asset, now().toISOString())
          const scan = Promise.resolve().then(async () => {
            try {
              await service.scan(item.asset, 'scheduled')
              lastFailure.delete(item.asset)
            } catch (cause) {
              // Keep an in-memory error even if the failure receipt cannot
              // be written; never let it hide behind an older successful scan.
              lastFailure.set(item.asset, {
                receiptId: item.lastReceipt?.id ?? null,
                message: cause instanceof Error ? cause.message : String(cause),
              })
            } finally {
              lastAttempt.set(item.asset, now().getTime())
              activeScans.delete(item.asset)
              activeStarted.delete(item.asset)
            }
          })
          activeScans.set(item.asset, scan)
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }
    })().finally(() => { activePoll = undefined })
    return activePoll
  }

  return {
    status,
    async tick() {
      await poll()
      await Promise.all([...activeScans.values()])
    },
    start() {
      if (running) return
      running = true
      timer = setInterval(() => { void poll() }, pollIntervalMs)
      timer.unref?.()
      void poll()
    },
    async stop() {
      running = false
      if (timer) clearInterval(timer)
      timer = undefined
      await activePoll
      await Promise.all([...activeScans.values()])
    },
  }
}
