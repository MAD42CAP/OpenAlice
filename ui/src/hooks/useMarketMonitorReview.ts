import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { MonitorAsset } from '../api/market-monitor'
import type { MarketReviewReport, ReviewWindow } from '../api/market-review'

export function useMarketMonitorReview(asset: MonitorAsset, strategy: string, days: ReviewWindow, visible: boolean) {
  const [revision, setRevision] = useState(0)
  const scope = `${asset}:${strategy}:${days}`
  const [state, setState] = useState<{ scope: string; report: MarketReviewReport | null; loading: boolean; failed: boolean }>({ scope, report: null, loading: true, failed: false })
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    setState({ scope, report: null, loading: true, failed: false })
    void api.marketMonitor.review(asset, days, controller.signal).then(report => {
      if (!controller.signal.aborted) setState({ scope, report, loading: false, failed: false })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ scope, report: null, loading: false, failed: true })
    })
    return () => controller.abort()
  }, [asset, days, scope, revision, visible])
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  return { ...(state.scope === scope ? state : { report: null, loading: true, failed: false }), refresh }
}
