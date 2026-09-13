import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { MonitorAsset, MonitorHealthReport } from '../api/market-monitor'

export function useMarketMonitorHealth(asset: MonitorAsset, hours: 24 | 72, visible: boolean, receiptId?: string) {
  const key = `${asset}:${hours}`
  const [state, setState] = useState<{ key: string; report: MonitorHealthReport | null; error: string | null; loading: boolean }>({ key, report: null, error: null, loading: true })
  const generation = useRef(0)
  const pending = useRef(false)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    pending.current = true
    setState((previous) => ({ key, report: previous.key === key ? previous.report : null, error: null, loading: true }))
    try {
      const report = await api.marketMonitor.health(asset, hours)
      if (request !== generation.current) return
      setState({ key, report, error: null, loading: false })
    } catch (cause) {
      if (request !== generation.current) return
      setState((previous) => ({ ...previous, error: cause instanceof Error ? cause.message : String(cause), loading: false }))
    } finally {
      if (request === generation.current) pending.current = false
    }
  }, [asset, hours, key])

  useEffect(() => {
    if (!visible) return
    const poll = () => { if (document.visibilityState === 'visible' && !pending.current) void refresh() }
    void refresh()
    const timer = window.setInterval(poll, 30_000)
    document.addEventListener('visibilitychange', poll)
    return () => {
      ++generation.current
      pending.current = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [refresh, visible, receiptId])

  return { ...(state.key === key ? state : { report: null, error: null, loading: true }), refresh }
}
