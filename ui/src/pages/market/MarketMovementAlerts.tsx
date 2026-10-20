import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { MonitorAsset } from '../../api/market-monitor'
import type { MovementBoundary, MovementCreate, MovementError, MovementLeg, MovementPlan, MovementPrice, MovementReport } from '../../api/market-movement-alerts'
import { useMarketMovementAlerts } from '../../hooks/useMarketMovementAlerts'
import { Button } from '../../components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible'
import { getIntlLocale } from '../../lib/intl'
import { formatMonitorDate } from './market-monitor-format'

const money = (value: number) => Number.isFinite(value) ? new Intl.NumberFormat(getIntlLocale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value) : '—'
const percent = (value: number) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '—'
const legs = ['up', 'down'] as const
type CommonProps = { asset: MonitorAsset; visible: boolean; revisionKey: string; notifications?: boolean; monitoringEnabled: boolean; intervalMinutes: number }
type ViewProps = Omit<CommonProps, 'visible' | 'revisionKey' | 'notifications'> & {
  nowMs?: number
  report: MovementReport | null; loading: boolean; busy: boolean; error: MovementError | null
  refresh: () => void; create: (input: Omit<MovementCreate, 'asset'>) => Promise<boolean>; cancel: (id: string) => Promise<boolean>
}

/** Display freshness only; this never changes a saved threshold or trigger. */
export function movementCheckOverdue(plan: Pick<MovementPlan, 'createdAt' | 'latestCheck'>, intervalMinutes: number, nowMs: number): boolean {
  const checkedAt = Date.parse(plan.latestCheck?.checkedAt ?? plan.createdAt)
  const interval = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? intervalMinutes : 15
  return !Number.isFinite(checkedAt) || !Number.isFinite(nowMs) || nowMs - checkedAt > Math.max(interval * 2, 5) * 60_000
}

export function MarketMovementAlerts(props: CommonProps) {
  const data = useMarketMovementAlerts(props.asset, props.visible, props.revisionKey)
  const { t } = useTranslation()
  const entry = useRef<{ asset: MonitorAsset; since: number; ids: Set<string> } | null>(null)
  useEffect(() => {
    const report = data.report
    if (!props.visible || !report || report.asset !== props.asset || report.readError || data.error === 'read') return
    const events = report.plans.flatMap(plan => legs.flatMap(direction => plan[direction]?.event ? [plan[direction]!.event!] : []))
    const storageKey = `openalice:movement-alerts:seen:${props.asset}`
    if (entry.current?.asset !== props.asset) {
      let saved: string[] = []
      try { const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); if (Array.isArray(raw)) saved = raw.filter((id): id is string => typeof id === 'string').slice(-200) } catch { /* storage is optional */ }
      entry.current = { asset: props.asset, since: Date.parse(report.generatedAt), ids: new Set([...saved, ...events.map(event => event.id)]) }
    } else {
      for (const event of events) {
        if (entry.current.ids.has(event.id)) continue
        entry.current.ids.add(event.id)
        if (Date.parse(event.observedAt) <= entry.current.since || !props.notifications || report.checkError || report.illustrative || !('Notification' in window) || Notification.permission !== 'granted') continue
        try { new Notification(`${props.asset} · ${t('movement.title')}`, { body: t('movement.event', { direction: t(`movement.${event.direction}`), percent: event.percent, price: money(event.price), time: formatMonitorDate(event.asOf) }), tag: event.id }) } catch { /* permission or delivery may change */ }
      }
    }
    try { localStorage.setItem(storageKey, JSON.stringify([...entry.current.ids].slice(-200))) } catch { /* keep in-memory deduplication */ }
  }, [data.report, data.error, props.asset, props.visible, props.notifications, t])
  return <MarketMovementAlertsView key={props.asset} {...props} {...data} />
}

function PriceInfo({ price }: { price: MovementPrice }) {
  const { t } = useTranslation()
  return <div className="space-y-1 text-xs text-muted-foreground"><p>{t(price.priceKind === 'last-trade' ? 'movement.lastTrade' : 'movement.dailyClose')}{price.status === 'delayed' && ` · ${t('movement.delayed')}`}</p><p>{t('movement.source', { provider: price.provider, feed: price.feed ?? '—', time: formatMonitorDate(price.asOf) })}</p><p>{t('movement.observed', { time: formatMonitorDate(price.observedAt) })}</p></div>
}

