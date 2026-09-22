import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judgmentSnapshot } from './judgment.fixture.js'
import { analysisInputHash, type MarketAnalysisArchive } from './replay.js'
import { buildJevInput, hashJevInput } from './typesafe-input.js'
import { createForecastExperiment, summarizeExperiment } from './forecast-experiment.js'
import { createForecastExperimentStore, recordHash } from './forecast-experiment-store.js'
import { buildChallengerInput, historicalReturns, returnChoice } from './forecast-history.js'
import { JEV_HORIZONS, JEV_PROTOCOL, type JevForecast, type JevReport } from './typesafe-types.js'
import { TYPESAFE_MODEL, type JevQuestion } from './typesafe-client.js'
import type { MarketMonitorStore } from './store.js'
import type { OhlcvBar } from '../market-data/bars/index.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'forecast-experiment-')); roots.push(root)
  const snapshot = judgmentSnapshot(); snapshot.id = 'f604bbbf-1e9a-4801-82ad-cd282550635d'
  const input: MarketAnalysisArchive['input'] = { asset: 'BTC', asOf: snapshot.capturedAt, strategyId: snapshot.strategyId, strategyVersion: 2,
    dailyBars: structuredClone(snapshot.chart.daily), intradayBars: structuredClone(snapshot.chart.intraday), abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5, context: snapshot.context, sourceHealth: snapshot.sourceHealth }
  snapshot.analysisInput = { hash: analysisInputHash(input), strategyVersion: 2 }
  const archive: MarketAnalysisArchive = { schemaVersion: 1, input, snapshot }
  let at = new Date(snapshot.capturedAt), automatic = true
  const base = buildJevInput(archive, at)
  const answer = { type: 'choice' as const, choice: 'flat', confidence: 0.7, probabilities: { up: 0.2, flat: 0.7, down: 0.1 } }
  const adequacy = { type: 'choice' as const, choice: 'adequate', confidence: 0.8, probabilities: { adequate: 0.8, insufficient: 0.2 } }
  const original: JevForecast = { schemaVersion: 1, id: 'original', asset: 'BTC', issuedAt: at.toISOString(), model: TYPESAFE_MODEL, protocol: JEV_PROTOCOL,
    basis: { snapshotId: snapshot.id, inputHash: snapshot.analysisInput.hash, capturedAt: input.asOf, strategyId: input.strategyId, strategyVersion: 2 },
    inputHash: hashJevInput({ state: base.state, questions: base.questions }), recordHash: '', state: base.state, questions: base.questions,
    horizons: Object.fromEntries(JEV_HORIZONS.map(h => [h, { bars: base.periods[h], answer, adequacy, baseline: 'bullish' }])) as unknown as JevForecast['horizons'], inputTokens: 1, durationMs: 1 }
  original.recordHash = recordHash(original)
  const baseline = { generate: vi.fn(async () => original), settings: vi.fn(async () => ({ configured: true, automatic, model: TYPESAFE_MODEL })),
    report: vi.fn(async () => ({ asset: 'BTC', generatedAt: at.toISOString(), configured: true, automatic, model: TYPESAFE_MODEL, historyTruncated: false, invalidRecords: 0, lastError: null,
      rows: [{ forecast: original, outcomes: [], providerChanged: false }], summaries: [] }) as JevReport) }
  const evaluate = vi.fn(async (_key: string, _state: unknown, questions: Record<string, JevQuestion>) => ({ model: TYPESAFE_MODEL, inputTokens: 1234, durationMs: 2,
    answers: Object.fromEntries(Object.entries(questions).map(([key, q]) => { const options = Object.keys(q.criteria), choice = options.includes('adequate') ? 'adequate' : options[0]!; return [key, { type: 'choice' as const, choice, confidence: 0.7, probabilities: Object.fromEntries(options.map(o => [o, o === choice ? 0.7 : 0.3 / (options.length - 1)])) }] })) }))
  const market = { archive: vi.fn(async () => archive), latestSeries: vi.fn(async () => snapshot.chart) } as unknown as MarketMonitorStore
  const store = createForecastExperimentStore(root)
  const deps = { baseline, market, store, credentials: { config: async () => ({ apiKey: 'test-only-placeholder', automatic: true }) }, client: { evaluate }, now: () => at }
  return { root, store, archive, snapshot, original, baseline, evaluate, market, deps, service: createForecastExperiment(deps), setAt: (date: string) => { at = new Date(date) }, setAutomatic: (value: boolean) => { automatic = value } }
}

