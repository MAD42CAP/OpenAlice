import { useCallback, useEffect, useRef, useState } from 'react'
import { marketThesisApi } from '../api/market-thesis'
import type { MonitorAsset } from '../api/market-monitor'
import type { ThesisDraft, ThesisReport } from '../api/market-thesis-types'

export function useMarketThesis(asset: MonitorAsset, visible: boolean, revisionKey: string) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [state, setState] = useState<{ asset: MonitorAsset; report: ThesisReport | null; loading: boolean; busy: boolean; error: string | null }>({ asset, report: null, loading: true, busy: false, error: null })
  const selection = useRef(asset), sequence = useRef(0), mutation = useRef(false)
  selection.current = asset
  const refresh = useCallback(() => { setState(old => ({ ...old, error: null })); setRefreshKey(n => n + 1) }, [])
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    let pending = false
    const load = async () => {
      if (pending || mutation.current) return
      pending = true
      const ticket = ++sequence.current
      setState(old => ({ asset, report: old.asset === asset ? old.report : null, loading: true, busy: false, error: old.asset === asset ? old.error : null }))
      try {
        const report = await marketThesisApi.read(asset, controller.signal)
        if (report.asset !== asset) throw new Error('thesis-unavailable')
        if (!controller.signal.aborted && ticket === sequence.current) setState(old => ({ asset, report, loading: false, busy: false,
          error: old.asset === asset && ['thesis-conflict', 'thesis-invalid'].includes(old.error ?? '') ? old.error : null }))
      } catch {
        if (!controller.signal.aborted && ticket === sequence.current) setState(old => ({ ...old, loading: false, error: 'thesis-unavailable' }))
      } finally { pending = false }
    }
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000)
    return () => { controller.abort(); window.clearInterval(timer); ++sequence.current }
  }, [asset, visible, revisionKey, refreshKey])
  const mutate = async (action: () => Promise<ThesisReport>) => {
    if (mutation.current) return false
    mutation.current = true
    const ticket = ++sequence.current
    setState(old => ({ ...old, busy: true, error: null }))
    try {
      const report = await action()
      if (report.asset !== asset) throw new Error('thesis-unavailable')
      if (selection.current === asset && ticket === sequence.current) setState({ asset, report, busy: false, loading: false, error: null })
      return true
    } catch (error) {
      if (selection.current === asset) setState(old => ({ ...old, busy: false, error: error instanceof Error && ['thesis-conflict', 'thesis-invalid'].includes(error.message) ? error.message : 'thesis-unavailable' }))
      return false
    } finally { mutation.current = false; if (selection.current !== asset || ticket !== sequence.current) refresh() }
  }
  return { ...(state.asset === asset ? state : { report: null, loading: visible, busy: mutation.current, error: null }), refresh,
    save: (expected: number, draft: ThesisDraft) => mutate(() => marketThesisApi.save(asset, expected, draft)),
    check: () => mutate(() => marketThesisApi.check(asset)),
  }
}
