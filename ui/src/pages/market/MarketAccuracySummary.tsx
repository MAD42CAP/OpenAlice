import { useState } from 'react'
import { useForecastValidation } from '../../hooks/useForecastValidation'
import { ForwardValidationDetails, MarketForwardValidationSummary } from './MarketForwardValidation'
import { LEGACY_FORWARD_PROTOCOL } from '../../api/forecast-validation-types'
import { useTranslation } from 'react-i18next'
import type { MonitorAsset } from '../../api/market-monitor'
import type { ExperimentReport } from '../../api/forecast-experiment'
import type { JevReport } from '../../api/typesafe'
import { useMarketAccuracySummary } from '../../hooks/useMarketAccuracySummary'
import { Button } from '../../components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible'

const horizons = ['short', 'medium', 'long'] as const
type Paired = ExperimentReport['summaries'][number]['paired']
const validBrier = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 && value <= 2
const comparable = (paired: Paired) => Number.isInteger(paired.count) && paired.count > 0 && validBrier(paired.originalBrier) && validBrier(paired.challengerBrier) && validBrier(paired.frequencyBrier)
const score = (value: number | null) => validBrier(value) ? value!.toFixed(3) : '—'

export function MarketAccuracySummary(props: { asset: MonitorAsset; visible: boolean; revisionKey: string }) {
  return <MarketAccuracyCurrent key={props.asset} {...props} />
}
function MarketAccuracyCurrent(props: { asset: MonitorAsset; visible: boolean; revisionKey: string }) {
  const { t } = useTranslation()
  const model = useForecastValidation(props.asset, props.visible, props.revisionKey)
  const [historyOpen, setHistoryOpen] = useState(false)
  return <><MarketForwardValidationSummary {...model} /><Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
    <CollapsibleTrigger className="cursor-pointer py-2 text-xs font-medium text-muted-foreground">{t('forward.history')}</CollapsibleTrigger>
    <CollapsibleContent>{historyOpen && <><p className="text-xs text-muted-foreground">{t('forward.legacy')}</p><MarketLegacyForwardValidation {...props} /><MarketLegacyAccuracy {...props} /></>}</CollapsibleContent>
  </Collapsible></>
}
function MarketLegacyForwardValidation(props: { asset: MonitorAsset; visible: boolean; revisionKey: string }) {
  const { t } = useTranslation()
  const model = useForecastValidation(props.asset, props.visible, props.revisionKey, LEGACY_FORWARD_PROTOCOL)
  return <section aria-label={t('forward.legacyV2')} className="min-w-0 border-t border-border py-3">
    <h3 className="text-xs font-medium">{t('forward.legacyV2')}</h3>
    {model.loading && <p role="status" className="mt-2 text-xs">{t('forward.loading')}</p>}
    {model.error && <p role="alert" className="mt-2 text-xs text-warning">{t('forward.legacyReadError')}</p>}
    {model.report && <ForwardValidationDetails report={model.report} />}
  </section>
}
function MarketLegacyAccuracy(props: { asset: MonitorAsset; visible: boolean; revisionKey: string }) {
  const model = useMarketAccuracySummary(props.asset, props.visible, props.revisionKey)
  return <MarketAccuracySummaryView asset={props.asset} {...model} />
}