describe('same-evidence forward experiment', () => {
  it('freezes original/combined before the call, single-flights and reuses immutable results after restart', async () => {
    const f = await fixture(), originalBefore = structuredClone(f.original)
    f.evaluate.mockImplementationOnce(async (...args) => {
      expect(await f.store.publication('BTC', '2026-09-20')).not.toBeNull()
      return { model: TYPESAFE_MODEL, answers: Object.fromEntries(Object.entries(args[2]).map(([key, q]) => { const choices = Object.keys(q.criteria); return [key, { type: 'choice', choice: choices[0]!, confidence: 1, probabilities: Object.fromEntries(choices.map((c, i) => [c, i ? 0 : 1])) }] })), inputTokens: 1, durationMs: 1 }
    })
    const [a, b] = await Promise.all([f.service.collect('BTC'), f.service.collect('BTC')])
    expect(a.id).toBe(b.id); expect(f.evaluate).toHaveBeenCalledOnce()
    expect(a.combined.snapshotId).toBe(f.original.basis.snapshotId)
    expect(a.combined.structure.confirmation).toEqual(f.snapshot.wyckoff!.confirmation)
    expect(f.original).toEqual(originalBefore)
    expect(JSON.stringify(await f.service.report('BTC'))).not.toContain('test-only-placeholder')
    const before = await readFile(join(f.root, 'BTC-2026-09-20.json'), 'utf8')
    await createForecastExperiment(f.deps).collect('BTC')
    expect(f.evaluate).toHaveBeenCalledOnce()
    expect(await readFile(join(f.root, 'BTC-2026-09-20.json'), 'utf8')).toBe(before)
    expect((await f.service.report('BTC')).summaries[0]).toMatchObject({ pending: 1, uniqueWindows: 0, paired: { count: 0 } })
  })
  it('uses common future windows, scores the frozen combined direction and never regenerates on reads', async () => {
    const f = await fixture(); await f.service.collect('BTC')
    f.snapshot.chart.daily.push({ date: '2026-09-20', open: 1, high: 500, low: 1, close: 500, volume: 1 }, { date: '2026-09-21', open: 100, high: 102, low: 99, close: 101, volume: 1 })
    f.setAt('2026-09-22T01:00:00Z')
    const report = await f.service.report('BTC')
    expect(report.rows[0]!.outcomes[0]).toMatchObject({ actual: 'up', outcome: { entry: 100, close: 101 }, correct: { original: false, challenger: true, combined: true, rules: true } })
    expect(report.summaries[0]).toMatchObject({ paired: { count: 1, originalCorrect: 0, challengerCorrect: 1 }, methods: { combined: { scored: 1, correct: 1 } } })
    expect(f.evaluate).toHaveBeenCalledOnce()
    const duplicate = structuredClone(report.rows[0]!); duplicate.id = 'later'; duplicate.issuedAt = '2026-09-20T13:00:00Z'
    duplicate.outcomes[0]!.correct.original = true
    expect(summarizeExperiment([duplicate, report.rows[0]!])[0]).toMatchObject({ duplicateWindows: 1, paired: { originalCorrect: 0, count: 1 } })
    vi.mocked(f.market.archive).mockResolvedValueOnce(null)
    expect((await f.service.report('BTC')).summaries[0]).toMatchObject({ excluded: 1, paired: { count: 0 } })
  })
  it('keeps publication on provider failure, hides transport details and enforces automatic cooldown/opt-in', async () => {
    const f = await fixture(); f.setAutomatic(false)
    await f.service.automatic('BTC'); expect(f.evaluate).not.toHaveBeenCalled()
    f.setAutomatic(true); f.evaluate.mockRejectedValueOnce(new Error('sensitive-provider-echo'))
    await expect(f.service.automatic('BTC')).rejects.toThrow(/对照实验/)
    expect(await f.store.publication('BTC', '2026-09-20')).not.toBeNull()
    expect((await f.service.report('BTC')).lastError).not.toContain('sensitive-provider-echo')
    await f.service.automatic('BTC'); expect(f.evaluate).toHaveBeenCalledOnce()
    await f.service.collect('BTC'); expect(f.evaluate).toHaveBeenCalledTimes(2)
    expect((await f.service.report('BTC')).latest?.candidate).not.toBeNull()
  })
  it('rejects a midnight result and corruption without overwriting the existing publication', async () => {
    const f = await fixture()
    f.evaluate.mockImplementationOnce(async () => { f.setAt('2026-09-21T00:00:00Z'); return { model: TYPESAFE_MODEL, answers: {}, inputTokens: 1, durationMs: 1 } })
    await expect(f.service.collect('BTC')).rejects.toThrow(/跨越交易日期/)
    expect(await f.store.candidate('BTC', '2026-09-20')).toBeNull()
    const path = join(f.root, 'BTC-2026-09-20.json')
    await writeFile(path, (await readFile(path, 'utf8')).replace('"asset":"BTC"', '"asset":"MSTR"'))
    f.setAt('2026-09-20T13:00:00Z')
    await expect(f.service.collect('BTC')).rejects.toThrow(/完整性/)
    expect((await f.service.report('BTC')).invalidRecords).toBe(1)
    expect(f.evaluate).toHaveBeenCalledOnce()
  })
  it('excludes an invalid challenger but keeps the original publication reviewable', async () => {
    const f = await fixture(); await f.service.collect('BTC')
    await writeFile(join(f.root, 'BTC-2026-09-20.candidate.json'), '{}')
    const report = await f.service.report('BTC')
    expect(report.invalidRecords).toBe(1); expect(report.rows).toHaveLength(1)
    expect(report.latest?.candidate).toBeNull()
  })
})

