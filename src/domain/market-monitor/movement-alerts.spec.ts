import { mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createMovementAlertService, movementDailyCompletedAt, movementPriceFromQuote, movementPriceFromSnapshot } from './movement-alerts.js'
import type { MarketQuote } from '../market-data/quotes.js'
import type { MarketMonitorSnapshot } from './types.js'
import type { MovementRisk } from './movement-alert-types.js'

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})
const roots: string[] = []
afterEach(async () => { vi.mocked(rename).mockClear(); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'market-movement-')); roots.push(root)
  let at = new Date('2026-10-19T20:30:00Z')
  let quote: MarketQuote = { asset: 'BTC', price: 100, asOf: '2026-10-19T20:29:59Z', fetchedAt: at.toISOString(), provider: 'coinbase', feed: 'Coinbase Exchange', status: 'fresh', currency: 'USD', attempts: [] }
  const quotes = { read: vi.fn(async () => quote) }, snapshot = vi.fn(async (): Promise<MarketMonitorSnapshot | null> => null)
  const risk = vi.fn(async () => ({ status: 'unavailable' } as MovementRisk))
  const service = () => createMovementAlertService({ root, quotes, snapshot, risk, now: () => at })
  const tick = (seconds: number, price: number, asOf?: string) => {
    at = new Date(at.getTime() + seconds * 1000)
    quote = { ...quote, price, asOf: asOf ?? new Date(at.getTime() - 1000).toISOString(), fetchedAt: at.toISOString() }
  }
  return { root, service, quotes, snapshot, risk, tick, quote: () => quote, at: () => at, setQuote: (q: MarketQuote) => { quote = q } }
}
const input = { asset: 'BTC' as const, upPercent: 5, downPercent: 5, expiresInHours: 1 }

it('freezes targets, atomically triggers once, retains opposite leg, and survives restart', async () => {
  const f = await fixture(), s = f.service()
  const created = (await s.create(input)).plans[0]!
  expect(created.anchor.price).toBe(100); expect(created.up?.targetPrice).toBe(105); expect(created.down?.targetPrice).toBe(95)
  f.tick(60, 105)
  await Promise.all([s.check('BTC'), s.check('BTC')])
  const result = (await f.service().report('BTC')).plans[0]!
  expect(result.up?.state).toBe('triggered'); expect(result.down?.state).toBe('armed')
  const id = result.up!.event!.id
  f.tick(60, 106); await f.service().check('BTC')
  expect((await s.report('BTC')).plans[0]!.up!.event!.id).toBe(id)
  f.tick(60, 94); await s.check('BTC')
  const final = (await s.report('BTC')).plans[0]!
  expect(final.down?.state).toBe('triggered'); expect(final.up!.event!.id).toBe(id)
})

it('GET never triggers or writes and competing creates preserve one active plan', async () => {
  const f = await fixture(), s = f.service()
  const requests = await Promise.allSettled([s.create(input), f.service().create(input)])
  expect(requests.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(requests.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'movement-active-plan' } })
  const bytes = await readFile(join(f.root, 'BTC.json'), 'utf8')
  f.tick(60, 110)
  expect((await s.report('BTC')).plans[0]!.up?.state).toBe('armed')
  expect(await readFile(join(f.root, 'BTC.json'), 'utf8')).toBe(bytes)
})

it('keeps readable active plans and event history when supplementary risk analysis fails', async () => {
  const f = await fixture(), s = f.service(); await s.create(input)
  f.tick(60, 105); await s.check('BTC')
  const bytes = await readFile(join(f.root, 'BTC.json'), 'utf8')
  f.risk.mockRejectedValue(new Error('private snapshot path and configuration details'))
  const report = await s.report('BTC')
  expect(report.readError).toBe(false)
  expect(report.plans[0]!.up).toMatchObject({ state: 'triggered', event: { price: 105 } })
  expect(report.plans[0]!.down?.state).toBe('armed')
  expect(report.risk).toEqual({ protocol: 'market-movement-risk-v1', status: 'unavailable', reason: 'snapshot-unavailable',
    reference: expect.objectContaining({ price: 105, provider: 'coinbase', priceKind: 'last-trade' }), analysis: null, horizons: [] })
  expect(JSON.stringify(report)).not.toMatch(/private|configuration details/)
  expect(await readFile(join(f.root, 'BTC.json'), 'utf8')).toBe(bytes)
})

