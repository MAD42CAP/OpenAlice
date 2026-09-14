import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Download, RefreshCw, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type {
  MonitorAlert,
  MonitorAsset,
  MonitorEvaluation,
  MonitorSettings,
  MonitorSnapshot,
  MonitorStrategy,
  MonitorSchedulerStatus,
} from '../api/market-monitor'
import type { HistoricalBar } from '../api/market'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/ui/button'
import { EmptyState, Skeleton } from '../components/StateViews'
import { cn } from '../lib/utils'
import { useMarketMonitorStatus } from '../hooks/useMarketMonitorStatus'
import { useMarketMonitorHealth } from '../hooks/useMarketMonitorHealth'
import { MonitorOperations } from '../components/market/MonitorOperations'
import { getIntlLocale } from '../lib/intl'
import {
  monitorAlertCopy,
  monitorEvidenceCopy,
  monitorHypothesisCopy,
  monitorSourceDetail,
  monitorSourceLabel,
  monitorStrategyLabel,
} from './market/market-monitor-presentation'

const ASSETS: MonitorAsset[] = ['BTC', 'TSLA']
const DEFAULT_SETTINGS: MonitorSettings = {
  backgroundEnabled: false,
  enabledAssets: ASSETS,
  strategyId: 'evidence-chain-v1',
  intervalMinutes: 15,
  notifications: false,
  alertConfidence: 68,
  abnormalVolumeRatio: 1.8,
  abnormalMovePercent: 1.5,
}

type Timeframe = '1D' | '1H'

function formatNumber(value: unknown, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: digits }).format(value)
    : '—'
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? '—' : `${value > 0 ? '+' : ''}${formatNumber(value)}%`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(getIntlLocale())
}

function usePersistedAsset(): [MonitorAsset, (asset: MonitorAsset) => void] {
  const [asset, setAssetState] = useState<MonitorAsset>(() => window.localStorage.getItem('market-monitor.asset') === 'TSLA' ? 'TSLA' : 'BTC')
  const setAsset = (next: MonitorAsset) => {
    window.localStorage.setItem('market-monitor.asset', next)
    setAssetState(next)
  }
  return [asset, setAsset]
}

