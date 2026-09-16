import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, CheckCircle2, Download, LoaderCircle, RefreshCw, Settings2, Sparkles, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type {
  MonitorAlert,
  MonitorAsset,
  MonitorEvaluation,
  MarketNarratorStatus,
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
import { formatMonitorDate as formatDate, formatContextValue } from './market/market-monitor-format'
import { getIntlLocale } from '../lib/intl'
import {
  monitorAlertCopy,
  monitorBriefHeadline,
  monitorBriefObservation,
  monitorBriefRisk,
  monitorEvidenceCopy,
  monitorHorizonLabel,
  monitorHypothesisCopy,
  monitorSourceDetail,
  monitorSourceLabel,
  monitorStrategyLabel,
  monitorTrendDirectionLabel,
  monitorTrendRegimeLabel,
  monitorWyckoffCondition,
  monitorWyckoffEventLabel,
  monitorWyckoffEventStatus,
  monitorWyckoffEvidence,
  monitorWyckoffPhaseLabel,
  monitorWyckoffTestLabel,
} from './market/market-monitor-presentation'

const ASSETS: MonitorAsset[] = ['BTC', 'TSLA', 'MSTR']
const EMPTY_HISTORY: Record<MonitorAsset, MonitorSnapshot[]> = { BTC: [], TSLA: [], MSTR: [] }
const DEFAULT_SETTINGS: MonitorSettings = {
  backgroundEnabled: false,
  codexNarrationEnabled: true,
  enabledAssets: ASSETS,
  strategyId: 'evidence-chain-v1',
  intervalMinutes: 15,
  notifications: false,
  alertConfidence: 68,
  abnormalVolumeRatio: 1.8,
  abnormalMovePercent: 1.5,
}

type Timeframe = '1D' | '1H'

type ActionFeedback = {
  state: 'running' | 'success' | 'error'
  message: string
  asset?: MonitorAsset
}

const NARRATOR_POLL_INTERVAL_MS = 2_000
const NARRATOR_POLL_ATTEMPTS = 450

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function formatNumber(value: unknown, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: digits }).format(value)
    : '—'
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? '—' : `${value > 0 ? '+' : ''}${formatNumber(value)}%`
}

