import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMarketIntelligence } from './intelligence-market.js'
import { guardInvestmentDraft } from './investment.js'
import { createInvestmentService } from './investment-service.js'
import { createInvestmentStore } from './investment-store.js'
import { evidenceChainV1Strategy } from './strategy.js'
import type { MarketMonitorSnapshot } from './types.js'
import type { InvestmentDraft, InvestmentInput } from './investment-types.js'
import { RESEARCH_SECTION_KEYS, type ResearchSnapshot } from './research-types.js'

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
function input(): InvestmentInput {
  const market = buildMarketIntelligence(snapshot(), at)
  const researchId = 'report:cost-basis'
  const claim = { text: '报告认为供应压力缓解，仍须等待需求确认。', evidenceIds: [researchId], inference: false }
  const research: ResearchSnapshot = { schemaVersion: 1, id: 'research-1', asset: 'BTC', reportId: 'report-1', reportUrl: 'https://research.glassnode.com/fixture/', reportTitle: 'Weekly research', publicationTime: '2026-10-13T10:00:00Z', reportPeriod: '2026-W41', reportHash: 'source-hash', previousSnapshotId: null, analysisVersion: 'glassnode-research-v1', analysisTime: '2026-10-13T12:00:00Z', analysisModel: 'configured', revision: 1, provenance, dataAsOf: '2026-10-12T00:00:00Z', mainThesis: claim,
    sections: Object.fromEntries(RESEARCH_SECTION_KEYS.map(k => [k, [claim]])) as ResearchSnapshot['sections'], metrics: [], keyPriceLevels: [{ label: '成本线', price: 100, unit: 'USD', role: 'cost-basis', dataAsOf: '2026-10-12T00:00:00Z', evidenceIds: [researchId] }], bullishEvidence: [claim], bearishEvidence: [], uncertainties: [claim], limitations: [claim], weeklyChanges: [], recordHash: 'research-hash', evidence: [{ id: researchId, asset: 'BTC', sourceName: 'Glassnode', sourceUrl: 'https://research.glassnode.com/fixture/', metric: 'source-paragraph', value: 'Cost basis $100', unit: null, dataAsOf: '2026-10-12T00:00:00Z', publishedAt: '2026-10-13T10:00:00Z', retrievedAt: '2026-10-13T11:00:00Z', quality: 'available', reportId: 'report-1', kind: 'observation' }] }
  return { market, research }
}
function draft(i: InvestmentInput): InvestmentDraft {
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
  it('projects actual closed bars, separate source times, hypothesis-only Wyckoff and missing data', () => {
    const s = snapshot(), market = buildMarketIntelligence(s, at)
    expect(market.snapshotId).toBe(s.id)
    expect(market.price).toBe(120)
    expect(market.marketDataAsOf).not.toBe(market.hourlyDataAsOf)
    expect(market.evidence.find(e => e.metric === 'daily-close')).toMatchObject({ value: 120, sourceName: 'coinbase', retrievedAt: at.toISOString() })
    expect(market.missingData.join(' ')).toContain('ETF')
    expect(market.wyckoffHypothesis?.confirmed).toBe(false)
    expect(market.horizons.map(h => h.direction)).toEqual(['short', 'medium', 'long'].map(h => s.trend![h as 'short'].direction))
    expect(() => buildMarketIntelligence({ ...s, asset: 'TSLA' }, at)).toThrow('BTC')
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
    expect(guardInvestmentDraft(i, d, at).draft.crossValidation[0]!.status).toBe('CONFIRMED')
    i.research.dataAsOf = '2026-09-01T00:00:00Z'
    const result = guardInvestmentDraft(i, d, at)
    expect(result.draft.crossValidation[0]!.status).toBe('CONFIRMED')
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
  it('retains a fresh opposing direction cited only by the claim as a conflict', () => {
    const i = input(), d = draft(i)
    i.market.evidence.find(e => e.metric === 'trend.medium')!.value = 'bullish'
    const opposing = i.market.evidence.find(e => e.metric === 'trend.short')!
    opposing.value = 'bearish'
    d.crossValidation[0]!.claim.evidenceIds.push(opposing.id)
    const result = guardInvestmentDraft(i, d, at)
    expect(result.draft.crossValidation[0]!.status).toBe('CONFLICTING')
    expect(d.crossValidation[0]!.status).toBe('CONFIRMED')
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
    try {
      const first = await service.publish(initial, draft(initial), provenance)
      const oldId = initial.research.evidence[0]!.id
      clock = new Date('2026-10-15T12:00:00Z')
      const current = JSON.parse(JSON.stringify(initial).replaceAll(oldId, 'report:cost-basis-2')) as InvestmentInput
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
      const newParagraph = JSON.parse(JSON.stringify(current).replaceAll('report:cost-basis-2', 'report:cost-basis-3')) as InvestmentInput
      newParagraph.research.id = 'research-3'; newParagraph.research.recordHash = 'research-hash-3'
      const revised = draft(newParagraph); revised.outlooks[1]!.direction = 'bullish'
      const third = await service.publish(newParagraph, revised, provenance)
      expect(third.snapshot.changes[0]!.explanation).toContain('同一报告新增引用段落 Glassnode/report-2')
      expect(third.snapshot.changes[0]!.evidenceIds).toEqual(expect.arrayContaining(['report:cost-basis-2', 'report:cost-basis-3']))
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
