import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { dataPath } from '../../core/paths.js'
import type { MarketQuote } from '../market-data/quotes.js'
import { assertFreshBars, closedBars } from './bar-policy.js'
import { regularEquitySession } from './equity-session.js'
import { MARKET_MONITOR_ASSETS, MARKET_MONITOR_ASSET_CONFIG, type MarketMonitorAsset, type MarketMonitorSnapshot } from './types.js'
import type { MovementCreate, MovementEvent, MovementLeg, MovementPlan, MovementPrice, MovementReport, MovementRisk } from './movement-alert-types.js'

const HOUR = 3_600_000
const LIMIT = 1000
const serials = new Map<string, Promise<unknown>>()
const stamp = (value: string) => Date.parse(value)
const assetSchema = z.enum(MARKET_MONITOR_ASSETS)
const percent = z.number().finite().min(0.1).max(50)
export const movementCreateSchema = z.object({ asset: assetSchema, upPercent: percent.optional(), downPercent: percent.optional(), expiresInHours: z.number().int().min(1).max(168) }).strict().refine(v => v.upPercent !== undefined || v.downPercent !== undefined)
const time = z.string().datetime()
const positive = z.number().finite().positive()
const label = z.string().min(1).max(120).regex(/^[\p{L}\p{N} ._:/|()\-]+$/u)
const priceSchema = z.object({ asset: assetSchema, price: positive, asOf: time, observedAt: time, provider: label, feed: label.nullable(), priceKind: z.enum(['last-trade', 'completed-daily-close']), status: z.enum(['fresh', 'delayed']) }).strict()
const eventSchema = z.object({ id: z.string().uuid(), planId: z.string().uuid(), asset: assetSchema, direction: z.enum(['up', 'down']), percent, targetPrice: positive, price: positive, asOf: time, observedAt: time, provider: label, feed: label.nullable(), providerChanged: z.boolean() }).strict()
const legSchema = z.object({ state: z.enum(['armed', 'triggered', 'expired', 'cancelled']), percent, targetPrice: positive, event: eventSchema.nullable() }).strict()
const planSchema = z.object({ id: z.string().uuid(), asset: assetSchema, createdAt: time, expiresAt: time, anchor: priceSchema, up: legSchema.nullable(), down: legSchema.nullable(), lastObservedAsOf: time.nullable(), latestCheck: z.object({ checkedAt: time, status: z.enum(['observed', 'unavailable', 'expired']), reason: z.string().max(80).nullable(), quote: priceSchema.nullable() }).strict().nullable() }).strict()
const stateSchema = z.object({ schemaVersion: z.literal(1), asset: assetSchema, plans: z.array(planSchema).max(LIMIT), recordHash: z.string() }).strict()
type State = z.infer<typeof stateSchema>
export class MovementAlertError extends Error {
  constructor(readonly code: 'movement-invalid' | 'movement-active-plan' | 'movement-price-unavailable' | 'movement-state-unavailable' | 'movement-not-found') { super(code) }
}
const hash = (state: State) => createHash('sha256').update(JSON.stringify({ ...state, recordHash: '' })).digest('hex')
const target = (anchor: number, direction: 'up' | 'down', value: number) => new Decimal(anchor).times(new Decimal(1).plus(new Decimal(value).div(100).times(direction === 'up' ? 1 : -1))).toNumber()
const armed = (p: MovementPlan) => p.up?.state === 'armed' || p.down?.state === 'armed'
function expire(plan: MovementPlan, at: Date): boolean {
  if (stamp(plan.expiresAt) > at.getTime() || !armed(plan)) return false
  for (const direction of ['up', 'down'] as const) if (plan[direction]?.state === 'armed') plan[direction]!.state = 'expired'
  plan.latestCheck = { checkedAt: at.toISOString(), status: 'expired', reason: null, quote: null }
  return true
}

