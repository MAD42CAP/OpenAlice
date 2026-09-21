import { useCallback, useEffect, useState } from 'react'
import type { MonitorAsset } from '../api/market-monitor'
import { marketJudgmentApi, type MarketJudgmentReport } from '../api/market-judgment'

export function useMarketJudgment(asset: MonitorAsset, strategyId: string, visible: boolean, revisionKey: string) {
  const key = `${asset}:${strategyId}`
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ key: string; report: MarketJudgmentReport | null; loading: boolean; error: boolean }>({ key, report: null, loading: true, error: false })
  const refresh = useCallback(() => setRevision(n => n + 1), [])
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    let pending = false
    const load = async () => {
      if (pending) return
      pending = true
      setState(old => ({ key, report: old.key === key ? old.report : null, loading: true, error: false }))
      try {
        const report = await marketJudgmentApi.read(asset, controller.signal)
        if (report.asset !== asset || report.strategyId !== strategyId) throw new Error('Selection changed')
        if (!controller.signal.aborted) setState({ key, report, loading: false, error: false })
      } catch { if (!controller.signal.aborted) setState(old => ({ ...old, loading: false, error: true })) }
      finally { pending = false }
    }
    void load()
    const poll = () => { if (document.visibilityState === 'visible') void load() }
    const timer = window.setInterval(poll, 30_000)
    document.addEventListener('visibilitychange', poll)
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', poll) }
  }, [asset, strategyId, key, visible, revisionKey, revision])
  return { ...(state.key === key ? state : { report: null, loading: visible, error: false }), refresh }
}
