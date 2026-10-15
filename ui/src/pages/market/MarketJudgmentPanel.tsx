import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MonitorAsset } from '../../api/market-monitor'
import type { MarketJudgmentReport } from '../../api/market-judgment'
import { useMarketJudgment } from '../../hooks/useMarketJudgment'
import { Button } from '../../components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible'
import { cn } from '../../lib/utils'
import { formatMonitorDate } from './market-monitor-format'
import { monitorTrendDirectionLabel, monitorWyckoffCondition, monitorWyckoffPhaseLabel } from './market-monitor-presentation'
import type { WyckoffPhaseCandidate } from '../../api/market-monitor'

export function MarketJudgmentPanel(props: { asset: MonitorAsset; strategyId: string; visible: boolean; revisionKey: string }) {
  const model = useMarketJudgment(props.asset, props.strategyId, props.visible, props.revisionKey)
  return <MarketJudgmentView key={props.asset} {...model} />
}

export function MarketJudgmentView({ report, loading, error, refresh }: { report: MarketJudgmentReport | null; loading: boolean; error: boolean; refresh: () => void }) {
  const { t } = useTranslation()
  const horizonDescription = useId()
  const [horizon, setHorizon] = useState<'short' | 'medium' | 'long'>('medium')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const current = report?.horizons[horizon]
  const condition = (ids: string[]) => ids.slice(0, 2).map(id => monitorWyckoffCondition(t, id)).join(' ')
  const direction = error ? 'insufficient' : current?.decision === 'abstain' ? 'unclear' : current?.direction
  const directionLabel = (item: MarketJudgmentReport['horizons']['short']) => error ? t('judgment.insufficient') : item.decision === 'abstain' ? t('forward.judgmentAbstain') : item.decision === 'conditional' && (item.direction === 'bullish' || item.direction === 'bearish') ? t(item.direction === 'bullish' ? 'forward.conditionalBullish' : 'forward.conditionalBearish') : t(`judgment.${item.direction}`)
  return <section aria-label={t('judgment.title')} className="rounded-xl border border-border bg-card p-3 md:p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{t('judgment.title')}</h2>
      {report && <span className="text-xs text-muted-foreground">{t(`judgment.quality.${error ? 'insufficient' : report.quality}`)}</span>}
    </div>
    {error && <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-warning"><span>{t('judgment.loadError')}</span><Button size="sm" variant="outline" onClick={refresh}>{t('judgment.retry')}</Button></div>}
    {!report && !error && <p role="status" className="mt-4 text-sm text-muted-foreground">{t(loading ? 'judgment.loading' : 'judgment.empty')}</p>}
    {report && current && <>
      <div aria-live="polite" className="mt-2">
        <p className={cn('text-2xl font-semibold', direction === 'bullish' ? 'text-success' : direction === 'bearish' ? 'text-destructive' : 'text-foreground')}>{directionLabel(current)}</p>
        <p className="mt-1 text-sm leading-5">{error ? t('judgment.stale') : t(`judgment.reason.${current.reasons[0] ?? 'rules-mixed'}`)}</p>
      </div>
      <div role="group" aria-label={t('judgment.horizon')} className="mt-2 grid grid-cols-3 gap-2">
        {(['short', 'medium', 'long'] as const).map(h => <Button key={h} variant={horizon === h ? 'secondary' : 'outline'} className="h-auto min-w-0 flex-col items-start gap-1 whitespace-normal py-2" aria-pressed={horizon === h} aria-describedby={`${horizonDescription}-${h}`} aria-label={t(report.asset === 'BTC' ? 'judgment.days' : 'judgment.sessions', { count: report.horizons[h].sessions })} onClick={() => setHorizon(h)}>
          <span className="text-xs text-muted-foreground">{t(`typesafe.${h}`)} · {t(report.asset === 'BTC' ? 'judgment.daysCompact' : 'judgment.sessionsCompact', { count: report.horizons[h].sessions })}</span>
          <span id={`${horizonDescription}-${h}`} className="font-semibold">{directionLabel(report.horizons[h])}</span>
        </Button>)}
      </div>
      {current.risks.length > 0 && <p className="mt-2 text-xs leading-5 text-warning">{current.risks.slice(0, 2).map(r => t(`judgment.reason.${r}`)).join(' ')}</p>}
      <p className="mt-2 text-xs text-muted-foreground">{t(report.validation ? 'forward.experimentalInvestment' : 'judgment.interpretation')}</p>
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="mt-2 border-t border-border pt-1">
        <CollapsibleTrigger className="cursor-pointer py-1 text-xs font-medium">{t('judgment.explain')}</CollapsibleTrigger>
        <CollapsibleContent>{detailsOpen && <>
          <p className="mt-3 text-xs text-muted-foreground">{t(`judgment.agreement.${error ? 'limited' : current.agreement}`)}</p>
          <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            <div><h3 className="text-xs font-semibold">{t('judgment.confirm')}</h3><p className="mt-1 text-sm leading-6">{direction === 'insufficient' ? t('judgment.rescan') : condition(report.structure.confirmation) || t('judgment.noLevels')}</p></div>
            <div><h3 className="text-xs font-semibold">{t('judgment.invalidate')}</h3><p className="mt-1 text-sm leading-6">{direction === 'insufficient' ? t('judgment.rescan') : condition(report.structure.invalidation) || t('judgment.noLevels')}</p></div>
          </div>
          {report.structure.lower !== null && report.structure.upper !== null && <p className="mt-3 text-xs text-muted-foreground">{t('judgment.rangeLevels', { lower: report.structure.lower.toLocaleString(), upper: report.structure.upper.toLocaleString() })}</p>}
          <p className="mt-3 text-xs text-muted-foreground">{t('judgment.basis', { daily: report.basis.dailyAt ?? '—', hourly: report.basis.hourlyAt ? formatMonitorDate(report.basis.hourlyAt) : '—' })}</p>
          <dl className="mt-2 space-y-3 text-sm">
          <div><dt className="font-medium">{t('judgment.rules')}</dt><dd className="mt-1 text-muted-foreground">{monitorTrendDirectionLabel(t, current.rules)} · {t('judgment.rulesRole')}</dd></div>
          <div><dt className="font-medium">{t('judgment.wyckoff')}</dt><dd className="mt-1 text-muted-foreground">{monitorWyckoffPhaseLabel(t, report.structure.phase as WyckoffPhaseCandidate)} · {t(report.structure.confirmed ? 'judgment.eventConfirmed' : 'judgment.eventPending')}</dd></div>
          <div><dt className="font-medium">Jev</dt><dd className="mt-1 text-muted-foreground">{report.jev.directions ? `${t(`typesafe.${report.jev.directions[horizon]}`)} · ` : ''}{t(`judgment.jev.${report.jev.status}`)} {t('judgment.jevRole')}</dd></div>
          <div><dt className="font-medium">{t('judgment.context')}</dt><dd className="mt-1 text-muted-foreground">{t('judgment.contextCount', { current: report.context.currentFields.length, retained: report.context.referenceFields.length, news: report.context.newsCount, filings: report.context.filingsCount })} {report.context.earningsAt && t('judgment.earnings', { date: report.context.earningsAt.slice(0, 10) })} {t('judgment.contextRole')}</dd></div>
          {current.risks.length > 2 && <div><dt className="font-medium">{t('judgment.limitations')}</dt><dd className="mt-1 text-muted-foreground">{current.risks.slice(2).map(r => t(`judgment.reason.${r}`)).join(' ')}</dd></div>}
        </dl><p className="mt-4 text-xs leading-5 text-muted-foreground">{t('judgment.method')}</p><p className="mt-1 text-xs text-muted-foreground">{t('judgment.calculated', { time: formatMonitorDate(report.generatedAt) })}</p></>}</CollapsibleContent>
      </Collapsible>
    </>}
  </section>
}