export function MarketEvidenceMonitorPage({ visible = true }: { visible?: boolean }) {
  const { t } = useTranslation()
  const [asset, setAsset] = usePersistedAsset()
  const [timeframe, setTimeframe] = useState<Timeframe>('1D')
  const [settings, setSettings] = useState<MonitorSettings>(DEFAULT_SETTINGS)
  const [strategies, setStrategies] = useState<MonitorStrategy[]>([])
  const [history, setHistory] = useState<Record<MonitorAsset, MonitorSnapshot[]>>({ BTC: [], TSLA: [] })
  const [alerts, setAlerts] = useState<MonitorAlert[]>([])
  const [evaluation, setEvaluation] = useState<MonitorEvaluation | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const runtime = useMarketMonitorStatus(visible)
  const [reportHours, setReportHours] = useState<24 | 72>(24)
  const [healthRevision, setHealthRevision] = useState(0)
  const health = useMarketMonitorHealth(asset, reportHours, visible, `${runtime.status?.assets.find((item) => item.asset === asset)?.lastReceipt?.id ?? ''}:${healthRevision}`)
  const seenAlerts = useRef<Set<string> | null>(null)
  const loadGeneration = useRef(0)
  const snapshots = history[asset]
  const snapshot = snapshots.at(-1) ?? null

  const notifyNewAlerts = useCallback((next: MonitorAlert[], allowNotifications: boolean) => {
    if (!seenAlerts.current) {
      seenAlerts.current = new Set(next.map((item) => item.id))
      return
    }
    const fresh = next.filter((item) => !seenAlerts.current!.has(item.id))
    next.forEach((item) => seenAlerts.current!.add(item.id))
    if (!allowNotifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    fresh.forEach((item) => new Notification(item.title, { body: item.message, tag: item.fingerprint }))
  }, [])

  const loadState = useCallback(async (initial = false) => {
    const request = ++loadGeneration.current
    try {
      const [nextSettings, nextStrategies] = await Promise.all([
        api.marketMonitor.settings(),
        api.marketMonitor.strategies(),
      ])
      const [btc, tsla, nextAlerts] = await Promise.all([
        api.marketMonitor.snapshots('BTC', 120, nextSettings.strategyId),
        api.marketMonitor.snapshots('TSLA', 120, nextSettings.strategyId),
        api.marketMonitor.alerts(undefined, 100),
      ])
      if (request !== loadGeneration.current) return
      setSettings(nextSettings)
      setStrategies(nextStrategies.strategies)
      setHistory({ BTC: btc.snapshots, TSLA: tsla.snapshots })
      setAlerts(nextAlerts.alerts)
      notifyNewAlerts(nextAlerts.alerts, nextSettings.notifications)
      setRefreshError(null)
      if (initial) setError(null)
    } catch (cause) {
      if (request !== loadGeneration.current) return
      const message = cause instanceof Error ? cause.message : String(cause)
      if (initial) setError(message)
      else setRefreshError(message)
    } finally {
      if (request === loadGeneration.current) setLoading(false)
    }
  }, [notifyNewAlerts])

  const scan = useCallback(async (target: MonitorAsset, trigger: 'manual' | 'scheduled') => {
    setScanning(true)
    try {
      const result = await api.marketMonitor.scan(target, trigger)
      // Reload persisted, active-strategy observations, including coalesced scans.
      await Promise.all([loadState(false), runtime.refresh()])
      setError(null)
      return result
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!history[target].length) setError(message)
      else setRefreshError(message)
      return null
    } finally {
      setScanning(false)
      setHealthRevision((revision) => revision + 1)
    }
  }, [history, loadState, runtime.refresh])

  useEffect(() => { void loadState(true) }, [loadState])

  useEffect(() => {
    if (!visible) return
    void api.marketMonitor.evaluation(asset).then(setEvaluation).catch(() => setEvaluation(null))
  }, [asset, snapshots.length, visible])

  useEffect(() => {
    if (!visible) return
    const refresh = () => { if (document.visibilityState === 'visible') void loadState(false) }
    const timer = window.setInterval(refresh, 30_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [loadState, visible])

  const saveSettings = async (next: MonitorSettings) => {
    if (next.notifications && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const permission = await Notification.requestPermission()
      next = { ...next, notifications: permission === 'granted' }
    }
    ++loadGeneration.current
    const saved = await api.marketMonitor.saveSettings(next)
    setSettings(saved)
    setHistory((current) => ({
      BTC: current.BTC.filter((row) => row.strategyId === saved.strategyId),
      TSLA: current.TSLA.filter((row) => row.strategyId === saved.strategyId),
    }))
    await Promise.all([loadState(false), runtime.refresh()])
  }

  const exportData = (format: 'json' | 'csv') => {
    const rows = history[asset]
    const content = format === 'json'
      ? `${JSON.stringify(rows, null, 2)}\n`
      : ['capturedAt,asset,price,bias,confidence,change1dPercent,change5dPercent,volumeRatio20d', ...rows.map((row) => [row.capturedAt, row.asset, row.metrics.lastPrice, row.hypothesis.bias, row.hypothesis.confidence, row.metrics.change1dPercent ?? '', row.metrics.change5dPercent ?? '', row.metrics.volumeRatio20d ?? ''].join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `market-evidence-${asset.toLowerCase()}.${format}`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader
        title={t('marketMonitor.title')}
        description={t('marketMonitor.description', { strategy: monitorStrategyLabel(t, settings.strategyId, strategies.find((strategy) => strategy.id === settings.strategyId)?.label ?? settings.strategyId) })}
        live={{ lastUpdated: snapshot ? new Date(snapshot.capturedAt) : null, label: snapshot ? t('marketMonitor.scannedAt', { time: formatDate(snapshot.capturedAt) }) : t('marketMonitor.waitingFirstScan'), hideDot: !snapshot }}
        right={<div className="flex items-center gap-1.5">
          {import.meta.env.VITE_DEMO_MODE && <span className="rounded-sm border border-warning/50 bg-warning/10 px-2 py-1 text-[10px] font-semibold tracking-wide text-warning">{t('marketMonitor.demoBadge')}</span>}
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen((value) => !value)} aria-label={t('marketMonitor.settingsTitle')}><Settings2 className="size-4" /></Button>
          <Button size="sm" onClick={() => void scan(asset, 'manual')} disabled={scanning}><RefreshCw className={cn('size-3.5', scanning && 'animate-spin')} />{t('marketMonitor.scanNow')}</Button>
        </div>}
      />

      {refreshError && <div role="status" className="mx-4 mt-2 flex items-center justify-between border-l-2 border-warning bg-warning/5 px-3 py-2 text-xs text-muted-foreground md:mx-6"><span>{t('marketMonitor.refreshFailed', { error: refreshError })}</span><Button variant="ghost" size="sm" onClick={() => void loadState(false)}>{t('marketMonitor.retry')}</Button></div>}

      {settingsOpen && <SettingsPanel settings={settings} strategies={strategies} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}

      <RuntimeStatus asset={asset} status={runtime.status} error={runtime.error} onRetry={runtime.refresh} />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3 md:px-6">
        <div role="tablist" aria-label={t('marketMonitor.monitoredAsset')} className="inline-flex rounded-md border border-border bg-muted/35 p-0.5">
          {ASSETS.map((item) => <button key={item} role="tab" aria-selected={asset === item} onClick={() => setAsset(item)} className={cn('rounded-[5px] px-4 py-1.5 text-xs font-semibold transition-colors', asset === item ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>{item}<span className="ml-1.5 font-normal text-muted-foreground">{item === 'BTC' ? t('marketMonitor.assetBitcoin') : t('marketMonitor.assetTesla')}</span></button>)}
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label={t('marketMonitor.chartTimeframe')} className="inline-flex rounded-md border border-border p-0.5">
            {(['1D', '1H'] as const).map((item) => <button key={item} aria-pressed={timeframe === item} onClick={() => setTimeframe(item)} className={cn('rounded px-2.5 py-1 text-[11px]', timeframe === item ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground')}>{item}</button>)}
          </div>
          <Button variant="ghost" size="sm" onClick={() => exportData('csv')} disabled={!snapshots.length}><Download className="size-3.5" />CSV</Button>
          <Button variant="ghost" size="sm" onClick={() => exportData('json')} disabled={!snapshots.length}>JSON</Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {loading && !snapshot ? <MonitorSkeleton /> : error && !snapshot ? <div><EmptyState title={t('marketMonitor.unavailable')} description={error} /><div className="-mt-9 flex justify-center pb-10"><Button onClick={() => void scan(asset, 'manual')}>{t('marketMonitor.retryScan')}</Button></div></div> : snapshot ? (
          <div className="mx-auto flex max-w-[1320px] flex-col gap-4 pb-8">
            <Overview snapshot={snapshot} timeframe={timeframe} />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.7fr)]">
              <EvidenceTable snapshot={snapshot} />
              <HypothesisPanel snapshot={snapshot} />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <ContextPanel snapshot={snapshot} />
              <SourcePanel snapshot={snapshot} />
            </div>
            <HistoryPanel snapshots={snapshots} evaluation={evaluation} alerts={alerts.filter((item) => item.asset === asset)} />
          </div>
        ) : <EmptyState title={t('marketMonitor.noObservations')} description={t('marketMonitor.noObservationsDescription')} />}
        <MonitorOperations asset={asset} hours={reportHours} onHoursChange={setReportHours} report={health.report} loading={health.loading} error={health.error} onRefresh={health.refresh} />
      </div>
    </div>
  )
}

function RuntimeStatus({ asset, status, error, onRetry }: { asset: MonitorAsset; status: MonitorSchedulerStatus | null; error: string | null; onRetry: () => Promise<void> }) {
  const { t } = useTranslation()
  const item = status?.assets.find((row) => row.asset === asset)
  const label = error ? t('marketMonitor.runtime.connectionUnavailable')
    : import.meta.env.VITE_DEMO_MODE ? t('marketMonitor.runtime.demoPaused')
    : !status ? t('marketMonitor.runtime.checking')
    : status.error ? t('marketMonitor.runtime.attention')
    : !status.running ? t('marketMonitor.runtime.stopped')
    : !status.backgroundEnabled ? t('marketMonitor.runtime.paused')
    : !item?.enabled ? t('marketMonitor.runtime.excluded', { asset })
    : item.scanning ? t('marketMonitor.runtime.scanning', { asset })
    : t('marketMonitor.runtime.active')
  return <section aria-label={t('marketMonitor.runtime.aria')} className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-4 py-2 text-[11px] text-muted-foreground md:px-6">
    <span role="status" className={cn('font-medium', (error || status?.error) && 'text-warning')}>{label}</span>
    {error ? <><span>{t('marketMonitor.runtime.retained', { error })}</span><Button variant="ghost" size="sm" onClick={() => void onRetry()}>{t('marketMonitor.runtime.retry')}</Button></> : <>
      {item?.lastReceipt && <span>{t('marketMonitor.runtime.lastAttempt', { time: formatDate(item.lastReceipt.completedAt ?? item.lastReceipt.requestedAt), outcome: t(`marketMonitor.outcome.${item.lastReceipt.outcome}`) })}</span>}
      {item?.nextScanAt && !import.meta.env.VITE_DEMO_MODE && <span>{t('marketMonitor.runtime.next', { time: formatDate(item.nextScanAt) })}</span>}
      {item?.lastError && <span className="text-warning">{item.lastError}</span>}
      {status?.error && <span className="text-warning">{status.error}</span>}
    </>}
  </section>
}

function Panel({ title, trailing, children }: { title: string; trailing?: React.ReactNode; children: React.ReactNode }) {
  return <section className="min-w-0 border-t border-border pt-3"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>{trailing}</div>{children}</section>
}

function Overview({ snapshot, timeframe }: { snapshot: MonitorSnapshot; timeframe: Timeframe }) {
  const { t } = useTranslation()
  const bars = timeframe === '1D' ? snapshot.chart.daily : snapshot.chart.intraday
  return <Panel title={t('marketMonitor.panels.marketState', { asset: snapshot.asset })} trailing={<span className="text-[11px] text-muted-foreground">{timeframe === '1D' ? snapshot.chart.dailyMeta.sourceId : snapshot.chart.intradayMeta?.sourceId ?? t('marketMonitor.chart.hourlyUnavailable')} · {formatDate(timeframe === '1D' ? snapshot.metrics.lastBarAt : snapshot.metrics.intraday.latestAt)}</span>}>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
      <div className="min-h-[260px] border-y border-border/60 py-3"><PriceChart bars={bars} unavailable={timeframe === '1H' && !snapshot.metrics.intraday.available} /></div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 content-start">
        <Metric label={t('marketMonitor.metrics.lastPrice')} value={snapshot.asset === 'BTC' ? `$${formatNumber(snapshot.metrics.lastPrice, 0)}` : `$${formatNumber(snapshot.metrics.lastPrice)}`} />
        <Metric label={t('marketMonitor.metrics.oneDayChange')} value={formatPercent(snapshot.metrics.change1dPercent)} tone={snapshot.metrics.change1dPercent} />
        <Metric label={t('marketMonitor.metrics.fiveDayChange')} value={formatPercent(snapshot.metrics.change5dPercent)} tone={snapshot.metrics.change5dPercent} />
        <Metric label={t('marketMonitor.metrics.weeklyFollowThrough')} value={formatPercent(snapshot.metrics.weeklyChangePercent)} tone={snapshot.metrics.weeklyChangePercent} />
        <Metric label={t('marketMonitor.metrics.sixtyDayRange')} value={snapshot.metrics.rangePosition60d == null ? '—' : `${Math.round(snapshot.metrics.rangePosition60d * 100)}%`} />
        <Metric label={t('marketMonitor.metrics.twentyDayVolume')} value={snapshot.metrics.volumeRatio20d == null ? '—' : `${formatNumber(snapshot.metrics.volumeRatio20d)}×`} />
        <Metric label={t('marketMonitor.metrics.latestHour')} value={formatPercent(snapshot.metrics.intraday.latestChangePercent)} tone={snapshot.metrics.intraday.latestChangePercent} />
        <Metric label={t('marketMonitor.metrics.rollingFourHours')} value={formatPercent(snapshot.metrics.intraday.fourHourChangePercent)} tone={snapshot.metrics.intraday.fourHourChangePercent} />
      </div>
    </div>
  </Panel>
}

function PriceChart({ bars, unavailable }: { bars: HistoricalBar[]; unavailable: boolean }) {
  const { t } = useTranslation()
  const points = useMemo(() => {
    const rows = bars.slice(-120)
    if (rows.length < 2) return ''
    const min = Math.min(...rows.map((row) => row.close))
    const max = Math.max(...rows.map((row) => row.close))
    const spread = max - min || 1
    return rows.map((row, index) => `${(index / (rows.length - 1)) * 100},${92 - ((row.close - min) / spread) * 80}`).join(' ')
  }, [bars])
  if (unavailable || !points) return <div className="flex h-[230px] items-center justify-center text-sm text-muted-foreground">{t('marketMonitor.chart.noHourlySeries')}</div>
  const latest = bars.at(-1)!
  const first = bars[Math.max(0, bars.length - 120)]
  const up = latest.close >= first.close
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-[230px] w-full" role="img" aria-label={t('marketMonitor.chart.aria', { price: formatNumber(latest.close) })}>
    {[20, 40, 60, 80].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} vectorEffect="non-scaling-stroke" className="stroke-border/60" />)}
    <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" strokeWidth="1.75" className={up ? 'stroke-success' : 'stroke-destructive'} />
  </svg>
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  return <div><div className="mb-1 text-[11px] text-muted-foreground">{label}</div><div className={cn('text-lg font-semibold tabular-nums', tone != null && tone > 0 && 'text-success', tone != null && tone < 0 && 'text-destructive')}>{value}</div></div>
}

function EvidenceTable({ snapshot }: { snapshot: MonitorSnapshot }) {
  const { t } = useTranslation()
  return <Panel title={t('marketMonitor.panels.evidenceChain')}><div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-xs"><thead className="border-b border-border text-[11px] text-muted-foreground"><tr><th className="pb-2 pr-3 font-medium">{t('marketMonitor.evidence.signal')}</th><th className="pb-2 pr-3 font-medium">{t('marketMonitor.evidence.frame')}</th><th className="pb-2 pr-3 font-medium">{t('marketMonitor.evidence.observedFact')}</th><th className="pb-2 font-medium">{t('marketMonitor.evidence.interpretation')}</th></tr></thead><tbody>{snapshot.evidence.map((item) => {
    const copy = monitorEvidenceCopy(t, snapshot, item, formatNumber)
    return <tr key={item.id} className="border-b border-border/50 align-top"><td className="py-3 pr-3 font-medium"><span className={cn('mr-2 inline-block size-1.5 rounded-full', item.tone === 'positive' ? 'bg-success' : item.tone === 'negative' ? 'bg-destructive' : 'bg-muted-foreground')} />{copy.label}</td><td className="py-3 pr-3 font-mono text-muted-foreground">{item.timeframe}</td><td className="py-3 pr-4 leading-5">{copy.observation}</td><td className="py-3 leading-5 text-muted-foreground">{copy.interpretation}</td></tr>
  })}</tbody></table></div></Panel>
}

function HypothesisPanel({ snapshot }: { snapshot: MonitorSnapshot }) {
  const { t } = useTranslation()
  const hypothesis = snapshot.hypothesis
  const copy = monitorHypothesisCopy(t, snapshot)
  return <Panel title={t('marketMonitor.panels.currentHypothesis')} trailing={<span className={cn('text-xs font-semibold tabular-nums', hypothesis.bias === 'bullish' ? 'text-success' : hypothesis.bias === 'bearish' ? 'text-destructive' : 'text-muted-foreground')}>{hypothesis.confidence}%</span>}><h4 className="text-lg font-semibold">{copy.label}</h4><p className="mt-2 text-xs leading-5 text-muted-foreground">{copy.summary}</p><ConditionList title={t('marketMonitor.panels.confirmation')} rows={copy.confirm} tone="positive" /><ConditionList title={t('marketMonitor.panels.invalidation')} rows={copy.invalidate} tone="negative" /><ConditionList title={t('marketMonitor.panels.alternatives')} rows={copy.alternatives} tone="neutral" /></Panel>
}

function ConditionList({ title, rows, tone }: { title: string; rows: string[]; tone: 'positive' | 'negative' | 'neutral' }) {
  return <div className="mt-4"><div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{title}</div><ul className="space-y-1.5 text-xs leading-5">{rows.map((row) => <li key={row} className="flex gap-2"><span className={cn('mt-2 size-1 shrink-0 rounded-full', tone === 'positive' ? 'bg-success' : tone === 'negative' ? 'bg-destructive' : 'bg-muted-foreground')} /><span>{row}</span></li>)}</ul></div>
}

function ContextPanel({ snapshot }: { snapshot: MonitorSnapshot }) {
  const { t } = useTranslation()
  const labels: Record<string, string> = { fundingRate: t('marketMonitor.context.fundingRate'), openInterest: t('marketMonitor.context.openInterest'), annualizedBasisPercent: t('marketMonitor.context.annualizedBasisPercent'), optionOpenInterest: t('marketMonitor.context.optionOpenInterest'), putCallOpenInterestRatio: t('marketMonitor.context.putCallOpenInterestRatio'), marketCap: t('marketMonitor.context.marketCap'), trailingPe: t('marketMonitor.context.trailingPe'), forwardPe: t('marketMonitor.context.forwardPe'), analystTargetMean: t('marketMonitor.context.analystTargetMean'), shortPercentFloat: t('marketMonitor.context.shortPercentFloat'), nextEarningsAt: t('marketMonitor.context.nextEarningsAt') }
  const rows = Object.entries(labels).filter(([key]) => snapshot.context[key] != null)
  return <Panel title={t('marketMonitor.panels.context', { asset: snapshot.asset })}><dl className="grid grid-cols-2 gap-x-5 gap-y-3">{rows.length ? rows.map(([key, label]) => <div key={key}><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium tabular-nums">{key.toLowerCase().includes('percent') || key === 'annualizedBasisPercent' ? `${formatNumber(snapshot.context[key])}%` : key.endsWith('At') ? formatDate(String(snapshot.context[key])) : formatNumber(snapshot.context[key])}</dd></div>) : <p className="col-span-2 text-xs text-muted-foreground">{t('marketMonitor.context.unavailable')}</p>}</dl>{snapshot.context.recentNews?.length ? <div className="mt-4 border-t border-border/60 pt-3"><div className="mb-2 text-[11px] font-semibold text-muted-foreground">{t('marketMonitor.context.recentNews')}</div><ul className="space-y-2">{snapshot.context.recentNews.map((item) => <li key={`${item.time}:${item.title}`} className="text-xs"><span className="text-muted-foreground">{formatDate(item.time)} · {item.source ?? t('marketMonitor.context.unknown')}</span><div className="mt-0.5 line-clamp-2">{item.title}</div></li>)}</ul></div> : null}</Panel>
}

function SourcePanel({ snapshot }: { snapshot: MonitorSnapshot }) {
  const { t } = useTranslation()
  return <Panel title={t('marketMonitor.panels.sourceHealth')}><div className="space-y-3">{snapshot.sourceHealth.map((source) => <div key={source.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2"><span className={cn('mt-1.5 size-2 rounded-full', source.status === 'ok' ? 'bg-success' : source.status === 'degraded' ? 'bg-warning' : 'bg-destructive')} /><div><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-xs font-medium">{monitorSourceLabel(t, source, snapshot.asset)}</span><span className="text-[10px] text-muted-foreground">{source.provider}</span></div><p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{monitorSourceDetail(t, source)}</p><div className="mt-0.5 text-[10px] text-muted-foreground/70">{t('marketMonitor.source.asOf', { time: formatDate(source.asOf) })}</div></div></div>)}</div></Panel>
}

function HistoryPanel({ snapshots, evaluation, alerts }: { snapshots: MonitorSnapshot[]; evaluation: MonitorEvaluation | null; alerts: MonitorAlert[] }) {
  const { t } = useTranslation()
  return <Panel title={t('marketMonitor.panels.history')} trailing={evaluation ? <span className="text-[11px] text-muted-foreground">{t('marketMonitor.history.summary', { resolved: evaluation.resolved, accuracy: evaluation.directionalAccuracy == null ? '—' : `${formatNumber(evaluation.directionalAccuracy)}%` })}</span> : undefined}><div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]"><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-xs"><thead className="border-b border-border text-left text-[11px] text-muted-foreground"><tr><th className="pb-2 font-medium">{t('marketMonitor.history.captured')}</th><th className="pb-2 font-medium">{t('marketMonitor.history.price')}</th><th className="pb-2 font-medium">{t('marketMonitor.history.hypothesis')}</th><th className="pb-2 text-right font-medium">{t('marketMonitor.history.confidence')}</th><th className="pb-2 text-right font-medium">{t('marketMonitor.history.trigger')}</th></tr></thead><tbody>{snapshots.slice(-12).reverse().map((row) => <tr key={row.id} className="border-b border-border/50"><td className="py-2.5 text-muted-foreground">{formatDate(row.capturedAt)}</td><td className="py-2.5 tabular-nums">{formatNumber(row.metrics.lastPrice)}</td><td className="py-2.5">{monitorHypothesisCopy(t, row).label}</td><td className="py-2.5 text-right tabular-nums">{row.hypothesis.confidence}%</td><td className="py-2.5 text-right text-muted-foreground">{t(`marketMonitor.history.${row.trigger}`)}</td></tr>)}</tbody></table></div><div><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground"><Bell className="size-3.5" />{t('marketMonitor.panels.recentAlerts')}</div>{alerts.length ? <ul className="space-y-2">{alerts.slice(-6).reverse().map((alert) => {
    const copy = monitorAlertCopy(t, alert, snapshots.find((row) => row.id === alert.snapshotId))
    return <li key={alert.id} className="border-l-2 border-warning pl-2 text-xs"><div className="font-medium">{copy.title}</div><div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{copy.message}</div></li>
  })}</ul> : <p className="text-xs text-muted-foreground">{t('marketMonitor.history.noAlerts')}</p>}</div></div></Panel>
}

