import { useCallback, useEffect, useState } from 'react'
import { marketDashboardApi, type DashboardWindow, type MarketDashboardReport } from '../api/market-dashboard'
import type { MonitorAsset } from '../api/market-monitor'

/** This read-only report has its own request lifecycle; it never starts a scan. */
export function useMarketDashboard(asset: MonitorAsset, days: DashboardWindow, visible: boolean, revisionKey = '') {
  const [revision, setRevision] = useState(0)
  const scope = `${asset}:${days}`
  const [state, setState] = useState<{ scope: string; report: MarketDashboardReport | null; loading: boolean; failed: boolean }>({ scope, report: null, loading: visible, failed: false })
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    let pending = false, failures = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      if (pending || controller.signal.aborted || document.visibilityState === 'hidden') return
      clearTimeout(retry)
      pending = true
      setState(old => ({ scope, report: old.scope === scope ? old.report : null, loading: true, failed: old.scope === scope && old.failed }))
      try {
        const report = await marketDashboardApi.report(asset, days, AbortSignal.any([controller.signal, AbortSignal.timeout(40_000)]))
        if (report.asset !== asset || report.windowDays !== days) throw new Error('Research selection mismatch')
        if (!controller.signal.aborted) { failures = 0; setState({ scope, report, loading: false, failed: false }) }
      } catch {
        if (!controller.signal.aborted) {
          setState(old => ({ scope, report: old.scope === scope ? old.report : null, loading: false, failed: true }))
          if (failures < 3) retry = setTimeout(() => void read(), [5000, 15000, 30000][failures++])
        }
      } finally { pending = false }
    }
    const resume = () => { failures = 0; void read() }
    void read()
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    return () => { controller.abort(); clearTimeout(retry); window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume) }
  }, [asset, days, scope, revision, visible, revisionKey])
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  return { ...(state.scope === scope ? state : { report: null, loading: visible, failed: false }), refresh }
}
