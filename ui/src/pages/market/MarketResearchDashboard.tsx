import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MonitorAsset } from '../../api/market-monitor'
import type { DashboardEvent, DashboardMetric, DashboardModule, DashboardSeries, DashboardSource, DashboardUnit, DashboardWindow, MarketDashboardReport } from '../../api/market-dashboard'
import { useMarketDashboard } from '../../hooks/useMarketDashboard'
import { Button } from '../../components/ui/button'
import { getIntlLocale } from '../../lib/intl'
import { formatMonitorDate } from './market-monitor-format'

export function formatDashboardValue(value: number | null, unit: DashboardUnit, compact = false): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const number = new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: unit === 'sats' || unit === 'count' ? 0 : unit === 'btc' ? 4 : unit === 'percent' ? 4 : 2, ...(compact ? { notation: 'compact' as const } : {}) }).format(value)
  return unit === 'usd' ? `$${number}` : unit === 'percent' ? `${number}%` : unit === 'btc' ? `${number} BTC` : unit === 'sats' ? `${number} sats` : unit === 'ratio' ? `${number}×` : number
}

export function MarketResearchDashboard({ asset, visible, revisionKey, onSelectSnapshot }: { asset: MonitorAsset; visible: boolean; revisionKey?: string; onSelectSnapshot?: (id: string) => void }) {
  const [days, setDays] = useState<DashboardWindow>(90)
  const dashboard = useMarketDashboard(asset, days, visible, revisionKey)
  return <MarketResearchPanels asset={asset} days={days} onDaysChange={setDays} report={dashboard.report} loading={dashboard.loading} failed={dashboard.failed} onRefresh={dashboard.refresh} onSelectSnapshot={onSelectSnapshot} />
}

export function MarketResearchPanels({ asset, days, onDaysChange, report, loading, failed, onRefresh, onSelectSnapshot }: { asset: MonitorAsset; days: DashboardWindow; onDaysChange: (days: DashboardWindow) => void; report: MarketDashboardReport | null; loading: boolean; failed: boolean; onRefresh: () => void; onSelectSnapshot?: (id: string) => void }) {
  const { t } = useTranslation()
  return <section id="market-research" className="oa-data-surface min-w-0 scroll-mt-4" aria-label={t('marketMonitor.research.title')}>
    <div className="oa-data-surface-header flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-sm font-semibold">{t('marketMonitor.research.title')}</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{t('marketMonitor.research.intro')}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t('marketMonitor.research.window')} className="flex gap-0.5">{([30, 90, 365] as const).map(value => <Button key={value} variant={days === value ? 'secondary' : 'ghost'} size="sm" aria-pressed={days === value} onClick={() => onDaysChange(value)}>{t('marketMonitor.research.days', { count: value })}</Button>)}</div>
        <Button variant="ghost" size="sm" disabled={loading} aria-label={t('marketMonitor.research.refresh')} onClick={onRefresh}><RefreshCw className="size-3.5" aria-hidden /></Button>
      </div>
    </div>
    <div className="space-y-5 p-4">
      {loading && <p role="status" className="text-xs text-muted-foreground">{t('marketMonitor.research.loading')}</p>}
      {failed && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-warning">{t('marketMonitor.research.failed')}<Button variant="ghost" size="sm" onClick={onRefresh}>{t('marketMonitor.retry')}</Button></div>}
      {report && <>
        {report.illustrative && <p className="text-xs font-medium text-warning">{t('marketMonitor.research.illustrative')}</p>}
        <p className="text-[11px] leading-5 text-muted-foreground">{t('marketMonitor.research.generated', { time: formatMonitorDate(report.generatedAt) })}</p>
        {report.modules.length === 0 && <p className="text-xs text-muted-foreground">{t('marketMonitor.research.empty')}</p>}
        {report.modules.map(module => <ResearchModule key={module.id} module={module} asset={asset} generatedAt={report.generatedAt} onSelectSnapshot={onSelectSnapshot} />)}
      </>}
    </div>
  </section>
}

