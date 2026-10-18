import { useTranslation } from 'react-i18next'
import type { MonitorAsset } from '../../api/market-monitor'
import type { NativeForwardReport, NativeForwardSummary } from '../../api/native-forward-types'
import { IntelligenceDisclosure } from './MarketIntelligenceShared'
import { formatMonitorDate } from './market-monitor-format'

export function MarketNativeForwardValidation({ asset, report, loading = false, error = false }: {
  asset: MonitorAsset; report?: NativeForwardReport | null; loading?: boolean; error?: boolean
}) {
  const { t } = useTranslation()
  const safe = report?.asset === asset ? report : null
  const readFailed = error || safe?.readError === true || !!report && !safe
  const failed = readFailed || safe?.historyTruncated === true
  const current = safe?.current
  const short = current?.summaries.find(row => row.horizon === 'short')
  let line = t('nativeForward.empty')
  if (short?.uniqueWindows) {
    line = short.unconditional.scored ? t('nativeForward.scored', { ...short.unconditional, ...short })
      : short.conditionalIntent.scored ? t('nativeForward.conditionalOnly', { count: short.conditionalIntent.scored, abstained: short.abstained })
        : t('nativeForward.abstainedOnly', { count: short.uniqueWindows, abstained: short.abstained })
  } else if (short?.pending) line = t('nativeForward.waiting')
  else if (short?.excluded) line = t('nativeForward.excludedOnly')
  if (loading && !safe) line = t('nativeForward.loading')
  if (failed) line = t('nativeForward.unavailable')
  const summary = (row: NativeForwardSummary) => <section key={row.horizon} className="min-w-0 space-y-1 border-t border-border pt-2 text-xs leading-5">
    <h4 className="font-medium">{t('nativeForward.horizon', { horizon: t(`typesafe.${row.horizon}`), count: row.sessions, unit: t(asset === 'BTC' ? 'nativeForward.days' : 'nativeForward.sessions') })}</h4>
    <p className="text-muted-foreground">{t('nativeForward.counts', { ...row })}</p>
    <p>{t(row.unconditional.scored ? 'nativeForward.unconditional' : 'nativeForward.noUnconditional', { ...row.unconditional })}</p>
    <p>{t(row.conditionalIntent.scored ? 'nativeForward.conditional' : 'nativeForward.noConditional', { ...row.conditionalIntent })}</p>
    <p>{t('nativeForward.abstained', { count: row.abstained })}</p>
    <p className="text-muted-foreground">{t('nativeForward.conditions', { ...row.conditions })}</p>
  </section>
  const cohorts = safe ? [safe.current, ...safe.cohorts.filter(row => row.analysisVersion !== safe.current?.analysisVersion || row.strategyId !== safe.current?.strategyId || row.strategyVersion !== safe.current?.strategyVersion)].filter((row): row is NonNullable<typeof row> => !!row) : []
  return <div className="min-w-0 py-2" data-testid="native-forward-validation">
    <p role={failed ? 'alert' : loading ? 'status' : undefined} className={`text-xs leading-5 ${failed ? 'text-warning' : 'text-muted-foreground'}`}>{t('nativeForward.title')} · {line}</p>
    {safe && (safe.invalidRecords > 0 || safe.orphanedRecords > 0) && <p role="alert" className="mt-1 text-xs text-warning">{t('nativeForward.integrity', { invalid: safe.invalidRecords, orphaned: safe.orphanedRecords })}</p>}
    {safe && <IntelligenceDisclosure title={t('nativeForward.details')}>
      {readFailed && <p className="text-xs text-warning">{t('nativeForward.retained')}</p>}
      <p className="text-xs leading-5 text-muted-foreground">{t('nativeForward.meaning')}</p>
      {cohorts.map(cohort => <section key={`${cohort.analysisVersion}:${cohort.strategyId}:${cohort.strategyVersion}`} className="min-w-0 space-y-2">
        <h3 className="text-xs font-medium">{t(cohort === safe.current ? 'nativeForward.current' : 'nativeForward.historical')} · {t('nativeForward.cohort', { ...cohort, version: cohort.strategyVersion })}</h3>
        <div className="grid min-w-0 gap-3 sm:grid-cols-3">{cohort.summaries.map(summary)}</div>
      </section>)}
      <p className="text-xs leading-5 text-muted-foreground">{t('nativeForward.conditionalMeaning')}</p>
      {safe.excludedSessions.length > 0 && <p className="text-xs text-warning">{t('nativeForward.sessionExclusions', { count: safe.excludedSessions.length })}</p>}
      {(safe.historyTruncated || safe.rowsTruncated) && <p className="text-xs text-warning">{t('nativeForward.truncated')}</p>}
      <IntelligenceDisclosure title={t('nativeForward.archive')} summary={`${safe.rows.length}`}>
        {safe.rows.map(row => <section key={row.publicationId} className="space-y-1 border-t border-border pt-2 text-xs leading-5">
          <p>{t('nativeForward.issued', { time: formatMonitorDate(row.issuedAt) })} · {row.analysisVersion}</p>
          {row.outcomes.map(outcome => <div key={outcome.horizon}>
            <p>{t(`typesafe.${outcome.horizon}`)} · {t(`nativeForward.${outcome.status}`)} · {t(`nativeForward.${outcome.intentKind}Kind`)}</p>
            {outcome.start && outcome.end && <p className="text-muted-foreground">{t('nativeForward.outcome', { ...outcome, change: outcome.changePercent?.toFixed(2) ?? '—' })}</p>}
          </div>)}
        </section>)}
      </IntelligenceDisclosure>
    </IntelligenceDisclosure>}
  </div>
}