it('reports successful create and cancel commits even when supplementary risk analysis is unavailable', async () => {
  const f = await fixture(), s = f.service()
  f.risk.mockRejectedValue(new Error('private snapshot read failure'))
  const created = await s.create(input)
  expect(created.risk).toMatchObject({ status: 'unavailable', reason: 'snapshot-unavailable' })
  expect(created.plans[0]!.up?.state).toBe('armed')
  const cancelled = await s.cancel(created.plans[0]!.id, 'BTC')
  expect(cancelled.risk).toMatchObject({ status: 'unavailable', reason: 'snapshot-unavailable' })
  expect(cancelled.plans[0]!.up?.state).toBe('cancelled')
  expect((await f.service().report('BTC')).plans[0]!.down?.state).toBe('cancelled')
})

it('never regresses the accepted trade watermark after stale out-of-order checks or restart', async () => {
  const f = await fixture(), s = f.service(); await s.create(input)
  f.tick(60, 101); const t1 = f.quote().asOf!
  f.tick(30, 106); const t2 = f.quote().asOf!
  f.tick(30, 102); const t3 = f.quote().asOf!
  await s.check('BTC')
  f.tick(1, 106, t1); await s.check('BTC')
  f.tick(1, 106, t2); await f.service().check('BTC')
  const p = (await s.report('BTC')).plans[0]!
  expect(p.up?.state).toBe('armed'); expect(p.lastObservedAsOf).toBe(t3)
  expect(p.latestCheck).toMatchObject({ status: 'unavailable', reason: 'quote-not-new' })
})

it.each(['stale', 'future', 'asset', 'source', 'malformed', 'old-trade'] as const)('does not trigger from %s quotes and recovers on new valid data', async mode => {
  const f = await fixture(), s = f.service(); await s.create(input); f.tick(60, 106)
  const good = f.quote()
  f.setQuote({ ...good, ...(mode === 'stale' ? { status: 'stale' as const } : mode === 'future' ? { asOf: '2026-10-19T20:32:00Z' } : mode === 'asset' ? { asset: 'TSLA' as const } : mode === 'source' ? { feed: 'IEX' as const } : mode === 'malformed' ? { asOf: 'not-a-time' } : { asOf: '2026-10-19T20:29:59Z' }) })
  await s.check('BTC')
  const rejected = (await s.report('BTC')).plans[0]!
  expect(rejected.up?.state).toBe('armed'); expect(rejected.latestCheck?.status).toBe('unavailable')
  f.setQuote(good); await s.check('BTC'); expect((await s.report('BTC')).plans[0]!.up?.state).toBe('triggered')
})

it('records provider changes explicitly and does not accept delayed trades beyond their policy age', async () => {
  const f = await fixture(), s = f.service(); await s.create(input); f.tick(60, 106)
  f.setQuote({ ...f.quote(), provider: 'yfinance', feed: 'Yahoo Finance', status: 'delayed' })
  await s.check('BTC')
  expect((await s.report('BTC')).plans[0]!.up!.event).toMatchObject({ provider: 'yfinance', providerChanged: true })
  expect(movementPriceFromQuote({ ...f.quote(), asOf: '2026-10-19T20:20:00Z' }, 'BTC', f.at())).toBeNull()
})

it('expires by walltime even if a provider returns a pre-deadline trade late, allows a new plan and retains history', async () => {
  const f = await fixture(), s = f.service(); await s.create(input)
  f.tick(3601, 106, '2026-10-19T21:29:59Z'); await s.check('BTC')
  expect((await s.report('BTC')).plans[0]!.up?.state).toBe('expired')
  await s.create(input)
  const p = (await s.report('BTC')).plans
  expect(p).toHaveLength(2); expect(p[0]!.up?.state).toBe('armed'); expect(p[1]!.up?.event).toBeNull()
})

it('cancels only the requested asset and leaves cancelled plans terminal', async () => {
  const f = await fixture(), s = f.service(); const p = (await s.create(input)).plans[0]!
  await expect(s.cancel(p.id, 'TSLA')).rejects.toMatchObject({ code: 'movement-not-found' })
  await s.cancel(p.id, 'BTC'); f.tick(60, 106); await s.check('BTC')
  expect((await s.report('BTC')).plans[0]!.up?.state).toBe('cancelled')
})