function ResearchModule({ module, asset, generatedAt, onSelectSnapshot }: { module: DashboardModule; asset: MonitorAsset; generatedAt: string; onSelectSnapshot?: (id: string) => void }) {
  const { t } = useTranslation()
  const price = module.series.filter(series => series.group === 'price' && series.unit === 'usd')
  const rest = module.series.filter(series => !price.includes(series))
  const normalized = rest.filter(series => series.group === 'strategy' && series.unit === 'index')
  const observedHistory = rest.filter(series => (series.group === 'strategy' || series.group === 'strc') && !series.maxGapMs && !series.id.startsWith('strc-dividend') && !(normalized.length > 1 && normalized.includes(series)))
  const strc = rest.filter(series => series.group === 'strc' && !observedHistory.includes(series))
  const derivatives = rest.filter(series => series.group === 'derivatives')
  const individual = rest.filter(series => !strc.includes(series) && !derivatives.includes(series) && !observedHistory.includes(series) && !(normalized.length > 1 && normalized.includes(series)))
  const events = orderedDashboardEvents(module.events, generatedAt)
  const strcMetrics = module.metrics.filter(metric => metric.id.startsWith('strc-'))
  const primaryMetrics = module.metrics.filter(metric => !strcMetrics.includes(metric))
  return <div className="min-w-0 border-t border-border pt-4 first:border-t-0 first:pt-0">
    <h3 className="mb-3 text-sm font-semibold">{module.label}</h3>
    {primaryMetrics.length > 0 && <MetricGrid metrics={primaryMetrics.slice(0, 6)} />}
    {primaryMetrics.length > 6 && <details className="mb-4 text-xs"><summary className="cursor-pointer text-primary">{t('marketMonitor.research.moreMetrics', { count: primaryMetrics.length - 6 })}</summary><div className="mt-4"><MetricGrid metrics={primaryMetrics.slice(6)} /></div></details>}
    {price.length > 0 && <SeriesPlot series={price} title={t('marketMonitor.research.priceStructure', { asset })} events={module.events} />}
    {normalized.length > 1 && <SeriesPlot series={normalized} title={t('marketMonitor.research.normalized')} events={[]} />}
    {derivatives.length > 0 && <div className="mt-3 border-t border-border/60 pt-3"><h4 className="mb-3 text-xs font-semibold">{t('marketMonitor.research.derivatives')}</h4><div className="grid min-w-0 gap-x-6 gap-y-5 lg:grid-cols-2">{derivatives.map(series => <SeriesPlot key={series.id} series={[series]} title={series.label} events={[]} />)}</div></div>}
    {observedHistory.length > 0 && <details className="my-3 text-xs"><summary className="cursor-pointer text-primary">{t('marketMonitor.research.metricHistory', { count: observedHistory.length })}</summary><div className="mt-4 grid min-w-0 gap-x-6 gap-y-5 lg:grid-cols-2">{observedHistory.map(series => <SeriesPlot key={series.id} series={[series]} title={series.label} events={[]} />)}</div></details>}
    {individual.length > 0 && <div className="grid min-w-0 gap-x-6 gap-y-5 lg:grid-cols-2">{individual.map(series => <SeriesPlot key={series.id} series={[series]} title={series.label} events={[]} />)}</div>}
    {(strc.length > 0 || strcMetrics.length > 0) && <div className="mt-3 border-t border-border/60 pt-3"><h4 className="mb-3 text-xs font-semibold">{t('marketMonitor.research.strc')}</h4><MetricGrid metrics={strcMetrics} /><div className="grid min-w-0 gap-x-6 gap-y-5 lg:grid-cols-2">{strc.map(series => <SeriesPlot key={series.id} series={[series]} title={series.label} events={module.events.filter(event => event.kind === 'dividend')} />)}</div></div>}
    {module.notes.length > 0 && <ul className="mt-3 space-y-1 text-[11px] leading-5 text-muted-foreground">{module.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    {events.length > 0 && <div className="mt-4 border-t border-border/60 pt-3"><h4 className="mb-2 text-xs font-semibold">{t('marketMonitor.research.events')}</h4><p className="mb-2 text-[11px] text-muted-foreground">{t('marketMonitor.research.eventTiming')}</p><EventList events={events.slice(0, 6)} onSelectSnapshot={onSelectSnapshot} />{events.length > 6 && <details className="mt-3 text-xs"><summary className="cursor-pointer text-primary">{t('marketMonitor.research.moreEvents', { count: events.length - 6 })}</summary><div className="mt-3"><EventList events={events.slice(6)} onSelectSnapshot={onSelectSnapshot} /></div></details>}</div>}
  </div>
}

function MetricGrid({ metrics }: { metrics: DashboardMetric[] }) {
  const { t } = useTranslation()
  return <dl className="mb-4 grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-3">{metrics.map(metric => <div key={metric.id} className="min-w-0"><dt className="text-xs text-muted-foreground">{metric.label}</dt><dd className="mt-1 break-words text-xl font-semibold tabular-nums">{formatDashboardValue(metric.value, metric.unit)}{metric.unit === 'months' && <span className="ml-1 text-xs font-normal">{t('marketMonitor.research.months')}</span>}</dd><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{metric.description}</p><SourceDisclosure source={metric.source} /></div>)}</dl>
}

function SourceDisclosure({ source }: { source: DashboardSource }) {
  const { t } = useTranslation()
  const safeUrl = source.url && /^https?:\/\//i.test(source.url) ? source.url : null
  return <div className="mt-2 break-words text-[10px] leading-4 text-muted-foreground">
    <div className="flex flex-wrap gap-x-2">{safeUrl ? <a href={safeUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{source.provider}</a> : <span>{source.provider}</span>}<span className={source.status === 'ok' ? '' : 'text-warning'}>{t(`marketMonitor.research.${source.status}`)}</span><span>{t('marketMonitor.research.dataAt', { time: source.dataAt ? formatMonitorDate(source.dataAt) : t('marketMonitor.research.unknownTime') })}</span></div>
    <details className="mt-1"><summary className="cursor-pointer hover:text-foreground">{t('marketMonitor.research.provenance')}</summary><dl className="mt-1 space-y-1"><div><dt className="inline">{t('marketMonitor.research.fetchedAt')} </dt><dd className="inline">{formatMonitorDate(source.fetchedAt)}</dd></div><div><dt className="inline">{t('marketMonitor.research.publishedAt')} </dt><dd className="inline">{source.publishedAt ? formatMonitorDate(source.publishedAt) : t('marketMonitor.research.unknownTime')}</dd></div>{source.formula && <div><dt className="inline">{t('marketMonitor.research.formula')} </dt><dd className="inline">{source.formula}</dd></div>}{source.formulaVersion && <div><dt className="inline">{t('marketMonitor.research.version')} </dt><dd className="inline">{source.formulaVersion}</dd></div>}{source.detail && <div><dd>{source.detail}</dd></div>}</dl></details>
  </div>
}

/** Preserve real timestamps and add explicit breaks; no interpolation across gaps. */
export function dashboardChartRows(series: DashboardSeries[]): Array<{ at: number; [key: string]: number | null }> {
  const rows = new Map<number, { at: number; [key: string]: number | null }>()
  const rowAt = (at: number) => { let row = rows.get(at); if (!row) { row = { at }; for (const item of series) row[item.id] = null; rows.set(at, row) } return row }
  for (const item of series) {
    const points = item.points.filter(point => Number.isFinite(Date.parse(point.at)) && Number.isFinite(point.value)).toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))
    for (let index = 0; index < points.length; index++) {
      const point = points[index]!, at = Date.parse(point.at)
      const previous = points[index - 1]
      if (previous && item.maxGapMs && at - Date.parse(previous.at) > item.maxGapMs) rowAt(Date.parse(previous.at) + item.maxGapMs)[item.id] = null
      rowAt(at)[item.id] = point.value
    }
  }
  return Array.from(rows.values()).sort((a, b) => a.at - b.at)
}

const strokes = ['var(--primary)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
function SeriesPlot({ series, title, events }: { series: DashboardSeries[]; title: string; events: DashboardEvent[] }) {
  const { t } = useTranslation()
  const id = useId()
  const rows = dashboardChartRows(series)
  const first = rows.at(0)?.at, last = rows.at(-1)?.at
  const unit = series[0]!.unit
  const markers = events.filter(event => { const at = Date.parse(dashboardEventAt(event)); return first != null && last != null && at >= first && at <= last }).slice(-12)
  const latest = series[0]!.points.at(-1)
  const sparse = series.every(item => !item.maxGapMs || item.points.length < 2)
  const dailyDates = series.every(item => item.timeAxis === 'utc-date' || (item.timeAxis !== 'instant' && item.points.every(point => /^\d{4}-\d{2}-\d{2}$/.test(point.at))))
  const date = (value: number) => new Intl.DateTimeFormat(getIntlLocale(), { month: 'short', day: 'numeric', ...(dailyDates ? { timeZone: 'UTC' } : first != null && last != null && last - first <= 172_800_000 ? { hour: '2-digit' as const, minute: '2-digit' as const } : {}) }).format(value)
  return <figure className="mb-4 min-w-0" aria-labelledby={id}>
    <figcaption id={id} className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs"><span className="font-medium">{title}</span><span className="tabular-nums text-muted-foreground">{latest ? `${series.length > 1 ? `${series[0]!.label} · ` : ''}${formatDashboardValue(latest.value, unit)}` : '—'}</span></figcaption>
    {rows.length > 0 ? <div className={series.some(item => item.id === 'price-close') ? 'h-64 min-w-0' : 'h-44 min-w-0'}><ResponsiveContainer width="100%" height="100%" minWidth={0}><LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} accessibilityLayer={false} role="img" aria-label={`${title} · ${first == null ? '' : date(first)} – ${last == null ? '' : date(last)}`}>
      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
      <XAxis dataKey="at" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={date} minTickGap={36} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
      <YAxis domain={['auto', 'auto']} width={72} tickFormatter={value => formatDashboardValue(Number(value), unit, true)} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
      <Tooltip labelFormatter={value => formatMonitorDate(dailyDates ? new Date(Number(value)).toISOString().slice(0, 10) : new Date(Number(value)).toISOString())} formatter={(value, name) => [formatDashboardValue(Number(value), unit), String(name)]} contentStyle={{ fontSize: 11, background: 'var(--background)', borderColor: 'var(--border)', borderRadius: 4 }} />
      {series.map((item, index) => <Line key={item.id} data={dashboardChartRows([item])} dataKey={item.id} name={item.label} type="linear" stroke={strokes[index % strokes.length]} strokeWidth={item.maxGapMs ? 1.6 : 0} dot={!item.maxGapMs || item.points.length < 2 ? { r: 2.5 } : false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />)}
      {series.filter(item => item.referenceValue != null).map(item => <ReferenceLine key={item.id} y={item.referenceValue} stroke="var(--muted-foreground)" strokeDasharray="4 4" ifOverflow="extendDomain" />)}
      {markers.map(event => <ReferenceLine key={event.id} x={Date.parse(dashboardEventAt(event))} stroke="var(--muted-foreground)" strokeDasharray="2 5" />)}
    </LineChart></ResponsiveContainer></div> : <p className="flex h-24 items-center border-y border-dashed border-border text-xs text-muted-foreground">{t('marketMonitor.research.noHistory')}</p>}
    {series.length > 1 && <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">{series.map((item, index) => <li key={item.id} className="flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ background: strokes[index % strokes.length] }} />{item.label}</li>)}</ul>}
    {sparse && rows.length > 0 && <p className="mt-1 text-[10px] text-muted-foreground">{t('marketMonitor.research.observations')}</p>}
    {series.map(item => <SourceDisclosure key={item.id} source={item.source} />)}
  </figure>
}

