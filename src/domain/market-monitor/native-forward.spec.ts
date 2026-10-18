import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { judgmentSnapshot } from './judgment.fixture.js'
import { buildMarketIntelligence } from './intelligence-market.js'
import { analysisInputHash, type MarketAnalysisArchive } from './replay.js'
import { intelligenceRecordHash, investmentInputHash } from './investment.js'
import { investmentAnalysisVersion, type InvestmentDirection, type InvestmentDraft, type InvestmentInput, type InvestmentSnapshot } from './investment-types.js'
import { createNativeForward, summarizeNativeForward } from './native-forward.js'
import { createNativeForwardStore, nativeForwardCommitHash, nativeForwardRecordHash } from './native-forward-store.js'
import { createInvestmentService } from './investment-service.js'
import { createInvestmentStore } from './investment-store.js'
import type { NativeForwardRow } from './native-forward-types.js'
import type { MarketMonitorAsset, MarketMonitorReceipt, MarketMonitorSnapshot } from './types.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const bar = (date: string, open = 100, close = 101) => ({ date, open, close, high: Math.max(open, close) + 2, low: Math.min(open, close) - 2, volume: 10 })

async function fixture(asset: MarketMonitorAsset = 'BTC', initial = '2026-09-20T12:00:00.000Z') {
  const root = await mkdtemp(join(tmpdir(), 'native-forward-')); roots.push(root)
  let clock = new Date(initial), serial = 0
  const archives = new Map<string, MarketAnalysisArchive>(), source = new Map<string, InvestmentSnapshot>(), observations: MarketMonitorSnapshot[] = [], receipts: MarketMonitorReceipt[] = []
  const register = (snapshot: MarketMonitorSnapshot, version = 3) => {
    const input: MarketAnalysisArchive['input'] = { asset, asOf: snapshot.capturedAt, strategyId: snapshot.strategyId, strategyVersion: version,
      dailyBars: structuredClone(snapshot.chart.daily), intradayBars: structuredClone(snapshot.chart.intraday), abnormalMovePercent: 1.5, abnormalVolumeRatio: 1.8, context: snapshot.context, sourceHealth: snapshot.sourceHealth }
    snapshot.analysisInput = { hash: analysisInputHash(input), strategyVersion: version }
    archives.set(snapshot.id, { schemaVersion: 1, input, snapshot }); observations.push(snapshot)
    receipts.push({ id: `receipt-${snapshot.id}`, asset, strategyId: snapshot.strategyId, requestedAt: snapshot.capturedAt, completedAt: snapshot.capturedAt, trigger: 'manual', outcome: 'stored', snapshotId: snapshot.id })
    return snapshot
  }
  const origin = () => {
    const snapshot = judgmentSnapshot(); snapshot.id = `market-${++serial}`; snapshot.asset = asset; snapshot.capturedAt = clock.toISOString()
    const day = Date.parse(clock.toISOString().slice(0, 10))
    snapshot.chart.daily = Array.from({ length: 60 }, (_, index) => bar(new Date(day - (60 - index) * 86_400_000).toISOString().slice(0, 10))).filter(b => asset === 'BTC' || ![0, 6].includes(new Date(b.date).getUTCDay()))
    snapshot.analysisBasis = { version: 3, closedBarsOnly: true, dailyAt: snapshot.chart.daily.at(-1)!.date, hourlyAt: null }
    snapshot.metrics.lastPrice = snapshot.chart.daily.at(-1)!.close
    register(snapshot)
    return { market: buildMarketIntelligence(snapshot, clock), research: null } satisfies InvestmentInput
  }
  const publication = (input: InvestmentInput, directions: InvestmentDirection[] = ['conditional-bullish', 'neutral', 'uncertain']) => {
    const claim = { text: 'Synthetic research intent', evidenceIds: [input.market.evidence[0]!.id], inference: true }
    const draft: InvestmentDraft = { summary: claim, crossValidation: [], outlooks: (['short', 'medium', 'long'] as const).map((horizon, index) => ({ horizon, direction: directions[index]!, conclusion: claim, structure: claim,
      supportingEvidence: [claim], opposingEvidence: [], risks: [claim], confirmation: [claim], invalidation: [claim], priceLevelLabels: [],
      decisionConditions: { confirmation: { metric: 'daily-close', operator: 'gt', threshold: 101, thresholdEvidenceId: claim.evidenceIds[0]!, description: 'future close above 101' },
        invalidation: { metric: 'daily-close', operator: 'lt', threshold: 90, thresholdEvidenceId: claim.evidenceIds[0]!, description: 'future close below 90' } } })), scenarios: [], priceMap: [], theses: [], limitations: [claim] }
    const inputHash = investmentInputHash(input, clock)
    const snapshot: InvestmentSnapshot = { ...draft, schemaVersion: 1, id: `investment-${inputHash}`, asset, analysisVersion: investmentAnalysisVersion(asset), analysisTime: clock.toISOString(),
      marketSnapshotId: input.market.snapshotId, researchSnapshotId: null, inputHash, previousSnapshotId: null, provenance: { workspaceId: 'test', runId: 'test', issueId: 'test', agent: 'codex' },
      analysisModel: 'synthetic', evidence: input.market.evidence, rawDraft: structuredClone(draft), guardWarnings: [], changes: [], recordHash: '' }
    snapshot.recordHash = intelligenceRecordHash(snapshot)
    return snapshot
  }
  const market = { archive: async (id: string) => archives.get(id) ?? null, snapshots: async () => observations.slice(), receipts: async () => receipts.slice() }
  const store = createNativeForwardStore(root)
  const service = createNativeForward({ market, store, publication: async id => source.get(id) ?? null, now: () => clock })
  const publish = async (input = origin(), directions?: InvestmentDirection[]) => {
    const saved = await service.capture(input, publication(input, directions)); source.set(saved.id, saved); await service.commit(saved); return saved
  }
  const observe = (date: string, daily: ReturnType<typeof bar>[]) => {
    clock = new Date(date)
    const snapshot = structuredClone(observations[0]!); snapshot.id = `outcome-${++serial}`; snapshot.capturedAt = clock.toISOString(); snapshot.chart.daily.push(...daily)
    snapshot.analysisBasis!.dailyAt = daily.at(-1)?.date ?? snapshot.analysisBasis!.dailyAt
    return register(snapshot)
  }
  return { root, asset, store, service, source, market, archives, observations, receipts, origin, publication, publish, observe, now: () => clock, setAt: (date: string) => { clock = new Date(date) } }
}

