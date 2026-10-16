import { useCallback, useEffect, useRef, useState } from 'react'
import type { MonitorAsset } from '../api/market-monitor'
import { marketIntelligenceApi, type MarketIntelligenceReport, type ResearchImport } from '../api/market-intelligence'

export type IntelligenceAction = 'discover' | 'import' | 'run'
export type IntelligenceFeedback = { action: IntelligenceAction; state: 'running' | 'success' | 'partial' | 'failed'; error?: string }
const valid = (report: MarketIntelligenceReport, asset: MonitorAsset) => report.asset === asset && (!report.market || report.market.asset === asset) && report.investment.history.every(row => row.asset === asset) && (!report.investment.latest || report.investment.latest.asset === asset)

export function useMarketIntelligence(asset: MonitorAsset, visible: boolean, revisionKey: string) {
  const key = `${asset}:${visible}:${revisionKey}`
  const [state, setState] = useState<{ key: string; report: MarketIntelligenceReport | null; loading: boolean; error: string | null; feedback: IntelligenceFeedback | null }>({ key, report: null, loading: visible, error: null, feedback: null })
  const [revision, setRevision] = useState(0)
  const selection = useRef(key); selection.current = key
  const actionPending = useRef<{ key: string } | null>(null)
  const requestVersion = useRef(0)
  const jobRunning = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    let loadedAt = 0
    ++requestVersion.current
    jobRunning.current = false
    setState(previous => previous.key === key ? { ...previous, loading: visible } : { key, report: null, loading: visible, error: null, feedback: null })
    if (!visible) return () => controller.abort()
    const load = async () => {
      if (pending) return
      pending = true
      const request = ++requestVersion.current
      setState(previous => previous.key === key ? { ...previous, loading: true } : previous)
      try {
        const next = await marketIntelligenceApi.read(asset, controller.signal)
        if (!valid(next, asset)) throw new Error('Unexpected research asset')
        if (!controller.signal.aborted && request === requestVersion.current && selection.current === key) {
          setState(previous => ({ ...previous, key, report: next, loading: false, error: null }))
          jobRunning.current = next.job.state === 'queued' || next.job.state === 'running'
        }
      } catch (cause) {
        if (!controller.signal.aborted && request === requestVersion.current && selection.current === key) setState(previous => ({ ...previous, loading: false, error: cause instanceof Error ? cause.message : String(cause) }))
      } finally {
        pending = false
        loadedAt = Date.now()
      }
    }
    void load()
    const poll = () => { if (document.visibilityState === 'visible' && Date.now() - loadedAt >= (jobRunning.current ? 5_000 : 30_000)) void load() }
    const timer = window.setInterval(poll, 5_000)
    document.addEventListener('visibilitychange', poll)
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', poll) }
  }, [asset, visible, key, revision])

  const perform = useCallback(async (action: IntelligenceAction, input?: ResearchImport, force = false) => {
    if (!visible || selection.current !== key || actionPending.current?.key === key || (asset !== 'BTC' && action !== 'run')) return false
    const pending = { key }; actionPending.current = pending
    const current = () => mounted.current && selection.current === key
    setState(previous => ({ ...previous, feedback: { action, state: 'running' } }))
    try {
      if (action === 'discover') await marketIntelligenceApi.discover(force)
      else if (action === 'import' && input) await marketIntelligenceApi.importReport(input)
      else if (action === 'run') await marketIntelligenceApi.run(asset, force)
      if (!current()) return false
      const request = ++requestVersion.current
      try {
        const next = await marketIntelligenceApi.read(asset)
        if (!valid(next, asset)) throw new Error('Unexpected research asset')
        if (!current()) return false
        if (request === requestVersion.current) {
          setState(previous => ({ ...previous, report: next, error: null }))
          jobRunning.current = next.job.state === 'queued' || next.job.state === 'running'
        }
        setState(previous => ({ ...previous, feedback: { action, state: next.job.state === 'failed' || next.job.state === 'blocked' || next.job.state === 'partial' ? 'partial' : 'success' } }))
      } catch (cause) {
        if (current()) setState(previous => ({ ...previous, ...(request === requestVersion.current ? { error: cause instanceof Error ? cause.message : String(cause) } : {}), feedback: { action, state: 'partial' } }))
      }
      return true
    } catch (cause) {
      if (current()) setState(previous => ({ ...previous, feedback: { action, state: 'failed', error: cause instanceof Error ? cause.message : String(cause) } }))
      return false
    } finally { if (actionPending.current === pending) actionPending.current = null }
  }, [asset, visible, key])
  return { ...(state.key === key ? state : { report: null, loading: visible, error: null, feedback: null }), refresh, perform }
}