/** Quotes never borrow a newer acquisition timestamp to make an old trade current. */
export function movementPriceFromQuote(quote: MarketQuote | null, asset: MarketMonitorAsset, at: Date): MovementPrice | null {
  if (!quote || quote.asset !== asset || quote.currency !== 'USD' || !['fresh', 'delayed'].includes(quote.status)
    || !quote.price || !Number.isFinite(quote.price) || quote.price <= 0 || !quote.asOf || !time.safeParse(quote.asOf).success || !time.safeParse(quote.fetchedAt).success || !quote.provider || !quote.feed
    || !['coinbase', 'alpaca', 'yfinance'].includes(quote.provider)) return null
  const feeds = { coinbase: 'Coinbase Exchange', alpaca: 'IEX', yfinance: 'Yahoo Finance' }
  if (quote.feed !== feeds[quote.provider] || quote.provider === 'coinbase' && asset !== 'BTC' || quote.provider === 'alpaca' && asset === 'BTC') return null
  const asOf = stamp(quote.asOf), acquired = stamp(quote.fetchedAt), maxAge = quote.provider === 'yfinance' && asset !== 'BTC' ? 20 * 60_000 : 2 * 60_000
  if (!Number.isFinite(asOf) || !Number.isFinite(acquired) || asOf > acquired || acquired > at.getTime() || asOf > at.getTime() || at.getTime() - asOf > maxAge) return null
  return { asset, price: quote.price, asOf: new Date(asOf).toISOString(), observedAt: new Date(acquired).toISOString(), provider: quote.provider, feed: quote.feed, priceKind: 'last-trade', status: quote.status as 'fresh' | 'delayed' }
}

export function movementDailyCompletedAt(day: string, asset: MarketMonitorAsset): number | null {
  if (asset === 'BTC') return stamp(`${day}T00:00:00Z`) + 24 * HOUR
  const session = regularEquitySession(day)
  if (!session.trading || session.closeMinutes === null) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(`${day}T18:00:00Z`))
  const value = (key: string) => Number(parts.find(p => p.type === key)?.value)
  const offsetMinutes = value('hour') * 60 + value('minute') - 18 * 60
  return stamp(`${day}T00:00:00Z`) + (session.closeMinutes - offsetMinutes) * 60_000
}

export function movementPriceFromSnapshot(snapshot: MarketMonitorSnapshot | null, asset: MarketMonitorAsset, at: Date): MovementPrice | null {
  if (!snapshot || snapshot.asset !== asset || !snapshot.analysisBasis?.closedBarsOnly || !Number.isFinite(stamp(snapshot.capturedAt)) || stamp(snapshot.capturedAt) > at.getTime()
    || !Array.isArray(snapshot.sourceHealth) || !Array.isArray(snapshot.chart?.daily) || snapshot.chart.dailyMeta?.symbol !== MARKET_MONITOR_ASSET_CONFIG[asset].symbol) return null
  const source = snapshot.sourceHealth.find(s => s.id === 'daily-bars')
  if (!source || !['ok', 'degraded'].includes(source.status) || source.retained || !label.safeParse(source.provider).success
    || !source.asOf || !Number.isFinite(stamp(source.asOf)) || stamp(source.asOf) > stamp(snapshot.capturedAt)) return null
  const bars = closedBars(snapshot.chart.daily, asset, '1d', new Date(snapshot.capturedAt)).slice().sort((a, b) => a.date.localeCompare(b.date))
  const bar = bars.at(-1), day = bar?.date.slice(0, 10)
  if (!bar || !day || snapshot.analysisBasis.dailyAt?.slice(0, 10) !== day || snapshot.metrics.lastPrice !== bar.close
    || stamp(source.asOf) < stamp(day) || new Set(bars.map(b => b.date.slice(0, 10))).size !== bars.length
    || ![bar.open, bar.high, bar.low, bar.close].every(n => Number.isFinite(n) && n > 0) || bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close)) return null
  try { assertFreshBars(bars, asset, '1d', at) } catch { return null }
  const close = movementDailyCompletedAt(day, asset)
  if (close === null || !Number.isFinite(close) || close > stamp(snapshot.capturedAt) || close > at.getTime()) return null
  return { asset, price: bar.close, asOf: new Date(close).toISOString(), observedAt: snapshot.capturedAt, provider: source.provider, feed: null, priceKind: 'completed-daily-close', status: 'delayed' }
}

