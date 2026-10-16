import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMarketIntelligence } from './intelligence-market.js'
import { evaluateInvestmentThesis, evidenceAvailability, guardInvestmentDraft, intelligenceRecordHash, investmentInputHash } from './investment.js'
import { createHash } from 'node:crypto'
import { INVESTMENT_ANALYSIS_VERSION } from './investment-types.js'
import { createInvestmentService } from './investment-service.js'
import { createInvestmentStore } from './investment-store.js'
import { evidenceChainV1Strategy } from './strategy.js'
import type { MarketMonitorSnapshot } from './types.js'
import type { InvestmentDraft, InvestmentInput } from './investment-types.js'
import { RESEARCH_SECTION_KEYS, type ResearchSnapshot } from './research-types.js'
import { RESEARCH_LOOP_PROTOCOL } from './research-loop-types.js'

const at = new Date('2026-10-14T12:00:00Z')
const provenance = { workspaceId: 'workspace', runId: 'run', issueId: 'issue', agent: 'codex', model: 'configured-native-model' }
function snapshot(date = at, close = 120): MarketMonitorSnapshot {
  const daily = Array.from({ length: 130 }, (_, i) => ({ date: new Date(Date.parse(date.toISOString().slice(0, 10)) - (130 - i) * 86400000).toISOString(), open: 100 + i / 10, high: 132, low: 90, close: i === 129 ? close : 100 + i / 10, volume: 1000 }))
  const intraday = Array.from({ length: 4 }, (_, i) => ({ date: new Date(date.getTime() - (4 - i) * 3600000).toISOString(), open: close, high: close + 1, low: close - 1, close, volume: 10 }))
  const sourceHealth = [{ id: 'daily-bars', label: 'daily', status: 'ok' as const, provider: 'coinbase', asOf: daily.at(-1)!.date, detail: 'fixture' }, { id: 'intraday-bars', label: 'hourly', status: 'ok' as const, provider: 'coinbase', asOf: intraday.at(-1)!.date, detail: 'fixture' }]
  const analysis = evidenceChainV1Strategy.analyze({ asset: 'BTC', dailyBars: daily, intradayBars: intraday, asOf: date, abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5 })
  return { id: `snapshot-${date.toISOString().slice(0, 10)}`, asset: 'BTC', capturedAt: date.toISOString(), trigger: 'manual', strategyId: evidenceChainV1Strategy.manifest.id, fingerprint: 'fixture', ...analysis,
    analysisBasis: { version: 2, closedBarsOnly: true, dailyAt: daily.at(-1)!.date, hourlyAt: intraday.at(-1)!.date }, sourceHealth, context: {}, chart: { daily, intraday, dailyMeta: { symbol: 'BTC-USD', from: daily[0]!.date, to: daily.at(-1)!.date, bars: daily.length, provider: 'coinbase' }, intradayMeta: { symbol: 'BTC-USD', from: intraday[0]!.date, to: intraday.at(-1)!.date, bars: intraday.length, provider: 'coinbase' } } }
}
function input(): InvestmentInput & { research: ResearchSnapshot } {
  const market = buildMarketIntelligence(snapshot(), at)
  const researchId = 'report:cost-basis'
  const claim = { text: '报告认为供应压力缓解，仍须等待需求确认。', evidenceIds: [researchId], inference: false }
  const research: ResearchSnapshot = { schemaVersion: 1, id: 'research-1', asset: 'BTC', reportId: 'report-1', reportUrl: 'https://research.glassnode.com/fixture/', reportTitle: 'Weekly research', publicationTime: '2026-10-13T10:00:00Z', reportPeriod: '2026-W41', reportHash: 'source-hash', previousSnapshotId: null, analysisVersion: 'glassnode-research-v1', analysisTime: '2026-10-13T12:00:00Z', analysisModel: 'configured', revision: 1, provenance, dataAsOf: '2026-10-12T00:00:00Z', mainThesis: claim,
    sections: Object.fromEntries(RESEARCH_SECTION_KEYS.map(k => [k, [claim]])) as ResearchSnapshot['sections'], metrics: [], keyPriceLevels: [{ label: '成本线', price: 100, unit: 'USD', role: 'cost-basis', dataAsOf: '2026-10-12T00:00:00Z', evidenceIds: [researchId] }], bullishEvidence: [claim], bearishEvidence: [], uncertainties: [claim], limitations: [claim], weeklyChanges: [], recordHash: 'research-hash', evidence: [{ id: researchId, asset: 'BTC', sourceName: 'Glassnode', sourceUrl: 'https://research.glassnode.com/fixture/', metric: 'source-paragraph', value: 'Cost basis $100', unit: null, dataAsOf: '2026-10-12T00:00:00Z', publishedAt: '2026-10-13T10:00:00Z', retrievedAt: '2026-10-13T11:00:00Z', quality: 'available', reportId: 'report-1', kind: 'observation' }] }
  return { market, research }
}
function draft(i: InvestmentInput & { research: ResearchSnapshot }): InvestmentDraft {
  const dailyId = i.market.evidence.find(e => e.metric === 'daily-close')!.id
  const trendId = i.market.evidence.find(e => e.metric === 'trend.medium')!.id
  const reportId = i.research.evidence[0]!.id
  const claim = { text: '依据已获取证据提出待验证情景，不表示保证的价格方向。', evidenceIds: [dailyId, reportId], inference: true }
  return { summary: claim, crossValidation: [{ claim, marketEvidenceIds: [trendId], researchEvidenceIds: [reportId], status: 'CONFIRMED', explanation: '模型认为同向。' }],
    outlooks: (['short', 'medium', 'long'] as const).map(horizon => ({ horizon, direction: 'neutral', conclusion: claim, structure: claim, supportingEvidence: [claim], opposingEvidence: [], risks: [claim], confirmation: [claim], invalidation: [claim], priceLevelLabels: ['成本线'] })),
    scenarios: (['bullish', 'neutral', 'bearish'] as const).map(kind => ({ kind, hypothesis: claim, conditions: [claim], confirmation: [claim], path: claim, invalidation: [claim], supportingEvidence: [claim], opposingEvidence: [], priceLevelLabels: ['成本线'] })), priceMap: [{ label: '成本线', price: 100, role: 'cost-basis', unit: 'USD', evidenceIds: [reportId] }], limitations: [claim],
    theses: [{ key: 'medium-recovery', title: '中期修复假设', claim, horizon: 'medium', observationDays: 7, supportConditions: [{ metric: 'daily-close', operator: 'gt', threshold: 100, thresholdEvidenceId: reportId, description: '新收盘站上成本线' }], invalidationConditions: [{ metric: 'daily-close', operator: 'lt', threshold: 100, thresholdEvidenceId: reportId, description: '新收盘跌破成本线' }], resolutionConditions: [] }] }
}

