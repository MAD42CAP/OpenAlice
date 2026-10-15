import { useCallback, useEffect, useRef, useState } from 'react'
import { forecastValidationApi, type ForwardReport } from '../api/forecast-validation'
import type { MonitorAsset } from '../api/market-monitor'

/** Reading this hook never requests a model or reconstructs historical predictions. */
export function useForecastValidation(asset: MonitorAsset, visible: boolean, revisionKey: string) {
  const [revision, setRevision] = useState(0)
  const key = `${asset}:${revisionKey}:${revision}:${visible}`
  const [state, setState] = useState<{ key: string; report: ForwardReport | null; loading: boolean; error: 'read' | 'collect' | null }>({ key, report: null, loading: visible, error: null })
  const [collecting, setCollecting] = useState(false)
  const current = useRef(asset); current.current = asset
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    if (!visible) { setState({ key, report: null, loading: false, error: null }); return () => controller.abort() }
    setState({ key, report: null, loading: true, error: null })
    forecastValidationApi.read(asset, controller.signal).then(report => {
      if (report.asset !== asset || report.protocol !== 'market-forward-v2') throw new Error('Selection mismatch')
      if (!controller.signal.aborted) setState({ key, report, loading: false, error: null })
    }).catch(() => { if (!controller.signal.aborted) setState({ key, report: null, loading: false, error: 'read' }) })
    return () => controller.abort()
  }, [asset, visible, revisionKey, revision, key])
  useEffect(() => {
    if (!visible) return
    const updated = (event: Event) => { if ((event as CustomEvent<{ asset: MonitorAsset }>).detail?.asset === asset) refresh() }
    window.addEventListener('market-forward-updated', updated)
    return () => window.removeEventListener('market-forward-updated', updated)
  }, [asset, visible, refresh])
  const collect = async () => {
    if (collecting) return
    const selected = asset
    setCollecting(true)
    try { await forecastValidationApi.collect(selected); if (mounted.current) window.dispatchEvent(new CustomEvent('market-forward-updated', { detail: { asset: selected } })) }
    catch { if (mounted.current && current.current === selected) setState(old => ({ ...old, error: 'collect' })) }
    finally { if (mounted.current) setCollecting(false) }
  }
  return { ...(state.key === key ? state : { report: null, loading: visible, error: null }), collecting, refresh, collect }
}
