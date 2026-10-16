import { useCallback, useEffect, useRef, useState } from 'react'
import type { MonitorAsset } from '../api/market-monitor'
import { researchLoopApi, type ResearchLoopReport } from '../api/research-loop'
import { researchLoopProtocol } from '../api/research-loop-types'

const valid = (report: ResearchLoopReport, asset: MonitorAsset) => report.asset === asset && report.protocol === researchLoopProtocol(asset) && (report.context.asset === undefined ? asset === 'BTC' : report.context.asset === asset) && report.context.protocol === report.protocol && report.context.evidence.every(row => row.asset === asset)
const active = (report: ResearchLoopReport) => report.contributors.some(row => row.state === 'running')

/** Merely viewing the monitor never starts a native research task. */
export function useResearchLoop(asset: MonitorAsset, visible: boolean, revisionKey: string) {
  const enabled = visible
  const key = `${asset}:${visible}:${revisionKey}`
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ key: string; report: ResearchLoopReport | null; loading: boolean; error: 'read' | 'run' | null }>({ key, report: null, loading: enabled, error: null })
  const [runningKey, setRunningKey] = useState<string | null>(null)
  const currentKey = useRef(key); currentKey.current = key
  const readGeneration = useRef(0)
  const runController = useRef<AbortController | null>(null)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => () => { runController.current?.abort(); runController.current = null }, [key])
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setState({ key, report: null, loading: enabled, error: null })
    if (!enabled) return () => controller.abort()
    const read = async () => {
      const generation = ++readGeneration.current
      let interval = 30_000
      try {
        const report = await researchLoopApi.read(asset, controller.signal)
        if (!valid(report, asset)) throw new Error('Selection mismatch')
        if (controller.signal.aborted) return
        if (generation === readGeneration.current) setState({ key, report, loading: false, error: null })
        if (active(report)) interval = 5_000
      } catch {
        if (controller.signal.aborted) return
        // A failed refresh cannot leave an old success labelled current.
        if (generation === readGeneration.current) setState({ key, report: null, loading: false, error: 'read' })
      }
      if (!controller.signal.aborted) timer = setTimeout(() => { void read() }, interval)
    }
    void read()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [enabled, key, revision])
  const run = async () => {
    if (!enabled || runController.current) return
    const selected = key
    const controller = new AbortController()
    runController.current = controller
    ++readGeneration.current
    setRunningKey(selected)
    try {
      const report = await researchLoopApi.run(asset, controller.signal)
      if (!valid(report, asset)) throw new Error('Selection mismatch')
      if (!controller.signal.aborted && currentKey.current === selected) { setState({ key: selected, report, loading: false, error: null }); refresh() }
    } catch {
      if (!controller.signal.aborted && currentKey.current === selected) setState({ key: selected, report: null, loading: false, error: 'run' })
    } finally {
      if (runController.current === controller) runController.current = null
      if (currentKey.current === selected) setRunningKey(null)
    }
  }
  return { ...(state.key === key ? state : { report: null, loading: enabled, error: null }), running: runningKey === key, refresh, run }
}
