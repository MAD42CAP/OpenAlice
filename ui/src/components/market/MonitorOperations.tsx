import { Download, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MonitorAsset, MonitorHealthReport } from '../../api/market-monitor'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { getIntlLocale } from '../../lib/intl'
import { monitorSourceLabel } from '../../pages/market/market-monitor-presentation'

type Props = {
  asset: MonitorAsset
  hours: 24 | 72
  onHoursChange: (hours: 24 | 72) => void
  report: MonitorHealthReport | null
  loading: boolean
  error: string | null
  onRefresh: () => Promise<void>
}

const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString(getIntlLocale()) : '—'

function exportReport(report: MonitorHealthReport) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `market-health-${report.asset.toLowerCase()}-${report.window.hours}h.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function MonitorOperations({ asset, hours, onHoursChange, report, loading, error, onRefresh }: Props) {
  const { t } = useTranslation()
  const summary = report?.summary
  const duration = (value: number | null | undefined) => value == null ? '—' : t('marketMonitor.operations.seconds', { value: (value / 1000).toLocaleString(getIntlLocale(), { maximumFractionDigits: 2 }) })
  const statusLabel = { ok: t('marketMonitor.operations.healthy'), degraded: t('marketMonitor.operations.degraded'), unavailable: t('marketMonitor.operations.unavailableStatus') }
  return <section aria-label={t('marketMonitor.operations.aria', { asset })} className="mx-auto max-w-[1320px] border-t border-border pb-8 pt-3">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('marketMonitor.operations.title', { asset })}</h3>
      <div className="flex flex-wrap items-center gap-1">
        <div role="group" aria-label={t('marketMonitor.operations.reportWindow')} className="flex gap-1">
          {([24, 72] as const).map((value) => <Button key={value} size="sm" variant={hours === value ? 'secondary' : 'ghost'} aria-pressed={hours === value} onClick={() => onHoursChange(value)}>{t('marketMonitor.operations.hours', { count: value })}</Button>)}
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void onRefresh()} aria-label={t('marketMonitor.operations.refresh')}><RefreshCw className="size-3.5" /></Button>
        <Button variant="ghost" size="sm" disabled={!report} onClick={() => report && exportReport(report)}><Download className="size-3.5" />{t('marketMonitor.operations.export')}</Button>
      </div>
    </div>
    {error && <p role="status" className="mb-3 text-xs text-warning">{t('marketMonitor.operations.unavailable')}{report ? t('marketMonitor.operations.retained') : ''}{error}</p>}
    {!report && !error && <p role="status" className="text-xs text-muted-foreground">{t('marketMonitor.operations.loading')}</p>}
    {report && summary && <>
      <p className="text-[11px] leading-5 text-muted-foreground">{t('marketMonitor.operations.window', { from: date(report.window.from), to: date(report.window.to), first: date(report.window.firstSampleAt), last: date(report.window.lastSampleAt) })}</p>
      {report.window.truncated && <p role="status" className="mt-1 text-xs text-warning">{t('marketMonitor.operations.truncated', { count: report.window.sampleLimit })}</p>}
      {summary.attempts === 0 ? <p className="mt-4 text-xs text-muted-foreground">{t('marketMonitor.operations.noAttempts')}</p> : <>
        <dl className="my-4 grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-4">
          {[
            [t('marketMonitor.operations.recordedAttempts'), String(summary.attempts)],
            [t('marketMonitor.operations.completion'), summary.successRatePercent == null ? '—' : `${summary.successRatePercent}%`],
            [t('marketMonitor.operations.failedAttempts'), String(summary.failed)],
            [t('marketMonitor.operations.sourceIssues'), t('marketMonitor.operations.checked', { issues: summary.scansWithSourceIssues, checked: summary.scansWithSourceChecks })],
            [t('marketMonitor.operations.scheduledManual'), `${summary.scheduled} / ${summary.manual}`],
            [t('marketMonitor.operations.newUnchanged'), `${summary.stored} / ${summary.duplicates}`],
            [t('marketMonitor.operations.averageDuration'), duration(summary.averageDurationMs)],
            [t('marketMonitor.operations.p95Duration'), duration(summary.p95DurationMs)],
          ].map(([label, value]) => <div key={label}><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{value}</dd></div>)}
        </dl>
        <p className="mb-4 text-[11px] leading-5 text-muted-foreground">{t('marketMonitor.operations.qualification', { missing: summary.attempts - summary.scansWithSourceChecks, durations: summary.durationSamples, failures: summary.consecutiveFailures, recoveries: summary.recoveries })}</p>
        <div className="overflow-x-auto">
          <table aria-label={t('marketMonitor.operations.sourceTable')} className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-border text-[11px] text-muted-foreground"><tr>{[t('marketMonitor.operations.source'), t('marketMonitor.operations.lastCheck'), t('marketMonitor.operations.healthy'), t('marketMonitor.operations.degraded'), t('marketMonitor.operations.unavailableStatus'), t('marketMonitor.operations.recoveries'), t('marketMonitor.operations.checkedDataTime')].map((label) => <th key={label} scope="col" className="pb-2 pr-4 font-medium">{label}</th>)}</tr></thead>
            <tbody>{report.sources.map((source) => <tr key={`${source.id}:${source.provider}`} className="border-b border-border/50 align-top">
              <td className="py-2.5 pr-4"><div className="font-medium">{monitorSourceLabel(t, source, asset)}</div><div className="mt-1 text-[11px] text-muted-foreground">{source.provider}</div></td>
              <td className={cn('py-2.5 pr-4', source.latestStatus === 'ok' ? 'text-success' : 'text-warning')}>{statusLabel[source.latestStatus]}</td>
              {[source.ok, source.degraded, source.unavailable, source.recoveries].map((count, index) => <td key={index} className="py-2.5 pr-4 tabular-nums">{count}</td>)}
              <td className="py-2.5 text-[11px] text-muted-foreground"><div>{date(source.lastCheckedAt)}</div><div className="mt-1">{date(source.lastDataAt)}</div></td>
            </tr>)}</tbody>
          </table>
        </div>
        {!report.sources.length && <p className="mt-2 text-xs text-muted-foreground">{t('marketMonitor.operations.unknownSources')}</p>}
        <div className="mt-5 overflow-x-auto">
          <table aria-label={t('marketMonitor.operations.recentTable')} className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b border-border text-[11px] text-muted-foreground"><tr>{[t('marketMonitor.operations.attemptTime'), t('marketMonitor.operations.trigger'), t('marketMonitor.operations.result'), t('marketMonitor.operations.duration'), t('marketMonitor.operations.detail')].map((label) => <th key={label} scope="col" className="pb-2 pr-4 font-medium">{label}</th>)}</tr></thead>
            <tbody>{report.recent.map((receipt) => <tr key={receipt.id} className="border-b border-border/50 align-top">
              <td className="py-2.5 pr-4 text-muted-foreground">{date(receipt.completedAt ?? receipt.requestedAt)}</td>
              <td className="py-2.5 pr-4">{t(`marketMonitor.history.${receipt.trigger}`)}</td>
              <td className={cn('py-2.5 pr-4', receipt.outcome === 'failed' && 'text-warning')}>{receipt.outcome === 'duplicate' ? t('marketMonitor.operations.unchangedEvidence') : receipt.outcome === 'stored' ? t('marketMonitor.operations.newEvidence') : t('marketMonitor.operations.failed')}</td>
              <td className="py-2.5 pr-4 tabular-nums">{duration(receipt.durationMs)}</td>
              <td className="max-w-sm break-words py-2.5 text-muted-foreground">{receipt.error ?? receipt.strategyId ?? '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
    </>}
  </section>
}