export function dashboardEventAt(event: DashboardEvent): string {
  return event.kind === 'judgment' || event.kind === 'wyckoff' ? event.availableAt ?? event.at : event.at
}

export function orderedDashboardEvents(events: DashboardEvent[], generatedAt: string): DashboardEvent[] {
  const today = generatedAt.slice(0, 10)
  return events.toSorted((a, b) => {
    const aUpcoming = a.kind === 'dividend' && a.at.slice(0, 10) > today
    const bUpcoming = b.kind === 'dividend' && b.at.slice(0, 10) > today
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1
    const delta = Date.parse(dashboardEventAt(a)) - Date.parse(dashboardEventAt(b))
    return aUpcoming ? delta : -delta
  })
}

function EventList({ events, onSelectSnapshot }: { events: DashboardEvent[]; onSelectSnapshot?: (id: string) => void }) {
  const { t } = useTranslation()
  return <ul className="space-y-3">{events.map(event => <li key={event.id} className="grid gap-1 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]"><div className="text-[11px] tabular-nums text-muted-foreground">{formatMonitorDate(dashboardEventAt(event))}</div><div className="min-w-0"><div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{event.label}</span>{event.level != null && <span className="tabular-nums text-muted-foreground">{formatDashboardValue(event.level, 'usd')}</span>}{event.snapshotId && onSelectSnapshot && <Button size="sm" variant="link" className="h-auto p-0 text-[11px]" onClick={() => onSelectSnapshot(event.snapshotId!)}>{t('marketMonitor.research.replay')}</Button>}{event.url && /^https?:\/\//i.test(event.url) && <a className="text-[11px] text-primary hover:underline" href={event.url} target="_blank" rel="noreferrer">{t('marketMonitor.research.original')}</a>}</div>{event.availableAt && event.availableAt !== event.at && <p className="mt-1 text-[11px] text-muted-foreground">{t(event.kind === 'judgment' || event.kind === 'wyckoff' ? 'marketMonitor.research.eventAt' : 'marketMonitor.research.capturedAt', { time: formatMonitorDate(event.kind === 'judgment' || event.kind === 'wyckoff' ? event.at : event.availableAt) })}</p>}{event.detail && <p className="mt-1 break-words text-[11px] leading-5 text-muted-foreground">{event.detail}</p>}</div></li>)}</ul>
}
