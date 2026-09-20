import { describe, expect, it, vi } from 'vitest'
import { createTypeSafeService, summarizeJev } from './typesafe-service.js'
import { buildJevInput, hashJevInput } from './typesafe-input.js'
import { TYPESAFE_MODEL } from './typesafe-client.js'
import { analysisInputHash, type MarketAnalysisArchive } from './replay.js'
import { evidenceChainV1Strategy } from './strategy.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS, type MarketMonitorAsset, type MarketMonitorSnapshot } from './types.js'
import type { MarketMonitorStore } from './store.js'
import type { JevForecast } from './typesafe-types.js'
import type { createTypeSafeStore } from './typesafe-store.js'
import type { OhlcvBar } from '../market-data/bars/index.js'

function fixture(asset: MarketMonitorAsset = 'BTC') {
  let at = new Date('2026-09-20T12:00:00Z')
  const daily: OhlcvBar[] = Array.from({ length: 100 }, (_, i) => ({ date: new Date(at.getTime() - (100 - i) * 86400000).toISOString().slice(0, 10), open: 100, high: 105, low: 95, close: 102, volume: 100 }))
  const hourly: OhlcvBar[] = [{ date: '2026-09-20T10:00:00Z', open: 101, high: 105, low: 99, close: 102, volume: 20 }]
  const input: MarketAnalysisArchive['input'] = { asset, asOf: at.toISOString(), dailyBars: daily, intradayBars: hourly, strategyId: 'evidence-chain-v1', strategyVersion: 2, abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5, context: { fundingRate: 0, recentNews: [{ title: 'DO NOT COPY RULE CONCLUSIONS', time: at.toISOString(), source: 'test' }] }, sourceHealth: [{ id: 'daily-bars', label: 'Daily', status: 'ok', provider: 'test', asOf: daily.at(-1)!.date, detail: 'do-not-send-provider-detail' }] }
  const analysis = evidenceChainV1Strategy.analyze({ ...input, asOf: at })
  const meta = { symbol: asset, from: daily[0]!.date, to: daily.at(-1)!.date, bars: daily.length, source: 'vendor' as const, sourceId: 'test', provider: 'test', interval: '1d' as const }
  const snapshot: MarketMonitorSnapshot = { ...analysis, id: 'f604bbbf-1e9a-4801-82ad-cd282550635d', asset, capturedAt: input.asOf, trigger: 'manual', strategyId: input.strategyId, fingerprint: 'fixture', context: input.context, sourceHealth: input.sourceHealth, analysisBasis: { version: 2, closedBarsOnly: true, dailyAt: daily.at(-1)!.date, hourlyAt: hourly[0]!.date }, analysisInput: { hash: analysisInputHash(input), strategyVersion: 2 }, chart: { daily, intraday: hourly, dailyMeta: meta, intradayMeta: null } }
  for (const h of ['short', 'medium', 'long'] as const) snapshot.trend![h].direction = 'bearish'
  const archive = { schemaVersion: 1 as const, input, snapshot }
  const records: JevForecast[] = []
  let configured = true, automatic = false
  const store = {
    config: async () => ({ apiKey: configured ? 'test-only-placeholder' : '', automatic }),
    settings: async () => ({ configured, automatic, model: TYPESAFE_MODEL }), save: vi.fn(), forecasts: async () => records,
    appendForecast: vi.fn(async (row: JevForecast) => { records.push(structuredClone(row)) }), appendAudit: vi.fn(),
  } as unknown as ReturnType<typeof createTypeSafeStore>
  const market = { archive: vi.fn(async () => archive), latestSeries: vi.fn(async () => snapshot.chart) } as unknown as MarketMonitorStore
  const monitor = { scan: vi.fn(async () => ({ snapshot })), settings: async () => DEFAULT_MARKET_MONITOR_SETTINGS, snapshots: async () => [snapshot] }
  const evaluate = vi.fn(async () => ({ model: TYPESAFE_MODEL, answers: Object.fromEntries(['short', 'medium', 'long'].flatMap(h => [[h, { type: 'choice' as const, choice: 'up', confidence: 0.6, probabilities: { up: 0.6, flat: 0.3, down: 0.1 } }], [`${h}Evidence`, { type: 'choice' as const, choice: 'adequate', confidence: 0.7, probabilities: { adequate: 0.7, insufficient: 0.3 } }]])), inputTokens: 1000, durationMs: 4 }))
  const service = createTypeSafeService({ monitor: monitor as never, store, marketStore: market, client: { evaluate }, now: () => at })
  return { service, records, evaluate, monitor, market, archive, snapshot, setAt: (value: string) => { at = new Date(value) }, configure: (value: boolean, auto = false) => { configured = value; automatic = auto } }
}

