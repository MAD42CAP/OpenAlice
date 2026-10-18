import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { explainInvestmentSnapshot, readInvestmentExplanation } from './investment-explanation.js'
import { guardInvestmentDraft, intelligenceRecordHash, investmentInputHash } from './investment.js'
import { investmentAnalysisVersion, type InvestmentDraft, type InvestmentInput, type InvestmentSnapshot } from './investment-types.js'
import { createNativeForwardStore, nativeForwardHash, nativeForwardRecordHash, nativeForwardCommitHash } from './native-forward-store.js'
import type { NativeForwardPublication, NativeForwardCommit } from './native-forward-types.js'
import { createInvestmentService } from './investment-service.js'
import { createInvestmentStore } from './investment-store.js'
import type { MarketMonitorAsset } from './types.js'
import type { EvidenceReference } from './intelligence-types.js'

const at = new Date('2026-10-14T21:00:00.000Z')
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

function fixture(asset: MarketMonitorAsset = 'TSLA') {
  const evidence: EvidenceReference[] = []
  const add = (metric: string, value: string | number | null, unit: string | null = null, dataAsOf = '2026-10-13T00:00:00.000Z') => {
    const ref: EvidenceReference = { id: `market:market-1:${metric}`, asset, sourceName: 'synthetic', sourceUrl: null, metric, value, unit, dataAsOf,
      publishedAt: null, retrievedAt: '2026-10-14T20:59:00.000Z', quality: 'available', reportId: null, kind: metric.startsWith('trend.') ? 'interpretation' : 'observation' }
    evidence.push(ref); return ref
  }
  add('daily-close', 100, 'USD')
  add('hourly-close', 101, 'USD', '2026-10-14T19:00:00.000Z')
  add('equity.next-earnings', '2026-10-28', null, '2026-10-14T20:00:00.000Z')
  const horizons = (['short', 'medium', 'long'] as const).map(horizon => {
    const refs = [add(`trend.${horizon}`, 'bullish'), add(`support.${horizon}`, 90, 'USD'), add(`resistance.${horizon}`, 110, 'USD')]
    return { horizon, observationWindow: 'Synthetic structural window', direction: 'bullish' as const, structure: 'synthetic', supportLevels: [90], resistanceLevels: [110],
      momentum: { text: 'Synthetic observation', evidenceIds: [refs[0]!.id], inference: true }, risks: [], confirmation: [], invalidation: [], evidenceIds: refs.map(e => e.id) }
  })
  const input: InvestmentInput = { market: { schemaVersion: 1, id: 'market-market-1', asset, snapshotId: 'market-1', analysisTime: at.toISOString(), retrievedAt: '2026-10-14T20:59:00.000Z',
    marketDataAsOf: '2026-10-13T00:00:00.000Z', hourlyDataAsOf: '2026-10-14T19:00:00.000Z', price: 100, volume: 10, priceKind: 'completed-daily-close', daily: [], hourly: [],
    horizons, wyckoffHypothesis: null, bullishEvidence: [], bearishEvidence: [], evidence, dataSources: [], dataQuality: 'partial', missingData: ['Optional product coverage is not available'], limitations: [] }, research: null }
  const outlooks = horizons.map(h => {
    const claim = { text: 'Synthetic research intent', evidenceIds: [h.evidenceIds[0]!], inference: true }
    return { horizon: h.horizon, direction: 'bullish' as const, conclusion: claim, structure: claim, supportingEvidence: [claim], opposingEvidence: [], risks: [claim], confirmation: [claim], invalidation: [claim], priceLevelLabels: [],
      decisionConditions: { confirmation: { metric: 'daily-close' as const, operator: 'gt' as const, threshold: 110, thresholdEvidenceId: h.evidenceIds[2]!, description: 'Future close above resistance' },
        invalidation: { metric: 'daily-close' as const, operator: 'lt' as const, threshold: 90, thresholdEvidenceId: h.evidenceIds[1]!, description: 'Future close below support' } } }
  })
  const claim = outlooks[0]!.conclusion
  const raw: InvestmentDraft = { summary: claim, outlooks, crossValidation: horizons.map(h => ({ horizon: h.horizon, claim: outlooks.find(o => o.horizon === h.horizon)!.conclusion,
    marketEvidenceIds: [h.evidenceIds[0]!], researchEvidenceIds: [], status: 'PARTIALLY_CONFIRMED', explanation: 'Only price evidence' })),
    scenarios: (['bullish', 'neutral', 'bearish'] as const).map(kind => ({ kind, hypothesis: claim, conditions: [claim], confirmation: [claim], path: claim, invalidation: [claim], supportingEvidence: [claim], opposingEvidence: [], priceLevelLabels: [] })),
    priceMap: [], theses: [{ key: 'synthetic-research', title: 'Synthetic research', claim, horizon: 'medium', observationDays: 7,
      supportConditions: [outlooks[1]!.decisionConditions.confirmation], invalidationConditions: [outlooks[1]!.decisionConditions.invalidation], resolutionConditions: [] }], limitations: [claim] }
  const freeze = () => {
    const guarded = guardInvestmentDraft(input, raw, at)
    const inputHash = investmentInputHash(input, at)
    const snapshot: InvestmentSnapshot = { ...guarded.draft, schemaVersion: 1, id: `investment-${inputHash}`, asset, analysisVersion: investmentAnalysisVersion(asset), analysisTime: at.toISOString(),
      marketSnapshotId: input.market.snapshotId, researchSnapshotId: input.research?.id ?? null, inputHash, previousSnapshotId: null,
      provenance: { workspaceId: 'synthetic', runId: 'synthetic', issueId: 'synthetic', agent: 'codex' }, analysisModel: 'synthetic', evidence: structuredClone(guarded.evidence), rawDraft: structuredClone(raw), guardWarnings: guarded.warnings, changes: [], recordHash: '' }
    snapshot.recordHash = intelligenceRecordHash(snapshot); return snapshot
  }
  return { input, raw, freeze, evidence }
}

