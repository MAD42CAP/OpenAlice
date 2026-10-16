import type { MonitorAsset } from '../../api/market-monitor'
import type { MarketIntelligenceReport } from '../../api/market-intelligence'
import { INVESTMENT_ANALYSIS_VERSION, RESEARCH_ANALYSIS_VERSION, RESEARCH_SECTION_KEYS, type EvidenceReference, type IntelligenceClaim, type InvestmentSnapshot, type ResearchSnapshot } from '../../api/market-intelligence-types'
import { demoResearchLoop } from './research-loop'

/** Entirely invented, visibly illustrative research. No Glassnode article text is included. */
export function demoMarketIntelligence(asset: MonitorAsset = 'BTC'): MarketIntelligenceReport {
  if (asset !== 'BTC') return demoEquityIntelligence(asset)
  const now = '2026-10-14T18:10:00Z'
  const retrievedAt = '2026-10-14T18:00:00Z'
  const evidence: EvidenceReference[] = [
    { id: 'demo-market-close', asset: 'BTC', sourceName: 'Illustrative completed daily bars', sourceUrl: null, metric: 'daily-close', value: 68000, unit: 'USD', dataAsOf: '2026-10-14T00:00:00Z', publishedAt: null, retrievedAt, quality: 'available', reportId: null, kind: 'observation' },
    { id: 'demo-report-cost', asset: 'BTC', sourceName: 'Illustrative research fixture', sourceUrl: 'https://research.glassnode.com/', metric: 'illustrative cost area', value: 65000, unit: 'USD', dataAsOf: '2026-10-12T00:00:00Z', publishedAt: '2026-10-13T12:00:00Z', retrievedAt, quality: 'available', reportId: 'demo-report-2', kind: 'observation' },
    { id: 'demo-previous-demand', asset: 'BTC', sourceName: 'Previous illustrative research', sourceUrl: 'https://research.glassnode.com/', metric: 'demand description', value: 'limited', unit: null, dataAsOf: '2026-10-05T00:00:00Z', publishedAt: '2026-10-06T12:00:00Z', retrievedAt: '2026-10-07T12:00:00Z', quality: 'available', reportId: 'demo-report-1', kind: 'interpretation' },
  ]
  const claim = (text: string, ids = ['demo-market-close', 'demo-report-cost'], inference = true): IntelligenceClaim => ({ text, evidenceIds: ids, inference })
  const research: ResearchSnapshot = {
    schemaVersion: 1, id: 'demo-research-2', asset: 'BTC', reportId: 'demo-report-2', reportUrl: 'https://research.glassnode.com/', reportTitle: '演示周报 · 成本支撑与需求分歧（虚构示例）', publicationTime: '2026-10-13T12:00:00Z', reportPeriod: 'Illustrative week 2', reportHash: 'illustrative-content-2', previousSnapshotId: 'demo-research-1', analysisVersion: RESEARCH_ANALYSIS_VERSION, analysisTime: '2026-10-14T18:02:00Z', analysisModel: 'Illustrative model', revision: 1, provenance: { workspaceId: 'demo', runId: 'demo-run', issueId: 'demo-issue', agent: 'Illustrative' }, recordHash: 'illustrative-research',
    dataAsOf: '2026-10-12T00:00:00Z', mainThesis: claim('演示：成本附近存在承接线索，需求是否持续仍需观察。', ['demo-report-cost']),
    sections: Object.fromEntries(RESEARCH_SECTION_KEYS.map(key => [key, [claim('演示研究观点：已有证据有限，不能直接推出价格即将上涨。', ['demo-report-cost'])]])) as ResearchSnapshot['sections'],
    metrics: [{ name: '演示成本区域', value: 65000, unit: 'USD', dataAsOf: '2026-10-12T00:00:00Z', kind: 'observation', evidenceIds: ['demo-report-cost'], meaning: claim('虚构数值，仅展示指标来源与时间。', ['demo-report-cost']), change: null }], keyPriceLevels: [{ label: '演示成本区域', price: 65000, unit: 'USD', role: 'cost-basis', dataAsOf: '2026-10-12T00:00:00Z', evidenceIds: ['demo-report-cost'] }], bullishEvidence: [claim('演示成本承接。', ['demo-report-cost'])], bearishEvidence: [], uncertainties: [claim('需求数据缺失。', [], true)], limitations: [claim('演示报告不代表 Glassnode 的实际结论。', [], true)], weeklyChanges: [{ topic: '演示需求变化', text: '两期演示材料都未能确认持续需求。', currentEvidenceIds: ['demo-report-cost'], previousEvidenceIds: ['demo-previous-demand'], inference: true }], evidence: evidence.filter(row => row.reportId !== null),
  }
  for (const [h, lower, upper] of [['short', 65000, 70000], ['medium', 60000, 72000], ['long', 55000, 80000]] as const) {
    for (const [kind, value] of [['support', lower], ['resistance', upper]] as const) evidence.push({ ...evidence[0], id: `demo-${kind}-${h}`, metric: `${kind}.${h}`, value })
  }
  const previous: ResearchSnapshot = { ...research, id: 'demo-research-1', reportId: 'demo-report-1', reportTitle: '演示上期周报（虚构示例）', publicationTime: '2026-10-06T12:00:00Z', analysisTime: '2026-10-07T12:00:00Z', dataAsOf: '2026-10-05T00:00:00Z', previousSnapshotId: null, metrics: [], keyPriceLevels: [], sections: Object.fromEntries(RESEARCH_SECTION_KEYS.map(key => [key, [claim('演示上期观点：需求尚弱。', ['demo-previous-demand'])]])) as ResearchSnapshot['sections'], bullishEvidence: [], bearishEvidence: [], uncertainties: [], limitations: [], weeklyChanges: [], evidence: [evidence[2]], mainThesis: claim('演示上期观点：需求尚弱。', ['demo-previous-demand']) }
  const investment: InvestmentSnapshot = {
    schemaVersion: 1, id: 'demo-investment-2', asset: 'BTC', analysisVersion: INVESTMENT_ANALYSIS_VERSION, analysisTime: now, marketSnapshotId: 'demo-scan', researchSnapshotId: research.id, inputHash: 'illustrative-input', previousSnapshotId: 'demo-investment-1', provenance: research.provenance, analysisModel: 'Illustrative model', evidence, guardWarnings: ['演示：ETF 与流动性数据不可用。'], changes: [{ horizon: 'medium', previous: 'neutral', current: 'conditional-bullish', evidenceIds: ['demo-market-close', 'demo-report-cost'], explanation: '演示：价格重新接近成本区，但需求确认仍缺失。' }], recordHash: 'illustrative-investment',
    summary: claim('演示：短期仍有压力，中期修复需要价格与需求共同确认。'),
    crossValidation: [{ claim: claim('演示：价格行为与成本支撑信号仍有分歧。'), marketEvidenceIds: ['demo-market-close'], researchEvidenceIds: ['demo-report-cost'], status: 'CONFLICTING', explanation: '演示成本证据不能替代价格突破确认。' }],
    outlooks: (['short', 'medium', 'long'] as const).map((horizon, index) => ({ horizon, direction: (['conditional-bearish', 'neutral', 'conditional-bullish'] as const)[index], conclusion: claim('演示条件性判断，等待后续证据。'), structure: claim('演示区间结构。'), supportingEvidence: [claim('成本区域提供参考。')], opposingEvidence: [claim('需求确认仍不足。')], risks: [claim('缺少 ETF 资金流。', [])], confirmation: [claim('日线重新站稳演示压力区。')], invalidation: [claim('日线跌破演示成本区。')], priceLevelLabels: ['演示成本区域'] })),
    scenarios: (['bullish', 'neutral', 'bearish'] as const).map(kind => ({ kind, hypothesis: claim(`演示 ${kind} 条件情景。`), conditions: [claim('需观察价格与成交量是否持续。')], confirmation: [claim('需要已收盘价格确认。')], path: claim('仅描述可能路径，不附主观精确概率。'), invalidation: [claim('预定条件未能维持。')], supportingEvidence: [claim('演示来源。')], opposingEvidence: [claim('仍有缺失数据。', [])], priceLevelLabels: ['演示成本区域'] })),
    priceMap: [{ label: '演示成本区域', price: 65000, unit: 'USD', role: 'cost-basis', evidenceIds: ['demo-report-cost'] }], theses: [], limitations: [claim('虚构示例，不可用于投资决策。', [])], rawDraft: null as unknown as InvestmentSnapshot['rawDraft'],
  }
  for (const outlook of investment.outlooks) {
    if (outlook.horizon === 'medium') continue
    const bearish = outlook.direction === 'conditional-bearish'
    const confirmationRef = evidence.find(e => e.metric === `${bearish ? 'support' : 'resistance'}.${outlook.horizon}`)!
    const invalidationRef = evidence.find(e => e.metric === `${bearish ? 'resistance' : 'support'}.${outlook.horizon}`)!
    outlook.decisionConditions = { confirmation: { metric: 'daily-close', operator: bearish ? 'lt' : 'gt', threshold: Number(confirmationRef.value), thresholdEvidenceId: confirmationRef.id, description: 'Illustrative future close boundary' }, invalidation: { metric: 'daily-close', operator: bearish ? 'gt' : 'lt', threshold: Number(invalidationRef.value), thresholdEvidenceId: invalidationRef.id, description: 'Illustrative future invalidation boundary' } }
    outlook.confirmation = [claim(`未来新完成日线收盘${bearish ? '低于' : '高于'} $${confirmationRef.value}。`, [confirmationRef.id])]
    outlook.invalidation = [claim(`未来新完成日线收盘${bearish ? '高于' : '低于'} $${invalidationRef.value}。`, [invalidationRef.id])]
  }
  investment.rawDraft = { summary: investment.summary, crossValidation: investment.crossValidation, outlooks: investment.outlooks, scenarios: investment.scenarios, priceMap: investment.priceMap, theses: [], limitations: investment.limitations }
  const feedback = demoResearchLoop()
  investment.researchFeedback = { protocol: feedback.protocol, contextHash: feedback.context.hash, reviewedIds: feedback.context.evidence.map(row => row.id), effect: 'caution', explanation: '演示：研究样本仍少，保留原有确认条件，不提升方向强度。' }
  const older: InvestmentSnapshot = { ...investment, id: 'demo-investment-1', analysisVersion: 'investment-intelligence-v2', researchFeedback: undefined, analysisTime: '2026-10-14T18:05:00Z', marketSnapshotId: 'demo-earlier-scan', previousSnapshotId: null, summary: claim('演示前次综合观点：中性观察。'), changes: [] }
  const objective = { metric: 'daily-close' as const, operator: 'lt' as const, threshold: 65000, thresholdEvidenceId: 'demo-report-cost', description: '演示成本下方的已收盘日线' }
  return {
    asset: 'BTC', generatedAt: now, illustrative: true,
    market: { schemaVersion: 1, id: 'demo-market-2', asset: 'BTC', snapshotId: 'demo-scan', analysisTime: now, retrievedAt: now, marketDataAsOf: '2026-10-14T00:00:00Z', hourlyDataAsOf: null, price: 68000, volume: null, priceKind: 'completed-daily-close', daily: [], hourly: [], horizons: [], wyckoffHypothesis: null, bullishEvidence: [], bearishEvidence: [], evidence: [evidence[0]], dataSources: [], dataQuality: 'partial', missingData: ['ETF flow unavailable'], limitations: ['Illustrative only'] },
    research: { reports: [research, previous].map(row => ({ schemaVersion: 1, id: row.reportId, asset: 'BTC', sourceName: 'Glassnode', url: row.reportUrl, title: row.reportTitle, publishedAt: row.publicationTime, retrievedAt: row.analysisTime, reportPeriod: row.reportPeriod, contentHash: row.reportHash, paragraphCount: 2, preview: 'Illustrative original fixture, no third-party article text.', origin: 'manual' })), snapshots: [research, previous], latest: research, status: { state: 'current', lastCheckedAt: now, nextCheckAt: '2026-10-15T18:10:00Z', lastError: null, latestReportId: research.reportId, pendingReportIds: [] } },
    investment: { schemaVersion: 1, generatedAt: now, asOf: now, latest: investment, history: [investment, older], theses: [{ ...{ key: 'demo-cost', title: '演示中期成本假设', claim: claim('演示成本附近的承接仍待观察。'), horizon: 'medium' as const, observationDays: 28, supportConditions: [], invalidationConditions: [objective], resolutionConditions: [] }, id: 'demo-thesis-1', revision: 1, createdAt: now, expiresAt: '2026-11-11T18:10:00Z', investmentSnapshotId: investment.id, evidence, recordHash: 'illustrative-thesis', status: 'ACTIVE', latestEvaluation: null }], evaluations: [], quality: { total: 1, active: 1, resolved: 0, invalidated: 0, expired: 0, unresolved: 1, conditionDefined: 1, stateChanges: 0, meanDurationDays: null, directionalAccuracy: null, note: 'Illustrative checks are not directional forecast accuracy.' } },
    job: { state: 'success', message: 'Illustrative native task completed; no real AI call.', updatedAt: now, runId: 'demo-run' },
  }
}

