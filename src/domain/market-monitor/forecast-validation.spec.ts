import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judgmentSnapshot } from './judgment.fixture.js'
import { analysisInputHash, type MarketAnalysisArchive } from './replay.js'
import { hashJevInput } from './typesafe-input.js'
import { buildForwardValidationInput, guardedJevDecision } from './forecast-validation-input.js'
import { createForecastValidationStore, forwardRecordHash } from './forecast-validation-store.js'
import { createForecastValidation, summarizeForwardValidation } from './forecast-validation.js'
import { FORWARD_PROTOCOL, PREVIOUS_FORWARD_PROTOCOL, LEGACY_FORWARD_PROTOCOL, JEV_DECISION_POLICY } from './forecast-validation-types.js'
import { TYPESAFE_MODEL, type JevAnswer, type JevQuestion, type JevResult } from './typesafe-client.js'
import { JEV_HORIZONS } from './typesafe-types.js'
import type { ReturnHistory } from './forecast-experiment-types.js'
import type { MarketMonitorStore } from './store.js'
import type { MarketMonitorService } from './service.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

function answer(choice: string, probabilities: Record<string, number>): JevAnswer {
  return { type: 'choice', choice, confidence: probabilities[choice]!, probabilities }
}
function result(questions: Record<string, JevQuestion>, overrides: Record<string, JevAnswer> = {}): JevResult {
  return { model: TYPESAFE_MODEL, inputTokens: 50, durationMs: 1,
    answers: Object.fromEntries(Object.entries(questions).map(([key, question]) => {
      const options = Object.keys(question.criteria)
      const choice = options.includes('adequate') ? 'adequate' : options.includes('supported') ? 'supported' : options[0]!
      return [key, overrides[key] ?? answer(choice, Object.fromEntries(options.map(option => [option, option === choice ? 0.8 : 0.2 / (options.length - 1)])))]
    })) }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'forecast-validation-')); roots.push(root)
  const snapshot = judgmentSnapshot()
  snapshot.chart.daily = Array.from({ length: 120 }, (_, i) => ({ date: new Date(Date.parse('2026-09-19') - (119 - i) * 86_400_000).toISOString().slice(0, 10), open: 100, close: 101, low: 90, high: 110, volume: 10 }))
  snapshot.chart.dailyMeta = { ...snapshot.chart.dailyMeta, from: snapshot.chart.daily[0]!.date, bars: 120 }
  const input: MarketAnalysisArchive['input'] = { asset: 'BTC', asOf: snapshot.capturedAt, strategyId: snapshot.strategyId, strategyVersion: 2,
    dailyBars: structuredClone(snapshot.chart.daily), intradayBars: structuredClone(snapshot.chart.intraday), abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5,
    context: structuredClone(snapshot.context), sourceHealth: structuredClone(snapshot.sourceHealth) }
  snapshot.analysisInput = { hash: analysisInputHash(input), strategyVersion: 2 }
  const archive: MarketAnalysisArchive = { schemaVersion: 1, input, snapshot }
  const series = structuredClone(snapshot.chart)
  let at = new Date(snapshot.capturedAt), automatic = true, configured = true
  const settings = vi.fn(async () => ({ configured, automatic, model: TYPESAFE_MODEL }))
  const config = vi.fn(async () => ({ apiKey: configured ? 'synthetic-key-placeholder' : '', automatic }))
  const evaluate = vi.fn(async (_key: string, _state: unknown, questions: Record<string, JevQuestion>) => result(questions))
  const monitor = { settings: vi.fn(async () => ({ strategyId: snapshot.strategyId })), scan: vi.fn(async () => ({ snapshot })), snapshots: vi.fn(async () => [snapshot]) }
  const market = { archive: vi.fn(async () => archive), latestSeries: vi.fn(async () => series) } as unknown as MarketMonitorStore
  const v2Root = join(root, 'forecast-validation-v2'), store = createForecastValidationStore(v2Root)
  const deps = { monitor: monitor as unknown as Pick<MarketMonitorService, 'settings' | 'scan' | 'snapshots'>, market, store, credentials: { config, settings }, client: { evaluate }, now: () => at }
  const advance = () => {
    series.daily.push({ date: '2026-09-20', open: 1, close: 500, high: 500, low: 1, volume: 1 }, { date: '2026-09-21', open: 100, close: 101, high: 102, low: 99, volume: 1 })
    at = new Date('2026-09-22T01:00:00Z')
  }
  return { root, v2Root, store, snapshot, archive, series, monitor, market, config, evaluate, deps, service: createForecastValidation(deps), advance,
    setAt: (value: string) => { at = new Date(value) }, setAutomatic: (value: boolean) => { automatic = value }, setConfigured: (value: boolean) => { configured = value } }
}