export function MarketAccuracySummaryView({ asset, jevReport, experimentReport, loading, error, refresh }: {
  asset: MonitorAsset
  jevReport: JevReport | null
  experimentReport: ExperimentReport | null
  loading: boolean
  error: boolean
  refresh: () => void
}) {
  const { t } = useTranslation()
  const jev = jevReport?.asset === asset ? jevReport : null
  const experiment = experimentReport?.asset === asset ? experimentReport : null
  const comparableSummaries = experiment?.summaries.filter(summary => comparable(summary.paired)) ?? []
  const lowerError = comparableSummaries.some(({ paired }) => paired.originalBrier! < paired.frequencyBrier! - 1e-9 || paired.challengerBrier! < paired.frequencyBrier! - 1e-9)
  const hasRecords = Boolean(jev?.rows.length || experiment?.rows.length)
  const verdict = comparableSummaries.length ? lowerError ? 'lowerError' : 'noEdge' : hasRecords ? 'comparisonPending' : error ? 'unavailable' : 'empty'
  const reportFailure = Boolean(jev?.lastError || experiment?.lastError)
  const invalid = (jev?.invalidRecords ?? 0) + (experiment?.invalidRecords ?? 0)
  const truncated = jev?.historyTruncated || experiment?.historyTruncated
  const horizonLabels = comparableSummaries.map(summary => t(`accuracy.${summary.horizon}`)).join(' / ')
  const results = horizons.map(horizon => {
    const summary = jev?.summaries.find(value => value.horizon === horizon)
    const label = t(`accuracy.${horizon}`)
    return summary && summary.scored > 0
      ? t('accuracy.hits', { horizon: label, correct: summary.correct, scored: summary.scored })
      : summary && summary.pending > 0 && summary.uniqueWindows === 0 && summary.complete === 0
        ? t('accuracy.pendingHorizon', { horizon: label })
        : t('accuracy.unscoredHorizon', { horizon: label })
  }).join(' · ')

  return <section aria-label={`${asset} · ${t('accuracy.title')}`} className="min-w-0 border-t border-border py-4">
    <h2 className="text-sm font-semibold">{t('accuracy.title')}</h2>
    {(jev?.illustrative || experiment?.illustrative) && <p className="mt-2 text-sm font-medium text-warning">{t('accuracy.demo')}</p>}
    {error && <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-warning"><span>{t('accuracy.loadError')}</span><Button size="sm" variant="outline" onClick={refresh}>{t('accuracy.retry')}</Button></div>}
    {reportFailure && <p role="alert" className="mt-2 text-sm text-warning">{t('accuracy.collectionError')}</p>}
    {invalid > 0 && <p className="mt-2 text-sm text-warning">{t('accuracy.archiveWarning', { invalid })}</p>}
    <p role={loading ? 'status' : undefined} className="mt-2 text-sm leading-6">{loading ? t('accuracy.loading') : t(`accuracy.${verdict}`, { horizons: horizonLabels })}</p>
    {!loading && jev && <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('accuracy.jevLine', { results })}</p>}
    {!loading && (jev || experiment) && <Collapsible className="mt-2">
      <CollapsibleTrigger className="cursor-pointer rounded py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{t('accuracy.details')}</CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        <p className="text-sm leading-6 text-muted-foreground">{t('accuracy.scope')}</p>
        {!jev && <p className="text-sm text-warning">{t('accuracy.missingJev')}</p>}
        {!experiment && <p className="text-sm text-warning">{t('accuracy.missingExperiment')}</p>}
        <div className="grid gap-3 sm:grid-cols-3">{horizons.map(horizon => {
          const matched = experiment?.summaries.find(summary => summary.horizon === horizon)
          const original = jev?.summaries.find(summary => summary.horizon === horizon)
          return <div key={horizon} className="min-w-0 border-t border-border pt-3 text-sm leading-6 tabular-nums">
            <h3 className="font-medium">{t(`accuracy.${horizon}`)}</h3>
            {original && <p className="mt-1 text-muted-foreground">{t(original.scored > 0 ? 'accuracy.jevCoverage' : 'accuracy.noJevScore', original)}</p>}
            {matched && <p className="mt-1 text-muted-foreground">{t('accuracy.comparisonCoverage', matched)}</p>}
            {matched && comparable(matched.paired) ? <>
              <p className="mt-1">{t('accuracy.pairedCount', { count: matched.paired.count })}</p>
              <p className="mt-1 text-muted-foreground">{t('accuracy.probabilityErrors', { original: score(matched.paired.originalBrier), challenger: score(matched.paired.challengerBrier), frequency: score(matched.paired.frequencyBrier) })}</p>
              <p className="mt-1 text-muted-foreground">{t('accuracy.pairedHits', { original: matched.paired.originalCorrect, challenger: matched.paired.challengerCorrect, frequency: matched.paired.frequencyCorrect ?? '—' })}</p>
            </> : <p className="mt-1 text-muted-foreground">{t('accuracy.noComparison')}</p>}
          </div>
        })}</div>
        <p className="text-sm leading-6 text-muted-foreground">{t('accuracy.caution')}</p>
        <p className="text-sm leading-6 text-muted-foreground">{t('accuracy.scoreMeaning')}</p>
        {truncated && <p className="text-sm text-warning">{t('accuracy.truncated')}</p>}
      </CollapsibleContent>
    </Collapsible>}
  </section>
}
