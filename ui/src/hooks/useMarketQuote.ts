import { useCallback, useEffect, useState } from 'react'
import { marketQuoteApi, type MarketQuote } from '../api/market-quote'
import type { MonitorAsset } from '../api/market-monitor'

export function useMarketQuote(asset: MonitorAsset, visible: boolean) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ asset: MonitorAsset; quote: MarketQuote | null; loading: boolean; failed: boolean; attempts: MarketQuote['attempts'] }>({ asset, quote: null, loading: visible, failed: false, attempts: [] })
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    let pending = false
    const read = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      setState(old => ({ asset, quote: old.asset === asset ? old.quote : null, attempts: [], loading: true, failed: old.asset === asset && old.failed }))
      try {
        const quote = await marketQuoteApi.read(asset, AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]))
        if (quote.asset !== asset) throw new Error('Quote asset mismatch')
        if (!controller.signal.aborted) setState(old => ({ asset, quote: quote.price == null && old.asset === asset ? old.quote : quote, loading: false, failed: quote.price == null, attempts: quote.attempts }))
      } catch {
        if (!controller.signal.aborted) setState(old => ({ ...old, loading: false, failed: true }))
      } finally { pending = false }
    }
    void read()
    const refreshVisible = () => { if (!controller.signal.aborted) void read() }
    const timer = window.setInterval(refreshVisible, 30_000)
    window.addEventListener('focus', refreshVisible)
    window.addEventListener('online', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', refreshVisible); window.removeEventListener('online', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible) }
  }, [asset, visible, revision])
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  return { ...(state.asset === asset ? state : { asset, quote: null, loading: visible, failed: false, attempts: [] }), refresh }
}
