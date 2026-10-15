import { useCallback, useEffect, useRef, useState } from 'react'
import type { MonitorAsset } from '../api/market-monitor'
import { marketIntelligenceApi, type MarketIntelligenceReport, type ResearchImport } from '../api/market-intelligence'

export type IntelligenceAction = 'discover' | 'import' | 'run'
export type IntelligenceFeedback = { action: IntelligenceAction; state: 'running' | 'success' | 'partial' | 'failed'; error?: string }

export function useMarketIntelligence(asset: MonitorAsset, visible: boolean, revisionKey: string) {
  const enabled = asset === 'BTC' && visible
  const [report, setReport] = useState<MarketIntelligenceReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<IntelligenceFeedback | null>(null)
  const [revision, setRevision] = useState(0)
  const selection = useRef(asset)
  selection.current = asset
  const actionPending = useRef(false)
  const requestVersion = useRef(0)
  const jobRunning = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let pending = false
    let loadedAt = 0
    const load = async () => {
      if (pending) return
      pending = true
      const request = ++requestVersion.current
      setLoading(true)
      try {
        const next = await marketIntelligenceApi.read(controller.signal)
        if (next.asset !== 'BTC') throw new Error('Unexpected research asset')
        if (!controller.signal.aborted && request === requestVersion.current) {
          setReport(next); setError(null)
          jobRunning.current = next.job.state === 'queued' || next.job.state === 'running'
        }
      } catch (cause) {
        if (!controller.signal.aborted && request === requestVersion.current) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        pending = false
        loadedAt = Date.now()
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    const poll = () => { if (document.visibilityState === 'visible' && Date.now() - loadedAt >= (jobRunning.current ? 5_000 : 30_000)) void load() }
    const timer = window.setInterval(poll, 5_000)
    document.addEventListener('visibilitychange', poll)
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', poll) }
  }, [enabled, revisionKey, revision])

  const perform = useCallback(async (action: IntelligenceAction, input?: ResearchImport, force = false) => {
    if (selection.current !== 'BTC' || actionPending.current) return false
    actionPending.current = true
    setFeedback({ action, state: 'running' })
    const current = () => mounted.current && selection.current === 'BTC'
    try {
      if (action === 'discover') await marketIntelligenceApi.discover(force)
      else if (action === 'import' && input) await marketIntelligenceApi.importReport(input)
      else if (action === 'run') await marketIntelligenceApi.run(force)
      if (!current()) return false
      const request = ++requestVersion.current
      try {
        const next = await marketIntelligenceApi.read()
        if (next.asset !== 'BTC') throw new Error('Unexpected research asset')
        if (!current()) return false
        if (request === requestVersion.current) {
          setReport(next); setError(null)
          jobRunning.current = next.job.state === 'queued' || next.job.state === 'running'
        }
        setFeedback({ action, state: next.job.state === 'failed' || next.job.state === 'blocked' || next.job.state === 'partial' ? 'partial' : 'success' })
      } catch (cause) {
        if (current()) { if (request === requestVersion.current) setError(cause instanceof Error ? cause.message : String(cause)); setFeedback({ action, state: 'partial' }) }
      }
      return true
    } catch (cause) {
      if (current()) setFeedback({ action, state: 'failed', error: cause instanceof Error ? cause.message : String(cause) })
      return false
    } finally { actionPending.current = false }
  }, [])
  return { report: asset === 'BTC' ? report : null, loading: enabled && loading, error: asset === 'BTC' ? error : null, feedback: asset === 'BTC' ? feedback : null, refresh, perform }
}
