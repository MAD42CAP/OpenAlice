import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, RefreshCw } from 'lucide-react'
import type { MonitorAsset } from '../../api/market-monitor'
import type { MarketReviewReport, ReviewCase, ReviewHorizon, ReviewWindow } from '../../api/market-review'
import { useMarketMonitorReview } from '../../hooks/useMarketMonitorReview'
import { Button } from '../ui/button'
import { formatMonitorDate } from '../../pages/market/market-monitor-format'
import { monitorBriefHeadline, monitorEvidenceCopy, monitorHorizonLabel, monitorTrendDirectionLabel, monitorWyckoffCondition, monitorWyckoffEventLabel, monitorWyckoffEventStatus, monitorWyckoffEvidence, monitorWyckoffPhaseLabel } from '../../pages/market/market-monitor-presentation'
import { getIntlLocale } from '../../lib/intl'

const number = (value: unknown, digits = 2) => typeof value !== 'number' || !Number.isFinite(value) ? '—' : new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: digits }).format(value)
const percent = (value: number | null | undefined) => value == null ? '—' : `${value > 0 ? '+' : ''}${number(value)}%`
const control = 'oa-field-control min-w-0 w-full max-w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs'

function exportReview(report: MarketReviewReport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `market-review-${report.asset}-${report.generatedAt.slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function MonitorReview({ asset, strategyId, visible }: { asset: MonitorAsset; strategyId: string; visible: boolean }) {
  const { t } = useTranslation()
  const [days, setDays] = useState<ReviewWindow>(30)
  const [kind, setKind] = useState<ReviewCase['kind']>('rules')
  const [horizon, setHorizon] = useState<ReviewHorizon>('day')
  const [selected, setSelected] = useState('')
  const review = useMarketMonitorReview(asset, strategyId, days, visible)
  const rows = review.report?.rows.filter(row => row.kind === kind).slice().reverse() ?? []
  const row = rows.find(row => row.id === selected) ?? rows.find(row => row.outcomes.some(outcome => outcome.horizon === horizon && outcome.status === 'complete')) ?? rows[0]
  const outcome = row?.outcomes.find(outcome => outcome.horizon === horizon)
  const path = row?.path.slice(0, outcome?.targetBars ?? 0) ?? []
  return <section aria-label={t('marketMonitor.review.title')} className="oa-data-surface min-w-0">
    <div className="oa-data-surface-header flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">{t('marketMonitor.review.title')}</h2>
      <div className="flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" disabled={review.loading} onClick={review.refresh}><RefreshCw className="size-3.5" />{t('marketMonitor.review.refresh')}</Button>
        <Button variant="ghost" size="sm" disabled={!review.report} onClick={() => review.report && exportReview(review.report)}><Download className="size-3.5" />{t('marketMonitor.review.export')}</Button>
      </div>
    </div>
    <div className="space-y-4 p-4 text-xs">
      <p className="text-muted-foreground">{t('marketMonitor.review.intro')}</p>
      <div className="flex flex-wrap gap-3">
        <label className="grid min-w-0 gap-1">{t('marketMonitor.review.window')}<select className={control} value={days} onChange={event => setDays(Number(event.target.value) as ReviewWindow)}>{([7, 30, 90] as const).map(value => <option key={value} value={value}>{t('marketMonitor.review.days', { count: value })}</option>)}</select></label>
        <label className="grid min-w-0 gap-1">{t('marketMonitor.review.kind')}<select className={control} value={kind} onChange={event => setKind(event.target.value as ReviewCase['kind'])}><option value="rules">{t('marketMonitor.review.rules')}</option><option value="narration">{t('marketMonitor.review.narration')}</option></select></label>
        <label className="grid min-w-0 gap-1">{t('marketMonitor.review.horizon')}<select className={control} value={horizon} onChange={event => setHorizon(event.target.value as ReviewHorizon)}>{(['day', 'week', 'month'] as const).map(value => <option key={value} value={value}>{t(`marketMonitor.review.${value}`)}</option>)}</select></label>
      </div>
      {review.loading && <p role="status">{t('marketMonitor.review.loading')}</p>}
      {review.failed && <p role="alert">{t('marketMonitor.review.failed')}</p>}
      {review.report && <>
        {review.report.illustrative && <p className="font-medium">{t('marketMonitor.review.illustrative')}</p>}
        <p className="text-muted-foreground">{t('marketMonitor.review.coverage', { from: formatMonitorDate(review.report.oldestObservationAt), at: formatMonitorDate(review.report.generatedAt) })}{review.report.historyTruncated && ` ${t('marketMonitor.review.truncated')}`}</p>
        <details className="border-y border-border py-2"><summary className="cursor-pointer font-medium">{t('marketMonitor.review.method')}</summary><p className="mt-2 leading-relaxed text-muted-foreground">{t(asset === 'BTC' ? 'marketMonitor.review.methodBtc' : 'marketMonitor.review.methodEquity')}</p><p className="mt-2 leading-relaxed text-muted-foreground">{t('marketMonitor.review.methodCommon')}</p></details>
        {kind === 'rules' && <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left tabular-nums [&_th]:p-2 [&_td]:p-2"><caption className="pb-2 text-left font-medium">{t('marketMonitor.review.aggregate')}</caption><thead className="border-b border-border text-muted-foreground"><tr><th>{t('marketMonitor.review.version')}</th><th>{t('marketMonitor.review.supported')}</th><th>{t('marketMonitor.review.opposed')}</th><th>{t('marketMonitor.review.flat')}</th><th>{t('marketMonitor.review.pending')}</th><th>{t('marketMonitor.review.excluded')}</th><th>{t('marketMonitor.review.rate')}</th><th>{t('marketMonitor.review.baseline')}</th></tr></thead><tbody>{review.report.summaries.filter(item => item.horizon === horizon).map(item => <tr key={item.strategyVersion ?? 'legacy'} className="border-b border-border/50"><td>{item.strategyVersion == null ? t('marketMonitor.review.legacy') : `v${item.strategyVersion}`}</td><td>{item.supported}</td><td>{item.opposed}</td><td>{item.flat}</td><td>{item.pending}</td><td>{item.excluded} / {item.nonDirectional}</td><td>{number(item.agreementPercent)}{item.agreementPercent != null ? '%' : ''} ({item.scored})</td><td>{number(item.alwaysBullishPercent)}{item.alwaysBullishPercent != null ? '%' : ''}</td></tr>)}</tbody></table><p className="mt-2 text-muted-foreground">{t('marketMonitor.review.sampleCaution')} {t('typesafe.cohortMethod')}</p>{review.report.summaries.filter(item => item.horizon === horizon).map(item => <p key={item.strategyVersion ?? 'legacy'} className="mt-1 text-muted-foreground">{item.strategyVersion == null ? t('marketMonitor.review.legacy') : `v${item.strategyVersion}`} · {t('typesafe.cohort', { uniqueWindows: item.uniqueWindows, duplicateWindows: item.duplicateWindows })}</p>)}</div>}
        {kind === 'narration' && <p className="text-muted-foreground">{t('marketMonitor.review.proseCaution')}</p>}
        {rows.length ? <label className="grid min-w-0 max-w-xl gap-1">{t('marketMonitor.review.case')}<select className={control} value={row?.id ?? ''} onChange={event => setSelected(event.target.value)}>{rows.map(item => <option key={item.id} value={item.id}>{formatMonitorDate(item.issuedAt)} · {item.strategyVersion == null ? t('marketMonitor.review.legacy') : `v${item.strategyVersion}`} · {t(`marketMonitor.review.${item.outcomes.find(o => o.horizon === horizon)?.status ?? 'unverified'}`)}</option>)}</select></label> : <p>{t('marketMonitor.review.empty')}</p>}
        {row && outcome && <div className="grid gap-5 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <h3 className="font-semibold">{t('marketMonitor.review.original')}</h3>
            <p className="text-muted-foreground">{t('marketMonitor.review.published', { time: formatMonitorDate(row.issuedAt) })} · {t(`marketMonitor.review.archive-${row.archiveStatus}`)}</p>
            {row.narration && <><h4 className="font-semibold">{row.narration.headline}</h4><p className="whitespace-pre-line leading-relaxed">{row.narration.summary}</p>{(['short', 'medium', 'long'] as const).map(h => <p key={h} className="whitespace-pre-line leading-relaxed"><strong>{monitorHorizonLabel(t, h)} · </strong>{row.narration![`${h}Term`]}</p>)}<p>{t('marketMonitor.review.narrativeConditions')} {row.narration.watchFor.join('；')}</p><p>{t('marketMonitor.review.risks')} {row.narration.risks.join('；')}</p></>}
            {row.original && <>
              {!row.narration && row.original.dailyBrief && <p className="font-medium">{monitorBriefHeadline(t, row.original.dailyBrief.headline)}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-2">{(['short', 'medium', 'long'] as const).map(h => <span key={h}>{monitorHorizonLabel(t, h)} · {monitorTrendDirectionLabel(t, row.original?.trend?.[h].direction ?? 'insufficient')}</span>)}</div>
              {row.original.wyckoff && <><p>{monitorWyckoffPhaseLabel(t, row.original.wyckoff.phaseCandidate)} · {t('marketMonitor.review.ruleScore', { value: row.original.wyckoff.confidence })}</p><ul className="space-y-1">{row.original.wyckoff.events.map((event, index) => <li key={index}>{monitorWyckoffEventLabel(t, event.kind)} · {monitorWyckoffEventStatus(t, event.status)} · {event.at.slice(0, 10)} · ${number(event.level)}</li>)}</ul>
                <details><summary className="cursor-pointer font-medium">{t('marketMonitor.review.reasoning')}</summary><div className="mt-2 space-y-2 leading-relaxed"><p>{t('marketMonitor.review.supporting')} {row.original.wyckoff.supportingEvidence.map(id => monitorWyckoffEvidence(t, id)).join('；')}</p><p>{t('marketMonitor.review.opposing')} {row.original.wyckoff.opposingEvidence.map(id => monitorWyckoffEvidence(t, id)).join('；')}</p>{row.original.evidence.map(item => { const copy = monitorEvidenceCopy(t, row.original!, item, number); return <p key={item.id}>{copy.label} · {copy.observation} · {copy.interpretation}</p> })}</div></details>
                <div className="space-y-2 border-t border-border pt-3"><p className="font-medium">{t('marketMonitor.review.conditions')}</p><p className="leading-relaxed">{t('marketMonitor.review.confirm')} {row.original.wyckoff.confirmation.map(id => monitorWyckoffCondition(t, id)).join('；')}</p><p className="leading-relaxed">{t('marketMonitor.review.invalidate')} {row.original.wyckoff.invalidation.map(id => monitorWyckoffCondition(t, id)).join('；')}</p><p className="text-muted-foreground">{t('marketMonitor.review.manualConditions')}</p></div>
              </>}
            </>}
          </div>
          <div className="min-w-0 space-y-3">
            <h3 className="font-semibold">{t('marketMonitor.review.actual')}</h3>
            <p className="font-medium" role="status">{t(`marketMonitor.review.${outcome.status}`)} · {outcome.observedBars}/{outcome.targetBars} {t('marketMonitor.review.sessions')}{outcome.status === 'complete' && ` · ${t(`marketMonitor.review.${outcome.verdict}`)}`}</p>
            <p className="text-muted-foreground">{t('marketMonitor.review.sources', { original: row.originalProvider ?? '—', actual: row.outcomeProvider ?? '—' })}{row.providerChanged && ` · ${t('marketMonitor.review.feedChanged')}`}</p>
            {outcome.status === 'complete' ? <><dl className="grid grid-cols-2 gap-3 tabular-nums"><div><dt className="text-muted-foreground">{t('marketMonitor.review.entry')} · {outcome.start}</dt><dd className="mt-1 text-base">${number(outcome.entry)}</dd></div><div><dt className="text-muted-foreground">{t('marketMonitor.review.exit')} · {outcome.end}</dt><dd className="mt-1 text-base">${number(outcome.close)}</dd></div><div><dt className="text-muted-foreground">{t('marketMonitor.review.change')}</dt><dd className="mt-1 text-base">{percent(outcome.changePercent)}</dd></div><div><dt className="text-muted-foreground">{t('marketMonitor.review.extremes')}</dt><dd className="mt-1">{percent(outcome.lowPercent)} / {percent(outcome.highPercent)}</dd></div></dl>{outcome.range && <p>{t('marketMonitor.review.rangeFacts', { above: outcome.range.above, below: outcome.range.below, inside: outcome.range.inside, lower: number(row.original?.wyckoff?.range?.lower), upper: number(row.original?.wyckoff?.range?.upper) })}</p>}</> : <p className="text-muted-foreground">{t(`marketMonitor.review.help-${outcome.status}`)}</p>}
            {path.length > 0 && <><ReviewPath path={path} /><details><summary className="cursor-pointer font-medium">{t('marketMonitor.review.prices')}</summary><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[330px] text-left tabular-nums [&_th]:p-1.5 [&_td]:p-1.5"><thead><tr><th>{t('marketMonitor.review.date')}</th><th>{t('marketMonitor.review.open')}</th><th>{t('marketMonitor.review.lowHigh')}</th><th>{t('marketMonitor.review.close')}</th></tr></thead><tbody>{path.map(bar => <tr key={bar.date}><td>{bar.date}</td><td>{number(bar.open)}</td><td>{number(bar.low)} / {number(bar.high)}</td><td>{number(bar.close)}</td></tr>)}</tbody></table></div></details></>}
          </div>
        </div>}
        <div className="border-t border-border pt-3"><h3 className="mb-2 font-semibold">{t('marketMonitor.review.lessons')}</h3><ul className="space-y-2 leading-relaxed">{review.report.lessons.map(lesson => <li key={lesson.code}>{t(`marketMonitor.review.lesson-${lesson.code}`, { count: lesson.count })}{lesson.caseIds.length > 0 && <Button variant="link" size="sm" onClick={() => { const target = review.report!.rows.find(item => item.id === lesson.caseIds[0]); if (target) { setKind(target.kind); setSelected(target.id); const observed = target.outcomes.find(item => lesson.code === 'direction-misses' ? item.verdict === 'opposed' : item.status === 'complete'); if (observed) setHorizon(observed.horizon) } }}>{t('marketMonitor.review.seeCase')}</Button>}</li>)}</ul><p className="mt-3 text-muted-foreground">{t('marketMonitor.review.feedback')}</p></div>
      </>}
    </div>
  </section>
}

function ReviewPath({ path }: { path: ReviewCase['path'] }) {
  const { t } = useTranslation()
  const prices = [path[0]!.open, ...path.map(bar => bar.close)]
  const min = Math.min(...prices), max = Math.max(...prices), spread = max - min || max * 0.01
  const points = prices.map((price, index) => `${20 + index / (prices.length - 1) * 600},${120 - (price - min) / spread * 100}`).join(' ')
  return <figure><svg viewBox="0 0 640 150" className="w-full text-primary" role="img" aria-label={t('marketMonitor.review.chart')}><title>{t('marketMonitor.review.chart')}</title><polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} /><text x="20" y="144" className="fill-muted-foreground" fontSize="12">{path[0]!.date}</text><text x="620" y="144" textAnchor="end" className="fill-muted-foreground" fontSize="12">{path.at(-1)!.date}</text></svg><figcaption className="text-muted-foreground">{t('marketMonitor.review.chartCaption')}</figcaption></figure>
}