function guardedEquityDraft(input: InvestmentInput): InvestmentDraft {
  const price = input.market.evidence.find(e => e.metric === 'daily-close')!, trend = input.market.evidence.find(e => e.metric === 'trend.short')!
  const claim = { text: 'Synthetic uncertain research', evidenceIds: [price.id], inference: true }
  const condition = { metric: 'daily-close' as const, operator: 'gt' as const, threshold: price.value as number, thresholdEvidenceId: price.id, description: 'Future close above original observed level' }
  return { summary: claim, crossValidation: [{ horizon: 'short', claim, marketEvidenceIds: [trend.id], researchEvidenceIds: [], status: 'UNVERIFIED', explanation: 'Unverified synthetic research' }],
    outlooks: (['short', 'medium', 'long'] as const).map(horizon => ({ horizon, direction: 'uncertain', conclusion: claim, structure: claim, supportingEvidence: [claim], opposingEvidence: [], risks: [claim], confirmation: [claim], invalidation: [claim], priceLevelLabels: [] })),
    scenarios: (['bullish', 'neutral', 'bearish'] as const).map(kind => ({ kind, hypothesis: claim, conditions: [claim], confirmation: [claim], path: claim, invalidation: [claim], supportingEvidence: [claim], opposingEvidence: [], priceLevelLabels: [] })),
    priceMap: [], theses: [{ key: 'synthetic-condition', title: 'Synthetic condition', claim, horizon: 'medium', observationDays: 7, supportConditions: [condition], invalidationConditions: [{ ...condition, operator: 'lt' }], resolutionConditions: [] }], limitations: [claim] }
}

