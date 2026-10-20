import { useCallback, useEffect, useRef, useState } from 'react'
import type { MonitorAsset } from '../api/market-monitor'
import { marketMovementApi, movementErrorCodes, type MovementCreate, type MovementError, type MovementReport } from '../api/market-movement-alerts'

/** Reads only on entry/poll; thresholds are armed exclusively by explicit submit. */
export function useMarketMovementAlerts(asset: MonitorAsset, visible: boolean, revisionKey: string) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ asset: MonitorAsset; report: MovementReport | null; loading: boolean; busy: boolean; error: MovementError | null }>({ asset, report: null, loading: visible, busy: false, error: null })
  const selection = useRef({ asset, visible, generation: 0 })
  if (selection.current.asset !== asset || selection.current.visible !== visible) selection.current = { asset, visible, generation: selection.current.generation + 1 }
  const sequence = useRef(0), mutation = useRef<AbortController | null>(null)
  const refresh = useCallback(() => { setState(old => ({ ...old, error: null })); setRevision(n => n + 1) }, [])
  useEffect(() => {
    const controller = new AbortController()
    const generation = selection.current.generation
    let pending = false
    mutation.current?.abort(); mutation.current = null
    if (!visible) { setState({ asset, report: null, loading: false, busy: false, error: null }); return () => controller.abort() }
    const read = async () => {
      if (pending || mutation.current || document.visibilityState === 'hidden') return
      pending = true
      const ticket = ++sequence.current
      setState(old => ({ asset, report: old.asset === asset ? old.report : null, loading: true, busy: false, error: old.asset === asset ? old.error : null }))
      try {
        const report = await marketMovementApi.read(asset, controller.signal)
        if (report.asset !== asset) throw new Error('Selection mismatch')
        if (!controller.signal.aborted && generation === selection.current.generation && ticket === sequence.current) setState(old => ({ asset, report, loading: false, busy: false, error: report.readError ? 'movement-state-unavailable' : old.error === 'read' || old.error === 'movement-state-unavailable' || old.asset !== asset ? null : old.error }))
      } catch {
        if (!controller.signal.aborted && generation === selection.current.generation && ticket === sequence.current) setState(old => ({ asset, report: old.asset === asset ? old.report : null, loading: false, busy: false, error: 'read' }))
      } finally { pending = false }
    }
    void read()
    const timer = window.setInterval(() => void read(), 30_000)
    const resumed = () => void read()
    document.addEventListener('visibilitychange', resumed)
    window.addEventListener('focus', resumed)
    return () => { controller.abort(); mutation.current?.abort(); mutation.current = null; ++sequence.current; window.clearInterval(timer); document.removeEventListener('visibilitychange', resumed); window.removeEventListener('focus', resumed) }
  }, [asset, visible, revisionKey, revision])
  const mutate = async (action: (signal: AbortSignal) => Promise<MovementReport>) => {
    if (!visible || mutation.current) return false
    const controller = new AbortController(), generation = selection.current.generation, ticket = ++sequence.current
    mutation.current = controller
    setState(old => ({ asset, report: old.asset === asset ? old.report : null, loading: false, busy: true, error: null }))
    try {
      const report = await action(controller.signal)
      if (report.asset !== asset) throw new Error('Selection mismatch')
      if (!controller.signal.aborted && generation === selection.current.generation && ticket === sequence.current) setState({ asset, report, loading: false, busy: false, error: report.readError ? 'movement-state-unavailable' : null })
      return !controller.signal.aborted && generation === selection.current.generation
    } catch (error) {
      if (!controller.signal.aborted && generation === selection.current.generation) {
        const message = error instanceof Error ? error.message : ''
        setState(old => ({ ...old, busy: false, error: movementErrorCodes.includes(message as typeof movementErrorCodes[number]) ? message as MovementError : 'request' }))
        // A failed response can still have committed; inspect the saved state
        // before presenting a retry or a conflicting plan as absent.
        if (!movementErrorCodes.includes(message as typeof movementErrorCodes[number]) || message === 'movement-active-plan') {
          try {
            const report = await marketMovementApi.read(asset, controller.signal)
            if (report.asset === asset && !controller.signal.aborted && generation === selection.current.generation) setState(old => ({ ...old, report, error: report.readError ? 'movement-state-unavailable' : old.error }))
          } catch { /* retain the explicit ambiguous-request message */ }
        }
      }
      return false
    } finally { if (mutation.current === controller) mutation.current = null }
  }
  return { ...(state.asset === asset && visible ? state : { report: null, loading: visible, busy: false, error: null }), refresh,
    create: (input: Omit<MovementCreate, 'asset'>) => mutate(signal => marketMovementApi.create({ ...input, asset }, signal)),
    cancel: (id: string) => mutate(signal => marketMovementApi.cancel(asset, id, signal)),
  }
}