function SettingsPanel({ settings, strategies, onSave, onClose }: { settings: MonitorSettings; strategies: MonitorStrategy[]; onSave: (settings: MonitorSettings) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldClass = 'mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground'
  const commit = async () => {
    setSaving(true)
    setError(null)
    try { await onSave(draft); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }
  return <form aria-label={t('marketMonitor.settingsTitle')} onSubmit={(event) => { event.preventDefault(); void commit() }} className="max-h-[60vh] shrink-0 overflow-y-auto border-b border-border bg-muted/20 px-4 py-3 md:px-6">
    <fieldset disabled={saving} className="mx-auto max-w-[1160px] space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={draft.backgroundEnabled} onChange={(event) => setDraft({ ...draft, backgroundEnabled: event.target.checked })} />{t('marketMonitor.settings.background')}</label>
        <fieldset className="flex items-center gap-3"><legend className="sr-only">{t('marketMonitor.settings.scheduledAssets')}</legend>{ASSETS.map((item) => <label key={item} className="flex items-center gap-1.5"><input type="checkbox" checked={draft.enabledAssets.includes(item)} onChange={(event) => setDraft({ ...draft, enabledAssets: event.target.checked ? [...draft.enabledAssets, item] : draft.enabledAssets.filter((asset) => asset !== item) })} />{item}</label>)}</fieldset>
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">{t('marketMonitor.settings.explanation')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-[11px] text-muted-foreground">{t('marketMonitor.settings.strategy')}<select className={fieldClass} value={draft.strategyId} onChange={(event) => setDraft({ ...draft, strategyId: event.target.value })}>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{monitorStrategyLabel(t, strategy.id, strategy.label)} v{strategy.version}</option>)}</select></label>
        <label className="text-[11px] text-muted-foreground">{t('marketMonitor.settings.interval')}<input className={fieldClass} type="number" required min={1} max={1440} value={draft.intervalMinutes} onChange={(event) => setDraft({ ...draft, intervalMinutes: Number(event.target.value) })} /></label>
        <label className="text-[11px] text-muted-foreground">{t('marketMonitor.settings.alertConfidence')}<input className={fieldClass} type="number" required min={50} max={95} value={draft.alertConfidence} onChange={(event) => setDraft({ ...draft, alertConfidence: Number(event.target.value) })} /></label>
        <label className="text-[11px] text-muted-foreground">{t('marketMonitor.settings.volumeRatio')}<input className={fieldClass} type="number" required min={1} max={10} step={0.1} value={draft.abnormalVolumeRatio} onChange={(event) => setDraft({ ...draft, abnormalVolumeRatio: Number(event.target.value) })} /></label>
        <label className="text-[11px] text-muted-foreground">{t('marketMonitor.settings.hourlyMove')}<input className={fieldClass} type="number" required min={0.1} max={25} step={0.1} value={draft.abnormalMovePercent} onChange={(event) => setDraft({ ...draft, abnormalMovePercent: Number(event.target.value) })} /></label>
      </div>
      {!draft.enabledAssets.length && <p role="alert" className="text-xs text-warning">{t('marketMonitor.settings.selectAsset')}</p>}
      {error && <p role="alert" className="text-xs text-warning">{t('marketMonitor.settings.saveFailed', { error })}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.notifications} onChange={(event) => setDraft({ ...draft, notifications: event.target.checked })} />{t('marketMonitor.settings.browserAlerts')}</label>
        <div className="flex gap-1"><Button type="button" variant="ghost" size="sm" onClick={onClose}>{t('marketMonitor.settings.cancel')}</Button><Button type="submit" size="sm" disabled={saving || !draft.enabledAssets.length}>{saving ? t('marketMonitor.settings.saving') : t('marketMonitor.settings.save')}</Button></div>
      </div>
    </fieldset>
  </form>
}

function MonitorSkeleton() {
  return <div className="mx-auto w-full max-w-[1320px] space-y-4"><Skeleton className="h-72 w-full" /><div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div></div>
}
