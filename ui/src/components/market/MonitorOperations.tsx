import { Download, RefreshCw } from 'lucide-react'
import type { MonitorAsset, MonitorHealthReport } from '../../api/market-monitor'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

type Props = {
  asset: MonitorAsset
  hours: 24 | 72
  onHoursChange: (hours: 24 | 72) => void
  report: MonitorHealthReport | null
  loading: boolean
  error: string | null
  onRefresh: () => Promise<void>
}

const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : '—'
const duration = (value: number | null | undefined) => value == null ? '—' : `${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`
const statusLabel = { ok: 'Healthy', degraded: 'Degraded', unavailable: 'Unavailable' }

function exportReport(report: MonitorHealthReport) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `market-health-${report.asset.toLowerCase()}-${report.window.hours}h.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function MonitorOperations({ asset, hours, onHoursChange, report, loading, error, onRefresh }: Props) {
  const summary = report?.summary
  return <section aria-label={`${asset} monitor operations`} className="mx-auto max-w-[1320px] border-t border-border pb-8 pt-3">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{asset} · Monitor operations</h3>
      <div className="flex flex-wrap items-center gap-1">
        <div role="group" aria-label="Report window" className="flex gap-1">
          {([24, 72] as const).map((value) => <Button key={value} size="sm" variant={hours === value ? 'secondary' : 'ghost'} aria-pressed={hours === value} onClick={() => onHoursChange(value)}>{value} hours</Button>)}
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void onRefresh()} aria-label="Refresh health report"><RefreshCw className="size-3.5" /></Button>
        <Button variant="ghost" size="sm" disabled={!report} onClick={() => report && exportReport(report)}><Download className="size-3.5" />Export report</Button>
      </div>
    </div>
    {error && <p role="status" className="mb-3 text-xs text-warning">Health report unavailable. {report ? 'Last successful report retained. ' : ''}{error}</p>}
    {!report && !error && <p role="status" className="text-xs text-muted-foreground">Loading health report…</p>}
    {report && summary && <>
      <p className="text-[11px] leading-5 text-muted-foreground">Window: {date(report.window.from)} – {date(report.window.to)}. Recorded samples: {date(report.window.firstSampleAt)} – {date(report.window.lastSampleAt)}.</p>
      {report.window.truncated && <p role="status" className="mt-1 text-xs text-warning">Showing the latest {report.window.sampleLimit.toLocaleString()} attempts; earlier attempts in this window are excluded.</p>}
      {summary.attempts === 0 ? <p className="mt-4 text-xs text-muted-foreground">No scan attempts recorded in this window.</p> : <>
        <dl className="my-4 grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-4">
          {[
            ['Recorded attempts', String(summary.attempts)],
            ['Scan completion', summary.successRatePercent == null ? '—' : `${summary.successRatePercent}%`],
            ['Failed attempts', String(summary.failed)],
            ['Scans with source issues', `${summary.scansWithSourceIssues} / ${summary.scansWithSourceChecks} checked`],
            ['Scheduled / manual', `${summary.scheduled} / ${summary.manual}`],
            ['New / unchanged evidence', `${summary.stored} / ${summary.duplicates}`],
            ['Average duration', duration(summary.averageDurationMs)],
            ['95th percentile duration', duration(summary.p95DurationMs)],
          ].map(([label, value]) => <div key={label}><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{value}</dd></div>)}
        </dl>
        <p className="mb-4 text-[11px] leading-5 text-muted-foreground">Completion measures recorded scan attempts, not continuous uptime or trading performance. {summary.attempts - summary.scansWithSourceChecks} attempts have no source checks; {summary.durationSamples} have duration measurements. Consecutive failures: {summary.consecutiveFailures}. Scan recoveries: {summary.recoveries}.</p>
        <div className="overflow-x-auto">
          <table aria-label="Data source reliability" className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-border text-[11px] text-muted-foreground"><tr>{['Source', 'Last check', 'Healthy', 'Degraded', 'Unavailable', 'Recoveries', 'Checked / data time'].map((label) => <th key={label} scope="col" className="pb-2 pr-4 font-medium">{label}</th>)}</tr></thead>
            <tbody>{report.sources.map((source) => <tr key={`${source.id}:${source.provider}`} className="border-b border-border/50 align-top">
              <td className="py-2.5 pr-4"><div className="font-medium">{source.label}</div><div className="mt-1 text-[11px] text-muted-foreground">{source.provider}</div></td>
              <td className={cn('py-2.5 pr-4', source.latestStatus === 'ok' ? 'text-success' : 'text-warning')}>{statusLabel[source.latestStatus]}</td>
              {[source.ok, source.degraded, source.unavailable, source.recoveries].map((count, index) => <td key={index} className="py-2.5 pr-4 tabular-nums">{count}</td>)}
              <td className="py-2.5 text-[11px] text-muted-foreground"><div>{date(source.lastCheckedAt)}</div><div className="mt-1">{date(source.lastDataAt)}</div></td>
            </tr>)}</tbody>
          </table>
        </div>
        {!report.sources.length && <p className="mt-2 text-xs text-muted-foreground">Source health is unknown for these attempts.</p>}
        <div className="mt-5 overflow-x-auto">
          <table aria-label="Recent scan attempts" className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b border-border text-[11px] text-muted-foreground"><tr>{['Attempt time', 'Trigger', 'Result', 'Duration', 'Detail'].map((label) => <th key={label} scope="col" className="pb-2 pr-4 font-medium">{label}</th>)}</tr></thead>
            <tbody>{report.recent.map((receipt) => <tr key={receipt.id} className="border-b border-border/50 align-top">
              <td className="py-2.5 pr-4 text-muted-foreground">{date(receipt.completedAt ?? receipt.requestedAt)}</td>
              <td className="py-2.5 pr-4">{receipt.trigger}</td>
              <td className={cn('py-2.5 pr-4', receipt.outcome === 'failed' && 'text-warning')}>{receipt.outcome === 'duplicate' ? 'Unchanged evidence' : receipt.outcome === 'stored' ? 'New evidence' : 'Failed'}</td>
              <td className="py-2.5 pr-4 tabular-nums">{duration(receipt.durationMs)}</td>
              <td className="max-w-sm break-words py-2.5 text-muted-foreground">{receipt.error ?? receipt.strategyId ?? '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
    </>}
  </section>
}
