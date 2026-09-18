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
    setState({ scope, report: null, loading: true, failed: false })
    void marketDashboardApi.report(asset, days, controller.signal).then(report => {
      if (!controller.signal.aborted) setState({ scope, report, loading: false, failed: false })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ scope, report: null, loading: false, failed: true })
    })
    return () => controller.abort()
  }, [asset, days, scope, revision, visible, revisionKey])
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  return { ...(state.scope === scope ? state : { report: null, loading: visible, failed: false }), refresh }
}