describe('versioned forward validation', () => {
  it('diagnoses saved signal abstention and raw outcomes without new model calls or changing either frozen file', async () => {
    const f = await fixture()
    f.evaluate.mockImplementationOnce(async (_key, _state, questions) => result(questions, {
      shortSignal: answer('uncertain', { supported: 0.1, uncertain: 0.9 }),
    }))
    await f.service.collect('BTC')
    const publicationPath = join(f.v2Root, 'BTC-2026-09-20.json'), candidatePath = join(f.v2Root, 'BTC-2026-09-20.candidate.json')
    const publicationBytes = await readFile(publicationPath, 'utf8'), candidateBytes = await readFile(candidatePath, 'utf8')
    const calls = { model: f.evaluate.mock.calls.length, config: f.config.mock.calls.length, scan: f.monitor.scan.mock.calls.length }
    f.advance()
    const report = await f.service.report('BTC'), outcome = report.rows[0]!.outcomes[0]!
    expect(outcome.choices.jev).toBeNull()
    expect(outcome.jevDiagnostics).toMatchObject({ rawAnswerValid: true, rawChoice: 'up', rawCorrect: true,
      evidence: { valid: true, choice: 'adequate' }, signal: { valid: true, choice: 'uncertain' }, reasons: ['signal-uncertain'] })
    const originalCohort = report.validation!.cohorts.find(value => value.cohort.key === report.rows[0]!.cohort!.key)!
    expect(originalCohort.summaries[0]!.jevDiagnostics.matured.raw).toMatchObject({ scored: 1, correct: 1 })
    expect(f.evaluate).toHaveBeenCalledTimes(calls.model)
    expect(f.config).toHaveBeenCalledTimes(calls.config)
    expect(f.monitor.scan).toHaveBeenCalledTimes(calls.scan)
    expect(await readFile(publicationPath, 'utf8')).toBe(publicationBytes)
    expect(await readFile(candidatePath, 'utf8')).toBe(candidateBytes)
  })

  it('does not credit an invalid raw answer even when its selected label matches the realised outcome', async () => {
    const f = await fixture()
    f.evaluate.mockImplementationOnce(async (_key, _state, questions) => result(questions, {
      short: answer('up', { up: 0.1, flat: 0.1, down: 0.8 }),
    }))
    await f.service.collect('BTC'); f.advance()
    const report = await f.service.report('BTC'), original = report.validation!.cohorts.find(value => value.cohort.key === report.rows[0]!.cohort!.key)!
    expect(report.rows[0]!.outcomes[0]).toMatchObject({ actual: 'up', choices: { jev: null },
      jevDiagnostics: { rawAnswerValid: false, rawChoice: null, rawCorrect: null, reasons: ['answer-invalid'] } })
    expect(original.summaries[0]!.jevDiagnostics.matured.raw).toMatchObject({ scored: 0, correct: 0, unavailable: 1 })
    expect(original.summaries[0]!.jevDiagnostics.published.invalidRawAnswers).toBe(1)
  })

  it('freezes a separate publication before one model call and never overwrites either record or v1 files', async () => {
    const f = await fixture()
    await mkdir(join(f.root, 'forecast-experiment-v1'))
    const oldPath = join(f.root, 'forecast-experiment-v1', 'BTC-2026-09-20.json')
    await writeFile(oldPath, 'immutable-v1-sentinel')
    f.evaluate.mockImplementationOnce(async (_key, _state, questions) => {
      const publication = await f.store.publication('BTC', '2026-09-20')
      expect(publication?.protocol).toBe(FORWARD_PROTOCOL)
      expect(publication?.combined.protocol).toBe('evidence-summary-v3')
      expect(publication?.input.state.requestAt).toBe(publication?.issuedAt)
      return result(questions)
    })
    const [first, second] = await Promise.all([f.service.collect('BTC'), f.service.collect('BTC')])
    expect(first.id).toBe(second.id); expect(f.evaluate).toHaveBeenCalledOnce()
    expect(first.policy).toMatchObject({ ...JEV_DECISION_POLICY, combinedProtocol: 'evidence-summary-v3', combinedDecisionPolicy: 'guarded-price-evidence-v3' })
    const frozen = await readFile(join(f.v2Root, 'BTC-2026-09-20.json'), 'utf8')
    const frozenCandidate = await readFile(join(f.v2Root, 'BTC-2026-09-20.candidate.json'), 'utf8')
    await createForecastValidation(f.deps).collect('BTC')
    expect(f.evaluate).toHaveBeenCalledOnce()
    expect(await readFile(join(f.v2Root, 'BTC-2026-09-20.json'), 'utf8')).toBe(frozen)
    expect(await readFile(join(f.v2Root, 'BTC-2026-09-20.candidate.json'), 'utf8')).toBe(frozenCandidate)
    expect(await readFile(oldPath, 'utf8')).toBe('immutable-v1-sentinel')
    const report = await f.service.report('BTC')
    expect(report.summaries[0]).toMatchObject({ pending: 1, complete: 0, probability: { count: 0 }, matched: { count: 0 } })
    expect(JSON.stringify(report)).not.toContain('synthetic-key-placeholder')
  })

  it('freezes active v4 on the same day without modifying the legacy v2 publication or request contract', async () => {
    const f = await fixture()
    const legacyRoot = join(f.root, 'legacy-v2')
    const legacyStore = createForecastValidationStore(legacyRoot, LEGACY_FORWARD_PROTOCOL)
    const legacy = createForecastValidation({ ...f.deps, protocol: LEGACY_FORWARD_PROTOCOL, store: legacyStore })
    const old = await legacy.collect('BTC')
    const oldCandidate = await legacyStore.candidate('BTC', '2026-09-20')
    const oldBytes = await readFile(join(legacyRoot, 'BTC-2026-09-20.json'), 'utf8')
    const candidateBytes = await readFile(join(legacyRoot, 'BTC-2026-09-20.candidate.json'), 'utf8')
    expect(old.protocol).toBe(LEGACY_FORWARD_PROTOCOL)
    expect(old.combined.protocol).toBe('evidence-summary-v2')
    expect(old.input.questions.short!.instructions).toContain('This is market-forward-v2.')
    expect(old.input.state.forecastProtocol).toBe(LEGACY_FORWARD_PROTOCOL)
    const active = await f.service.collect('BTC')
    expect(active.protocol).toBe(FORWARD_PROTOCOL)
    expect(active.id).not.toBe(old.id)
    expect(active.combined.protocol).toBe('evidence-summary-v3')
    expect(active.input.questions.short!.instructions).toContain(`This is ${FORWARD_PROTOCOL}.`)
    expect((await f.store.candidate('BTC', '2026-09-20'))!.decisions).toEqual(oldCandidate!.decisions)
    f.advance()
    const [oldReport, activeReport] = await Promise.all([legacy.report('BTC'), f.service.report('BTC')])
    expect(oldReport.protocol).toBe(LEGACY_FORWARD_PROTOCOL)
    expect(oldReport.rows).toHaveLength(1)
    expect(activeReport.protocol).toBe(FORWARD_PROTOCOL)
    expect(activeReport.rows).toHaveLength(1)
    expect(await readFile(join(legacyRoot, 'BTC-2026-09-20.json'), 'utf8')).toBe(oldBytes)
    expect(await readFile(join(legacyRoot, 'BTC-2026-09-20.candidate.json'), 'utf8')).toBe(candidateBytes)
    expect(f.evaluate).toHaveBeenCalledTimes(2)
  })

  it('keeps the intermediate v3 cohort separate and byte-identical while collecting active v4 on the same session', async () => {
    const f = await fixture(), previousRoot = join(f.root, 'previous-v3')
    const previousStore = createForecastValidationStore(previousRoot, PREVIOUS_FORWARD_PROTOCOL)
    const previousService = createForecastValidation({ ...f.deps, protocol: PREVIOUS_FORWARD_PROTOCOL, store: previousStore })
    const previous = await previousService.collect('BTC')
    const publicationPath = join(previousRoot, 'BTC-2026-09-20.json')
    const candidatePath = join(previousRoot, 'BTC-2026-09-20.candidate.json')
    const publicationBytes = await readFile(publicationPath, 'utf8'), candidateBytes = await readFile(candidatePath, 'utf8')
    const active = await f.service.collect('BTC')
    expect(previous.protocol).toBe('market-forward-v3')
    expect(active.protocol).toBe('market-forward-v4')
    expect(previous.id).not.toBe(active.id)
    expect(previous.policy).toEqual(active.policy)
    expect(previous.policy.id).toBe('jev-base-rate-v2')
    f.advance()
    const oldReport = await previousService.report('BTC'), currentReport = await f.service.report('BTC')
    expect(oldReport).toMatchObject({ protocol: PREVIOUS_FORWARD_PROTOCOL, invalidRecords: 0 })
    expect(oldReport.rows).toHaveLength(1); expect(currentReport.rows).toHaveLength(1)
    expect(oldReport.validation!.current.cohort.protocol).toBe(PREVIOUS_FORWARD_PROTOCOL)
    expect(currentReport.validation!.current.cohort.protocol).toBe(FORWARD_PROTOCOL)
    expect(await readFile(publicationPath, 'utf8')).toBe(publicationBytes)
    expect(await readFile(candidatePath, 'utf8')).toBe(candidateBytes)
    expect(f.evaluate).toHaveBeenCalledTimes(2)
  })

  it('retains invalid intermediate v3 stock records without cleansing them or leaking their scores into v4', async () => {
    const f = await fixture(), previousRoot = join(f.root, 'invalid-previous-v3')
    const previousStore = createForecastValidationStore(previousRoot, PREVIOUS_FORWARD_PROTOCOL)
    const previousService = createForecastValidation({ ...f.deps, protocol: PREVIOUS_FORWARD_PROTOCOL, store: previousStore })
    const publication = structuredClone(await previousService.collect('BTC'))
    publication.asset = 'TSLA'; publication.input.state.asset = 'TSLA'; publication.combined.asset = 'TSLA'
    publication.input.history.medium.sessions = 5; publication.input.history.long.sessions = 20
    publication.combined.horizons.medium.sessions = 5; publication.combined.horizons.long.sessions = 20
    publication.inputHash = hashJevInput(publication.input); publication.recordHash = forwardRecordHash(publication)
    await previousStore.savePublication('TSLA', '2026-09-20', publication)
    const path = join(previousRoot, 'TSLA-2026-09-20.json'), originalBytes = await readFile(path, 'utf8')
    const previousReport = await previousService.report('TSLA'), activeReport = await f.service.report('TSLA')
    expect(previousReport).toMatchObject({ protocol: PREVIOUS_FORWARD_PROTOCOL, invalidRecords: 1, rows: [], latest: null })
    expect(activeReport).toMatchObject({ protocol: FORWARD_PROTOCOL, invalidRecords: 0, rows: [], latest: null })
    expect(await readFile(path, 'utf8')).toBe(originalBytes)
    expect(f.evaluate).toHaveBeenCalledOnce()
  })

  it('refuses an active stock publication bound to a pre-session-policy archive even with recomputed hashes', async () => {
    const f = await fixture(), publication = structuredClone(await f.service.collect('BTC'))
    publication.asset = 'TSLA'; publication.input.state.asset = 'TSLA'; publication.combined.asset = 'TSLA'
    publication.input.history.medium.sessions = 5; publication.input.history.long.sessions = 20
    publication.combined.horizons.medium.sessions = 5; publication.combined.horizons.long.sessions = 20
    publication.inputHash = hashJevInput(publication.input); publication.recordHash = forwardRecordHash(publication)
    await f.store.savePublication('TSLA', '2026-09-20', publication)
    vi.mocked(f.market.archive).mockClear()
    const rejected = await f.service.report('TSLA')
    expect(rejected).toMatchObject({ invalidRecords: 1, latest: null, rows: [] })
    expect(f.market.archive).not.toHaveBeenCalled()
    expect(f.evaluate).toHaveBeenCalledOnce()
  })

  it('reports common open-to-close future outcomes with the original target and never requests on reads', async () => {
    const f = await fixture(); await f.service.collect('BTC'); f.advance()
    const report = await f.service.report('BTC')
    expect(report.rows[0]!.outcomes[0]).toMatchObject({ actual: 'up', outcome: { entry: 100, close: 101, changePercent: 1 }, correct: { rules: true, jev: true, combined: true, frequency: true, alwaysUp: true } })
    expect(report.summaries[0]).toMatchObject({ uniqueWindows: 1, probability: { count: 1, frequencyBrier: 0 }, matched: { count: 1 } })
    expect(f.evaluate).toHaveBeenCalledOnce()
    expect(report.summaries[1]!.pending).toBe(1)
    vi.mocked(f.market.archive).mockResolvedValueOnce(null)
    const invalid = await f.service.report('BTC')
    expect(invalid.invalidRecords).toBe(1)
    expect(invalid.latest).toBeNull()
    expect(invalid.summaries[0]).toMatchObject({ excluded: 1, probability: { count: 0 } })
  })

  it('preserves inflated raw flat probabilities and Brier when the decision abstains', async () => {
    const f = await fixture()
    f.evaluate.mockImplementationOnce(async (_key, _state, questions) => result(questions, { short: answer('flat', { up: 0.1, flat: 0.8, down: 0.1 }) }))
    await f.service.collect('BTC'); f.advance()
    const report = await f.service.report('BTC')
    expect(report.latest?.candidate?.raw.answers.short?.probabilities).toEqual({ up: 0.1, flat: 0.8, down: 0.1 })
    expect(report.latest?.candidate?.decisions.short).toEqual({ rawChoice: 'flat', choice: null, reasons: ['flat-inflated'] })
    expect(report.summaries[0]).toMatchObject({ methods: { jev: { scored: 0, correct: 0, abstained: 1 }, rules: { scored: 1, correct: 1 } }, probability: { count: 1 }, matched: { count: 0 } })
    expect(report.summaries[0]!.probability.jevBrier).toBeCloseTo(1.46)
    const later = structuredClone(report.rows[0]!)
    later.id = 'later'; later.issuedAt = '2026-09-20T13:00:00Z'
    later.outcomes[0]!.choices.jev = 'up'; later.outcomes[0]!.correct.jev = true; later.outcomes[0]!.brier.jev = 0
    const summary = summarizeForwardValidation([later, report.rows[0]!])[0]!
    expect(summary).toMatchObject({ uniqueWindows: 1, duplicateWindows: 1, methods: { jev: { scored: 0, abstained: 1 } } })
    expect(summary.probability.jevBrier).toBeCloseTo(1.46)
  })

  it('keeps conditional or range structure as abstention rather than narrow flat forecasts', async () => {
    const f = await fixture(); f.snapshot.wyckoff!.testState = 'pending'
    await f.service.collect('BTC'); f.advance()
    const report = await f.service.report('BTC')
    expect(report.latest?.publication.combined.horizons.short.decision).toBe('conditional')
    expect(report.rows[0]!.outcomes[0]!.choices.combined).toBeNull()
    expect(report.rows[0]!.outcomes[0]!.choices.rules).toBe('up')
  })

  it.each(['uncertain', 'missing'] as const)('keeps valid raw probabilities scoreable when Signal is %s', async signal => {
    const f = await fixture()
    f.evaluate.mockImplementationOnce(async (_key, _state, questions) => {
      const raw = result(questions)
      if (signal === 'missing') delete raw.answers.shortSignal
      else raw.answers.shortSignal = answer('uncertain', { supported: 0.2, uncertain: 0.8 })
      return raw
    })
    await f.service.collect('BTC'); f.advance()
    const report = await f.service.report('BTC')
    expect(report.latest?.candidate?.decisions.short.choice).toBeNull()
    expect(report.latest?.candidate?.decisions.short.reasons).toContain(signal === 'missing' ? 'answer-invalid' : 'signal-uncertain')
    expect(report.summaries[0]).toMatchObject({ probability: { count: 1 }, methods: { jev: { scored: 0, abstained: 1 } } })
    expect(report.summaries[0]!.probability.jevBrier).toBeCloseTo(0.06)
  })

  it('freezes rules without a configured key and later adds a same-day candidate to the same publication', async () => {
    const f = await fixture(); f.setConfigured(false)
    const first = await f.service.collect('BTC')
    expect(f.evaluate).not.toHaveBeenCalled(); expect(f.config).not.toHaveBeenCalled()
    expect((await f.service.report('BTC')).latest?.candidate).toBeNull()
    f.setConfigured(true); f.setAt('2026-09-20T13:00:00Z')
    const second = await f.service.collect('BTC')
    expect(second.id).toBe(first.id); expect(f.monitor.scan).toHaveBeenCalledOnce()
    const candidate = (await f.service.report('BTC')).latest?.candidate
    expect(candidate?.requestedAt).toBe('2026-09-20T13:00:00.000Z')
    expect(candidate?.inputHash).toBe(first.inputHash)
    expect(first.input.state.requestAt).toBe('2026-09-20T12:00:00.000Z')
  })

  it('respects automatic opt-out while retaining explicit manual requests and daily freeze-only deduplication', async () => {
    const f = await fixture(); f.setAutomatic(false)
    await f.service.automatic('BTC'); await f.service.automatic('BTC')
    expect(f.evaluate).not.toHaveBeenCalled(); expect(f.monitor.snapshots).toHaveBeenCalledOnce()
    expect(await f.store.publication('BTC', '2026-09-20')).not.toBeNull()
    await f.service.collect('BTC')
    expect(f.evaluate).toHaveBeenCalledOnce()
    const g = await fixture(); g.setAutomatic(false)
    await g.service.automatic('BTC'); g.setAutomatic(true); await g.service.automatic('BTC')
    expect(g.evaluate).toHaveBeenCalledOnce()
  })

  it('retains the publication on failures, redacts errors, backs off automatic retries and permits a manual retry', async () => {
    const f = await fixture(); f.evaluate.mockRejectedValueOnce(new Error('private-upstream-error-and-key'))
    await expect(f.service.automatic('BTC')).rejects.toThrow(/新版前向验证/)
    const first = await f.store.publication('BTC', '2026-09-20')
    expect(first).not.toBeNull(); expect(await f.store.candidate('BTC', '2026-09-20')).toBeNull()
    expect((await f.service.report('BTC')).lastError).not.toContain('private-upstream')
    await f.service.automatic('BTC'); expect(f.evaluate).toHaveBeenCalledOnce()
    await f.service.collect('BTC'); expect(f.evaluate).toHaveBeenCalledTimes(2)
    expect((await f.service.report('BTC')).latest?.publication.id).toBe(first?.id)
  })

  it('rejects cross-session completion without writing a late candidate', async () => {
    const f = await fixture()
    f.evaluate.mockImplementationOnce(async (_key, _state, questions) => { f.setAt('2026-09-21T00:00:00Z'); return result(questions) })
    await expect(f.service.collect('BTC')).rejects.toThrow(/跨越交易日期/)
    expect(await f.store.publication('BTC', '2026-09-20')).not.toBeNull()
    expect(await f.store.candidate('BTC', '2026-09-20')).toBeNull()
  })

  it('counts corrupted records and never replaces an invalid candidate or publication', async () => {
    const f = await fixture(); await f.service.collect('BTC')
    const path = join(f.v2Root, 'BTC-2026-09-20.candidate.json')
    await writeFile(path, '{}')
    const report = await f.service.report('BTC')
    expect(report).toMatchObject({ invalidRecords: 1, latest: { candidate: null } })
    expect(report.rows).toHaveLength(1)
    await expect(f.service.collect('BTC')).rejects.toThrow(/完整性/)
    expect(f.evaluate).toHaveBeenCalledOnce(); expect(await readFile(path, 'utf8')).toBe('{}')
    const publicationPath = join(f.v2Root, 'BTC-2026-09-20.json')
    await writeFile(publicationPath, (await readFile(publicationPath, 'utf8')).replace('"asset":"BTC"', '"asset":"MSTR"'))
    expect((await f.service.report('BTC')).invalidRecords).toBe(1)
    expect((await f.service.report('BTC')).rows).toHaveLength(0)
  })

  it('rejects semantically invalid times even with recomputed record hashes', async () => {
    const f = await fixture(); await f.service.collect('BTC')
    const candidate = (await f.store.candidate('BTC', '2026-09-20'))!
    candidate.requestedAt = '2026-09-19T12:00:00Z'; candidate.recordHash = forwardRecordHash(candidate)
    await writeFile(join(f.v2Root, 'BTC-2026-09-20.candidate.json'), JSON.stringify(candidate))
    expect((await f.service.report('BTC')).invalidRecords).toBe(1)
    expect((await f.service.report('BTC')).latest?.candidate).toBeNull()
  })

  it('rejects future historical endpoints even when input and record hashes are recomputed', async () => {
    const f = await fixture(); await f.service.collect('BTC')
    const publication = (await f.store.publication('BTC', '2026-09-20'))!
    publication.input.history.short.lastExitAt = '2026-09-21'
    publication.inputHash = hashJevInput(publication.input); publication.recordHash = forwardRecordHash(publication)
    await writeFile(join(f.v2Root, 'BTC-2026-09-20.json'), JSON.stringify(publication))
    expect((await f.service.report('BTC')).invalidRecords).toBe(1)
    expect((await f.service.report('BTC')).latest).toBeNull()
  })

  it('does not present a candidate or fall back to an older direction when the newest original archive is unavailable', async () => {
    const f = await fixture(); await f.service.collect('BTC')
    const first = (await f.store.publication('BTC', '2026-09-20'))!
    const newer = structuredClone(first)
    newer.id = 'newer-publication'; newer.issuedAt = '2026-09-21T12:00:00.000Z'
    newer.input.state.requestAt = newer.issuedAt
    newer.inputHash = hashJevInput(newer.input); newer.recordHash = forwardRecordHash(newer)
    await f.store.savePublication('BTC', '2026-09-21', newer)
    f.setAt('2026-09-21T13:00:00Z')
    vi.mocked(f.market.archive).mockResolvedValueOnce(f.archive).mockResolvedValueOnce(null)
    const report = await f.service.report('BTC')
    expect(report.rows).toHaveLength(2)
    expect(report.latest).toBeNull()
    expect(report.invalidRecords).toBe(1)
    expect(report.rows[1]!.outcomes.every(outcome => outcome.outcome.status === 'unverified')).toBe(true)
    await writeFile(join(f.v2Root, 'BTC-2026-09-21.json'), '{}')
    expect((await f.service.report('BTC')).latest).toBeNull()
  })
})

