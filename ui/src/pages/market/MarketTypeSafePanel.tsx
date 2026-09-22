import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MonitorAsset } from '../../api/market-monitor'
import type { JevReport } from '../../api/typesafe'
import { useTypeSafeAudit, useTypeSafeReport } from '../../hooks/useTypeSafe'
import { Button } from '../../components/ui/button'
import { inputClass } from '../../components/form'
import { useWorkspace } from '../../tabs/store'

const horizons = ['short', 'medium', 'long'] as const
const directions = ['up', 'flat', 'down'] as const
const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`
const colors = { up: 'bg-success', flat: 'bg-muted-foreground', down: 'bg-destructive' }
export function MarketTypeSafePanel({ asset, visible, revisionKey }: { asset: MonitorAsset; visible: boolean; revisionKey: string }) {
  const model = useTypeSafeReport(asset, visible, revisionKey)
  return <TypeSafeForecastView {...model} asset={asset} />
}
export function TypeSafeForecastView({ asset, report, error, loading, generating, refresh, generate }: {
  asset: MonitorAsset; report: JevReport | null; error: string | null; loading: boolean; generating: boolean; refresh: () => void; generate: () => void
}) {
  const { t } = useTranslation()
  const openOrFocus = useWorkspace(s => s.openOrFocus)
  const latest = report?.rows.at(-1)
  return <section className="rounded-xl border border-border bg-card p-4 md:p-5" aria-labelledby="jev-forecast-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="jev-forecast-title" className="font-semibold">{asset} · {t('typesafe.forecastTitle')}</h2><p className="mt-1 text-xs text-muted-foreground">{report?.model ?? 'Jev'}{report?.illustrative ? ` · ${t('typesafe.demo')}` : ''}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={loading} onClick={refresh}>{t('typesafe.refresh')}</Button>
        {report?.configured ? <Button size="sm" disabled={generating} onClick={generate}>{t(generating ? 'typesafe.busy' : 'typesafe.generate')}</Button>
          : <Button size="sm" variant="outline" onClick={() => openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })}>{t('typesafe.settingsLink')}</Button>}
      </div>
    </div>
    <p className="mt-3 text-sm text-muted-foreground">{t('typesafe.disclaimer')}</p>
    <p className="mt-2 text-xs text-muted-foreground">{t('typesafe.timing')}</p>
    {report && <p className="mt-2 text-xs text-muted-foreground">{t('typesafe.cadence', { state: t(report.automatic ? 'typesafe.on' : 'typesafe.off') })}</p>}
    {report && <div aria-label={t('typesafe.scoreboard')} className="mt-3 space-y-1 border-l-2 border-border pl-3 text-xs">
      <p className="font-medium">{t('typesafe.scoreboard')}</p>
      {report.summaries.map(s => <p key={s.horizon}>{t(`typesafe.${s.horizon}`)} · {t(s.scored ? 'typesafe.scoreline' : 'typesafe.unscoredLine', s)}</p>)}
      <p className="text-muted-foreground">{t('typesafe.scoreCaution')}</p>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error === 'load' ? t('typesafe.loadError') : error}</p>}
    {report?.lastError && !error && <p role="alert" className="mt-3 text-sm text-destructive">{report.lastError}</p>}
    {!latest && <p role="status" className="py-5 text-sm text-muted-foreground">{t(loading ? 'typesafe.busy' : 'typesafe.empty')}</p>}
    {latest && <>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{t('typesafe.issued', { time: new Date(latest.forecast.issuedAt).toLocaleString() })}</span><span>{t('typesafe.evidence', { time: new Date(latest.forecast.basis.capturedAt).toLocaleString() })}</span></div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {horizons.map(h => { const forecast = latest.forecast.horizons[h]; const choice = forecast.adequacy.choice === 'adequate' && directions.includes(forecast.answer.choice as typeof directions[number]) ? forecast.answer.choice as typeof directions[number] : 'insufficient'; return <div key={h} className="min-w-0 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">{t(`typesafe.${h}`)} <span className="font-normal text-muted-foreground">· {t('typesafe.sessions', { count: forecast.bars })}</span></h3>
          <p className="mt-2 text-sm font-medium">{t('typesafe.selected', { choice: t(`typesafe.${choice}`) })}</p>
          {choice === 'insufficient' && <p className="mt-2 text-xs text-warning">{t('typesafe.abstentionHint')}</p>}
          <div className="mt-4 space-y-3">{directions.map(d => <div key={d}><div className="mb-1 flex justify-between text-xs"><span>{t(`typesafe.${d}`)}</span><span className="tabular-nums">{percent(forecast.answer.probabilities[d]!)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className={`h-full rounded-full ${colors[d]}`} style={{ width: `${forecast.answer.probabilities[d]! * 100}%` }} /></div></div>)}</div>
          <p className="mt-4 text-xs text-muted-foreground">{t('typesafe.baseline', { value: t(`typesafe.${forecast.baseline}`) })}</p>
        </div> })}
      </div>
      <TypeSafeEvidence state={latest.forecast.state} />
    </>}
    {report && <TypeSafeReview report={report} />}
    {report?.configured && <TypeSafeAuditPanel key={asset} />}
  </section>
}
function TypeSafeReview({ report }: { report: JevReport }) {
  const { t } = useTranslation()
  return <details className="mt-5 border-t border-border pt-4">
    <summary className="cursor-pointer text-sm font-medium">{t('typesafe.retrospective')}</summary>
    <p className="mt-3 text-xs text-muted-foreground">{t('typesafe.sampleWarning')}</p>
    <p className="mt-2 text-xs text-muted-foreground">{t('typesafe.cohortMethod')} {t('typesafe.pairedHint')}</p>
    {report.invalidRecords > 0 && <p className="mt-2 text-xs text-destructive">{t('typesafe.invalid', { count: report.invalidRecords })}</p>}
    {report.historyTruncated && <p className="mt-2 text-xs text-muted-foreground">{t('typesafe.truncated')}</p>}
    <div className="mt-3 grid gap-3 md:grid-cols-3">{report.summaries.map(s => <div key={s.horizon} className="rounded-lg bg-muted/30 p-3 text-xs">
      <h3 className="font-semibold">{t(`typesafe.${s.horizon}`)}</h3>
      <p className="mt-2 text-muted-foreground">{t('typesafe.coverage', s)}</p>
      <p className="mt-2 text-muted-foreground">{t('typesafe.cohort', s)}</p>
      <p className="mt-2 text-muted-foreground">{t('typesafe.flatPattern', s)}</p>
      {!s.scored && <p className="mt-2">{t('typesafe.noScore')}</p>}
      <dl className="mt-3 space-y-2">
        <div><dt>{t('typesafe.accuracy', { count: s.scored })}</dt><dd className="mt-1 font-medium">{percent(s.accuracy)}</dd></div>
        <div><dt>{t('typesafe.paired', { count: s.baselineCompared })}</dt><dd className="mt-1 font-medium">{percent(s.pairedAccuracy)} / {percent(s.baselineAccuracy)}</dd></div>
        <div><dt>{t('typesafe.alwaysUp')}</dt><dd className="mt-1 font-medium">{percent(s.alwaysUpAccuracy)}</dd></div>
        <div><dt>{t('typesafe.brier')}</dt><dd className="mt-1 font-medium">{s.brier?.toFixed(3) ?? '—'}</dd></div>
      </dl>
      <details className="mt-3"><summary className="cursor-pointer">{t('typesafe.reliability')}</summary><table className="mt-2 w-full text-left"><thead><tr><th>{t('typesafe.bin')}</th><th>{t('typesafe.count')}</th><th>{t('typesafe.observed')}</th></tr></thead><tbody>{s.calibration.map(b => <tr key={b.from}><td className="py-1">{Math.round(b.from * 100)}–{Math.round(b.to * 100)}%</td><td>{b.count}</td><td>{percent(b.observedAccuracy)}</td></tr>)}</tbody></table></details>
    </div>)}</div>
    <p className="mt-3 text-xs text-muted-foreground">{t('typesafe.brierHint')}</p>
    {report.rows.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><caption className="mb-2 text-left font-medium">{t('typesafe.history')}</caption><thead><tr><th className="p-2">{t('typesafe.issued', { time: '' })}</th>{horizons.map(h => <th className="p-2" key={h}>{t(`typesafe.${h}`)} · {t('typesafe.outcome')}</th>)}</tr></thead><tbody>{report.rows.slice().reverse().map(row => <tr className="border-t border-border" key={row.forecast.id}><td className="p-2">{new Date(row.forecast.issuedAt).toLocaleString()}{row.providerChanged && <p className="text-warning">{t('typesafe.providerChanged')}</p>}</td>{row.outcomes.map(o => <td key={o.horizon} className="p-2">{t(`typesafe.${row.forecast.horizons[o.horizon].adequacy.choice === 'adequate' ? row.forecast.horizons[o.horizon].answer.choice as typeof directions[number] : 'insufficient'}`)} · {o.actual ? `${o.outcome.changePercent?.toFixed(2)}%` : t(`typesafe.${o.outcome.status}`)}</td>)}</tr>)}</tbody></table></div>}
  </details>
}
function TypeSafeAuditPanel() {
  const { t } = useTranslation(), model = useTypeSafeAudit()
  const [source, setSource] = useState(''), [claim, setClaim] = useState(''), [url, setUrl] = useState('')
  return <details className="mt-4 border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium">{t('typesafe.auditTitle')}</summary>
    <p className="mt-3 text-xs text-muted-foreground">{t('typesafe.auditHint')}</p>
    <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); void model.run({ source, claim, ...(url.trim() ? { sourceUrl: url.trim() } : {}) }) }}>
      <label className="block text-xs">{t('typesafe.source')}<textarea required minLength={20} maxLength={16000} rows={4} className={`${inputClass} mt-1`} value={source} disabled={model.busy} onChange={e => setSource(e.target.value)} /></label>
      <label className="block text-xs">{t('typesafe.claim')}<input required minLength={3} maxLength={1000} className={`${inputClass} mt-1`} value={claim} disabled={model.busy} onChange={e => setClaim(e.target.value)} /></label>
      <label className="block text-xs">{t('typesafe.url')}<input type="url" maxLength={2048} className={`${inputClass} mt-1`} value={url} disabled={model.busy} onChange={e => setUrl(e.target.value)} /></label>
      <Button type="submit" size="sm" disabled={model.busy}>{t(model.busy ? 'typesafe.busy' : 'typesafe.audit')}</Button>
    </form>
    {model.error && <p role="alert" className="mt-2 text-sm text-destructive">{model.error}</p>}
    {model.result && <div role="status" className="mt-3 space-y-2 text-sm"><p className="font-medium">{model.result.claim}</p>{(['support', 'event'] as const).map(id => <p key={id}>{t(`typesafe.${id}`)} · {t(`typesafe.${model.result!.answers[id]!.choice as 'supported' | 'contradicted' | 'insufficient' | 'planned' | 'completed' | 'cancelled' | 'unspecified'}`)} · {percent(model.result!.answers[id]!.probabilities[model.result!.answers[id]!.choice]!)}</p>)}<p className="text-xs text-muted-foreground">{t('typesafe.issued', { time: new Date(model.result.issuedAt).toLocaleString() })}</p></div>}
  </details>
}

function TypeSafeEvidence({ state }: { state: Record<string, unknown> }) {
  const { t } = useTranslation()
  const daily = state.daily as { lastClose?: number; windows?: Array<{ bars: number; returnPercent: number; distanceFromAveragePercent: number }> } | undefined
  const sources = state.sources as Array<{ id: string; label?: string; provider: string; asOf: string | null; status: string }> | undefined
  if (!daily || typeof daily.lastClose !== 'number') return null
  return <details className="mt-4 text-xs"><summary className="cursor-pointer font-medium">{t('typesafe.evidenceTitle')}</summary>
    <p className="mt-3">{t('typesafe.lastClose')} · ${daily.lastClose.toLocaleString()}</p>
    <div className="mt-2 overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="py-2">{t('typesafe.windowBars')}</th><th>{t('typesafe.returnWindow')}</th><th>{t('typesafe.averageDistance')}</th></tr></thead><tbody>{daily.windows?.map(w => <tr key={w.bars} className="border-t border-border"><td className="py-2">{w.bars}</td><td>{w.returnPercent.toFixed(2)}%</td><td>{w.distanceFromAveragePercent.toFixed(2)}%</td></tr>)}</tbody></table></div>
    <p className="mt-3 font-medium">{t('typesafe.sourceTime')}</p><ul className="mt-2 space-y-1 text-muted-foreground">{sources?.map(source => <li key={source.id}>{source.label} · {source.provider} · {t(source.status === 'ok' ? 'typesafe.sourceOk' : source.status === 'degraded' ? 'typesafe.sourceDegraded' : 'typesafe.sourceUnavailable')} · {source.asOf ? new Date(source.asOf).toLocaleString() : '—'}</li>)}</ul>
  </details>
}