export function MarketMovementAlertsView({ asset, report, loading, busy, error, refresh, create, cancel, monitoringEnabled, intervalMinutes, nowMs = Date.now() }: ViewProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false), [upEnabled, setUpEnabled] = useState(true), [downEnabled, setDownEnabled] = useState(true)
  const [up, setUp] = useState('3'), [down, setDown] = useState('3'), [hours, setHours] = useState('24'), [invalid, setInvalid] = useState(false)
  const id = useId()
  const unavailable = error === 'read' || error === 'movement-state-unavailable' || report?.readError
  const safeReport = report?.asset === asset && !unavailable ? report : null
  const active = safeReport?.plans.find(plan => Date.parse(plan.expiresAt) > Date.parse(safeReport.generatedAt) && legs.some(direction => plan[direction]?.state === 'armed'))
  const latest = active ?? safeReport?.plans[0]
  const overdue = active ? movementCheckOverdue(active, intervalMinutes, nowMs) : false
  const legState = (plan: MovementPlan, leg: MovementLeg) => leg.state === 'armed' && safeReport && Date.parse(plan.expiresAt) <= Date.parse(safeReport.generatedAt) ? 'expired' : leg.state
  const shortRisk = safeReport?.risk.status === 'available' ? safeReport.risk.horizons.find(row => row.horizon === 'short' && row.status === 'available') : null
  const boundaryText = (label: 'support' | 'resistance', boundary: MovementBoundary) => `${t('movement.relative', { label: t(`movement.${label}`), price: money(boundary.price), distance: percent(boundary.distancePercent) })}${boundary.priceCrossed ? ` · ${t('movement.crossedCompact')}` : ''}`
  const riskSummary = [shortRisk?.downside && boundaryText('support', shortRisk.downside.boundary), shortRisk?.upside && boundaryText('resistance', shortRisk.upside.boundary)].filter(Boolean).join(' · ')
  const planSummary = latest ? legs.flatMap(direction => latest[direction] ? [t('movement.leg', { direction: t(`movement.${direction}`), percent: latest[direction]!.percent, state: t(`movement.${legState(latest, latest[direction]!)}`) })] : []).join(' / ') : t('movement.empty')
  const checkUnavailable = active?.latestCheck?.status === 'unavailable'
  const statusSummary = active && !monitoringEnabled ? t('movement.monitoringPaused') : overdue ? t('movement.checkOverdue') : checkUnavailable ? t('movement.checkUnavailable') : planSummary
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const valid = (value: string) => Number.isFinite(Number(value)) && Number(value) >= .1 && Number(value) <= 50
    if ((!upEnabled && !downEnabled) || upEnabled && !valid(up) || downEnabled && !valid(down) || !Number.isInteger(Number(hours)) || Number(hours) < 1 || Number(hours) > 168) { setInvalid(true); return }
    setInvalid(false)
    void create({ ...(upEnabled ? { upPercent: Number(up) } : {}), ...(downEnabled ? { downPercent: Number(down) } : {}), expiresInHours: Number(hours) })
  }
  return <section aria-label={t('movement.title')} className="oa-data-surface min-w-0 px-4 py-3">
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><div className="min-w-0 text-xs leading-5"><h3 className="font-medium">{t('movement.title')}</h3><p className={active && (!monitoringEnabled || overdue || checkUnavailable) ? 'text-warning' : 'text-muted-foreground'}>{unavailable || report?.checkError ? t('movement.unverified') : loading && !report ? t('movement.loading') : statusSummary}</p>{riskSummary && <p className="text-muted-foreground">{riskSummary}</p>}</div><CollapsibleTrigger className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{t('movement.details')}</CollapsibleTrigger></div>
      {(error || safeReport?.checkError) && <p role="alert" className="mt-2 text-xs text-warning">{error ? t(`movement.errors.${error}`) : t('movement.checkError')}</p>}
      <CollapsibleContent>{open && <div className="mt-3 min-w-0 space-y-4 border-t border-border pt-3 text-xs leading-5">
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading || busy}>{t('movement.refresh')}</Button>
        {!monitoringEnabled && <p className="text-warning">{t('movement.backgroundOff')}</p>}
        <p className="text-muted-foreground">{t('movement.cadence', { minutes: intervalMinutes })} {t('movement.delivery')} {t('movement.browser')}</p>
        {safeReport?.illustrative && <p className="text-warning">{t('movement.illustrative')}</p>}
        {latest && <div className="space-y-2 rounded-md border border-border p-3"><p className="font-medium">{t('movement.anchor', { price: money(latest.anchor.price) })}</p><PriceInfo price={latest.anchor} /><p>{t('movement.expires', { time: formatMonitorDate(latest.expiresAt) })}</p><p>{latest.latestCheck ? t('movement.checked', { time: formatMonitorDate(latest.latestCheck.checkedAt) }) : t('movement.notChecked')}</p>
          {latest.latestCheck?.status === 'unavailable' && <p className="text-warning">{t('movement.checkUnavailable')}</p>}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">{legs.map(direction => { const leg = latest[direction]; if (!leg) return null
            const checked = latest.latestCheck?.status === 'observed' ? latest.latestCheck.quote?.price : null
            const distance = checked && checked > 0 ? (direction === 'up' ? leg.targetPrice / checked - 1 : 1 - leg.targetPrice / checked) * 100 : null
            return <div key={direction} className="space-y-1"><p>{t('movement.leg', { direction: t(`movement.${direction}`), percent: leg.percent, state: t(`movement.${legState(latest, leg)}`) })}</p><p>{t('movement.target', { price: money(leg.targetPrice) })}</p>{legState(latest, leg) === 'armed' && distance !== null && <p>{distance > 0 ? t('movement.remaining', { percent: distance.toFixed(2) }) : t('movement.reached')}</p>}{leg.event && <><p>{t('movement.event', { direction: t(`movement.${direction}`), percent: leg.event.percent, price: money(leg.event.price), time: formatMonitorDate(leg.event.asOf) })}</p><p>{leg.event.provider} · {leg.event.feed ?? '—'}</p>{leg.event.providerChanged && <p className="text-warning">{t('movement.providerChanged')}</p>}</>}</div>
          })}</div>{active && <Button type="button" variant="outline" size="sm" onClick={() => void cancel(active.id)} disabled={busy}>{t('movement.cancel')}</Button>}
        </div>}
        {!active && <form onSubmit={submit} className="space-y-3"><p>{t('movement.fixed')}</p><div className="grid min-w-0 gap-3 sm:grid-cols-3">{legs.map(direction => <div key={direction} className="min-w-0 space-y-2"><label className="flex items-center gap-2"><input type="checkbox" checked={direction === 'up' ? upEnabled : downEnabled} onChange={event => (direction === 'up' ? setUpEnabled : setDownEnabled)(event.target.checked)} disabled={busy} />{t('movement.enable', { direction: t(`movement.${direction}`) })}</label><label htmlFor={`${id}-${direction}`}>{t('movement.threshold', { direction: t(`movement.${direction}`) })}</label><input className="oa-field-control w-full min-w-0 rounded-md border border-input bg-background px-2 py-2 text-sm" id={`${id}-${direction}`} type="number" min="0.1" max="50" step="0.1" value={direction === 'up' ? up : down} onChange={event => (direction === 'up' ? setUp : setDown)(event.target.value)} disabled={busy || !(direction === 'up' ? upEnabled : downEnabled)} /></div>)}<div className="min-w-0 space-y-2"><label htmlFor={`${id}-hours`}>{t('movement.expiry')}</label><input className="oa-field-control w-full min-w-0 rounded-md border border-input bg-background px-2 py-2 text-sm" id={`${id}-hours`} type="number" min="1" max="168" step="1" value={hours} onChange={event => setHours(event.target.value)} disabled={busy} /></div></div>{invalid && <p role="alert" className="text-warning">{t('movement.invalid')}</p>}<Button type="submit" size="sm" disabled={busy || loading || !safeReport || error === 'request'}>{t(busy ? 'movement.creating' : 'movement.create')}</Button></form>}
        <section aria-label={t('movement.condition')} className="space-y-3 border-t border-border pt-3"><h4 className="font-medium">{t('movement.condition')}</h4>
          {safeReport?.risk.status !== 'available' ? <p className="text-muted-foreground">{t(safeReport?.risk.status === 'outdated' ? 'movement.riskOutdated' : 'movement.riskUnavailable')}</p> : <>{safeReport.risk.reference && <><p>{money(safeReport.risk.reference.price)}</p><PriceInfo price={safeReport.risk.reference} /></>}{safeReport.risk.horizons.map(row => <div key={row.horizon} className="space-y-1"><h5 className="font-medium">{t(`movement.${row.horizon}`)} · {t('movement.window', { count: row.observationBars })}</h5>{row.status === 'unavailable' ? <p>{t('movement.insufficient')}</p> : (['downside', 'upside'] as const).map(side => { const scenario = row[side]; if (!scenario) return null; return <div key={side} className="space-y-1"><p>{boundaryText(side === 'downside' ? 'support' : 'resistance', scenario.boundary)}</p><p className="text-muted-foreground">{t(scenario.boundary.priceCrossed ? 'movement.crossed' : 'movement.notCrossed')}</p>{scenario.nextBoundary && <p>{t(side === 'downside' ? 'movement.nextDown' : 'movement.nextUp', { horizon: t(`movement.${scenario.nextBoundary.sourceHorizon}`), price: money(scenario.nextBoundary.price), distance: percent(scenario.nextBoundary.distancePercent) })}</p>}</div> })}</div>)}<p className="text-muted-foreground">{t('movement.closeConfirmed')}</p>{safeReport.risk.analysis && <p className="text-muted-foreground">{safeReport.risk.analysis.provider} · {formatMonitorDate(safeReport.risk.analysis.dataAsOf)}</p>}</>}
        </section>
      </div>}</CollapsibleContent>
    </Collapsible>
  </section>
}