describe('frozen input and Jev decision gate', () => {
  const history = (flat = 0.1, samples = 100): ReturnHistory => ({ sessions: 1, samples, firstEntryAt: '2026-01-01', lastExitAt: '2026-09-19', meanPercent: 0, volatilityPercent: 2,
    medianAbsolutePercent: 1, probabilities: { up: (1 - flat) / 2, flat, down: (1 - flat) / 2 } })
  const raw = (overrides: Record<string, JevAnswer> = {}): JevResult => ({ model: TYPESAFE_MODEL, inputTokens: 1, durationMs: 1, answers: {
    short: answer('up', { up: 0.7, flat: 0.1, down: 0.2 }), shortEvidence: answer('adequate', { adequate: 0.8, insufficient: 0.2 }), shortSignal: answer('supported', { supported: 0.8, uncertain: 0.2 }), ...overrides,
  } })

  it('supplies same-target past-only frequencies and separate predictive uncertainty without legacy rule conclusions', async () => {
    const f = await fixture(), at = new Date(f.archive.input.asOf)
    const before = buildForwardValidationInput(f.archive, at)
    expect(Object.keys(before.questions)).toHaveLength(12)
    expect(before.questions.shortSignal!.criteria).toHaveProperty('uncertain')
    expect(before.questions.short!.criteria).not.toHaveProperty('uncertain')
    expect(Object.values(before.questions.short!.criteria).join(' ')).not.toContain('more likely')
    expect(before.questions.shortSignal!.instructions).toContain('shared state only')
    expect(before.questions.shortEvidence!.instructions).toContain('data quality')
    expect(before.state.forecastProtocol).toBe(FORWARD_PROTOCOL)
    expect(before.history.short.probabilities).toEqual({ up: 1, flat: 0, down: 0 })
    expect(JSON.stringify(before.state)).not.toMatch(/phaseCandidate|bullish|bearish|confirmation/)
    f.archive.input.dailyBars.push({ date: '2026-09-20', open: 101, close: 999, high: 999, low: 100, volume: 10 })
    expect(buildForwardValidationInput(f.archive, at)).toEqual(before)
  })

  it('feeds active stock research qualified regular-session numbers while preserving v2 raw input and original archives', async () => {
    const f = await fixture(), at = new Date('2026-09-18T22:00:00Z')
    f.archive.input.asset = 'TSLA'; f.archive.snapshot.asset = 'TSLA'
    f.archive.input.strategyVersion = 3; f.archive.input.asOf = at.toISOString()
    expect(() => buildForwardValidationInput(f.archive, at)).toThrow(/重新扫描/)
    f.archive.snapshot.analysisBasis!.version = 3
    f.archive.snapshot.capturedAt = at.toISOString()
    delete f.archive.snapshot.chart.intradayMeta!.barCapability
    f.archive.input.sourceHealth.find(value => value.id === 'intraday-bars')!.provider = 'alpaca'
    f.archive.input.sourceHealth.find(value => value.id === 'daily-bars')!.provider = 'alpaca'
    const businessDates: string[] = []
    for (let day = Date.parse('2026-09-18'); businessDates.length < 120; day -= 86_400_000) {
      const date = new Date(day)
      if (date.getUTCDay() > 0 && date.getUTCDay() < 6) businessDates.unshift(date.toISOString().slice(0, 10))
    }
    f.archive.input.dailyBars = businessDates.map(date => ({ date, open: 100, close: 101, low: 99, high: 102, volume: 100_000 }))
    f.archive.input.intradayBars = ['14', '15', '16', '17', '18'].flatMap(day => [18, 19].map(hour => ({
      date: `2026-09-${day}T${hour}:00:00Z`, open: 100, close: hour === 18 ? 100 : 101,
      low: 99, high: 102, volume: 100_000,
    })))
    f.archive.input.intradayBars.push({ date: '2026-09-18T21:00:00Z', open: 100, close: 80, high: 100, low: 80, volume: 549 })
    const original = structuredClone(f.archive)
    const legacy = buildForwardValidationInput(f.archive, at, LEGACY_FORWARD_PROTOCOL)
    const active = buildForwardValidationInput(f.archive, at)
    expect(legacy.state.hourly).toMatchObject({ lastClose: 80 })
    expect(legacy.state).not.toHaveProperty('hourlyInputPolicy')
    expect(active.state.hourly).toMatchObject({ lastClose: 101, count: 2, latestChangePercent: 1 })
    expect(active.state.hourlyInputPolicy).toMatchObject({ id: 'equity-regular-session-v3', source: 'alpaca', rawBarCount: 11, continuousBarCount: 2, excluded: { session: 1 } })
    expect((active.state.hourlyInputPolicy as { volumeScope: string }).volumeScope).toContain('not consolidated')
    expect(active.state.barVolumeScope).toMatchObject({ daily: expect.stringContaining('IEX'), hourly: expect.stringContaining('IEX') })
    expect(f.archive).toEqual(original)
    // Source metadata remains an explicit fallback when the health item is absent.
    f.archive.input.sourceHealth = f.archive.input.sourceHealth.filter(value => value.id !== 'intraday-bars')
    f.archive.snapshot.chart.intradayMeta!.sourceId = 'alpaca'
    expect(buildForwardValidationInput(f.archive, at).state.hourlyInputPolicy).toMatchObject({ source: 'alpaca', volumeScope: expect.stringContaining('IEX') })
    // A thin latest regular bucket suppresses numerical momentum; older usable
    // bars cannot be stitched across it or promoted into a current hourly view.
    f.archive.input.intradayBars.push({ date: '2026-09-18T19:00:00Z', open: 101, close: 90, high: 101, low: 90, volume: 549 })
    expect(buildForwardValidationInput(f.archive, at).state.hourly).toBeNull()
    f.archive.input.strategyVersion = 2
    expect(() => buildForwardValidationInput(f.archive, at)).toThrow(/重新扫描/)
    expect(() => buildForwardValidationInput(f.archive, at, LEGACY_FORWARD_PROTOCOL)).not.toThrow()
  })

  it.each(['2026-09-21T14:00:00Z', '2026-09-21T20:30:00Z'])('rechecks a premarket frozen stock archive against the request session at %s', async requestAt => {
    const f = await fixture(), capturedAt = '2026-09-21T12:00:00Z'
    f.archive.input.asset = 'TSLA'; f.archive.snapshot.asset = 'TSLA'; f.archive.input.strategyVersion = 3
    f.archive.input.asOf = capturedAt; f.archive.snapshot.capturedAt = capturedAt
    f.archive.snapshot.analysisBasis = { version: 3, closedBarsOnly: true, dailyAt: '2026-09-18', hourlyAt: '2026-09-18T19:00:00Z' }
    const dates: string[] = []
    for (let day = Date.parse('2026-09-18'); dates.length < 120; day -= 86_400_000) {
      const date = new Date(day)
      if (date.getUTCDay() > 0 && date.getUTCDay() < 6) dates.unshift(date.toISOString().slice(0, 10))
    }
    f.archive.input.dailyBars = dates.map(date => ({ date, open: 100, high: 102, low: 99, close: 101, volume: 100_000 }))
    f.archive.input.intradayBars = ['14', '15', '16', '17', '18'].flatMap(day => [18, 19].map(hour => ({
      date: `2026-09-${day}T${hour}:00:00Z`, open: 100, close: hour === 18 ? 100 : 101, high: 102, low: 99, volume: 100_000,
    })))
    const original = structuredClone(f.archive)
    const premarket = buildForwardValidationInput(f.archive, new Date(capturedAt))
    expect(premarket.state.hourly).toMatchObject({ lastClosedAt: '2026-09-18T19:00:00Z', lastClose: 101 })
    expect(premarket.state.hourlyInputPolicy).toMatchObject({ fresh: true })
    const active = buildForwardValidationInput(f.archive, new Date(requestAt))
    expect(active.state.hourly).toBeNull()
    expect(active.state.hourlyInputPolicy).toMatchObject({ fresh: false, evidenceCapturedAt: capturedAt })
    // The shipped v2 request contract keeps its former four-day off-hours
    // tolerance; only prospective session-policy inputs receive this fix.
    expect(buildForwardValidationInput(f.archive, new Date(requestAt), LEGACY_FORWARD_PROTOCOL).state.hourly).not.toBeNull()
    expect(f.archive).toEqual(original)
  })

  it('separates uncertainty, data insufficiency and sparse history from flat', () => {
    const uncertain = raw({ shortSignal: answer('uncertain', { supported: 0.2, uncertain: 0.8 }) })
    expect(guardedJevDecision(uncertain, 'short', history())).toMatchObject({ rawChoice: 'up', choice: null, reasons: ['signal-uncertain'] })
    expect(guardedJevDecision(raw({ shortEvidence: answer('insufficient', { adequate: 0.2, insufficient: 0.8 }) }), 'short', history()).reasons).toContain('evidence-insufficient')
    expect(guardedJevDecision(raw(), 'short', history(0.1, 59))).toMatchObject({ choice: null, reasons: ['history-insufficient'] })
    expect(guardedJevDecision(raw(), 'short', history(0.1, 60))).toMatchObject({ choice: 'up', reasons: [] })
    const missing = raw(); delete missing.answers.shortSignal
    expect(guardedJevDecision(missing, 'short', history()).reasons).toContain('answer-invalid')
  })

  it('freezes the exact flat guard boundaries and never repairs an invalid distribution', () => {
    const flat = raw({ short: answer('flat', { up: 0.1, flat: 0.8, down: 0.1 }) })
    const unchanged = structuredClone(flat)
    expect(guardedJevDecision(flat, 'short', history()).reasons).toEqual(['flat-inflated'])
    expect(flat).toEqual(unchanged)
    expect(guardedJevDecision(flat, 'short', history(1 / 3))).toMatchObject({ choice: 'flat', reasons: [] })
    const boundary = raw({ short: answer('flat', { up: 0.3, flat: 0.4, down: 0.3 }) })
    expect(guardedJevDecision(boundary, 'short', history(0.2))).toMatchObject({ choice: 'flat', reasons: [] })
    const invalid = raw({ short: answer('flat', { up: 0.1, flat: 0.8, down: 0.3 }) })
    expect(guardedJevDecision(invalid, 'short', history()).reasons).toContain('answer-invalid')
    expect(invalid.answers.short!.probabilities).toEqual({ up: 0.1, flat: 0.8, down: 0.3 })
  })
})