describe('historical context without look-ahead', () => {
  it('uses open-to-close returns, exact flat boundaries and population horizon volatility', () => {
    const bars: OhlcvBar[] = ['2026-09-16', '2026-09-17', '2026-09-18'].map((date, i) => ({ date, open: i ? 200 : 100, close: i === 2 ? 198 : i ? 202 : 100, low: 90, high: 210, volume: 1 }))
    const history = historicalReturns(bars, 'BTC', new Date('2026-09-19T12:00:00Z'))
    expect(history.short).toMatchObject({ samples: 2, meanPercent: 0, volatilityPercent: 1, probabilities: { up: 0.5, flat: 0, down: 0.5 } })
    expect(returnChoice(100, 100.25)).toBe('flat'); expect(returnChoice(100, 99.75)).toBe('flat')
    expect(history.medium.samples).toBe(0)
    const future = { ...bars[2]!, date: '2026-09-19', close: 1000, high: 1000 }
    expect(historicalReturns([...bars, future], 'BTC', new Date('2026-09-19T12:00:00Z'))).toEqual(history)
  })
  it('excludes missing weekdays and BTC dates rather than inventing a later starting price', () => {
    const bar = (date: string): OhlcvBar => ({ date, open: 100, high: 101, low: 99, close: 100, volume: 1 })
    expect(historicalReturns([bar('2026-09-18'), bar('2026-09-21')], 'TSLA', new Date('2026-09-22T12:00:00Z')).short.samples).toBe(1)
    expect(historicalReturns([bar('2026-09-17'), bar('2026-09-21')], 'TSLA', new Date('2026-09-22T12:00:00Z')).short.samples).toBe(0)
    expect(historicalReturns([bar('2026-09-18'), bar('2026-09-20')], 'BTC', new Date('2026-09-22T12:00:00Z')).short.samples).toBe(0)
  })
  it('adds history and atomic questions without leaking rule labels or future bars', async () => {
    const f = await fixture(), at = new Date(f.archive.input.asOf)
    const before = buildChallengerInput(f.archive, at)
    expect(before.questions.short!.instructions).toContain('uncertainty does not mean flat')
    expect(Object.keys(before.questions)).toHaveLength(9)
    expect(before.state.priceEvidence.prior20).toEqual({ lower: 90, upper: 110 })
    expect(JSON.stringify(before.state)).not.toMatch(/phaseCandidate|bullish|bearish|confirmation/)
    f.archive.input.dailyBars.push({ date: '2026-09-20', open: 101, high: 999, low: 100, close: 999, volume: 10 })
    expect(buildChallengerInput(f.archive, at)).toEqual(before)
  })
})
