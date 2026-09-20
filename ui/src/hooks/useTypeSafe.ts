import { useCallback, useEffect, useRef, useState } from 'react'
import { typeSafeApi, type TypeSafeSettings, type JevReport } from '../api/typesafe'
import type { MonitorAsset } from '../api/market-monitor'

export function useTypeSafeSettings() {
  const [settings, setSettings] = useState<TypeSafeSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    typeSafeApi.settings(controller.signal).then(value => { if (!controller.signal.aborted) setSettings(value) }, () => { if (!controller.signal.aborted) setError('load') })
    return () => controller.abort()
  }, [])
  const save = async (input: Parameters<typeof typeSafeApi.save>[0]) => {
    setBusy(true); setError(null)
    try { const result = await typeSafeApi.save(input); setSettings(result); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'save'); return false }
    finally { setBusy(false) }
  }
  const test = async () => {
    setBusy(true); setError(null)
    try { const result = await typeSafeApi.test(); return result.illustrative ? 'demo' as const : 'live' as const }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'test'); return null }
    finally { setBusy(false) }
  }
  return { settings, error, busy, save, test }
}

export function useTypeSafeReport(asset: MonitorAsset, visible: boolean, revisionKey: string) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ asset: MonitorAsset; report: JevReport | null; loading: boolean; error: string | null }>({ asset, report: null, loading: true, error: null })
  const [generating, setGenerating] = useState<MonitorAsset | null>(null)
  const current = useRef(asset); current.current = asset
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const refresh = useCallback(() => setRevision(n => n + 1), [])
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    setState(old => ({ asset, report: old.asset === asset ? old.report : null, loading: true, error: null }))
    typeSafeApi.report(asset, controller.signal).then(report => {
      if (report.asset !== asset) throw new Error('Asset mismatch')
      if (!controller.signal.aborted) setState({ asset, report, loading: false, error: null })
    }).catch(() => { if (!controller.signal.aborted) setState(old => ({ ...old, loading: false, error: 'load' })) })
    return () => controller.abort()
  }, [asset, visible, revisionKey, revision])
  const generate = async () => {
    if (generating) return
    const selected = asset
    setGenerating(selected)
    try { await typeSafeApi.generate(selected); if (mounted.current && current.current === selected) refresh() }
    catch (cause) { if (mounted.current && current.current === selected) setState(old => ({ ...old, error: cause instanceof Error ? cause.message : 'generate' })) }
    finally { if (mounted.current) setGenerating(null) }
  }
  return { ...(state.asset === asset ? state : { asset, report: null, loading: visible, error: null }), generating: generating !== null, refresh, generate }
}

export function useTypeSafeAudit() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof typeSafeApi.audit>> | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const run = async (input: Parameters<typeof typeSafeApi.audit>[0]) => {
    setBusy(true); setError(null); setResult(null)
    try { setResult(await typeSafeApi.audit(input)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'audit') }
    finally { setBusy(false) }
  }
  return { result, busy, error, run }
}