function usePersistedAsset(): [MonitorAsset, (asset: MonitorAsset) => void] {
  const [asset, setAssetState] = useState<MonitorAsset>(() => {
    const saved = window.localStorage.getItem('market-monitor.asset') as MonitorAsset | null
    return saved && ASSETS.includes(saved) ? saved : 'BTC'
  })
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
  const [history, setHistory] = useState<Record<MonitorAsset, MonitorSnapshot[]>>(EMPTY_HISTORY)
  const [alerts, setAlerts] = useState<MonitorAlert[]>([])
  const [evaluation, setEvaluation] = useState<MonitorEvaluation | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanningAsset, setScanningAsset] = useState<MonitorAsset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [narratorStatus, setNarratorStatus] = useState<MarketNarratorStatus | null>(null)
  const [narratorRunning, setNarratorRunning] = useState(false)
  const [scanFeedback, setScanFeedback] = useState<ActionFeedback | null>(null)
  const [narratorFeedback, setNarratorFeedback] = useState<ActionFeedback | null>(null)
  const runtime = useMarketMonitorStatus(visible)
  const [reportHours, setReportHours] = useState<24 | 72>(24)
  const [healthRevision, setHealthRevision] = useState(0)
  const health = useMarketMonitorHealth(asset, reportHours, visible, `${runtime.status?.assets.find((item) => item.asset === asset)?.lastReceipt?.id ?? ''}:${healthRevision}`)
  const seenAlerts = useRef<Set<string> | null>(null)
  const loadGeneration = useRef(0)
  const narratorRunGeneration = useRef(0)
  const snapshots = history[asset]
  const snapshot = snapshots.at(-1) ?? null
  const scanning = scanningAsset !== null

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
      const nextNarrator = await api.marketMonitor.narratorStatus().catch(() => null)
      const [assetHistories, nextAlerts] = await Promise.all([
        Promise.all(ASSETS.map(async (item) => [item, (await api.marketMonitor.snapshots(item, 120, nextSettings.strategyId)).snapshots] as const)),
        api.marketMonitor.alerts(undefined, 100),
      ])
      if (request !== loadGeneration.current) return
      setSettings(nextSettings)
      setStrategies(nextStrategies.strategies)
      setNarratorStatus(nextNarrator)
      setHistory(Object.fromEntries(assetHistories) as Record<MonitorAsset, MonitorSnapshot[]>)
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
    setScanningAsset(target)
    if (trigger === 'manual') setScanFeedback({ state: 'running', asset: target, message: t('marketMonitor.feedback.scanRunning', { asset: target }) })
    try {
      const result = await api.marketMonitor.scan(target, trigger)
      // Reload persisted, active-strategy observations, including coalesced scans.
      await Promise.all([loadState(false), runtime.refresh()])
      setError(null)
      if (trigger === 'manual') {
        setScanFeedback({
          state: 'success',
          asset: target,
          message: t(result.stored ? 'marketMonitor.feedback.scanCompleteNew' : 'marketMonitor.feedback.scanCompleteUnchanged', { asset: target }),
        })
      }
      return result
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!history[target].length) setError(message)
      if (trigger === 'manual') setScanFeedback({ state: 'error', asset: target, message: t('marketMonitor.feedback.scanFailed', { asset: target, error: message }) })
      else setRefreshError(message)
      return null
    } finally {
      setScanningAsset(null)
      setHealthRevision((revision) => revision + 1)
    }
  }, [history, loadState, runtime.refresh, t])

  useEffect(() => { void loadState(true) }, [loadState])

  useEffect(() => {
    if (!visible) return
    let active = true
    setEvaluation(null)
    void api.marketMonitor.evaluation(asset).then(result => { if (active) setEvaluation(result) }).catch(() => { if (active) setEvaluation(null) })
    return () => { active = false }
  }, [asset, snapshots.at(-1)?.id, visible])

  useEffect(() => {
    if (!visible) return
    const refresh = () => { if (document.visibilityState === 'visible') void loadState(false) }
    const timer = window.setInterval(refresh, 30_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [loadState, visible])

  useEffect(() => () => { narratorRunGeneration.current += 1 }, [])

  const saveSettings = async (next: MonitorSettings) => {
    if (next.notifications && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const permission = await Notification.requestPermission()
      next = { ...next, notifications: permission === 'granted' }
    }
    ++loadGeneration.current
    const saved = await api.marketMonitor.saveSettings(next)
    setSettings(saved)
    setHistory((current) => Object.fromEntries(ASSETS.map((item) => [
      item,
      current[item].filter((row) => row.strategyId === saved.strategyId),
    ])) as Record<MonitorAsset, MonitorSnapshot[]>)
    await Promise.all([loadState(false), runtime.refresh()])
  }

  const runNarratorNow = async () => {
    const generation = ++narratorRunGeneration.current
    setNarratorRunning(true)
    setRefreshError(null)
    setNarratorFeedback({ state: 'running', message: t('marketMonitor.feedback.narratorRunning') })
    try {
      const dispatched = await api.marketMonitor.runNarratorNow()
      if (generation !== narratorRunGeneration.current) return
      setNarratorStatus(dispatched)
      const taskId = dispatched.lastRun?.taskId
      if (!taskId) throw new Error(t('marketMonitor.feedback.narratorDispatchUnknown'))

      let completed: MarketNarratorStatus | null = null
      for (let attempt = 0; attempt < NARRATOR_POLL_ATTEMPTS; attempt++) {
        if (attempt > 0) await wait(NARRATOR_POLL_INTERVAL_MS)
        if (generation !== narratorRunGeneration.current) return
        const status = await api.marketMonitor.narratorStatus()
        if (generation !== narratorRunGeneration.current) return
        setNarratorStatus(status)
        if (status.lastRun?.taskId !== taskId || status.lastRun.status === 'running') continue
        completed = status
        break
      }

      if (!completed) throw new Error(t('marketMonitor.feedback.narratorTimedOut'))
      if (completed.lastRun?.status !== 'done') {
        throw new Error(completed.lastRun?.error || t('marketMonitor.feedback.narratorStopped', { status: completed.lastRun?.status ?? 'unknown' }))
      }
      await loadState(false)
      if (generation !== narratorRunGeneration.current) return
      setNarratorFeedback({ state: 'success', message: t('marketMonitor.feedback.narratorComplete') })
    } catch (cause) {
      if (generation !== narratorRunGeneration.current) return
      const message = cause instanceof Error ? cause.message : String(cause)
      setNarratorFeedback({ state: 'error', message: t('marketMonitor.feedback.narratorFailed', { error: message }) })
    } finally {
      if (generation === narratorRunGeneration.current) setNarratorRunning(false)
    }
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
        right={<div className="flex flex-wrap items-center justify-end gap-1.5">
          {import.meta.env.VITE_DEMO_MODE && <span className="rounded-sm border border-warning/50 bg-warning/10 px-2 py-1 text-[10px] font-semibold tracking-wide text-warning">{t('marketMonitor.demoBadge')}</span>}
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen((value) => !value)} aria-label={t('marketMonitor.settingsTitle')}><Settings2 className="size-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => void runNarratorNow()} disabled={!settings.codexNarrationEnabled || narratorRunning} aria-busy={narratorRunning}>{narratorRunning ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}{t(narratorRunning ? 'marketMonitor.narrator.running' : 'marketMonitor.narrator.runNow')}</Button>
          <Button size="sm" onClick={() => void scan(asset, 'manual')} disabled={scanning} aria-busy={scanning}><RefreshCw className={cn('size-3.5', scanning && 'animate-spin motion-reduce:animate-none')} aria-hidden />{t(scanning ? 'marketMonitor.scanRunning' : 'marketMonitor.scanNow', { asset: scanningAsset ?? asset })}</Button>
        </div>}
      />

      {(narratorFeedback || scanFeedback) && <div className="mx-4 mt-2 space-y-2 md:mx-6">
        {narratorFeedback && <ActionFeedbackBar feedback={narratorFeedback} onDismiss={() => setNarratorFeedback(null)} onRetry={narratorFeedback.state === 'error' ? () => void runNarratorNow() : undefined} />}
        {scanFeedback && <ActionFeedbackBar feedback={scanFeedback} onDismiss={() => setScanFeedback(null)} onRetry={scanFeedback.state === 'error' ? () => void scan(scanFeedback.asset ?? asset, 'manual') : undefined} />}
      </div>}

      {refreshError && <div role="status" className="mx-4 mt-2 flex items-center justify-between border-l-2 border-warning bg-warning/5 px-3 py-2 text-xs text-muted-foreground md:mx-6"><span>{t('marketMonitor.refreshFailed', { error: refreshError })}</span><Button variant="ghost" size="sm" onClick={() => void loadState(false)}>{t('marketMonitor.retry')}</Button></div>}

      {settingsOpen && <SettingsPanel settings={settings} strategies={strategies} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}

      <RuntimeStatus asset={asset} status={runtime.status} error={runtime.error} onRetry={runtime.refresh} />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3 md:px-6">
        <div role="tablist" aria-label={t('marketMonitor.monitoredAsset')} className="inline-flex rounded-md border border-border bg-muted/35 p-0.5">
          {ASSETS.map((item) => <button key={item} role="tab" aria-selected={asset === item} onClick={() => setAsset(item)} className={cn('rounded-[5px] px-4 py-1.5 text-xs font-semibold transition-colors', asset === item ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>{item}<span className="ml-1.5 font-normal text-muted-foreground">{t(item === 'BTC' ? 'marketMonitor.assetBitcoin' : item === 'TSLA' ? 'marketMonitor.assetTesla' : 'marketMonitor.assetStrategy')}</span></button>)}
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
            <DailyBriefPanel snapshot={snapshot} narratorStatus={narratorStatus} />
            <Overview snapshot={snapshot} timeframe={timeframe} />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.7fr)]">
              <EvidenceTable snapshot={snapshot} />
              <HypothesisPanel snapshot={snapshot} />
            </div>
            <WyckoffPanel snapshot={snapshot} />
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

function ActionFeedbackBar({ feedback, onDismiss, onRetry }: { feedback: ActionFeedback; onDismiss: () => void; onRetry?: () => void }) {
  const { t } = useTranslation()
  const running = feedback.state === 'running'
  const Icon = running ? LoaderCircle : feedback.state === 'success' ? CheckCircle2 : TriangleAlert
  return <div
    role={feedback.state === 'error' ? 'alert' : 'status'}
    aria-live={feedback.state === 'error' ? 'assertive' : 'polite'}
    aria-atomic="true"
    aria-busy={running}
    className={cn(
      'flex min-h-10 items-center gap-2 border-l-2 px-3 py-2 text-xs',
      running && 'border-primary bg-primary/5 text-foreground',
      feedback.state === 'success' && 'border-success bg-success/5 text-foreground',
      feedback.state === 'error' && 'border-warning bg-warning/5 text-foreground',
    )}
  >
    <Icon className={cn('size-4 shrink-0', running && 'animate-spin text-primary motion-reduce:animate-none', feedback.state === 'success' && 'text-success', feedback.state === 'error' && 'text-warning')} aria-hidden />
    <span className="min-w-0 flex-1 leading-5">{feedback.message}</span>
    {onRetry && <Button variant="ghost" size="sm" onClick={onRetry}>{t('marketMonitor.retry')}</Button>}
    {!running && <Button variant="ghost" size="icon" onClick={onDismiss} aria-label={t('marketMonitor.feedback.dismiss')}><X className="size-3.5" aria-hidden /></Button>}
  </div>
}

function DailyBriefPanel({ snapshot, narratorStatus }: { snapshot: MonitorSnapshot; narratorStatus: MarketNarratorStatus | null }) {
  const { t } = useTranslation()
  const brief = snapshot.dailyBrief
  const trend = snapshot.trend
  if (!brief || !trend) return <Panel title={t('marketMonitor.panels.dailyBrief')}><p className="text-xs text-muted-foreground">{t('marketMonitor.brief.upgradeHint')}</p></Panel>
  const tone = brief.overallDirection === 'bullish' ? 'text-success' : brief.overallDirection === 'bearish' ? 'text-destructive' : 'text-foreground'
  const narration = snapshot.aiNarration
  return <Panel title={t('marketMonitor.panels.dailyBrief')} trailing={<span className="text-[10px] text-muted-foreground">{t('marketMonitor.brief.cadence', { date: brief.periodKey })} · {t('marketMonitor.brief.narrator')}</span>}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h4 className={cn('text-lg font-semibold', tone)}>{monitorBriefHeadline(t, brief.headline)}</h4>
      <span className="text-xs font-semibold tabular-nums text-muted-foreground">{t('marketMonitor.trend.confidence', { confidence: brief.confidence })}</span>
    </div>
    <dl className="mt-4 grid border-y border-border/60 sm:grid-cols-3 sm:divide-x sm:divide-border/60">
      {([trend.short, trend.medium, trend.long] as const).map((assessment) => <div key={assessment.horizon} className="py-3 sm:px-4 sm:first:pl-0 sm:last:pr-0">
        <dt className="text-[11px] text-muted-foreground">{monitorHorizonLabel(t, assessment.horizon)}</dt>
        <dd className={cn('mt-1 text-base font-semibold', assessment.direction === 'bullish' ? 'text-success' : assessment.direction === 'bearish' ? 'text-destructive' : '')}>{monitorTrendDirectionLabel(t, assessment.direction)}</dd>
        <div className="mt-1 text-[11px] text-muted-foreground">{monitorTrendRegimeLabel(t, assessment.regime)} · {t('marketMonitor.trend.score', { score: assessment.score })} · {assessment.confidence}/100</div>
      </div>)}
    </dl>
    <div className="grid gap-x-6 lg:grid-cols-3">
      <ConditionList title={t('marketMonitor.brief.observations')} rows={brief.observations.map((id) => monitorBriefObservation(t, id))} tone="neutral" />
      <ConditionList title={t('marketMonitor.brief.watchFor')} rows={brief.watchFor.map((id) => monitorWyckoffCondition(t, id))} tone="positive" />
      <ConditionList title={t('marketMonitor.brief.risks')} rows={brief.risks.length ? brief.risks.map((id) => monitorBriefRisk(t, id)) : [t('marketMonitor.brief.noRisks')]} tone="negative" />
    </div>
    <div className="mt-5 border-t border-border/60 pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold"><Sparkles className="size-3.5 text-primary" />{t('marketMonitor.narrator.title')}</div>
        {narration ? <span className="text-[10px] text-muted-foreground">Codex{narration.model ? ` · ${narration.model}` : ''} · {formatDate(narration.generatedAt)}</span>
          : <span className={cn('text-[10px]', narratorStatus?.state === 'failed' || narratorStatus?.state === 'blocked' ? 'text-warning' : 'text-muted-foreground')}>{narratorStatus ? t(`marketMonitor.narrator.state.${narratorStatus.state}`) : t('marketMonitor.narrator.checking')}</span>}
      </div>
      {narration ? <div>
        <h4 className="text-base font-semibold">{narration.headline}</h4>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{narration.summary}</p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div><dt className="text-[11px] text-muted-foreground">{t('marketMonitor.trend.short')}</dt><dd className="mt-1 text-xs leading-5">{narration.shortTerm}</dd></div>
          <div><dt className="text-[11px] text-muted-foreground">{t('marketMonitor.trend.medium')}</dt><dd className="mt-1 text-xs leading-5">{narration.mediumTerm}</dd></div>
          <div><dt className="text-[11px] text-muted-foreground">{t('marketMonitor.trend.long')}</dt><dd className="mt-1 text-xs leading-5">{narration.longTerm}</dd></div>
        </dl>
        <div className="grid gap-x-6 lg:grid-cols-3">
          <ConditionList title={t('marketMonitor.narrator.evidence')} rows={narration.evidence} tone="neutral" />
          <ConditionList title={t('marketMonitor.narrator.watchFor')} rows={narration.watchFor} tone="positive" />
          <ConditionList title={t('marketMonitor.narrator.risks')} rows={narration.risks} tone="negative" />
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground">{t('marketMonitor.narrator.disclaimer')}</p>
      </div> : <p className="text-xs leading-5 text-muted-foreground">{narratorStatus?.message ?? t('marketMonitor.narrator.waiting')}</p>}
    </div>
  </Panel>
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
  return <Panel title={t('marketMonitor.panels.marketState', { asset: snapshot.asset })} trailing={<span className="text-[11px] text-muted-foreground">{timeframe === '1D' ? snapshot.chart.dailyMeta.sourceId : snapshot.chart.intradayMeta?.sourceId ?? t('marketMonitor.chart.hourlyUnavailable')} · {formatDate(timeframe === '1D' ? bars.at(-1)?.date.slice(0, 10) : bars.at(-1)?.date)}</span>}>
    <p className="mb-3 text-xs leading-5 text-muted-foreground">{snapshot.analysisBasis ? t('marketMonitor.analysisBasis', { daily: formatDate(snapshot.analysisBasis.dailyAt), hourly: formatDate(snapshot.analysisBasis.hourlyAt) }) : t('marketMonitor.legacyBasis')}</p>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
      <div className="min-h-[260px] border-y border-border/60 py-3"><PriceChart bars={bars} unavailable={timeframe === '1H' && !snapshot.metrics.intraday.available} /></div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 content-start">
        <Metric label={t(snapshot.analysisBasis ? 'marketMonitor.metrics.closedPrice' : 'marketMonitor.metrics.lastPrice')} value={snapshot.asset === 'BTC' ? `$${formatNumber(snapshot.metrics.lastPrice, 0)}` : `$${formatNumber(snapshot.metrics.lastPrice)}`} />
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
  return <Panel title={t('marketMonitor.panels.currentHypothesis')} trailing={<span className={cn('text-xs font-semibold tabular-nums', hypothesis.bias === 'bullish' ? 'text-success' : hypothesis.bias === 'bearish' ? 'text-destructive' : 'text-muted-foreground')}>{hypothesis.confidence}/100</span>}><h4 className="text-lg font-semibold">{copy.label}</h4><p className="mt-2 text-xs leading-5 text-muted-foreground">{copy.summary}</p><ConditionList title={t('marketMonitor.panels.confirmation')} rows={copy.confirm} tone="positive" /><ConditionList title={t('marketMonitor.panels.invalidation')} rows={copy.invalidate} tone="negative" /><ConditionList title={t('marketMonitor.panels.alternatives')} rows={copy.alternatives} tone="neutral" /></Panel>
}

function WyckoffPanel({ snapshot }: { snapshot: MonitorSnapshot }) {
  const { t } = useTranslation()
  const wyckoff = snapshot.wyckoff
  if (!wyckoff) return <Panel title={t('marketMonitor.panels.wyckoff')}><p className="text-xs text-muted-foreground">{t('marketMonitor.brief.upgradeHint')}</p></Panel>
  const priceDigits = snapshot.asset === 'BTC' ? 0 : 2
  return <Panel title={t('marketMonitor.panels.wyckoff')} trailing={<span className="text-[10px] text-muted-foreground">{t('marketMonitor.wyckoff.candidate')}</span>}>
    <div className="grid gap-5 lg:grid-cols-[minmax(240px,0.65fr)_minmax(0,1.35fr)]">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-lg font-semibold">{monitorWyckoffPhaseLabel(t, wyckoff.phaseCandidate)}</h4><span className="text-xs font-semibold tabular-nums text-muted-foreground">{t('marketMonitor.wyckoff.confidence', { confidence: wyckoff.confidence })}</span></div>
        <div className="mt-1 text-xs text-muted-foreground">{monitorWyckoffTestLabel(t, wyckoff.testState)}</div>
        {wyckoff.range && <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-border/60 py-3 text-xs">
          <Metric label={t('marketMonitor.wyckoff.lower')} value={`$${formatNumber(wyckoff.range.lower, priceDigits)}`} />
          <Metric label={t('marketMonitor.wyckoff.upper')} value={`$${formatNumber(wyckoff.range.upper, priceDigits)}`} />
          <Metric label={t('marketMonitor.wyckoff.position')} value={`${Math.round(wyckoff.range.position * 100)}%`} />
          <Metric label={t('marketMonitor.wyckoff.width')} value={formatPercent(wyckoff.range.widthPercent)} />
        </dl>}
        <div className="mt-4 text-[11px] font-semibold text-muted-foreground">{t('marketMonitor.wyckoff.events')}</div>
        {wyckoff.events.length ? <ul className="mt-2 space-y-2">{wyckoff.events.map((event) => <li key={`${event.kind}:${event.at}`} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/50 pb-2 text-xs"><span>{monitorWyckoffEventLabel(t, event.kind)}</span><span className={cn('text-[11px]', event.status === 'confirmed' ? 'text-success' : event.status === 'invalidated' ? 'text-destructive' : 'text-warning')}>{monitorWyckoffEventStatus(t, event.status)} · {formatDate(event.at.slice(0, 10))}{event.level == null ? '' : ` · $${formatNumber(event.level, priceDigits)}`}</span></li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">{t('marketMonitor.wyckoff.noEvents')}</p>}
      </div>
      <div className="grid gap-x-6 md:grid-cols-2">
        <ConditionList title={t('marketMonitor.wyckoff.supporting')} rows={wyckoff.supportingEvidence.map((id) => monitorWyckoffEvidence(t, id))} tone="positive" />
        <ConditionList title={t('marketMonitor.wyckoff.opposing')} rows={wyckoff.opposingEvidence.length ? wyckoff.opposingEvidence.map((id) => monitorWyckoffEvidence(t, id)) : [t('marketMonitor.wyckoff.noOpposing')]} tone="neutral" />
        <ConditionList title={t('marketMonitor.panels.confirmation')} rows={wyckoff.confirmation.map((id) => monitorWyckoffCondition(t, id))} tone="positive" />
        <ConditionList title={t('marketMonitor.panels.invalidation')} rows={wyckoff.invalidation.map((id) => monitorWyckoffCondition(t, id))} tone="negative" />
      </div>
    </div>
  </Panel>
}

function ConditionList({ title, rows, tone }: { title: string; rows: string[]; tone: 'positive' | 'negative' | 'neutral' }) {
  return <div className="mt-4"><div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{title}</div><ul className="space-y-1.5 text-xs leading-5">{rows.map((row) => <li key={row} className="flex gap-2"><span className={cn('mt-2 size-1 shrink-0 rounded-full', tone === 'positive' ? 'bg-success' : tone === 'negative' ? 'bg-destructive' : 'bg-muted-foreground')} /><span>{row}</span></li>)}</ul></div>
}

function ContextPanel({ snapshot }: { snapshot: MonitorSnapshot }) {
  const { t } = useTranslation()
  const labels: Record<string, string> = { fundingRate: t('marketMonitor.context.fundingRate'), openInterest: t('marketMonitor.context.openInterest'), annualizedBasisPercent: t('marketMonitor.context.annualizedBasisPercent'), optionOpenInterest: t('marketMonitor.context.optionOpenInterest'), putCallOpenInterestRatio: t('marketMonitor.context.putCallOpenInterestRatio'), marketCap: t('marketMonitor.context.marketCap'), trailingPe: t('marketMonitor.context.trailingPe'), forwardPe: t('marketMonitor.context.forwardPe'), analystTargetMean: t('marketMonitor.context.analystTargetMean'), shortPercentFloat: t('marketMonitor.context.shortPercentFloat'), nextEarningsAt: t('marketMonitor.context.nextEarningsAt') }
  const rows = Object.entries(labels).filter(([key]) => snapshot.context[key] != null)
  return <Panel title={t('marketMonitor.panels.context', { asset: snapshot.asset })}>
    <dl className="grid grid-cols-2 gap-x-5 gap-y-3">{rows.length ? rows.map(([key, label]) => <div key={key}><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium tabular-nums">{formatContextValue(key, snapshot.context[key])}</dd></div>) : <p className="col-span-2 text-xs text-muted-foreground">{t('marketMonitor.context.unavailable')}</p>}</dl>
    {snapshot.context.recentFilings?.length ? <div className="mt-4 border-t border-border/60 pt-3"><div className="mb-2 text-[11px] font-semibold text-muted-foreground">{t('marketMonitor.context.recentFilings')}</div><ul className="space-y-2">{snapshot.context.recentFilings.map((item) => <li key={`${item.filingDate}:${item.form}:${item.url}`} className="text-xs"><a href={item.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{item.form}</a><span className="ml-2 text-muted-foreground">{formatDate(item.filingDate)}{item.reportDate ? ` · ${t('marketMonitor.context.reportPeriod')} ${formatDate(item.reportDate)}` : ''}</span>{item.description ? <div className="mt-0.5 line-clamp-2 text-muted-foreground">{item.description}</div> : null}</li>)}</ul></div> : null}
    {snapshot.context.recentNews?.length ? <div className="mt-4 border-t border-border/60 pt-3"><div className="mb-2 text-[11px] font-semibold text-muted-foreground">{t('marketMonitor.context.recentNews')}</div><ul className="space-y-2">{snapshot.context.recentNews.map((item) => <li key={`${item.time}:${item.title}`} className="text-xs"><span className="text-muted-foreground">{formatDate(item.time)} · {item.source ?? t('marketMonitor.context.unknown')}</span><div className="mt-0.5 line-clamp-2">{item.title}</div></li>)}</ul></div> : null}
  </Panel>
}

function SourcePanel({ snapshot }: { snapshot: MonitorSnapshot }) {
  const { t } = useTranslation()
  return <Panel title={t('marketMonitor.panels.sourceHealth')}><div className="space-y-3">{snapshot.sourceHealth.map((source) => <div key={source.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2"><span className={cn('mt-1.5 size-2 rounded-full', source.status === 'ok' ? 'bg-success' : source.status === 'degraded' ? 'bg-warning' : 'bg-destructive')} /><div><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-xs font-medium">{monitorSourceLabel(t, source, snapshot.asset)}</span><span className="text-[10px] text-muted-foreground">{source.provider}</span></div><p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{monitorSourceDetail(t, source)}</p><div className="mt-0.5 text-[10px] text-muted-foreground/70">{t('marketMonitor.source.asOf', { time: formatDate(source.asOf) })}</div></div></div>)}</div></Panel>
}

function HistoryPanel({ snapshots, evaluation, alerts }: { snapshots: MonitorSnapshot[]; evaluation: MonitorEvaluation | null; alerts: MonitorAlert[] }) {
  const { t } = useTranslation()
  return <Panel title={t('marketMonitor.panels.history')} trailing={evaluation ? <span className="text-[11px] text-muted-foreground">{t('marketMonitor.history.summary', { resolved: evaluation.resolved, accuracy: evaluation.directionalAccuracy == null ? '—' : `${formatNumber(evaluation.directionalAccuracy)}%` })}</span> : undefined}><div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]"><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-xs"><thead className="border-b border-border text-left text-[11px] text-muted-foreground"><tr><th className="pb-2 font-medium">{t('marketMonitor.history.captured')}</th><th className="pb-2 font-medium">{t('marketMonitor.history.price')}</th><th className="pb-2 font-medium">{t('marketMonitor.history.hypothesis')}</th><th className="pb-2 text-right font-medium">{t('marketMonitor.history.confidence')}</th><th className="pb-2 text-right font-medium">{t('marketMonitor.history.trigger')}</th></tr></thead><tbody>{snapshots.slice(-12).reverse().map((row) => <tr key={row.id} className="border-b border-border/50"><td className="py-2.5 text-muted-foreground">{formatDate(row.capturedAt)}</td><td className="py-2.5 tabular-nums">{formatNumber(row.metrics.lastPrice)}</td><td className="py-2.5">{monitorHypothesisCopy(t, row).label}</td><td className="py-2.5 text-right tabular-nums">{row.hypothesis.confidence}/100</td><td className="py-2.5 text-right text-muted-foreground">{t(`marketMonitor.history.${row.trigger}`)}</td></tr>)}</tbody></table></div><div><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground"><Bell className="size-3.5" />{t('marketMonitor.panels.recentAlerts')}</div>{alerts.length ? <ul className="space-y-2">{alerts.slice(-6).reverse().map((alert) => {
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
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={draft.codexNarrationEnabled} onChange={(event) => setDraft({ ...draft, codexNarrationEnabled: event.target.checked })} />{t('marketMonitor.settings.codexNarration')}</label>
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