function originFor(input: InvestmentInput, original: InvestmentSnapshot) {
  const snapshot = structuredClone(original)
  const inputHash = nativeForwardHash(input)
  snapshot.forwardValidation = { protocol: 'native-investment-forward-v1', originInputHash: inputHash }
  snapshot.recordHash = intelligenceRecordHash(snapshot)
  const origin: NativeForwardPublication = { schemaVersion: 1, protocol: 'native-investment-forward-v1', id: snapshot.id, asset: snapshot.asset, issuedAt: snapshot.analysisTime,
    sessionDate: '2026-10-14', originInputHash: inputHash, input: structuredClone(input), snapshot: structuredClone(snapshot),
    basis: { snapshotId: input.market.snapshotId, inputHash: 'synthetic-market-hash', strategyId: 'evidence-chain-v1', strategyVersion: 4, provider: 'synthetic', receiptId: 'synthetic-receipt', completedAt: input.market.retrievedAt }, recordHash: '' }
  origin.recordHash = nativeForwardRecordHash(origin)
  const commit: NativeForwardCommit = { schemaVersion: 1, protocol: 'native-investment-forward-v1', id: snapshot.id, asset: snapshot.asset,
    publishedAt: new Date(at.getTime() + 1000).toISOString(), captureHash: origin.recordHash, snapshotHash: snapshot.recordHash, recordHash: '' }
  commit.recordHash = nativeForwardCommitHash(commit)
  return { snapshot, origin, commit, store: { read: async () => origin, readCommit: async () => commit } }
}
const reasons = (value: ReturnType<typeof explainInvestmentSnapshot>, horizon = 'short') => value.outlooks.find(o => o.horizon === horizon)!

