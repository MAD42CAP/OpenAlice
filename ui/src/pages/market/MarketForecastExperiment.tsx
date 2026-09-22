import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { forecastExperimentApi, type ExperimentReport } from '../../api/forecast-experiment'
import type { MonitorAsset } from '../../api/market-monitor'
import { Button } from '../../components/ui/button'
import { monitorWyckoffCondition } from './market-monitor-presentation'

export function MarketForecastExperiment({ asset, visible, revisionKey }: { asset: MonitorAsset; visible: boolean; revisionKey: string }) {
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false)
  const [state, setState] = useState<{ asset: MonitorAsset; report: ExperimentReport | null; error: boolean }>({ asset, report: null, error: false })
  const current = useRef(asset); current.current = asset
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    forecastExperimentApi.read(asset, controller.signal).then(report => {
      if (report.asset !== asset) throw new Error('Asset mismatch')
      if (!controller.signal.aborted) setState({ asset, report, error: false })
    }).catch(() => { if (!controller.signal.aborted) setState({ asset, report: null, error: true }) })
    return () => controller.abort()
  }, [asset, visible, revisionKey, revision])
  const collect = async () => {
    if (busy) return
    const selected = asset
    setBusy(true)
    try { await forecastExperimentApi.collect(selected) }
    catch { if (mounted.current && current.current === selected) setState(s => ({ ...s, error: true })) }
    finally { if (mounted.current) { setBusy(false); if (current.current === selected) setRevision(n => n + 1) } }
  }
  return <ForecastExperimentView asset={asset} report={state.asset === asset ? state.report : null} error={state.asset === asset && state.error} busy={busy} collect={collect} refresh={() => setRevision(n => n + 1)} />
}
const horizons = ['short', 'medium', 'long'] as const
const methods = ['original', 'challenger', 'rules', 'combined', 'frequency', 'alwaysUp'] as const
const percent = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`

export function ForecastExperimentView({ asset, report, error, busy, collect, refresh }: { asset: MonitorAsset; report: ExperimentReport | null; error: boolean; busy: boolean; collect: () => void; refresh: () => void }) {
  const { t } = useTranslation()
  const latest = report?.latest, lastRow = report?.rows.at(-1)
  return <section aria-label={`${asset} · ${t('typesafe.experimentTitle')}`} className="rounded-xl border border-border bg-card p-4 md:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{t('typesafe.experimentTitle')}</h2><div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={refresh}>{t('typesafe.refresh')}</Button>
      {report?.configured && <Button size="sm" disabled={busy} onClick={collect}>{t(busy ? 'typesafe.busy' : 'typesafe.experimentCollect')}</Button>}
    </div></div>
    <p className="mt-2 text-xs text-muted-foreground">{t('typesafe.experimentHint')}</p>
    {report?.illustrative && <p className="mt-2 text-xs text-warning">{t('typesafe.demo')}</p>}
    {(error || report?.lastError) && <p role="alert" className="mt-2 text-sm text-warning">{report?.lastError ?? t('typesafe.loadError')}</p>}
    {report && <p className="mt-3 text-sm">{t('typesafe.experimentCount', { count: report.rows.length })}</p>}
    {!latest && <p className="mt-2 text-xs text-muted-foreground">{t('typesafe.experimentEmpty')}</p>}
    {latest && <>
      <p className="mt-2 text-xs text-muted-foreground">{t('typesafe.issued', { time: new Date(latest.publication.issuedAt).toLocaleString() })} · {t('typesafe.experimentFrozen')}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t('typesafe.evidence', { time: new Date(latest.publication.original.basis.capturedAt).toLocaleString() })} · {t('typesafe.experimentBasisHint')}</p>
      {!latest.candidate && <p className="mt-2 text-xs text-warning">{t('typesafe.experimentIncomplete')}</p>}
      <div className="mt-3 grid gap-3 md:grid-cols-3">{horizons.map(h => {
        const outcome = lastRow?.outcomes.find(o => o.horizon === h)
        return <div key={h} className="min-w-0 rounded-lg bg-muted/30 p-3 text-sm"><h3 className="font-medium">{t(`typesafe.${h}`)} · {t('typesafe.sessions', { count: latest.publication.original.horizons[h].bars })}</h3>
          <p className="mt-2">{t('typesafe.methodOriginal')} · {outcome?.choices.original ? t(`typesafe.${outcome.choices.original}`) : t('typesafe.insufficient')}</p>
          <p className="mt-1">{t('typesafe.methodChallenger')} · {outcome?.choices.challenger ? t(`typesafe.${outcome.choices.challenger}`) : t('typesafe.insufficient')}</p>
          <p className="mt-1">{t('typesafe.methodCombined')} · {t(`judgment.${latest.publication.combined.horizons[h].direction}`)}</p>
          <p className="mt-2 text-xs text-muted-foreground">{t('typesafe.outcome')} · {outcome?.actual ? `${outcome.outcome.changePercent?.toFixed(2)}%` : t(`typesafe.${outcome?.outcome.status ?? 'pending'}`)}</p>
        </div>
      })}</div>
    </>}
    {report && <details className="mt-4 border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium">{t('typesafe.experimentDetails')}</summary>
      <p className="mt-3 text-xs text-muted-foreground">{t('typesafe.experimentScoring')}</p>
      {report.invalidRecords > 0 && <p className="mt-2 text-xs text-warning">{t('typesafe.invalid', { count: report.invalidRecords })}</p>}
      {report.historyTruncated && <p className="mt-2 text-xs text-warning">{t('typesafe.truncated')}</p>}
      {report.summaries.map(s => <div key={s.horizon} className="mt-4"><h3 className="text-sm font-semibold">{t(`typesafe.${s.horizon}`)}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('typesafe.experimentCoverage', s)}</p>
        <p className="mt-2 text-sm">{t('typesafe.experimentPaired', s.paired)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('typesafe.experimentBrier', { original: s.paired.originalBrier?.toFixed(3) ?? '—', challenger: s.paired.challengerBrier?.toFixed(3) ?? '—', frequency: s.paired.frequencyBrier?.toFixed(3) ?? '—' })}</p>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[300px] text-left text-xs"><thead><tr><th className="py-2">{t('typesafe.experimentMethod')}</th><th>{t('typesafe.experimentScore')}</th></tr></thead><tbody>{methods.map(m => <tr className="border-t border-border" key={m}><td className="py-2">{t(`typesafe.method${m[0]!.toUpperCase()}${m.slice(1)}` as 'typesafe.methodOriginal')}</td><td>{s.methods[m].scored ? `${s.methods[m].correct} / ${s.methods[m].scored}` : '—'}</td></tr>)}</tbody></table></div>
      </div>)}
      {latest?.candidate && <>
        <h3 className="mt-5 text-sm font-semibold">{t('typesafe.experimentHistory')}</h3>
        <p className="mt-2 text-xs text-muted-foreground">{t('typesafe.experimentHistoryHint')}</p>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[450px] text-left text-xs"><thead><tr><th className="py-2">{t('typesafe.experimentWindow')}</th><th>{t('typesafe.count')}</th><th>{t('typesafe.experimentFrequency')}</th><th>{t('typesafe.experimentVolatility')}</th></tr></thead><tbody>{horizons.map(h => { const history = latest.candidate!.history[h]; return <tr className="border-t border-border" key={h}><td className="py-2">{t(`typesafe.${h}`)}</td><td>{history.samples}</td><td>{(['up', 'flat', 'down'] as const).map(c => percent(history.probabilities?.[c])).join(' / ')}</td><td>{history.volatilityPercent?.toFixed(2) ?? '—'}%</td></tr> })}</tbody></table></div>
        <h3 className="mt-4 text-sm font-semibold">{t('typesafe.experimentChecks')}</h3><p className="mt-2 text-xs text-muted-foreground">{t('typesafe.experimentChecksHint')}</p>
        <ul className="mt-2 space-y-2 text-xs">{(['breakout', 'hold', 'participation'] as const).map(id => <li key={id}>{t(`typesafe.check${id}`)} · {t(`typesafe.checkResult_${latest.candidate!.result.answers[id]?.choice}` as 'typesafe.checkResult_up')}</li>)}</ul>
      </>}
      {latest && <div className="mt-4 text-xs text-muted-foreground"><p>{t('typesafe.experimentRange', { lower: latest.publication.combined.structure.lower?.toLocaleString() ?? '—', upper: latest.publication.combined.structure.upper?.toLocaleString() ?? '—' })}</p>
        <p className="mt-2">{t('judgment.confirm')} · {latest.publication.combined.structure.confirmation.map(c => monitorWyckoffCondition(t, c)).join(' ') || '—'}</p>
        <p className="mt-2">{t('judgment.invalidate')} · {latest.publication.combined.structure.invalidation.map(c => monitorWyckoffCondition(t, c)).join(' ') || '—'}</p></div>}
      {report.rows.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[500px] text-left text-xs"><caption className="mb-2 text-left">{t('typesafe.history')}</caption><thead><tr><th>{t('typesafe.issued', { time: '' })}</th>{horizons.map(h => <th className="p-2" key={h}>{t(`typesafe.${h}`)}</th>)}</tr></thead><tbody>{report.rows.slice().reverse().map(row => <tr className="border-t border-border" key={row.id}><td className="py-2">{new Date(row.issuedAt).toLocaleString()}{row.providerChanged && <p className="text-warning">{t('typesafe.providerChanged')}</p>}</td>{row.outcomes.map(o => <td className="p-2" key={o.horizon}>{(['original', 'challenger', 'combined'] as const).map(m => <p key={m}>{t(m === 'original' ? 'typesafe.methodOriginal' : m === 'challenger' ? 'typesafe.methodChallenger' : 'typesafe.methodCombined')} · {o.choices[m] ? t(`typesafe.${o.choices[m]}`) : t('typesafe.insufficient')}</p>)}<p className="mt-1 text-muted-foreground">{t('typesafe.outcome')} · {o.actual ? `${o.outcome.changePercent?.toFixed(2)}%` : t(`typesafe.${o.outcome.status}`)}</p></td>)}</tr>)}</tbody></table></div>}
    </details>}
  </section>
}