describe('investment intelligence evidence guards', () => {
  it('rejects credential-like native draft content without echoing it', () => {
    const i = input(), d = draft(i), marker = 'Bearer syntheticSensitiveMarkerForValidationOnly'
    d.summary.text = marker
    try { guardInvestmentDraft(i, d, at); throw new Error('accepted sensitive content') } catch (error) {
      expect(String(error)).toContain('敏感内容')
      expect(String(error)).not.toContain(marker)
    }
  })
  it('requires exact frozen feedback review without promoting inference into an independent observation', () => {
    const i = input(), d = draft(i)
    const ref = { ...i.market.evidence[0]!, id: 'feedback:quant', metric: 'research-feedback.quant', value: '样本不足，继续前向验证', unit: null, kind: 'inference' as const, reportId: null, sourceName: 'Auto Quant', dataAsOf: at.toISOString(), publishedAt: at.toISOString(), retrievedAt: at.toISOString() }
    i.researchFeedback = { protocol: RESEARCH_LOOP_PROTOCOL, hash: 'a'.repeat(64), asOf: at.toISOString(), records: [], jev: null, evidence: [ref] }
    expect(() => guardInvestmentDraft(i, d, at)).toThrow('逐项审阅')
    d.feedbackReview = { reviewedIds: [ref.id], effect: 'caution', explanation: '复盘尚无独立优势，维持条件性研究。' }
    i.market.evidence.find(e => e.metric === 'trend.medium')!.value = 'bullish'
    const guarded = guardInvestmentDraft(i, d, at)
    expect(guarded.draft.crossValidation[0]!.status).toBe('PARTIALLY_CONFIRMED')
    expect(guarded.evidence.find(e => e.id === ref.id)?.kind).toBe('inference')
    expect(guarded.warnings.join(' ')).toContain('不增加独立确认票数')
    d.feedbackReview.reviewedIds = ['later-feedback']
    expect(() => guardInvestmentDraft(i, d, at)).toThrow('逐项审阅')
    d.feedbackReview.reviewedIds = [ref.id]
    i.researchFeedback.evidence[0]!.kind = 'observation'
    expect(() => guardInvestmentDraft(i, d, at)).toThrow('来源或时序')
  })
  it('persists the reviewed feedback receipt and gives later feedback a new publication identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-synthesis-'))
    try {
      const i = input(), d = draft(i), service = createInvestmentService({ root, now: () => at })
      const ref = { ...i.market.evidence[0]!, id: 'feedback:prediction', metric: 'research-feedback.prediction', value: '事件资料不足', unit: null, kind: 'inference' as const, reportId: null, dataAsOf: at.toISOString(), publishedAt: at.toISOString(), retrievedAt: at.toISOString() }
      i.researchFeedback = { protocol: RESEARCH_LOOP_PROTOCOL, hash: 'a'.repeat(64), asOf: at.toISOString(), records: [], jev: null, evidence: [ref] }
      d.feedbackReview = { reviewedIds: [ref.id], effect: 'context-only', explanation: '事件线索保留为研究背景，暂不改变方向。' }
      const first = await service.publish(i, d, provenance)
      expect(first.snapshot.analysisVersion).toBe('investment-intelligence-v3')
      expect(first.snapshot.researchFeedback).toMatchObject({ contextHash: 'a'.repeat(64), reviewedIds: [ref.id], effect: 'context-only' })
      const original = JSON.stringify(first.snapshot)
      i.researchFeedback.hash = 'b'.repeat(64)
      const second = await service.publish(i, d, { ...provenance, runId: 'later-run' })
      expect(second.snapshot.id).not.toBe(first.snapshot.id)
      expect(JSON.stringify((await service.report()).history.find(p => p.id === first.snapshot.id))).toBe(original)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('keeps an evidenced sideways range distinct from uncertain transition', () => {
    const i = input(), d = draft(i)
    const trend = i.market.evidence.find(e => e.metric === 'trend.medium')!
    const view = i.market.horizons.find(h => h.horizon === 'medium')!
    trend.value = 'sideways'; view.direction = 'sideways'
    view.supportLevels = [90]; view.resistanceLevels = [130]
    i.research.bullishEvidence = []; i.research.bearishEvidence = []
    const range = guardInvestmentDraft(i, d, at).draft
    expect(range.crossValidation[0]!.status).toBe('PARTIALLY_CONFIRMED')
    expect(range.outlooks[1]!.direction).toBe('neutral')
    expect(range.summary.text).toContain('中期区间判断')
    trend.value = 'transition'; view.direction = 'transition'
    expect(guardInvestmentDraft(i, d, at).draft.outlooks[1]!.direction).toBe('uncertain')
    trend.value = 'sideways'; view.direction = 'sideways'; view.supportLevels = []
    expect(guardInvestmentDraft(i, d, at).draft.outlooks[1]!.direction).toBe('uncertain')
  })
  it('projects actual closed bars, separate source times, hypothesis-only Wyckoff and missing data', () => {
    const s = snapshot(), market = buildMarketIntelligence(s, at)
    expect(market.snapshotId).toBe(s.id)
    expect(market.price).toBe(120)
    expect(market.marketDataAsOf).not.toBe(market.hourlyDataAsOf)
    expect(market.evidence.find(e => e.metric === 'daily-close')).toMatchObject({ value: 120, sourceName: 'coinbase', retrievedAt: at.toISOString() })
    expect(market.missingData.join(' ')).toContain('ETF')
    expect(market.wyckoffHypothesis?.confirmed).toBe(false)
    expect(market.horizons.map(h => h.direction)).toEqual(['short', 'medium', 'long'].map(h => s.trend![h as 'short'].direction))
    expect(buildMarketIntelligence({ ...s, asset: 'TSLA' }, at).asset).toBe('TSLA')
    expect(() => buildMarketIntelligence(s, new Date('2026-10-13'))).toThrow('时间')
  })
  it('rejects invented prices, nonexistent evidence and duplicate horizons', () => {
    const i = input(), d = draft(i)
    d.priceMap[0]!.price = 101
    expect(() => guardInvestmentDraft(i, d, at)).toThrow('价格地图')
    const missing = draft(i); missing.summary.evidenceIds = ['unknown']
    expect(() => guardInvestmentDraft(i, missing, at)).toThrow('不存在')
    const repeated = draft(i); repeated.outlooks[2]!.horizon = 'short'
    expect(() => guardInvestmentDraft(i, repeated, at)).toThrow('重复')
    const fakeThreshold = draft(i); fakeThreshold.theses[0]!.invalidationConditions[0]!.threshold = 99
    expect(() => guardInvestmentDraft(i, fakeThreshold, at)).toThrow('阈值')
  })
  it('prevents the model turning opposite evidence into confirmation, keeping the raw proposal unchanged', () => {
    const i = input(), d = draft(i)
    i.market.evidence.find(e => e.metric === 'trend.medium')!.value = 'bearish'
    const result = guardInvestmentDraft(i, d, at)
    expect(result.draft.crossValidation[0]!.status).toBe('CONFLICTING')
    expect(result.warnings.join(' ')).toContain('CONFIRMED → CONFLICTING')
    expect(d.crossValidation[0]!.status).toBe('CONFIRMED')
    expect(result.draft.crossValidation[0]!.explanation).toContain('AI 原解释')
  })
  it('uses individually dated research references when the report has mixed cutoffs and no aggregate date', () => {
    const i = input(), d = draft(i)
    i.research.dataAsOf = null
    i.market.evidence.find(e => e.metric === 'trend.medium')!.value = 'bullish'
    expect(guardInvestmentDraft(i, d, at).draft.crossValidation[0]!.status).toBe('PARTIALLY_CONFIRMED')
    i.research.dataAsOf = '2026-09-01T00:00:00Z'
    const result = guardInvestmentDraft(i, d, at)
    expect(result.draft.crossValidation[0]!.status).toBe('PARTIALLY_CONFIRMED')
    expect(result.warnings).toContain('报告整体数据时间较旧；各指标仍按各自明确的截止时间独立检查。')
  })
  it('checks extra claim references for freshness before confirming otherwise aligned evidence', () => {
    const i = input(), d = draft(i)
    i.market.evidence.find(e => e.metric === 'trend.medium')!.value = 'bullish'
    const hourly = i.market.evidence.find(e => e.metric === 'hourly-close')!
    hourly.dataAsOf = '2026-10-11T12:00:00Z'
    d.crossValidation[0]!.claim.evidenceIds.push(hourly.id)
    expect(guardInvestmentDraft(i, d, at).draft.crossValidation[0]!.status).toBe('OUTDATED')
  })
  it('does not mistake another horizon cited by the claim for same-horizon conflict', () => {
    const i = input(), d = draft(i)
    i.market.evidence.find(e => e.metric === 'trend.medium')!.value = 'bullish'
    const opposing = i.market.evidence.find(e => e.metric === 'trend.short')!
    opposing.value = 'bearish'
    d.crossValidation[0]!.claim.evidenceIds.push(opposing.id)
    const result = guardInvestmentDraft(i, d, at)
    expect(result.draft.crossValidation[0]!.status).toBe('PARTIALLY_CONFIRMED')
    expect(d.crossValidation[0]!.status).toBe('CONFIRMED')
  })
  it('requires an explicit same-horizon anchor and never combines short and long votes', () => {
    const i = input(), d = draft(i)
    const row = d.crossValidation[0]!
    row.horizon = 'short'
    i.market.evidence.find(e => e.metric === 'trend.medium')!.value = 'bullish'
    const guarded = guardInvestmentDraft(i, d, at).draft
    expect(guarded.crossValidation[0]!.status).toBe('UNVERIFIED')
    expect(guarded.outlooks.every(o => o.direction === 'uncertain')).toBe(true)
    const ambiguous = draft(i)
    ambiguous.crossValidation[0]!.marketEvidenceIds.push(i.market.evidence.find(e => e.metric === 'trend.long')!.id)
    expect(guardInvestmentDraft(i, ambiguous, at).draft.crossValidation[0]!.status).toBe('UNVERIFIED')
  })
  it('caps repeated price-volume interpretations and unknown report families, updating the visible conclusion', () => {
    const i = input(), d = draft(i)
    i.market.evidence.find(e => e.metric === 'trend.medium')!.value = 'bullish'
    d.outlooks[1]!.direction = 'bullish'
    d.summary.text = 'BTC 必将上涨'
    d.outlooks[1]!.conclusion = { ...d.outlooks[1]!.conclusion, text: '已经确认持续上涨' }
    const result = guardInvestmentDraft(i, d, at)
    expect(result.draft.crossValidation[0]!.status).toBe('PARTIALLY_CONFIRMED')
    expect(result.draft.outlooks[1]!.direction).toBe('conditional-bullish')
    expect(result.draft.outlooks[0]!.direction).toBe('uncertain')
    expect(result.draft.summary.text).toContain('中期有条件偏多')
    expect(result.draft.summary.text).not.toContain('必将')
    expect(result.draft.outlooks[1]!.conclusion.text).not.toContain('已经确认')
    expect(d.summary.text).toBe('BTC 必将上涨')
  })
  it('does not trust a model metric name or the Glassnode brand as independent evidence', () => {
    const i = input(), d = draft(i), e = i.research.evidence[0]!
    i.market.evidence.find(e => e.metric === 'trend.medium')!.value = 'bullish'
    const claim = i.research.mainThesis
    i.research.metrics = [{ name: 'SOPR', value: 100, unit: 'ratio', kind: 'observation', dataAsOf: e.dataAsOf, evidenceIds: [e.id], meaning: claim, change: null }]
    expect(guardInvestmentDraft(i, d, at).draft.crossValidation[0]!.status).toBe('PARTIALLY_CONFIRMED')
    e.excerpt = 'SOPR is mentioned, but its value is unavailable.'
    expect(guardInvestmentDraft(i, d, at).draft.crossValidation[0]!.status).toBe('PARTIALLY_CONFIRMED')
    e.excerpt = 'On 2026-10-12 SOPR is unavailable. BTC price was $100.'
    i.research.metrics[0]!.value = 2026
    expect(guardInvestmentDraft(i, d, at).draft.crossValidation[0]!.status).toBe('PARTIALLY_CONFIRMED')
    e.excerpt = 'MVRV was 100.'
    i.research.metrics[0]!.value = 100
    expect(guardInvestmentDraft(i, d, at).draft.crossValidation[0]!.status).toBe('PARTIALLY_CONFIRMED')
  })
  it('keeps numeric MVRV, SOPR and ETF report paragraphs unknown until trusted structured observations exist', () => {
    const i = input(), d = draft(i), e = i.research.evidence[0]!
    i.market.evidence.find(e => e.metric === 'trend.medium')!.value = 'bullish'
    e.excerpt = 'On 2026-10-12 SOPR was 1.02, MVRV was 2.1 and ETF net flows were $100 million.'
    i.research.metrics = [{ name: 'SOPR', value: 1.02, unit: 'ratio', kind: 'observation', dataAsOf: e.dataAsOf, evidenceIds: [e.id], meaning: i.research.mainThesis, change: null }]
    d.outlooks[1]!.direction = 'bullish'
    const result = guardInvestmentDraft(i, d, at)
    expect(result.draft.crossValidation[0]!.status).toBe('PARTIALLY_CONFIRMED')
    expect(result.draft.outlooks[1]!.direction).toBe('conditional-bullish')
    expect(result.draft.summary.text).toContain('中期有条件偏多')
    // Even a model relabeling the source paragraph cannot manufacture trusted metadata.
    e.metric = 'funding-8h'; e.value = 0.01
    expect(guardInvestmentDraft(i, d, at).draft.crossValidation[0]!.status).toBe('PARTIALLY_CONFIRMED')
  })
  it.each(['conflict', 'outdated', 'missing'] as const)('downgrades a leading bullish outlook and summary for %s evidence', kind => {
    const i = input(), d = draft(i)
    i.market.evidence.find(e => e.metric === 'trend.medium')!.value = kind === 'conflict' ? 'bearish' : 'bullish'
    if (kind === 'outdated') i.research.evidence[0]!.dataAsOf = '2026-09-01T00:00:00Z'
    if (kind === 'missing') i.research.evidence[0]!.dataAsOf = null
    d.summary.text = '全面上涨已确认'; d.outlooks[1]!.direction = 'bullish'
    d.outlooks[1]!.conclusion.text = '中期无条件上涨'
    const result = guardInvestmentDraft(i, d, at).draft
    expect(result.outlooks[1]!.direction).toBe('uncertain')
    expect(result.summary.text).toContain('中期暂不判断')
    expect(result.summary.text).not.toContain('上涨')
    expect(result.outlooks[1]!.conclusion.text).not.toContain('上涨')
  })
  it.each(['missing', 'future', 'outdated'] as const)('guards %s research without inventing confirmation', kind => {
    const i = input(), d = draft(i), e = i.research.evidence[0]!
    if (kind === 'missing') e.dataAsOf = null
    if (kind === 'future') e.dataAsOf = '2026-10-15T00:00:00Z'
    if (kind === 'outdated') e.dataAsOf = '2026-09-01T00:00:00Z'
    expect(guardInvestmentDraft(i, d, at).draft.crossValidation[0]!.status).toBe(kind === 'outdated' ? 'OUTDATED' : 'UNVERIFIED')
  })
})