describe('independent native publication forward contract', () => {
  it('freezes exact input and effective snapshot, keeps conditional price confirmation separate from a failed return intent, and leaves longer windows pending', async () => {
    const f = await fixture(), input = f.origin(), snapshot = await f.publish(input)
    const file = join(f.root, 'BTC', `${snapshot.id}.json`), bytes = await readFile(file, 'utf8')
    expect(snapshot.forwardValidation?.protocol).toBe('native-investment-forward-v1')
    expect((await f.service.report('BTC')).rows[0]!.outcomes.every(o => o.status === 'pending')).toBe(true)
    f.observe('2026-09-22T12:00:00Z', [bar('2026-09-20'), bar('2026-09-21', 110, 102)])
    const report = await f.service.report('BTC'), short = report.rows[0]!.outcomes[0]!
    expect(short).toMatchObject({ status: 'complete', start: '2026-09-21', end: '2026-09-21', actual: 'down', intent: 'up', intentKind: 'conditional', correct: false,
      conditions: { defined: true, confirmationAt: '2026-09-21', invalidationAt: null } })
    expect(report.current!.summaries[0]).toMatchObject({ unconditional: { scored: 0, correct: 0 }, conditionalIntent: { scored: 1, correct: 0 }, conditions: { confirmationTriggered: 1 } })
    expect(report.rows[0]!.outcomes[1]!.status).toBe('pending')
    expect(await readFile(file, 'utf8')).toBe(bytes)
    expect(input.market.snapshotId).toBe(snapshot.marketSnapshotId)
  })

  it('uses only outcome archives acquired by asOf and never matures a forming candle from an older chart', async () => {
    const f = await fixture(); await f.publish()
    const partial = f.observe('2026-09-21T12:00:00Z', [bar('2026-09-20'), bar('2026-09-21', 100, 102)])
    f.setAt('2026-09-22T12:00:00Z')
    expect((await f.service.report('BTC')).rows[0]!.outcomes[0]!.actual).toBeNull()
    f.observe('2026-09-22T12:01:00Z', [bar('2026-09-20'), bar('2026-09-21', 100, 103)])
    const historical = await f.service.report('BTC', { asOf: '2026-09-21T13:00:00Z' })
    expect(historical.rows[0]!.outcomeSnapshotId).toBe(partial.id)
    expect(historical.rows[0]!.outcomes[0]!.actual).toBeNull()
    await expect(f.service.report('BTC', { asOf: '2099-01-01T00:00:00Z' })).rejects.toThrow('历史查询时间')
  })

  it('keeps earliest daily abstention before version filtering, with no inherited scores in the current cohort', async () => {
    const f = await fixture(); await f.publish(undefined, ['neutral', 'uncertain', 'neutral'])
    f.setAt('2026-09-20T13:00:00Z')
    const input = f.origin(), candidate = f.publication(input, ['bullish', 'bullish', 'bullish'])
    candidate.analysisVersion = 'investment-intelligence-v3'; candidate.recordHash = intelligenceRecordHash(candidate)
    const later = await f.service.capture(input, candidate); f.source.set(later.id, later); await f.service.commit(later)
    f.observe('2026-09-22T12:00:00Z', [bar('2026-09-20'), bar('2026-09-21', 100, 103)])
    const report = await f.service.report('BTC')
    expect(report.cohorts.find(c => c.analysisVersion === 'investment-intelligence-v4')!.summaries[0]).toMatchObject({ abstained: 1, unconditional: { scored: 0 }, conditionalIntent: { scored: 0 } })
    expect(report.current).toMatchObject({ analysisVersion: 'investment-intelligence-v3' })
    expect(report.current!.summaries[0]).toMatchObject({ uniqueWindows: 0, suppressedWindows: 1, unconditional: { scored: 0 } })
  })

  it('preserves earliest identical equity realised window across weekend publications', () => {
    const make = (id: string, issuedAt: string, intent: 'up' | null): NativeForwardRow => ({ publicationId: id, issuedAt, analysisVersion: 'investment-intelligence-equity-v2',
      basis: { snapshotId: 'market', inputHash: 'hash', strategyId: 'evidence-chain-v1', strategyVersion: 3, provider: 'synthetic' }, outcomeSnapshotId: 'later', outcomeProvider: 'synthetic', providerChanged: false,
      outcomes: (['short', 'medium', 'long'] as const).map(horizon => ({ horizon, sessions: horizon === 'short' ? 1 : horizon === 'medium' ? 5 : 20, status: 'complete', start: '2026-09-21', end: '2026-09-21', entry: 100, close: 103, changePercent: 3,
        actual: 'up', intent, intentKind: intent ? 'unconditional' : 'abstain', correct: intent ? true : null, conditions: { defined: false, confirmationAt: null, invalidationAt: null } })) })
    const result = summarizeNativeForward([make('first', '2026-09-18T22:00:00Z', null), make('later', '2026-09-19T12:00:00Z', 'up')], 'TSLA')
    expect(result[0]!.summaries[0]).toMatchObject({ uniqueWindows: 1, suppressedWindows: 1, abstained: 1, unconditional: { scored: 0 } })
  })

  it('exposes an orphan and refuses later same-input registration across sessions', async () => {
    const f = await fixture(), input = f.origin(), snapshot = await f.service.capture(input, f.publication(input))
    const first = await f.service.report('BTC')
    expect(first).toMatchObject({ orphanedRecords: 1, current: null, rows: [] })
    f.setAt('2026-09-21T12:00:00Z')
    await expect(f.service.capture(input, f.publication(input))).rejects.toThrow('未回填')
    expect((await f.store.read('BTC', snapshot.id))!.issuedAt).toBe('2026-09-20T12:00:00.000Z')
    expect(f.source.size).toBe(0)
  })

  it('does not promote mismatched source publication hashes or corrupt latest capture into current scores', async () => {
    const f = await fixture(), first = await f.publish()
    f.setAt('2026-09-21T12:00:00Z'); const latest = await f.publish()
    const changed = structuredClone(latest); changed.summary.text = 'different source'; changed.recordHash = intelligenceRecordHash(changed); f.source.set(changed.id, changed)
    expect(await f.service.report('BTC')).toMatchObject({ invalidRecords: 1, current: null })
    const file = join(f.root, 'BTC', `${latest.id}.json`)
    const raw = JSON.parse(await readFile(file, 'utf8')); raw.input.market.price = 999; await writeFile(file, JSON.stringify(raw))
    const report = await f.service.report('BTC')
    expect(report.invalidRecords).toBe(1); expect(report.current).toBeNull(); expect(report.rows).toEqual([])
    expect(await f.store.read('BTC', first.id)).not.toBeNull()
  })

  it.each(['BTC', 'TSLA'] as const)('uses the fixed full %s short/medium/long session counts and excludes a missing left boundary', async asset => {
    const f = await fixture(asset, '2026-09-18T22:00:00.000Z'); await f.publish(undefined, ['bullish', 'bullish', 'bullish'])
    const dates = Array.from({ length: 50 }, (_, i) => new Date(Date.parse('2026-09-18') + i * 86_400_000).toISOString().slice(0, 10)).filter(day => asset === 'BTC' || ![0, 6].includes(new Date(day).getUTCDay()))
    f.observe('2026-11-08T20:00:00Z', dates.map(day => bar(day)))
    const report = await f.service.report(asset)
    expect(report.rows[0]!.outcomes.map(o => o.sessions)).toEqual(asset === 'BTC' ? [1, 7, 30] : [1, 5, 20])
    expect(report.rows[0]!.outcomes.every(o => o.status === 'complete')).toBe(true)
    const latest = f.observations.at(-1)!, archive = f.archives.get(latest.id)!
    archive.input.dailyBars = archive.input.dailyBars.filter(b => b.date !== (asset === 'BTC' ? '2026-09-19' : '2026-09-21'))
    latest.analysisInput!.hash = analysisInputHash(archive.input)
    expect((await f.service.report(asset)).rows[0]!.outcomes[0]!.status).toBe('missing-data')
  })

  it('rejects tampered origin input even when both declared hash strings still agree', async () => {
    const f = await fixture(), input = f.origin(), archive = f.archives.get(input.market.snapshotId)!
    archive.input.dailyBars[0]!.close = 1000
    await expect(f.service.capture(input, f.publication(input))).rejects.toThrow('原始市场档案')
    expect((await f.store.list('BTC')).records).toEqual([])
  })

  it('scores hash-covered input bars, ignores tampered chart bars, and refuses a tampered outcome input', async () => {
    const f = await fixture(); await f.publish(undefined, ['bullish', 'neutral', 'uncertain'])
    const outcome = f.observe('2026-09-22T12:00:00Z', [bar('2026-09-20'), bar('2026-09-21', 100, 103)])
    outcome.chart.daily.find(b => b.date === '2026-09-21')!.close = 50
    expect((await f.service.report('BTC')).rows[0]!.outcomes[0]).toMatchObject({ actual: 'up', close: 103 })
    f.archives.get(outcome.id)!.input.dailyBars.find(b => b.date === '2026-09-21')!.close = 50
    const report = await f.service.report('BTC')
    expect(report.rows[0]!.outcomeSnapshotId).not.toBe(outcome.id)
    expect(report.rows[0]!.outcomes[0]!.actual).toBeNull()
  })

  it('commits exactly the registered snapshot in the real investment service, while duplicate publication creates no second capture', async () => {
    const f = await fixture('TSLA'), input = f.origin(), root = join(f.root, 'source'), nativeRoot = join(f.root, 'forward')
    const service = createInvestmentService({ asset: 'TSLA', root, now: f.now, nativeForward: { market: f.market, root: nativeRoot } })
    const draft = guardedEquityDraft(input), provenance = { workspaceId: 'test', runId: 'test', issueId: 'test', agent: 'codex' }
    const saved = await service.publish(input, draft, provenance)
    expect(saved.stored).toBe(true)
    const captured = await createNativeForwardStore(nativeRoot).read('TSLA', saved.snapshot.id)
    expect(captured!.snapshot.recordHash).toBe(saved.snapshot.recordHash)
    expect((await createInvestmentStore(root).read('publications', saved.snapshot.id))!.recordHash).toBe(captured!.snapshot.recordHash)
    expect((await service.publish(input, draft, provenance)).stored).toBe(false)
    expect((await createNativeForwardStore(nativeRoot).list('TSLA')).records).toHaveLength(1)
    expect((await service.report()).nativeForward).toMatchObject({ orphanedRecords: 0, invalidRecords: 0 })
  })

  it('never registers an old publication when the independent contract is enabled later', async () => {
    const f = await fixture('TSLA'), input = f.origin(), root = join(f.root, 'source'), nativeRoot = join(f.root, 'forward')
    const provenance = { workspaceId: 'test', runId: 'test', issueId: 'test', agent: 'codex' }, draft = guardedEquityDraft(input)
    const legacy = await createInvestmentService({ asset: 'TSLA', root, now: f.now }).publish(input, draft, provenance)
    const path = join(root, 'publications', `${legacy.snapshot.id}.json`), bytes = await readFile(path, 'utf8')
    const service = createInvestmentService({ asset: 'TSLA', root, now: f.now, nativeForward: { market: f.market, root: nativeRoot } })
    const repeated = await service.publish(input, draft, provenance)
    expect(repeated).toMatchObject({ stored: false }); expect(repeated.snapshot.forwardValidation).toBeUndefined()
    expect((await service.report()).nativeForward).toMatchObject({ current: null, rows: [], cohorts: [] })
    expect(await readFile(path, 'utf8')).toBe(bytes)
  })

  it('refuses a failed origin registration before a source publication can be written', async () => {
    const f = await fixture('TSLA'), input = f.origin(), root = join(f.root, 'source')
    f.archives.delete(input.market.snapshotId)
    const service = createInvestmentService({ asset: 'TSLA', root, now: f.now, nativeForward: { market: f.market, root: join(f.root, 'forward') } })
    await expect(service.publish(input, guardedEquityDraft(input), { workspaceId: 'test', runId: 'test', issueId: 'test', agent: 'codex' })).rejects.toThrow('原始市场档案')
    expect(await createInvestmentStore(root).list('publications')).toEqual([])
  })

  it('discloses a bounded archive truncation and withholds all current scores', async () => {
    const f = await fixture(); await f.publish()
    const service = createNativeForward({ market: f.market, now: f.now, publication: async id => f.source.get(id) ?? null,
      store: { ...f.store, list: async () => ({ records: [], invalidRecords: 0, truncated: true }) } })
    expect(await service.report('BTC')).toMatchObject({ historyTruncated: true, current: null, rows: [], cohorts: [] })
  })

  it.each(['orphan', 'source-corrupt'] as const)('never lets a later weekend call replace a %s Friday call for the same Monday window', async failure => {
    const f = await fixture('TSLA', '2026-09-18T22:00:00.000Z'), first = await f.publish(undefined, ['neutral', 'neutral', 'uncertain'])
    if (failure === 'orphan') f.source.delete(first.id)
    else {
      const changed = structuredClone(first); changed.summary.text = 'different committed source'; changed.recordHash = intelligenceRecordHash(changed)
      f.source.set(changed.id, changed)
    }
    f.setAt('2026-09-19T12:00:00Z'); await f.publish(undefined, ['bullish', 'bullish', 'bullish'])
    f.observe('2026-09-22T20:00:00Z', [bar('2026-09-18'), bar('2026-09-21', 100, 104)])
    const report = await f.service.report('TSLA')
    expect(report).toMatchObject({ current: null, rows: [], cohorts: [] })
    expect(failure === 'orphan' ? report.orphanedRecords : report.invalidRecords).toBe(1)
  })

  it.each(['registration', 'market'] as const)('isolates %s report I/O failures without exposing exception text', async failure => {
    const f = await fixture(); await f.publish()
    const fail = async (): Promise<never> => { throw new Error('synthetic private file /unreadable/path Bearer syntheticToken') }
    const service = createNativeForward({ market: { ...f.market, ...(failure === 'market' ? { snapshots: fail } : {}) }, now: f.now, publication: async id => f.source.get(id) ?? null,
      store: { ...f.store, ...(failure === 'registration' ? { list: fail } : {}) } })
    const report = await service.report('BTC')
    expect(report).toMatchObject({ readError: true, readErrorReason: failure === 'registration' ? 'registration-read-failed' : 'market-history-read-failed', current: null, rows: [], cohorts: [] })
    expect(JSON.stringify(report)).not.toMatch(/unreadable|syntheticToken|Bearer/)
  })

  it('preserves the real investment report when the supplementary forward market listing fails', async () => {
    const f = await fixture('TSLA'), input = f.origin()
    const market = { ...f.market, snapshots: async (): Promise<MarketMonitorSnapshot[]> => { throw new Error('synthetic inaccessible history') } }
    const service = createInvestmentService({ asset: 'TSLA', root: join(f.root, 'source'), now: f.now, nativeForward: { market, root: join(f.root, 'forward') } })
    const saved = await service.publish(input, guardedEquityDraft(input), { workspaceId: 'test', runId: 'test', issueId: 'test', agent: 'codex' })
    const report = await service.report()
    expect(report.latest!.id).toBe(saved.snapshot.id)
    expect(report.theses).toHaveLength(1)
    expect(report.nativeForward).toMatchObject({ readError: true, current: null, rows: [], cohorts: [] })
  })

  it.each(['origin-archive', 'verification-archive', 'registration-save'] as const)('rechecks time after %s and never commits a capture that crosses midnight', async stage => {
    const f = await fixture('BTC', '2026-09-20T23:59:59.900Z'), input = f.origin(), snapshot = f.publication(input)
    let calls = 0
    const late = () => f.setAt('2026-09-21T00:00:00.010Z')
    const service = createNativeForward({ market: { ...f.market, archive: async id => {
      const archive = await f.market.archive(id); calls++
      if (stage === 'origin-archive' && calls === 1 || stage === 'verification-archive' && calls === 2) late()
      return archive
    } }, now: f.now, publication: async id => f.source.get(id) ?? null, store: { ...f.store, save: async row => {
      const result = await f.store.save(row); if (stage === 'registration-save') late(); return result
    } } })
    await expect(service.capture(input, snapshot)).rejects.toThrow('不能跨日或跨收盘')
    expect(f.source.size).toBe(0)
    expect((await f.store.list('BTC')).records).toHaveLength(stage === 'registration-save' ? 1 : 0)
    expect(await service.report('BTC')).toMatchObject({ current: null, rows: [], cohorts: [], orphanedRecords: stage === 'registration-save' ? 1 : 0 })
  })

  it.each([
    ['2026-09-19T03:59:59.900Z', '2026-09-19T04:00:00.010Z'],
    ['2026-09-18T20:14:59.900Z', '2026-09-18T20:15:00.010Z'],
    ['2026-09-18T12:00:00.000Z', '2026-09-18T12:01:01.000Z'],
  ])('rejects delayed equity capture across the New York session, completion cutoff, or 60-second budget (%s)', async (initial, completed) => {
    const f = await fixture('TSLA', initial), input = f.origin()
    const service = createNativeForward({ market: { ...f.market, archive: async id => {
      const archive = await f.market.archive(id); f.setAt(completed!); return archive
    } }, now: f.now, publication: async id => f.source.get(id) ?? null, store: f.store })
    await expect(service.capture(input, f.publication(input))).rejects.toThrow('不能跨日或跨收盘')
    expect((await f.store.list('TSLA')).records).toEqual([])
  })

  it('does not score an existing source file whose actual save completed after the publication boundary', async () => {
    const f = await fixture('BTC', '2026-09-20T23:59:59.900Z'), input = f.origin(), captured = await f.service.capture(input, f.publication(input))
    const sourceStore = createInvestmentStore(join(f.root, 'source'))
    const delayedSave = async () => {
      const result = await sourceStore.save('publications', captured); f.setAt('2026-09-21T00:00:00.010Z'); return result.record
    }
    const committedSource = await delayedSave(); f.source.set(committedSource.id, committedSource)
    await expect(f.service.commit(committedSource)).rejects.toThrow('不能跨日或跨收盘')
    expect(await f.store.readCommit('BTC', captured.id)).toBeNull()
    expect(await f.service.report('BTC')).toMatchObject({ orphanedRecords: 1, current: null, rows: [], cohorts: [] })
    expect((await sourceStore.read('publications', captured.id))!.recordHash).toBe(captured.recordHash)
  })

  it('uses real source commit time for asOf rather than the earlier analysis/capture time', async () => {
    const f = await fixture(), input = f.origin(), captured = await f.service.capture(input, f.publication(input))
    f.setAt('2026-09-20T12:00:30.000Z'); f.source.set(captured.id, captured); await f.service.commit(captured)
    expect((await f.store.readCommit('BTC', captured.id))!.publishedAt).toBe('2026-09-20T12:00:30.000Z')
    expect(await f.service.report('BTC', { asOf: '2026-09-20T12:00:15.000Z' })).toMatchObject({ current: null, rows: [], cohorts: [] })
    expect((await f.service.report('BTC', { asOf: '2026-09-20T12:00:30.000Z' })).rows).toHaveLength(1)
  })

  it('requires a completed acquisition receipt before registering the original native input', async () => {
    const f = await fixture(), input = f.origin()
    f.receipts[0]!.completedAt = '2026-09-20T12:02:00.000Z'; f.setAt('2026-09-20T12:01:00.000Z')
    await expect(f.service.capture(input, f.publication(input))).rejects.toThrow('市场取得回执')
    expect((await f.store.list('BTC')).records).toEqual([])
  })

  it('does not use a scan requested before asOf but completed afterwards to label a return', async () => {
    const f = await fixture(); await f.publish()
    const observation = f.observe('2026-09-22T20:16:00.000Z', [bar('2026-09-20'), bar('2026-09-21', 100, 103)])
    f.receipts.find(r => r.snapshotId === observation.id)!.completedAt = '2026-09-22T20:18:00.000Z'
    f.setAt('2026-09-22T20:19:00.000Z')
    const before = await f.service.report('BTC', { asOf: '2026-09-22T20:17:00.000Z' })
    expect(before.rows[0]!.outcomes[0]!.actual).toBeNull(); expect(before.outcomeReceiptUnavailable).toBe(1)
    const after = await f.service.report('BTC', { asOf: '2026-09-22T20:18:00.000Z' })
    expect(after.rows[0]!.outcomes[0]).toMatchObject({ actual: 'up', close: 103 })
  })

  it('recognizes the actual 10,000-receipt ceiling and withholds scores while permitting a proven new origin', async () => {
    const f = await fixture(); await f.publish()
    const original = f.receipts[0]!
    while (f.receipts.length < 10_000) f.receipts.push({ ...original, id: `bounded-${f.receipts.length}` })
    expect(await f.service.report('BTC')).toMatchObject({ historyTruncated: true, current: null, rows: [], cohorts: [] })
    f.setAt('2026-09-20T12:00:30Z'); const input = f.origin()
    const captured = await f.service.capture(input, f.publication(input))
    expect(captured.forwardValidation).toBeDefined()
  })

  it('does not treat a source file without a commit receipt as publicly available', async () => {
    const f = await fixture(), input = f.origin(), captured = await f.service.capture(input, f.publication(input))
    f.source.set(captured.id, captured)
    expect(await f.service.report('BTC')).toMatchObject({ orphanedRecords: 1, current: null, rows: [], cohorts: [] })
  })

  it('rejects omitted origin receipt proof even when capture and commit hashes are internally valid', async () => {
    const f = await fixture(), saved = await f.publish()
    f.observe('2026-09-22T12:00:00Z', [bar('2026-09-20'), bar('2026-09-21', 100, 103)])
    f.receipts.splice(f.receipts.findIndex(r => r.snapshotId === saved.marketSnapshotId), 1)
    const path = join(f.root, 'BTC', `${saved.id}.json`), raw = JSON.parse(await readFile(path, 'utf8'))
    delete raw.basis.receiptId; delete raw.basis.completedAt; raw.recordHash = nativeForwardRecordHash(raw)
    await writeFile(path, JSON.stringify(raw))
    const commitPath = join(f.root, 'BTC', 'commits', `${saved.id}.json`), receipt = JSON.parse(await readFile(commitPath, 'utf8'))
    receipt.captureHash = raw.recordHash; receipt.recordHash = nativeForwardCommitHash(receipt); await writeFile(commitPath, JSON.stringify(receipt))
    expect(await f.service.report('BTC')).toMatchObject({ invalidRecords: 1, current: null, rows: [], cohorts: [] })
  })
})
