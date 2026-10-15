import { useTranslation } from 'react-i18next'
import type { ForwardReport } from '../../api/forecast-validation'
import { Button } from '../../components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible'
import { formatMonitorDate } from './market-monitor-format'

const horizons = ['short', 'medium', 'long'] as const
const methods = ['rules', 'jev', 'combined', 'frequency', 'alwaysUp'] as const
const brier = (value: number | null) => value !== null && Number.isFinite(value) ? value.toFixed(3) : '—'
type Props = { report: ForwardReport | null; loading: boolean; error: 'read' | 'collect' | null; refresh: () => void }

// Match the server's reviewSessionDate; the viewer's local timezone and clock
// must not turn an older publication into today's assessment.
function currentPublication(report: ForwardReport): boolean {
  const issuedAt = report.latest?.publication.issuedAt
  if (!issuedAt || !Number.isFinite(Date.parse(issuedAt)) || !Number.isFinite(Date.parse(report.generatedAt)) || Date.parse(issuedAt) > Date.parse(report.generatedAt)) return false
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: report.asset === 'BTC' ? 'UTC' : 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  return date.format(new Date(issuedAt)) === date.format(new Date(report.generatedAt))
}

export function MarketForwardValidationSummary({ report, loading, error, refresh }: Props) {
  const { t } = useTranslation()
  const mature = report?.summaries.some(row => row.complete > 0)
  const current = report ? currentPublication(report) : false
  return <section aria-label={t('forward.title')} className="min-w-0 border-t border-border py-4">
    <h2 className="text-sm font-semibold">{t('forward.title')}</h2>
    {error !== 'read' && <p role={loading ? 'status' : undefined} className="mt-2 text-sm leading-6">{t(loading ? 'forward.loading' : mature ? 'forward.experimental' : report?.rows.length ? 'forward.waiting' : 'forward.empty')}</p>}
    {report?.illustrative && <p className="mt-1 text-xs text-warning">{t('accuracy.demo')}</p>}
    {error && <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-warning"><span>{t(error === 'read' ? 'forward.readError' : 'forward.collectError')}</span><Button size="sm" variant="outline" onClick={refresh}>{t('accuracy.retry')}</Button></div>}
    {report?.lastError && <p role="alert" className="mt-2 text-xs text-warning">{t('forward.modelFailed')}</p>}
    {report && report.invalidRecords > 0 && <p className="mt-1 text-xs text-warning">{t('forward.invalid', { count: report.invalidRecords })}</p>}
    {report?.latest && <div className="mt-2 min-w-0 text-xs leading-5 text-muted-foreground"><p>{t('forward.issued', { time: formatMonitorDate(report.latest.publication.issuedAt) })}</p>{!current && <p role="status" className="mt-1 text-warning">{t('forward.historicalWaiting')}</p>}{current && <div className="mt-1 grid min-w-0 gap-2 sm:grid-cols-3">{horizons.map(horizon => {
      const decision = report.latest!.candidate?.decisions[horizon]
      return <div key={horizon} className="min-w-0"><p className="font-medium">{t(`typesafe.${horizon}`)} · {t('forward.decision', { choice: decision?.choice ? t(`forward.${decision.choice}`) : t('forward.abstain') })}</p><p>{decision ? decision.reasons.length ? t(`forward.reason.${decision.reasons[0]!}`) : t('forward.accepted') : t('forward.modelMissing')}</p></div>
    })}</div>}</div>}
    {report && <Collapsible className="mt-1"><CollapsibleTrigger className="cursor-pointer py-2 text-xs font-medium text-muted-foreground">{t('forward.detail')}</CollapsibleTrigger><CollapsibleContent><ForwardValidationDetails report={report} /></CollapsibleContent></Collapsible>}
  </section>
}

export function MarketForwardJevView({ report, loading, error, refresh, collect, collecting }: Props & { collect: () => void; collecting: boolean }) {
  const { t } = useTranslation()
  const latest = report?.latest
  const current = report ? currentPublication(report) : false
  return <section aria-label="Jev v2" className="min-w-0 rounded-xl border border-border bg-card p-4 md:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Jev · v2</h2><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={loading} onClick={refresh}>{t('typesafe.refresh')}</Button><Button size="sm" disabled={collecting || loading} onClick={collect}>{t(collecting ? 'forward.busy' : 'forward.freeze')}</Button></div></div>
    <p className="mt-2 text-xs text-muted-foreground">{t('forward.effective')}</p>
    {report?.illustrative && <p className="mt-2 text-xs text-warning">{t('accuracy.demo')}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-warning">{t(error === 'read' ? 'forward.readError' : 'forward.collectError')}</p>}
    {report && !report.configured && <p className="mt-2 text-xs text-muted-foreground">{t('forward.configured')}</p>}
    {report?.lastError && <p role="alert" className="mt-2 text-xs text-warning">{t('forward.modelFailed')}</p>}
    {!latest && <p role="status" className="mt-3 text-sm text-muted-foreground">{t(loading ? 'forward.loading' : 'forward.noLatest')}</p>}
    {latest && <><p className="mt-3 text-xs text-muted-foreground">{t('forward.issued', { time: formatMonitorDate(latest.publication.issuedAt) })}</p>
      {!current && <p role="status" className="mt-2 text-xs text-warning">{t('forward.historicalWaiting')}</p>}
      {current && !latest.candidate && <p className="mt-2 text-xs text-warning">{t('forward.modelMissing')}</p>}
      {current && <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-3">{horizons.map(h => {
        const decision = latest.candidate?.decisions[h]
        const sessions = latest.publication.input.history[h].sessions
        return <div key={h} className="min-w-0 border-t border-border pt-3"><h3 className="text-xs text-muted-foreground">{t(`typesafe.${h}`)} · {t(report.asset === 'BTC' ? 'forward.days' : 'forward.sessions', { count: sessions })}</h3><p className="mt-1 text-base font-semibold">{decision?.choice ? t(`forward.${decision.choice}`) : t('forward.abstain')}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{decision ? decision.reasons.length ? t(`forward.reason.${decision.reasons[0]!}`) : t('forward.accepted') : t('forward.modelMissing')}</p></div>
      })}</div>}
      {latest.candidate && <Collapsible className="mt-3 border-t border-border pt-1"><CollapsibleTrigger className="cursor-pointer py-2 text-xs font-medium">{t(current ? 'forward.raw' : 'forward.historicalRaw')}</CollapsibleTrigger><CollapsibleContent><div className="grid min-w-0 gap-3 sm:grid-cols-3">{horizons.map(h => {
        const decision = latest.candidate!.decisions[h]
        const answer = latest.candidate!.raw.answers[h]
        return <div key={h} className="min-w-0 space-y-1 text-xs leading-5"><h4 className="font-medium">{t(`typesafe.${h}`)}</h4><p>{t('forward.rawChoice', { choice: decision.rawChoice })}</p>{(['up', 'flat', 'down'] as const).map(d => <p key={d}>{t(`forward.${d}`)} · {typeof answer?.probabilities[d] === 'number' ? `${(answer.probabilities[d]! * 100).toFixed(1)}%` : '—'}</p>)}</div>
      })}</div></CollapsibleContent></Collapsible>}
    </>}
  </section>
}