describe('investment immutable history and objective theses', () => {
  it('deduplicates inputs, attributes the actual model, keeps terminal invalidation and forbids future replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'investment-'))
    let clock = new Date(at)
    const service = createInvestmentService({ root, now: () => clock }), i = input(), d = draft(i)
    try {
      const first = await service.publish(i, d, provenance)
      expect(first.stored).toBe(true)
      expect(first.snapshot.analysisModel).toBe(provenance.model)
      expect(first.snapshot.rawDraft).toEqual(d)
      clock = new Date('2026-10-14T12:30:00Z')
      expect((await service.publish(i, { ...d, summary: { ...d.summary, text: '不覆盖历史' } }, provenance)).stored).toBe(false)
      expect((await service.report()).history).toHaveLength(1)
      expect((await service.report({ asOf: '2026-10-14T11:00:00Z' })).latest).toBeNull()
      expect((await service.report({ asOf: '2026-10-12T00:00:00Z' })).theses).toHaveLength(0)
      clock = new Date('2026-10-15T12:00:00Z')
      const next = buildMarketIntelligence(snapshot(clock, 95), clock)
      expect((await service.revalidate(next))[0]!.status).toBe('INVALIDATED')
      clock = new Date('2026-10-16T12:00:00Z')
      expect(await service.revalidate(buildMarketIntelligence(snapshot(clock, 125), clock))).toEqual([])
      const final = await service.report()
      expect(final.theses[0]!.status).toBe('INVALIDATED')
      expect(final.quality.invalidated).toBe(1)
      expect(final.quality.directionalAccuracy).toBeNull()
      expect(final.evaluations[0]).toMatchObject({ previousStatus: 'CHALLENGED', status: 'INVALIDATED' })
      expect((await service.report({ asOf: '2026-10-14T12:01:00Z' })).theses[0]!.status).toBe('CHALLENGED')
      const nextInput = { ...i, market: next }, nextDraft = draft(nextInput)
      nextDraft.theses[0]!.invalidationConditions[0]!.operator = 'gt'
      await service.publish(nextInput, nextDraft, provenance)
      expect((await service.report()).theses[0]!.invalidationConditions[0]!.operator).toBe('lt')
      const file = join(root, 'publications', `${first.snapshot.id}.json`)
      const changed = JSON.parse(await readFile(file, 'utf8')); changed.summary.text = 'tampered'
      await writeFile(file, JSON.stringify(changed))
      await expect(service.report()).rejects.toThrow('integrity')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('expires with an explicit deadline and does not invalidate using observations obtained after expiry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'investment-expiry-'))
    let clock = new Date(at)
    const service = createInvestmentService({ root, now: () => clock }), i = input(), d = draft(i)
    d.theses[0]!.observationDays = 1
    try {
      await service.publish(i, d, provenance)
      clock = new Date('2026-10-16T12:00:00Z')
      const rows = await service.revalidate(buildMarketIntelligence(snapshot(clock, 95), clock))
      expect(rows[0]).toMatchObject({ status: 'EXPIRED', reason: expect.stringContaining('观察期限结束') })
      expect(rows[0]!.rows.every(r => r.result === 'unknown')).toBe(true)
      expect((await service.report()).quality).toMatchObject({ expired: 1, meanDurationDays: 1 })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('uses a newly completed day for support and explicit terminal resolution, never the old close reread later', async () => {
    const root = await mkdtemp(join(tmpdir(), 'investment-resolution-'))
    let clock = new Date(at)
    const service = createInvestmentService({ root, now: () => clock }), i = input(), d = draft(i)
    const closeId = i.market.evidence.find(e => e.metric === 'daily-close')!.id
    d.theses[0]!.resolutionConditions = [{ metric: 'daily-close', operator: 'gte', threshold: 120, thresholdEvidenceId: closeId, description: '未来新收盘达到原观察价位' }]
    try {
      await service.publish(i, d, provenance)
      clock = new Date('2026-10-14T12:15:00Z')
      const reread = { ...i.market, snapshotId: 'same-old-bars-new-scan', retrievedAt: clock.toISOString(), evidence: i.market.evidence.map(e => ({ ...e, retrievedAt: clock.toISOString() })) }
      const unchanged = await service.revalidate(reread)
      expect(unchanged[0]!.status).toBe('CHALLENGED')
      expect((await service.report()).evaluations).toHaveLength(1)
      clock = new Date('2026-10-15T12:00:00Z')
      expect((await service.revalidate(buildMarketIntelligence(snapshot(clock, 115), clock)))[0]!.status).toBe('STRENGTHENING')
      clock = new Date('2026-10-16T12:00:00Z')
      expect((await service.revalidate(buildMarketIntelligence(snapshot(clock, 120), clock)))[0]!.status).toBe('RESOLVED')
      clock = new Date('2026-10-17T12:00:00Z')
      await service.revalidate(buildMarketIntelligence(snapshot(clock, 95), clock))
      expect((await service.report()).theses[0]!.status).toBe('RESOLVED')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('keeps future or missing-time objective indicators unknown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'investment-time-'))
    let clock = new Date(at)
    const service = createInvestmentService({ root, now: () => clock }), i = input()
    try {
      await service.publish(i, draft(i), provenance)
      clock = new Date('2026-10-15T12:00:00Z')
      const market = buildMarketIntelligence(snapshot(clock, 95), clock)
      market.evidence.find(e => e.metric === 'daily-close')!.dataAsOf = '2026-10-16T00:00:00Z'
      expect((await service.revalidate(market))[0]!.status).toBe('CHALLENGED')
      market.evidence.find(e => e.metric === 'daily-close')!.dataAsOf = null
      expect((await service.revalidate(market))[0]!.rows.every(r => r.result === 'unknown')).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('attributes changed report and paragraph references even when paragraph values are null', async () => {
    const root = await mkdtemp(join(tmpdir(), 'investment-report-change-'))
    let clock = new Date(at)
    const service = createInvestmentService({ root, now: () => clock }), initial = input()
    initial.research.evidence[0]!.value = null
    initial.market.evidence.find(e => e.metric === 'trend.medium')!.value = 'bullish'
    try {
      const first = await service.publish(initial, draft(initial), provenance)
      const oldId = initial.research.evidence[0]!.id
      clock = new Date('2026-10-15T12:00:00Z')
      const current = JSON.parse(JSON.stringify(initial).replaceAll(oldId, 'report:cost-basis-2')) as InvestmentInput & { research: ResearchSnapshot }
      current.market = buildMarketIntelligence(snapshot(clock), clock)
      current.market.evidence.find(e => e.metric === 'trend.medium')!.value = 'bullish'
      current.research.id = 'research-2'; current.research.reportId = 'report-2'
      current.research.recordHash = 'research-hash-2'; current.research.evidence[0]!.reportId = 'report-2'
      current.research.evidence[0]!.value = null
      const proposal = draft(current)
      proposal.outlooks[1]!.direction = 'conditional-bullish'
      const second = await service.publish(current, proposal, provenance)
      const change = second.snapshot.changes[0]!
      expect(change.explanation).toContain('引用报告更新 Glassnode：report-1 → report-2')
      expect(change.evidenceIds).toEqual(expect.arrayContaining([oldId, 'report:cost-basis-2']))
      expect(second.snapshot.evidence.some(e => e.id === oldId)).toBe(true)
      expect(second.snapshot.guardWarnings.join(' ')).not.toContain('方向调整，但引用指标值没有')
      expect((await service.report()).history.find(s => s.id === first.snapshot.id)!.changes).toEqual([])
      clock = new Date('2026-10-16T12:00:00Z')
      const newParagraph = JSON.parse(JSON.stringify(current).replaceAll('report:cost-basis-2', 'report:cost-basis-3')) as InvestmentInput & { research: ResearchSnapshot }
      newParagraph.research.id = 'research-3'; newParagraph.research.recordHash = 'research-hash-3'
      const revised = draft(newParagraph); revised.outlooks[1]!.direction = 'bearish'
      const third = await service.publish(newParagraph, revised, provenance)
      expect(third.snapshot.changes[0]!.explanation).toContain('同一报告新增引用段落 Glassnode/report-2')
      expect(third.snapshot.changes[0]!.evidenceIds).toEqual(expect.arrayContaining(['report:cost-basis-2', 'report:cost-basis-3']))
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('keeps v1/v2 archive bytes and hashes readable while publishing separate v3 synthesis', async () => {
    const root = await mkdtemp(join(tmpdir(), 'investment-version-'))
    const service = createInvestmentService({ root, now: () => at }), i = input(), d = draft(i)
    try {
      const first = await service.publish(i, d, provenance)
      const oldHash = createHash('sha256').update(JSON.stringify({ version: 1, marketSnapshotId: i.market.snapshotId, researchSnapshotId: i.research.id, researchHash: i.research.recordHash })).digest('hex')
      expect(investmentInputHash(i)).not.toBe(oldHash)
      const legacy = { ...first.snapshot, id: `investment-${oldHash}`, inputHash: oldHash, analysisVersion: 'investment-intelligence-v1' as const, summary: d.summary }
      legacy.recordHash = intelligenceRecordHash(legacy)
      const legacyFile = join(root, 'publications', `${legacy.id}.json`), bytes = JSON.stringify(legacy)
      await writeFile(legacyFile, bytes)
      const v2Hash = createHash('sha256').update(JSON.stringify({ analysisVersion: 'investment-intelligence-v2', marketSnapshotId: i.market.snapshotId, researchSnapshotId: i.research.id, researchHash: i.research.recordHash })).digest('hex')
      const v2 = { ...legacy, id: `investment-${v2Hash}`, inputHash: v2Hash, analysisVersion: 'investment-intelligence-v2' as const }
      v2.recordHash = intelligenceRecordHash(v2)
      const v2File = join(root, 'publications', `${v2.id}.json`), v2Bytes = JSON.stringify(v2)
      await writeFile(v2File, v2Bytes)
      await rm(join(root, 'publications', `${first.snapshot.id}.json`))
      const upgraded = await service.publish(i, d, provenance)
      expect(upgraded.stored).toBe(true)
      expect(upgraded.snapshot.analysisVersion).toBe(INVESTMENT_ANALYSIS_VERSION)
      expect(upgraded.snapshot.rawDraft).toEqual(d)
      expect((await service.report()).history.map(r => r.analysisVersion)).toEqual(expect.arrayContaining(['investment-intelligence-v1', 'investment-intelligence-v2', 'investment-intelligence-v3']))
      expect(await readFile(legacyFile, 'utf8')).toBe(bytes)
      expect(await readFile(v2File, 'utf8')).toBe(v2Bytes)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('atomically preserves a competing initial record and verifies hashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'investment-store-'))
    try {
      const service = createInvestmentService({ root, now: () => at }), i = input()
      const first = await service.publish(i, draft(i), provenance)
      const store = createInvestmentStore(root)
      expect((await store.save('publications', first.snapshot)).stored).toBe(false)
      await expect(store.save('publications', { ...first.snapshot, recordHash: 'bad' })).rejects.toThrow('hash')
      await expect(store.read('publications', '../x')).rejects.toThrow('identity')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})


describe('equity investment isolation and conservative synthesis', () => {
  const equity = (asset: 'TSLA' | 'MSTR') => {
    const original = input(), d = draft(original)
    const market = structuredClone(original.market)
    market.asset = asset
    market.evidence.forEach(e => { e.asset = asset })
    const daily = market.evidence.find(e => e.metric === 'daily-close')!
    const oldReportId = original.research.evidence[0]!.id
    const remapped = JSON.parse(JSON.stringify(d).replaceAll(oldReportId, daily.id)) as InvestmentDraft
    remapped.priceMap.forEach(p => { p.price = market.price!; p.role = 'reference' })
    remapped.theses.forEach(t => [...t.supportConditions, ...t.invalidationConditions].forEach(c => { c.threshold = market.price! }))
    remapped.crossValidation = market.horizons.map(h => {
      const ref = market.evidence.find(e => e.metric === `trend.${h.horizon}`)!
      ref.value = 'bullish'; h.direction = 'bullish'
      return { horizon: h.horizon, claim: { ...remapped.summary, evidenceIds: [ref.id, daily.id] }, marketEvidenceIds: [ref.id, daily.id], researchEvidenceIds: [], status: 'CONFIRMED', explanation: 'Price evidence only, no independent confirmation.' }
    })
    remapped.outlooks.forEach(o => { o.direction = 'bullish' })
    return { i: { market, research: null } as InvestmentInput, d: remapped }
  }
  it.each(['TSLA', 'MSTR'] as const)('allows %s price evidence without inventing a BTC report or independent confirmation', asset => {
    const { i, d } = equity(asset), guarded = guardInvestmentDraft(i, d, at)
    expect(guarded.draft.crossValidation.every(r => r.status === 'PARTIALLY_CONFIRMED')).toBe(true)
    expect(guarded.draft.outlooks.every(o => o.direction === 'conditional-bullish')).toBe(true)
    expect(guarded.evidence.every(e => e.asset === asset)).toBe(true)
    i.research = input().research
    expect(() => guardInvestmentDraft(i, d, at)).toThrow('不匹配')
  })
  it('rejects cross-asset evidence and feedback and keeps stock publication identities separate', async () => {
    const a = equity('TSLA'), b = equity('MSTR')
    expect(investmentInputHash(a.i)).not.toBe(investmentInputHash(b.i))
    a.i.market.evidence[0]!.asset = 'MSTR'
    expect(() => guardInvestmentDraft(a.i, a.d, at)).toThrow('跨标的')
    a.i.market.evidence[0]!.asset = 'TSLA'
    a.i.researchFeedback = { protocol: 'equity-research-loop-v1', asset: 'MSTR', hash: 'a'.repeat(64), asOf: at.toISOString(), records: [], jev: null, evidence: [] }
    expect(() => guardInvestmentDraft(a.i, a.d, at)).toThrow('来源或时序')
    delete a.i.researchFeedback
    const root = await mkdtemp(join(tmpdir(), 'equity-investment-'))
    try {
      const service = createInvestmentService({ asset: 'TSLA', root, now: () => at })
      const result = await service.publish(a.i, a.d, provenance)
      expect(result.snapshot).toMatchObject({ asset: 'TSLA', analysisVersion: 'investment-intelligence-equity-v1', researchSnapshotId: null })
      await expect(service.publish(b.i, b.d, provenance)).rejects.toThrow('不匹配')
      await expect(service.revalidate(b.i.market)).rejects.toThrow()
      expect((await service.report()).latest?.asset).toBe('TSLA')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('cannot turn an equity market capitalization into a price threshold', () => {
    const { i, d } = equity('TSLA')
    i.market.evidence.push({ ...i.market.evidence[0]!, id: 'market-cap', metric: 'equity.market-cap', value: 100000000, unit: 'USD' })
    d.priceMap[0] = { label: d.priceMap[0]!.label, price: 100000000, unit: 'USD', role: 'support', evidenceIds: ['market-cap'] }
    expect(() => guardInvestmentDraft(i, d, at)).toThrow('真实数值')
  })
  it('requires a genuinely later completed equity session for thesis checks', async () => {
    const { i, d } = equity('TSLA'), root = await mkdtemp(join(tmpdir(), 'equity-thesis-'))
    try {
      const service = createInvestmentService({ asset: 'TSLA', root, now: () => at })
      await service.publish(i, d, provenance)
      const thesis = (await service.report()).theses[0]!
      thesis.createdAt = '2026-10-14T23:00:00Z'
      thesis.expiresAt = '2026-10-21T23:00:00Z'
      const market = structuredClone(i.market), daily = market.evidence.find(e => e.metric === 'daily-close')!
      Object.assign(daily, { dataAsOf: '2026-10-14T00:00:00Z', retrievedAt: '2026-10-14T23:30:00Z', value: 121 })
      const same = evaluateInvestmentThesis(thesis, market, null, new Date('2026-10-14T23:30:00Z'))
      expect(same.rows.every(r => r.result === 'unknown')).toBe(true)
      Object.assign(daily, { dataAsOf: '2026-10-15T00:00:00Z', retrievedAt: '2026-10-15T23:30:00Z' })
      const next = evaluateInvestmentThesis(thesis, market, same, new Date('2026-10-15T23:30:00Z'))
      expect(next.status).toBe('STRENGTHENING')
      expect(next.rows.some(r => r.kind === 'support' && r.result === 'met')).toBe(true)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('uses exchange-aware bar freshness on weekends while event context still expires after 24 hours', () => {
    const { i } = equity('TSLA'), ref = i.market.evidence.find(e => e.metric === 'daily-close')!
    const friday = '2026-10-16T00:00:00Z', sunday = new Date('2026-10-18T18:00:00Z')
    Object.assign(ref, { dataAsOf: friday, retrievedAt: '2026-10-16T21:00:00Z', quality: 'available' })
    expect(evidenceAvailability(ref, sunday)).toBe('available')
    expect(evidenceAvailability({ ...ref, metric: 'equity.next-earnings' }, sunday)).toBe('outdated')
    expect(evidenceAvailability(ref, new Date('2026-10-22T18:00:00Z'))).toBe('outdated')
  })
})
