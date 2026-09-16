import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { MonitorReplay } from '../api/market-monitor'

export function useMarketMonitorReplay(scope: string) {
  const generation = useRef(0)
  const [state, setState] = useState<{ scope: string; selected: string | null; result: MonitorReplay | null; error: string | null; loading: boolean }>({ scope, selected: null, result: null, error: null, loading: false })
  useEffect(() => () => { ++generation.current }, [scope])
  const select = useCallback(async (id: string) => {
    const request = ++generation.current
    setState({ scope, selected: id, result: null, error: null, loading: true })
    try {
      const result = await api.marketMonitor.replay(id)
      if (request === generation.current) setState({ scope, selected: id, result, error: null, loading: false })
    } catch (error) {
      if (request === generation.current) setState({ scope, selected: id, result: null, error: error instanceof Error ? error.message : String(error), loading: false })
    }
  }, [scope])
  return { ...(state.scope === scope ? state : { selected: null, result: null, error: null, loading: false }), select }
}