it('refuses corrupt persisted state without repairing or erasing it', async () => {
  const f = await fixture(), s = f.service(); await s.create(input)
  const file = join(f.root, 'BTC.json'), raw = await readFile(file, 'utf8')
  await writeFile(file, raw.replace('"targetPrice":105', '"targetPrice":1'))
  const bytes = await readFile(file, 'utf8')
  expect((await s.report('BTC')).readError).toBe(true)
  await expect(s.create(input)).rejects.toMatchObject({ code: 'movement-state-unavailable' })
  await expect(s.check('BTC')).rejects.toMatchObject({ code: 'movement-state-unavailable' })
  expect(await readFile(file, 'utf8')).toBe(bytes)
})

it('keeps failed atomic writes visible and original state intact, then recovers on a persisted retry', async () => {
  const f = await fixture(), s = f.service(); await s.create(input)
  const file = join(f.root, 'BTC.json'), before = await readFile(file, 'utf8')
  f.tick(60, 106); vi.mocked(rename).mockRejectedValueOnce(new Error('private path and transport'))
  await expect(s.check('BTC')).rejects.toMatchObject({ code: 'movement-state-unavailable' })
  expect(await readFile(file, 'utf8')).toBe(before)
  expect((await s.report('BTC')).checkError).toBe(true)
  await s.check('BTC')
  const report = await s.report('BTC')
  expect(report.checkError).toBe(false); expect(report.plans[0]!.up?.state).toBe('triggered')
})

it.each([{ ...input, upPercent: 0 }, { ...input, downPercent: 51 }, { asset: 'BTC', expiresInHours: 1 }, { ...input, expiresInHours: 169 }, { ...input, unexpected: true }])('rejects invalid configuration before reading prices', async value => {
  const f = await fixture()
  await expect(f.service().create(value as typeof input)).rejects.toMatchObject({ code: 'movement-invalid' })
  expect(f.quotes.read).not.toHaveBeenCalled()
})

it('uses attributed completed daily closes only as frozen fallback anchors with real completion times', () => {
  const snapshot = { asset: 'BTC', capturedAt: '2026-10-19T20:30:00Z', analysisBasis: { closedBarsOnly: true, dailyAt: '2026-10-18' }, metrics: { lastPrice: 100 }, sourceHealth: [{ id: 'daily-bars', status: 'ok', provider: 'coinbase', asOf: '2026-10-18' }], chart: { dailyMeta: { symbol: 'BTC-USD' }, daily: [{ date: '2026-10-18', open: 99, high: 101, low: 98, close: 100, volume: 1 }] } } as unknown as MarketMonitorSnapshot
  const at = new Date(snapshot.capturedAt)
  expect(movementPriceFromSnapshot(snapshot, 'BTC', at)).toMatchObject({ priceKind: 'completed-daily-close', asOf: '2026-10-19T00:00:00.000Z', provider: 'coinbase' })
  expect(movementPriceFromSnapshot({ ...snapshot, capturedAt: '2026-10-18T20:30:00Z' }, 'BTC', at)).toBeNull()
  expect(movementPriceFromSnapshot(snapshot, 'TSLA', at)).toBeNull()
  expect(movementPriceFromSnapshot(snapshot, 'BTC', new Date('2026-10-22'))).toBeNull()
  expect(movementPriceFromSnapshot({ ...snapshot, sourceHealth: [{ ...snapshot.sourceHealth[0]!, asOf: '2026-10-20' }] }, 'BTC', at)).toBeNull()
  expect(movementPriceFromSnapshot({ ...snapshot, sourceHealth: [{ ...snapshot.sourceHealth[0]!, asOf: '2026-10-17' }] }, 'BTC', at)).toBeNull()
  expect(movementPriceFromSnapshot({ ...snapshot, chart: { ...snapshot.chart, dailyMeta: { ...snapshot.chart.dailyMeta, symbol: 'TSLA' } } }, 'BTC', at)).toBeNull()
  expect(movementPriceFromSnapshot({ ...snapshot, chart: { ...snapshot.chart, daily: [...snapshot.chart.daily, ...snapshot.chart.daily] } }, 'BTC', at)).toBeNull()
  expect(new Date(movementDailyCompletedAt('2026-10-19', 'TSLA')!).toISOString()).toBe('2026-10-19T20:00:00.000Z')
  expect(new Date(movementDailyCompletedAt('2026-11-27', 'TSLA')!).toISOString()).toBe('2026-11-27T18:00:00.000Z')
  expect(movementDailyCompletedAt('2026-10-18', 'TSLA')).toBeNull()
})
