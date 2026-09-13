import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { MonitorSchedulerStatus } from '../api/market-monitor'

/** Poll runtime facts, never dispatch scans from a browser timer. */
export function useMarketMonitorStatus(visible: boolean) {
  const [status, setStatus] = useState<MonitorSchedulerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const next = await api.marketMonitor.status()
      if (request !== generation.current) return
      setStatus(next)
      setError(null)
    } catch (cause) {
      if (request !== generation.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    const poll = () => { if (document.visibilityState === 'visible') void refresh() }
    void refresh()
    const timer = window.setInterval(poll, 15_000)
    document.addEventListener('visibilitychange', poll)
    return () => {
      ++generation.current
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [refresh, visible])

  return { status, error, refresh }
}