function ForwardValidationDetails({ report }: { report: ForwardReport }) {
  const { t } = useTranslation()
  return <div className="min-w-0 space-y-3 pt-2 text-xs leading-5">
    <p className="text-muted-foreground">{t('forward.scoring')}</p>
    <div className="grid min-w-0 gap-3 sm:grid-cols-3">{report.summaries.map(row => <section key={row.horizon} className="min-w-0 space-y-1 border-t border-border pt-3"><h3 className="font-medium">{t(`typesafe.${row.horizon}`)}</h3><p className="text-muted-foreground">{t('forward.coverage', { ...row })}</p>{methods.map(method => <p key={method}>{t(row.methods[method].scored ? 'forward.methodScore' : 'forward.noScore', { method: t(`forward.methods.${method}`), ...row.methods[method] })}</p>)}<p className="mt-2 text-muted-foreground">{t('forward.matched', { count: row.matched.count })}</p>{row.matched.count > 0 && <div>{methods.map(method => <p key={method}>{t('forward.matchedScore', { method: t(`forward.methods.${method}`), correct: row.matched.correct[method], count: row.matched.count })}</p>)}</div>}<p className="text-muted-foreground">{t('forward.probability', { count: row.probability.count, jev: brier(row.probability.jevBrier), frequency: brier(row.probability.frequencyBrier) })}</p></section>)}</div>
    <p className="text-muted-foreground">{t('forward.caution')}</p>
    {report.historyTruncated && <p className="text-warning">{t('forward.truncated')}</p>}
  </div>
}