describe('read-only native investment explanation', () => {
  it('separates model abstention, saved conflict and unknown evidence without blaming global partial coverage', () => {
    const f = fixture()
    for (const outlook of f.raw.outlooks) outlook.direction = 'uncertain' as never
    f.raw.crossValidation[0]!.status = 'UNVERIFIED'
    const snapshot = f.freeze()
    snapshot.crossValidation[1]!.status = 'CONFLICTING'
    // History may append uncited old evidence to explain a change. It is not a current gate.
    snapshot.evidence.push({ ...snapshot.evidence[0]!, id: 'uncited-historical-change', quality: 'unavailable', dataAsOf: null })
    const explanation = explainInvestmentSnapshot(snapshot, f.input, 'verified')
    expect(reasons(explanation)).toMatchObject({ rawDirection: 'uncertain', direction: 'uncertain', marketDirection: 'bullish', primaryReason: 'model-uncertain' })
    expect(reasons(explanation).reasons.map(r => r.code)).toEqual(expect.arrayContaining(['model-uncertain', 'evidence-unverified']))
    expect(reasons(explanation, 'medium').reasons.map(r => r.code)).toContain('same-horizon-conflict')
    expect(explanation.outlooks.flatMap(o => o.reasons).map(r => r.code)).not.toContain('data-unavailable')
    expect(reasons(explanation).reasons.map(r => r.code)).not.toContain('same-horizon-conflict')
  })

  it.each(['unavailable', 'outdated', 'unknown'] as const)('classifies only actual cited %s evidence at the original analysis time', quality => {
    const f = fixture(), snapshot = f.freeze(), ref = f.input.market.evidence.find(e => e.metric === 'trend.medium')!
    ref.quality = quality
    const medium = reasons(explainInvestmentSnapshot(snapshot, f.input, 'verified'), 'medium')
    expect(medium.reasons.map(r => r.code)).toContain(quality === 'unavailable' ? 'data-unavailable' : quality === 'outdated' ? 'data-outdated' : 'evidence-unverified')
    expect(reasons(explainInvestmentSnapshot(snapshot, f.input, 'verified')).reasons.map(r => r.code)).not.toContain('data-unavailable')
  })

  it('does not turn a source paragraph with no numeric value into a failed data source', () => {
    const f = fixture(), snapshot = f.freeze()
    const paragraph = { ...f.evidence[0]!, id: 'paragraph', metric: 'report-paragraph', value: null, reportId: 'report', excerpt: 'Synthetic dated source paragraph' }
    f.input.market.evidence.push(paragraph)
    snapshot.rawDraft.outlooks[1]!.conclusion.evidenceIds.push(paragraph.id)
    expect(reasons(explainInvestmentSnapshot(snapshot, f.input, 'verified'), 'medium').reasons.map(r => r.code)).not.toContain('data-unavailable')
  })

  it('preserves explicit earnings and hourly constraints alongside an already uncertain model', () => {
    const f = fixture()
    for (const outlook of f.raw.outlooks) outlook.direction = 'uncertain' as never
    f.evidence.find(e => e.metric === 'equity.next-earnings')!.value = '2026-10-16'
    f.evidence.find(e => e.metric === 'hourly-close')!.quality = 'unavailable'
    const explanation = explainInvestmentSnapshot(f.freeze(), f.input, 'verified')
    expect(reasons(explanation)).toMatchObject({ primaryReason: 'earnings-risk-window', rawDirection: 'uncertain' })
    expect(reasons(explanation).reasons.map(r => r.code)).toEqual(expect.arrayContaining(['model-uncertain', 'earnings-risk-window', 'hourly-evidence-unavailable']))
    expect(reasons(explanation, 'medium').reasons.map(r => r.code)).not.toContain('earnings-risk-window')
  })

  it('keeps an unverified earnings calendar specific instead of labeling the whole market unavailable', () => {
    const f = fixture()
    f.evidence.find(e => e.metric === 'equity.next-earnings')!.quality = 'unknown'
    const short = reasons(explainInvestmentSnapshot(f.freeze(), f.input, 'verified'))
    expect(short.primaryReason).toBe('earnings-calendar-unverified')
    expect(short.reasons.map(r => r.code)).not.toContain('data-unavailable')
  })

  it('keeps conditional support, valid boundaries and missing independent confirmation distinct from missing data', () => {
    const f = fixture(), snapshot = f.freeze(), before = JSON.stringify(snapshot)
    const explanation = explainInvestmentSnapshot(snapshot, f.input, 'verified')
    expect(reasons(explanation, 'medium')).toMatchObject({ rawDirection: 'bullish', direction: 'conditional-bullish', primaryReason: 'independent-confirmation-missing' })
    expect(reasons(explanation, 'medium').reasons.map(r => r.code)).toEqual(['independent-confirmation-missing'])
    expect(JSON.stringify(snapshot)).toBe(before)
    expect(snapshot.outlooks[1]!.decisionConditions!.confirmation.threshold).toBe(110)
  })

  it('reports absent and stale directional boundaries separately without inventing them for model abstentions', () => {
    const f = fixture()
    delete (f.raw.outlooks[1] as InvestmentDraft['outlooks'][number]).decisionConditions
    const snapshot = f.freeze()
    expect(reasons(explainInvestmentSnapshot(snapshot, f.input, 'verified'), 'medium').primaryReason).toBe('conditions-missing')
    f.input.market.evidence.find(e => e.metric === 'resistance.short')!.quality = 'outdated'
    expect(reasons(explainInvestmentSnapshot(snapshot, f.input, 'verified')).primaryReason).toBe('conditions-outdated')
    snapshot.rawDraft.outlooks[1]!.direction = 'uncertain'
    expect(reasons(explainInvestmentSnapshot(snapshot, f.input, 'verified'), 'medium').reasons.map(r => r.code)).not.toContain('conditions-missing')
  })

  it.each(['unavailable', 'unknown'] as const)('preserves the specific boundary constraint when an existing pair has %s references', quality => {
    const f = fixture()
    f.evidence.find(e => e.metric === 'resistance.medium')!.quality = quality
    const snapshot = f.freeze()
    expect(snapshot.outlooks[1]!.direction).toBe('uncertain')
    expect(snapshot.guardWarnings.join(' ')).toContain('机读确认与失效边界缺失或已过期')
    const medium = reasons(explainInvestmentSnapshot(snapshot, f.input, 'verified'), 'medium')
    expect(medium.primaryReason).toBe('conditions-unavailable')
    expect(medium.reasons.map(r => r.code)).toContain('conditions-unavailable')
    expect(medium.reasons.map(r => r.code)).not.toContain('conditions-outdated')
  })

  it('does not infer same-horizon conflict from different horizons or ambiguous validation anchors', () => {
    const f = fixture(), snapshot = f.freeze()
    snapshot.crossValidation = [{ ...snapshot.crossValidation[0]!, horizon: undefined, marketEvidenceIds: [f.input.market.horizons[0]!.evidenceIds[0]!, f.input.market.horizons[2]!.evidenceIds[0]!], status: 'CONFLICTING' }]
    const result = explainInvestmentSnapshot(snapshot, f.input, 'verified')
    expect(result.outlooks.flatMap(o => o.reasons).map(r => r.code)).not.toContain('same-horizon-conflict')
    expect(result.outlooks.every(o => o.reasons.some(r => r.code === 'cross-validation-missing'))).toBe(true)
  })

  it('treats old missing frozen inputs as incomplete explanations, even when raw uncertainty is preserved', () => {
    const f = fixture(), snapshot = f.freeze()
    snapshot.rawDraft.outlooks[0]!.direction = 'uncertain'
    snapshot.guardWarnings = ['证据不足 is arbitrary presentation text and must not determine classification']
    const explanation = explainInvestmentSnapshot(snapshot)
    expect(explanation.inputStatus).toBe('unavailable')
    expect(explanation.outlooks.every(o => o.primaryReason === 'explanation-unavailable')).toBe(true)
    expect(reasons(explanation).reasons.map(r => r.code)).toContain('model-uncertain')
    expect(explanation.outlooks.flatMap(o => o.reasons).map(r => r.code)).not.toContain('earnings-calendar-unverified')
  })

  it('validates exact source/capture/commit bindings and freezes the explanation clock across later queries', async () => {
    const f = fixture(), bound = originFor(f.input, f.freeze())
    const first = await readInvestmentExplanation(bound.snapshot, bound.store, new Date('2026-10-14T22:00:00Z'))
    const later = await readInvestmentExplanation(bound.snapshot, bound.store, new Date('2027-01-01T00:00:00Z'))
    expect(later).toEqual(first)
    expect(first).toMatchObject({ inputStatus: 'verified', asset: 'TSLA', snapshotId: bound.snapshot.id, marketSnapshotId: 'market-1', analysisTime: at.toISOString() })
    expect((await readInvestmentExplanation(bound.snapshot, bound.store, at)).inputStatus).toBe('unavailable')
    bound.origin.input.market.snapshotId = 'different-market'
    expect((await readInvestmentExplanation(bound.snapshot, bound.store, new Date('2026-10-14T22:00:00Z'))).inputStatus).toBe('invalid')
  })

  it('accepts genuinely bound older analysis versions without reapplying newer hidden guard requirements', async () => {
    const f = fixture(), snapshot = f.freeze()
    snapshot.analysisVersion = 'investment-intelligence-equity-v1'
    const bound = originFor(f.input, snapshot)
    const result = await readInvestmentExplanation(bound.snapshot, bound.store, new Date('2026-10-14T22:00:00Z'))
    expect(result.inputStatus).toBe('verified')
    expect(result.outlooks.every(o => o.primaryReason === 'explanation-unavailable')).toBe(true)
  })

  it.each(['capture', 'commit', 'source', 'protocol'] as const)('fails closed for a mismatched %s companion', async kind => {
    const f = fixture(), bound = originFor(f.input, f.freeze())
    if (kind === 'capture') bound.origin.snapshot.recordHash = 'different-source'
    else if (kind === 'commit') bound.commit.captureHash = 'different-capture'
    else if (kind === 'source') bound.snapshot.summary.text = 'Changed source text'
    else bound.origin.protocol = 'other-protocol' as never
    const result = await readInvestmentExplanation(bound.snapshot, bound.store, new Date('2026-10-14T22:00:00Z'))
    expect(result.inputStatus).toBe('invalid')
    expect(result.outlooks.every(o => o.primaryReason === 'explanation-unavailable')).toBe(true)
  })

  it('contains missing/corrupt/IO companion failures without turning them into market-data failures', async () => {
    const f = fixture(), bound = originFor(f.input, f.freeze())
    const unavailable = await readInvestmentExplanation(bound.snapshot, { read: async () => null, readCommit: async () => null }, at)
    expect(unavailable.inputStatus).toBe('unavailable')
    const failed = await readInvestmentExplanation(bound.snapshot, { read: async () => { throw new Error('Synthetic IO failure') }, readCommit: async () => null }, at)
    expect(failed.inputStatus).toBe('read-error')
    expect(reasons(failed).primaryReason).toBe('explanation-unavailable')
  })

  it('adds only a latest-bound report companion and leaves publication bytes and return scores unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'investment-explanation-')); roots.push(root)
    const f = fixture(), bound = originFor(f.input, f.freeze())
    const publications = createInvestmentStore(join(root, 'publications'))
    const origins = createNativeForwardStore(join(root, 'origins'))
    await publications.save('publications', bound.snapshot)
    await origins.save(bound.origin); await origins.saveCommit(bound.commit)
    const files = async () => {
      const names = await readdir(root, { recursive: true, withFileTypes: true })
      return Promise.all(names.filter(v => v.isFile()).map(async v => [join(v.parentPath, v.name), await readFile(join(v.parentPath, v.name), 'utf8')]))
    }
    const before = await files()
    const market = { archive: async () => null, snapshots: async () => [], receipts: async () => [] }
    const service = createInvestmentService({ asset: 'TSLA', root: join(root, 'publications'), nativeForward: { market, root: join(root, 'origins') }, now: () => new Date('2026-10-14T22:00:00Z') })
    const result = await service.report()
    expect(result.latest).toEqual(bound.snapshot)
    expect(result.explanation).toMatchObject({ snapshotId: bound.snapshot.id, inputStatus: 'verified' })
    expect(result.nativeForward?.current).toBeNull()
    expect(await files()).toEqual(before)
    await expect(service.report({ asOf: '2026-10-15T00:00:00Z' })).rejects.toThrow('历史查询时间')
  })
})