/** Stock fixtures have their own identities and no fabricated on-chain report. */
function demoEquityIntelligence(asset: 'TSLA' | 'MSTR'): MarketIntelligenceReport {
  const now = '2026-10-15T18:10:00Z', closed = '2026-10-14T20:00:00Z'
  const prefix = `demo-${asset.toLowerCase()}`, price = asset === 'TSLA' ? 485 : 315
  const feedback = demoResearchLoop('ready', asset)
  const daily: EvidenceReference = { id: `${prefix}-close`, asset, sourceName: 'Illustrative completed equity session', sourceUrl: null, metric: 'daily-close', value: price, unit: 'USD', dataAsOf: closed, publishedAt: null, retrievedAt: now, quality: 'available', reportId: null, kind: 'observation' }
  const claim = (text: string, ids = [daily.id]): IntelligenceClaim => ({ text, evidenceIds: ids, inference: true })
  const summary = claim(`演示 ${asset}：保持条件性观察，公司事件及后续收盘确认仍待验证。`)
  const draft: InvestmentSnapshot['rawDraft'] = {
    summary, crossValidation: [{ claim: claim('演示：价格结构可用，公司事件证据仍不足。'), marketEvidenceIds: [daily.id], researchEvidenceIds: [], status: 'PARTIALLY_CONFIRMED', explanation: '演示研究仅作背景，不视为独立方向确认。' }],
    outlooks: (['short', 'medium', 'long'] as const).map(horizon => ({ horizon, direction: 'uncertain', conclusion: claim(`演示 ${asset}：等待该周期的价格与事件证据。`), structure: claim('演示：区间仍需确认。'), supportingEvidence: [], opposingEvidence: [], risks: [claim('演示：财报时间尚未核验。', [])], confirmation: [claim('演示：等待后续收盘确认。')], invalidation: [claim('演示：突破未能维持。')], priceLevelLabels: [] })),
    scenarios: (['bullish', 'neutral', 'bearish'] as const).map(kind => ({ kind, hypothesis: claim(`演示 ${kind} 条件情景。`), conditions: [claim('演示：关注后续已收盘交易日。')], confirmation: [claim('演示：需要价格结构确认。')], path: claim('演示：条件情景不附精确概率。'), invalidation: [claim('演示：预设结构未能维持。')], supportingEvidence: [], opposingEvidence: [], priceLevelLabels: [] })),
    priceMap: [], theses: [], limitations: [claim('虚构示例，不能证明预测准确率。', [])],
    feedbackReview: { reviewedIds: feedback.context.evidence.map(row => row.id), effect: 'caution', explanation: '演示：已审阅三项研究反馈，保留证据限制。' },
  }
  const investment: InvestmentSnapshot = { ...draft, schemaVersion: 1, id: `${prefix}-investment-2`, asset, analysisVersion: 'investment-intelligence-equity-v2', analysisTime: now, marketSnapshotId: `${prefix}-scan`, researchSnapshotId: null, inputHash: `${prefix}-input`, previousSnapshotId: null, provenance: { workspaceId: 'demo-chat', runId: `${prefix}-synthesis`, issueId: `${prefix}-intelligence`, agent: 'Illustrative' }, analysisModel: 'Illustrative model', evidence: [daily, ...feedback.context.evidence], rawDraft: draft, guardWarnings: [], changes: [], recordHash: `${prefix}-investment-hash`, researchFeedback: { protocol: feedback.protocol, contextHash: feedback.context.hash, ...draft.feedbackReview! } }
  return {
    asset, generatedAt: now, illustrative: true,
    market: { schemaVersion: 1, id: `${prefix}-market`, asset, snapshotId: `${prefix}-scan`, analysisTime: now, retrievedAt: now, marketDataAsOf: closed, hourlyDataAsOf: null, price, volume: null, priceKind: 'completed-daily-close', daily: [], hourly: [], horizons: [], wyckoffHypothesis: null, bullishEvidence: [], bearishEvidence: [], evidence: [daily], dataSources: [], dataQuality: 'partial', missingData: ['Company-event timing unverified'], limitations: ['Illustrative only'] },
    research: { reports: [], snapshots: [], latest: null, status: { state: 'never-checked', lastCheckedAt: null, nextCheckAt: null, lastError: null, latestReportId: null, pendingReportIds: [] } },
    investment: { schemaVersion: 1, generatedAt: now, asOf: now, latest: investment, history: [investment], theses: [], evaluations: [], quality: { total: 0, active: 0, resolved: 0, invalidated: 0, expired: 0, unresolved: 0, conditionDefined: 0, stateChanges: 0, meanDurationDays: null, directionalAccuracy: null, note: 'Illustrative judgments are not measured forecast accuracy.' } },
    job: { state: 'success', message: `Illustrative ${asset} native synthesis; no real AI call.`, updatedAt: now, runId: `${prefix}-synthesis` },
  }
}