describe('prospective Jev research', () => {
  it('uses numeric evidence, closed bars and explicit horizon definitions, without rule labels or raw errors', () => {
    const f = fixture(), result = buildJevInput(f.archive, new Date('2026-09-20T12:00:00Z'))
    expect(result.periods).toEqual({ short: 1, medium: 7, long: 30 })
    expect(result.state.context).toEqual({ fundingRate: 0 })
    expect(JSON.stringify(result.state)).not.toMatch(/bearish|DO NOT COPY|do-not-send-provider-detail/)
    expect(buildJevInput(fixture('MSTR').archive, new Date('2026-09-20T12:00:00Z')).periods).toEqual({ short: 1, medium: 5, long: 20 })
    f.archive.input.intradayBars = []
    expect(buildJevInput(f.archive, new Date('2026-09-20T12:00:00Z')).state.hourly).toBeNull()
    expect(() => buildJevInput(f.archive, new Date('2026-09-25T12:00:00Z'))).toThrow(/过期/)
  })
  it('single-flights requests and reuses the persisted daily record after restart without a paid call', async () => {
    const f = fixture()
    const [a, b] = await Promise.all([f.service.generate('BTC'), f.service.generate('BTC')])
    expect(a.id).toBe(b.id)
    expect(f.evaluate).toHaveBeenCalledOnce()
    expect(f.records).toHaveLength(1)
    expect(a.horizons.short.baseline).toBe('bearish')
    expect(a.recordHash).toBe(hashJevInput({ ...a, recordHash: '' }))
    expect((await f.service.generate('BTC')).id).toBe(a.id)
    expect(f.evaluate).toHaveBeenCalledOnce()
  })
  it('does not call the provider until configured and opt-in, and isolates errors', async () => {
    const f = fixture()
    f.configure(false)
    await f.service.automatic('BTC')
    await expect(f.service.generate('BTC')).rejects.toThrow(/保存 TypeSafe/)
    f.configure(true, false)
    await f.service.automatic('BTC')
    expect(f.evaluate).not.toHaveBeenCalled()
    f.configure(true, true)
    f.evaluate.mockRejectedValueOnce(new Error('private transport details'))
    await expect(f.service.automatic('BTC')).rejects.toThrow(/暂不可用/)
    expect((await f.service.report('BTC')).lastError).not.toContain('private transport')
    expect(f.records).toHaveLength(0)
  })
  it('dates the prediction at publication, waits for future closes and scores matched baselines', async () => {
    const f = fixture()
    await f.service.generate('BTC')
    expect((await f.service.report('BTC')).summaries[0]).toMatchObject({ pending: 1, complete: 0, accuracy: null })
    // Today's huge move cannot become the entry. Entry is tomorrow's open.
    f.snapshot.chart.daily.push({ date: '2026-09-20', open: 10, close: 100, low: 10, high: 100, volume: 100 }, { date: '2026-09-21', open: 200, close: 202, low: 195, high: 205, volume: 100 })
    f.setAt('2026-09-22T01:00:00Z')
    const report = await f.service.report('BTC')
    expect(report.rows[0].outcomes[0]).toMatchObject({ actual: 'up', correct: true, outcome: { entry: 200, close: 202, start: '2026-09-21' } })
    expect(report.rows[0].outcomes[0].brier).toBeCloseTo(0.26)
    expect(report.summaries[0]).toMatchObject({ complete: 1, scored: 1, accuracy: 1, baselineAccuracy: 0, pairedAccuracy: 1, baselineCompared: 1, alwaysUpAccuracy: 1 })
    expect(report.summaries[1]).toMatchObject({ pending: 1 })
    expect(f.evaluate).toHaveBeenCalledOnce()
  })
  it('counts abstentions and missing archives without inflating accuracy', async () => {
    const f = fixture(); await f.service.generate('BTC')
    f.snapshot.chart.daily.push({ date: '2026-09-20', open: 100, close: 100, low: 95, high: 105, volume: 100 }, { date: '2026-09-21', open: 100, close: 102, low: 95, high: 105, volume: 100 })
    f.setAt('2026-09-22T01:00:00Z')
    f.records[0].horizons.short.adequacy = { type: 'choice', choice: 'insufficient', confidence: 0.7, probabilities: { adequate: 0.3, insufficient: 0.7 } }
    f.records[0].recordHash = hashJevInput({ ...f.records[0], recordHash: '' })
    const report = await f.service.report('BTC')
    expect(report.summaries[0]).toMatchObject({ complete: 1, abstained: 1, scored: 0, accuracy: null, baselineCompared: 0 })
    expect(report.summaries[0].brier).toBeCloseTo(0.26)
    vi.mocked(f.market.archive).mockResolvedValueOnce(null)
    expect((await f.service.report('BTC')).summaries[0]).toMatchObject({ excluded: 1, complete: 0 })
    f.records[0].issuedAt = '2026-09-20T13:00:00Z'
    expect((await f.service.report('BTC')).invalidRecords).toBe(1)
  })
  it('keeps comparison samples paired when rules abstain', async () => {
    const f = fixture(); await f.service.generate('BTC')
    const row = (await f.service.report('BTC')).rows[0]
    row.forecast.horizons.short.baseline = 'insufficient'
    row.outcomes[0] = { ...row.outcomes[0], actual: 'up', correct: true, brier: 0.26, outcome: { ...row.outcomes[0].outcome, status: 'complete' } }
    expect(summarizeJev([row])[0]).toMatchObject({ scored: 1, accuracy: 1, pairedAccuracy: null, baselineAccuracy: null, baselineCompared: 0, alwaysUpAccuracy: 1 })
  })
})
