import { useCallback, useEffect, useState } from 'react'
import type { MonitorAsset } from '../api/market-monitor'
import { typeSafeApi, type JevReport } from '../api/typesafe'
import { forecastExperimentApi, type ExperimentReport } from '../api/forecast-experiment'

type AccuracyRead = {
  key: string
  jevReport: JevReport | null
  experimentReport: ExperimentReport | null
  loading: boolean
  error: boolean
}

/** Reads existing archives only; refreshing never requests a model forecast. */
export function useMarketAccuracySummary(asset: MonitorAsset, visible: boolean, revisionKey: string) {
  const [revision, setRevision] = useState(0)
  const key = `${asset}:${revisionKey}:${revision}:${visible}`
  const [state, setState] = useState<AccuracyRead>({ key, jevReport: null, experimentReport: null, loading: visible, error: false })
  const refresh = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    if (!visible) {
      setState({ key, jevReport: null, experimentReport: null, loading: false, error: false })
      return
    }
    const controller = new AbortController()
    setState({ key, jevReport: null, experimentReport: null, loading: true, error: false })
    const load = async () => {
      const [jev, experiment] = await Promise.allSettled([
        typeSafeApi.report(asset, controller.signal),
        forecastExperimentApi.read(asset, controller.signal),
      ])
      if (controller.signal.aborted) return
      const jevReport = jev.status === 'fulfilled' && jev.value.asset === asset ? jev.value : null
      const experimentReport = experiment.status === 'fulfilled' && experiment.value.asset === asset ? experiment.value : null
      setState({ key, jevReport, experimentReport, loading: false, error: jevReport === null || experimentReport === null })
    }
    void load()
    return () => controller.abort()
  }, [asset, visible, revisionKey, revision, key])

  const selected = state.key === key ? state : { jevReport: null, experimentReport: null, loading: visible, error: false }
  return { jevReport: selected.jevReport, experimentReport: selected.experimentReport, loading: selected.loading, error: selected.error, refresh }
}