export function createMovementAlertService(deps: {
  quotes: { read(asset: MarketMonitorAsset): Promise<MarketQuote> }
  snapshot(asset: MarketMonitorAsset): Promise<MarketMonitorSnapshot | null>
  risk(asset: MarketMonitorAsset, anchor: MovementPrice | null): Promise<MovementRisk>
  root?: string
  now?: () => Date
}) {
  const root = deps.root ?? dataPath('market-monitor', 'movement-alerts-v1'), now = deps.now ?? (() => new Date())
  const checkFailures = new Set<MarketMonitorAsset>()
  const asset = (value: MarketMonitorAsset) => { if (!assetSchema.safeParse(value).success) throw new MovementAlertError('movement-invalid'); return value }
  const file = (value: MarketMonitorAsset) => `${root}/${asset(value)}.json`
  const serialize = <T>(value: MarketMonitorAsset, run: () => Promise<T>) => {
    const key = file(value), task = (serials.get(key) ?? Promise.resolve()).catch(() => {}).then(run)
    serials.set(key, task)
    void task.finally(() => { if (serials.get(key) === task) serials.delete(key) }).catch(() => {})
    return task
  }
  const read = async (value: MarketMonitorAsset): Promise<State> => {
    try {
      const raw = await readFile(file(value), 'utf8')
      if (raw.length > 8_000_000) throw new Error()
      const state = stateSchema.parse(JSON.parse(raw))
      if (state.asset !== value || state.recordHash !== hash(state) || new Set(state.plans.map(p => p.id)).size !== state.plans.length || state.plans.filter(armed).length > 1) throw new Error()
      for (const p of state.plans) {
        if (p.asset !== value || p.anchor.asset !== value || (!p.up && !p.down) || stamp(p.anchor.asOf) > stamp(p.anchor.observedAt) || stamp(p.anchor.observedAt) > stamp(p.createdAt)
          || stamp(p.expiresAt) - stamp(p.createdAt) < HOUR || stamp(p.expiresAt) - stamp(p.createdAt) > 168 * HOUR) throw new Error()
        for (const direction of ['up', 'down'] as const) {
          const leg = p[direction]
          if (!leg) continue
          if (target(p.anchor.price, direction, leg.percent) !== leg.targetPrice || (leg.state === 'triggered') !== (leg.event !== null)) throw new Error()
          const e = leg.event
          if (e && (e.planId !== p.id || e.asset !== value || e.direction !== direction || e.percent !== leg.percent || e.targetPrice !== leg.targetPrice || stamp(e.asOf) <= Math.max(stamp(p.anchor.asOf), stamp(p.createdAt))
            || stamp(e.asOf) > stamp(e.observedAt) || stamp(e.observedAt) >= stamp(p.expiresAt) || stamp(e.asOf) >= stamp(p.expiresAt)
            || (direction === 'up' ? new Decimal(e.price).lt(leg.targetPrice) : new Decimal(e.price).gt(leg.targetPrice)))) throw new Error()
        }
      }
      return state
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, asset: value, plans: [], recordHash: '' }
      throw new MovementAlertError('movement-state-unavailable')
    }
  }
  const save = async (state: State) => {
    const path = file(state.asset), temp = `${path}.${randomUUID()}.tmp`
    try {
      await mkdir(root, { recursive: true, mode: 0o700 })
      state.recordHash = hash(state)
      await writeFile(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
      await rename(temp, path)
    } catch { throw new MovementAlertError('movement-state-unavailable') }
    finally { await unlink(temp).catch(() => {}) }
  }
  const reference = async (value: MarketMonitorAsset) => {
    const quote = await deps.quotes.read(value).catch(() => null)
    const current = movementPriceFromQuote(quote, value, now())
    return current ?? movementPriceFromSnapshot(await deps.snapshot(value).catch(() => null), value, now())
  }
  const report = async (value: MarketMonitorAsset): Promise<MovementReport> => {
    asset(value)
    let state: State, readError = false
    try { state = await read(value) } catch { state = { schemaVersion: 1, asset: value, plans: [], recordHash: '' }; readError = true }
    const at = now(), plans = structuredClone(state.plans)
    plans.forEach(p => expire(p, at)) // Projection only: GET cannot trigger or persist.
    const anchor = await reference(value)
    let risk: MovementRisk
    try { risk = await deps.risk(value, anchor) }
    catch { risk = { protocol: 'market-movement-risk-v1', status: 'unavailable', reason: 'snapshot-unavailable', reference: anchor, analysis: null, horizons: [] } }
    return { asset: value, generatedAt: now().toISOString(), plans: plans.reverse(), risk, readError, checkError: checkFailures.has(value) }
  }
  return {
    report,
    async create(input: MovementCreate) {
      const parsed = movementCreateSchema.safeParse(input)
      if (!parsed.success) throw new MovementAlertError('movement-invalid')
      const value = parsed.data.asset
      await serialize(value, async () => {
        const state = await read(value), at = now()
        state.plans.forEach(p => expire(p, at))
        if (state.plans.some(armed)) throw new MovementAlertError('movement-active-plan')
        if (state.plans.length >= LIMIT) throw new MovementAlertError('movement-state-unavailable')
        const anchor = await reference(value), created = now()
        if (!anchor) throw new MovementAlertError('movement-price-unavailable')
        const leg = (direction: 'up' | 'down', p: number | undefined): MovementLeg | null => p === undefined ? null : { state: 'armed', percent: p, targetPrice: target(anchor.price, direction, p), event: null }
        state.plans.push({ id: randomUUID(), asset: value, createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + input.expiresInHours * HOUR).toISOString(), anchor, up: leg('up', input.upPercent), down: leg('down', input.downPercent), lastObservedAsOf: null, latestCheck: null })
        await save(state)
      })
      return report(value)
    },
    async cancel(id: string, value: MarketMonitorAsset) {
      if (!z.string().uuid().safeParse(id).success) throw new MovementAlertError('movement-invalid')
      await serialize(value, async () => {
        const state = await read(value), p = state.plans.find(p => p.id === id)
        if (!p) throw new MovementAlertError('movement-not-found')
        expire(p, now())
        for (const direction of ['up', 'down'] as const) if (p[direction]?.state === 'armed') p[direction]!.state = 'cancelled'
        await save(state)
      })
      return report(value)
    },
    async check(value: MarketMonitorAsset): Promise<void> {
      let persisted = false
      try { await serialize(value, async () => {
        const state = await read(value), plan = state.plans.find(armed)
        if (!plan) return
        const persist = async () => { await save(state); persisted = true }
        if (expire(plan, now())) { await persist(); return }
        const raw = await deps.quotes.read(value).catch(() => null), at = now()
        if (expire(plan, at)) { await persist(); return }
        const quote = movementPriceFromQuote(raw, value, at)
        const newAfter = Math.max(stamp(plan.createdAt), stamp(plan.anchor.asOf), plan.lastObservedAsOf ? stamp(plan.lastObservedAsOf) : 0)
        const usable = quote && stamp(quote.asOf) > newAfter && stamp(quote.observedAt) < stamp(plan.expiresAt) && stamp(quote.asOf) < stamp(plan.expiresAt)
        plan.latestCheck = { checkedAt: at.toISOString(), status: usable ? 'observed' : 'unavailable', reason: usable ? null : quote ? 'quote-not-new' : 'quote-unavailable', quote }
        if (usable) plan.lastObservedAsOf = quote.asOf
        if (usable) for (const direction of ['up', 'down'] as const) {
          const leg = plan[direction]
          if (!leg || leg.state !== 'armed' || (direction === 'up' ? new Decimal(quote.price).lt(leg.targetPrice) : new Decimal(quote.price).gt(leg.targetPrice))) continue
          const event: MovementEvent = { id: randomUUID(), planId: plan.id, asset: value, direction, percent: leg.percent, targetPrice: leg.targetPrice,
            price: quote.price, asOf: quote.asOf, observedAt: quote.observedAt, provider: quote.provider, feed: quote.feed, providerChanged: quote.provider !== plan.anchor.provider || quote.feed !== plan.anchor.feed }
          leg.state = 'triggered'; leg.event = event
        }
        await persist() // Event and one-shot state share one atomic replacement.
      }); if (persisted) checkFailures.delete(value) }
      catch { checkFailures.add(value); throw new MovementAlertError('movement-state-unavailable') }
    },
  }
}
export type MovementAlertService = ReturnType<typeof createMovementAlertService>
