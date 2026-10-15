import { createHash } from 'node:crypto'
import Decimal from 'decimal.js'
import { z } from 'zod'
import type { EvidenceReference } from './intelligence-types.js'
import { INVESTMENT_ANALYSIS_VERSION } from './investment-types.js'
import type { InvestmentDirection, InvestmentDraft, InvestmentInput, InvestmentSnapshot, InvestmentThesis, InvestmentThesisEvaluation, InvestmentThesisStatus, ValidationStatus } from './investment-types.js'
import { RESEARCH_LOOP_PROTOCOL } from './research-loop-types.js'

const claim = z.object({ text: z.string().min(1).max(2400), evidenceIds: z.array(z.string().min(1)).min(1).max(24), inference: z.boolean() }).strict()
const horizon = z.enum(['short', 'medium', 'long'])
const direction = z.enum(['bullish', 'neutral', 'bearish', 'conditional-bullish', 'conditional-bearish', 'uncertain'])
const condition = z.object({ metric: z.enum(['daily-close', 'daily-change-percent', 'volume-ratio']), operator: z.enum(['gt', 'gte', 'lt', 'lte']), threshold: z.number().finite(), thresholdEvidenceId: z.string().nullable(), description: z.string().min(1).max(600) }).strict()
export const investmentDraftSchema = z.object({
  feedbackReview: z.object({ reviewedIds: z.array(z.string().min(1)).max(40), effect: z.enum(['context-only', 'caution', 'conflict']), explanation: z.string().min(1).max(900) }).strict().optional(),
  summary: claim,
  crossValidation: z.array(z.object({ horizon: horizon.optional(), claim, marketEvidenceIds: z.array(z.string()).min(1).max(24), researchEvidenceIds: z.array(z.string()).min(1).max(24), status: z.enum(['CONFIRMED', 'PARTIALLY_CONFIRMED', 'CONFLICTING', 'UNVERIFIED', 'OUTDATED']), explanation: z.string().min(1).max(1800) }).strict()).min(1).max(16),
  outlooks: z.array(z.object({ horizon, direction, conclusion: claim, structure: claim, supportingEvidence: z.array(claim).max(16), opposingEvidence: z.array(claim).max(16), risks: z.array(claim).min(1).max(16), confirmation: z.array(claim).min(1).max(16), invalidation: z.array(claim).min(1).max(16), priceLevelLabels: z.array(z.string()).max(24) }).strict()).length(3),
  scenarios: z.array(z.object({ kind: z.enum(['bullish', 'neutral', 'bearish']), hypothesis: claim, conditions: z.array(claim).min(1).max(16), confirmation: z.array(claim).min(1).max(16), path: claim, invalidation: z.array(claim).min(1).max(16), supportingEvidence: z.array(claim).max(16), opposingEvidence: z.array(claim).max(16), priceLevelLabels: z.array(z.string()).max(24) }).strict()).length(3),
  priceMap: z.array(z.object({ label: z.string().min(1).max(160), price: z.number().positive().finite(), unit: z.literal('USD'), role: z.enum(['support', 'resistance', 'cost-basis', 'reference']), evidenceIds: z.array(z.string()).min(1).max(24) }).strict()).max(24),
  theses: z.array(z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), title: z.string().min(1).max(240), claim, horizon, observationDays: z.number().int().min(1).max(180), supportConditions: z.array(condition).min(1).max(12), invalidationConditions: z.array(condition).min(1).max(12), resolutionConditions: z.array(condition).max(12) }).strict()).min(1).max(12),
  limitations: z.array(claim).min(1).max(24),
}).strict()

export const intelligenceRecordHash = <T extends { recordHash: string }>(row: T) => createHash('sha256').update(JSON.stringify({ ...row, recordHash: '' })).digest('hex')
export const investmentInputHash = (input: InvestmentInput) => createHash('sha256').update(JSON.stringify({ analysisVersion: INVESTMENT_ANALYSIS_VERSION, marketSnapshotId: input.market.snapshotId, researchSnapshotId: input.research.id, researchHash: input.research.recordHash, feedbackHash: input.researchFeedback?.hash ?? null })).digest('hex')
const timestamp = (value: string | null) => value === null ? NaN : Date.parse(value)
const timely = (e: EvidenceReference, at: Date) => Number.isFinite(timestamp(e.dataAsOf)) && Number.isFinite(timestamp(e.retrievedAt)) && timestamp(e.dataAsOf) <= at.getTime() && timestamp(e.retrievedAt) <= at.getTime() && timestamp(e.dataAsOf) <= timestamp(e.retrievedAt) && (e.publishedAt === null || Number.isFinite(timestamp(e.publishedAt)) && timestamp(e.publishedAt) <= at.getTime())
export function evidenceAvailability(e: EvidenceReference, at: Date): 'available' | 'unverified' | 'outdated' {
  if (!timely(e, at) || e.quality === 'unavailable' || e.quality === 'unknown') return 'unverified'
  const ttl = e.reportId ? 14 * 86_400_000 : e.metric === 'hourly-close' ? 3 * 3_600_000 : ['funding-8h', 'open-interest', 'annualized-basis', 'option-open-interest', 'put-call-ratio'].includes(e.metric) ? 30 * 60_000 : 2 * 86_400_000
  return e.quality === 'outdated' || at.getTime() - timestamp(e.dataAsOf) > ttl ? 'outdated' : 'available'
}
/** Validate claims against supplied evidence; retain the AI proposal separately. */
export function guardInvestmentDraft(input: InvestmentInput, value: unknown, at: Date): { draft: InvestmentDraft; warnings: string[]; evidence: EvidenceReference[] } {
  const raw = investmentDraftSchema.parse(value) as InvestmentDraft
  if (new Set(raw.outlooks.map(o => o.horizon)).size !== 3 || new Set(raw.scenarios.map(s => s.kind)).size !== 3 || new Set(raw.theses.map(t => t.key)).size !== raw.theses.length || new Set(raw.priceMap.map(p => p.label)).size !== raw.priceMap.length) throw new Error('期限、情景、价格标签或观点标识重复。')
  if (!Number.isFinite(timestamp(input.market.retrievedAt)) || timestamp(input.market.retrievedAt) > at.getTime() || !Number.isFinite(timestamp(input.research.analysisTime)) || timestamp(input.research.analysisTime) > at.getTime()) throw new Error('不得使用尚未获取的市场或研究档案。')
  const feedback = input.researchFeedback
  if (feedback && (feedback.protocol !== RESEARCH_LOOP_PROTOCOL || !/^[a-f0-9]{64}$/.test(feedback.hash)
    || !Number.isFinite(timestamp(feedback.asOf)) || timestamp(feedback.asOf) > at.getTime()
    || feedback.evidence.some(e => e.kind !== 'inference' || e.reportId !== null || typeof e.value === 'number'
      || !e.metric.startsWith('research-feedback.') || !timely(e, at)))) throw new Error('研究回流上下文未通过来源或时序核验。')
  if (feedback?.evidence.length) {
    const ids = new Set(feedback.evidence.map(e => e.id)), reviewed = raw.feedbackReview?.reviewedIds ?? []
    if (!raw.feedbackReview || reviewed.length !== ids.size || new Set(reviewed).size !== reviewed.length || reviewed.some(id => !ids.has(id))) throw new Error('综合研判必须逐项审阅本次冻结的研究回流证据。')
  } else if (raw.feedbackReview?.reviewedIds.length) throw new Error('综合研判引用了本次输入之外的研究回流。')
  const evidence = [...input.market.evidence, ...input.research.evidence, ...(feedback?.evidence ?? [])]
  if (new Set(evidence.map(e => e.id)).size !== evidence.length) throw new Error('证据标识重复。')
  const byId = new Map(evidence.map(e => [e.id, e]))
  const requireIds = (ids: string[]) => { if (!ids.length || ids.some(id => !byId.has(id))) throw new Error('重要断言引用了不存在的证据。') }
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    const o = node as Record<string, unknown>
    if ('evidenceIds' in o) requireIds(o.evidenceIds as string[])
    Object.values(o).forEach(visit)
  }
  visit(raw)
  const groundedPrice = (price: number, ids: string[]) => ids.some(id => {
    const e = byId.get(id)!
    if (e.unit === 'USD' && typeof e.value === 'number' && new Decimal(e.value).eq(price) && e.kind === 'observation') return true
    return input.research.keyPriceLevels.some(p => p.price === price && p.evidenceIds.includes(id) && p.evidenceIds.every(i => byId.has(i)))
  })
  for (const level of raw.priceMap) if (!groundedPrice(level.price, level.evidenceIds)) throw new Error('价格地图必须引用来源中的真实数值。')
  for (const outlook of raw.outlooks) if (outlook.priceLevelLabels.some(label => !raw.priceMap.some(p => p.label === label))) throw new Error('期限引用了不存在的价格标签。')
  for (const scenario of raw.scenarios) if (scenario.priceLevelLabels.some(label => !raw.priceMap.some(p => p.label === label))) throw new Error('情景引用了不存在的价格标签。')
  for (const thesis of raw.theses) for (const c of [...thesis.supportConditions, ...thesis.invalidationConditions, ...thesis.resolutionConditions]) {
    if (c.thresholdEvidenceId && !byId.has(c.thresholdEvidenceId)) throw new Error('条件引用了不存在的阈值证据。')
    if (c.metric === 'daily-close' && (!c.thresholdEvidenceId || !groundedPrice(c.threshold, [c.thresholdEvidenceId]))) throw new Error('收盘价条件的阈值必须来自真实价格证据。')
    if (c.metric === 'volume-ratio' && c.threshold < 0) throw new Error('成交量条件不能为负。')
  }
  const warnings: string[] = []
  if (feedback?.evidence.length) warnings.push('Auto Prediction、Jev 与 Auto Quant 回流仅为待验证研究推断，不增加独立确认票数，不自动调整规则权重。')
  if (input.research.dataAsOf && Number.isFinite(timestamp(input.research.dataAsOf)) && at.getTime() - timestamp(input.research.dataAsOf) > 14 * 86_400_000) warnings.push('报告整体数据时间较旧；各指标仍按各自明确的截止时间独立检查。')
  if (!raw.summary.inference || raw.outlooks.some(o => !o.conclusion.inference || !o.structure.inference) || raw.scenarios.some(s => !s.hypothesis.inference || !s.path.inference)) throw new Error('综合结论与情景路径必须明确标记为 AI 推断。')
  const draft = structuredClone(raw)
  const marketIds = new Set(input.market.evidence.map(e => e.id)), researchIds = new Set(input.research.evidence.map(e => e.id))
  const targetOf = (row: InvestmentDraft['crossValidation'][number]) => {
    const anchors = input.market.horizons.filter(h => row.marketEvidenceIds.some(id => h.evidenceIds.includes(id) && byId.get(id)?.metric === `trend.${h.horizon}`)).map(h => h.horizon)
    return row.horizon ? anchors.includes(row.horizon) ? row.horizon : null : anchors.length === 1 ? anchors[0]! : null
  }
  const researchBias = (ids: string[]) => ({
    bullish: input.research.bullishEvidence.some(c => c.evidenceIds.some(id => ids.includes(id))),
    bearish: input.research.bearishEvidence.some(c => c.evidenceIds.some(id => ids.includes(id))),
  })
  // Published reports expose source paragraphs, not trusted, horizon-bound
  // directional metric observations. Neither their brand, prose, numeric values
  // nor model-authored research.metrics can establish an independent family.
  // Only server-projected observations with explicit metric metadata may do so.
  const independentFamily = (e: EvidenceReference): 'derivatives' | null => e.reportId === null && e.kind === 'observation' && typeof e.value === 'number' && Number.isFinite(e.value)
    && ['funding-8h', 'open-interest', 'annualized-basis', 'option-open-interest', 'put-call-ratio'].includes(e.metric) ? 'derivatives' : null
  const rowHorizons = new Map<InvestmentDraft['crossValidation'][number], ReturnType<typeof targetOf>>()
  for (const row of draft.crossValidation) {
    if (row.marketEvidenceIds.some(id => !marketIds.has(id)) || row.researchEvidenceIds.some(id => !researchIds.has(id))) throw new Error('交叉验证必须分别引用真实市场与研究证据。')
    const target = targetOf(row)
    rowHorizons.set(row, target)
    const referencedIds = [...new Set([...row.marketEvidenceIds, ...row.researchEvidenceIds, ...row.claim.evidenceIds])]
    const refs = referencedIds.map(id => byId.get(id)!).filter(e => !/^trend\./.test(e.metric) || e.metric === `trend.${target}`)
    const availability = refs.map(e => evidenceAvailability(e, at))
    if (!input.research.publicationTime || !Number.isFinite(timestamp(input.research.publicationTime)) || timestamp(input.research.publicationTime) > at.getTime()) availability.push('unverified')
    if (input.research.dataAsOf !== null && (!Number.isFinite(timestamp(input.research.dataAsOf)) || timestamp(input.research.dataAsOf) > timestamp(input.research.publicationTime))) availability.push('unverified')
    const market = refs.find(e => marketIds.has(e.id) && e.metric === `trend.${target}`)?.value
    const research = researchBias(referencedIds.filter(id => researchIds.has(id)))
    const conflicting = target !== null && (market === 'bullish' && research.bearish || market === 'bearish' && research.bullish || research.bullish && research.bearish)
    const anchor = input.market.horizons.find(h => h.horizon === target)
    const lower = anchor?.supportLevels[0], upper = anchor?.resistanceLevels[0]
    const observedRange = market === 'sideways' && anchor?.direction === 'sideways'
      && typeof lower === 'number' && Number.isFinite(lower) && typeof upper === 'number' && Number.isFinite(upper) && upper > lower
      && input.market.price !== null && input.market.price >= lower && input.market.price <= upper
    const aligned = market === 'bullish' && research.bullish || market === 'bearish' && research.bearish || observedRange && !research.bullish && !research.bearish
    const independent = refs.some(e => researchIds.has(e.id) && independentFamily(e) !== null)
    let status: ValidationStatus = !target || availability.includes('unverified') ? 'UNVERIFIED' : availability.includes('outdated') ? 'OUTDATED' : conflicting || row.status === 'CONFLICTING' ? 'CONFLICTING' : aligned ? independent && row.status === 'CONFIRMED' ? 'CONFIRMED' : 'PARTIALLY_CONFIRMED' : 'UNVERIFIED'
    // A model's explicit uncertainty is never upgraded by the server guard.
    if (['UNVERIFIED', 'OUTDATED'].includes(row.status) && ['CONFIRMED', 'PARTIALLY_CONFIRMED'].includes(status)) status = row.status
    const original = row.status
    row.status = status
    if (target) row.horizon = target
    const explanation = status === 'CONFLICTING' ? '同一期限的市场方向与研究依据冲突，暂不判断。' : status === 'OUTDATED' ? '关键证据已过期，更新前暂不判断。' : status === 'UNVERIFIED' ? '缺少可核验的同期限证据；未知时间或不可用数据不能确认。' : status === 'PARTIALLY_CONFIRMED' ? '仅有同期限的部分支持；同一量价家族或来源不明的报告不能重复计票。' : '同期限且有可溯源的独立指标支持；不表示未来方向已确认或已有预测优势。'
    row.explanation = `${explanation} AI 原解释：${row.explanation}`
    if (status !== original) warnings.push(`交叉验证 ${original} → ${status}：${row.claim.text}`)
  }
  const label = { short: '短期', medium: '中期', long: '长期' }
  const directionLabels: Record<InvestmentDirection, string> = { bullish: '偏多', bearish: '偏空', neutral: '区间判断', 'conditional-bullish': '有条件偏多', 'conditional-bearish': '有条件偏空', uncertain: '暂不判断' }
  for (const outlook of draft.outlooks) {
    const related = draft.crossValidation.filter(row => rowHorizons.get(row) === outlook.horizon)
    const ids = [...new Set([...outlook.conclusion.evidenceIds, ...outlook.structure.evidenceIds, ...outlook.supportingEvidence.flatMap(c => c.evidenceIds), ...related.flatMap(r => [...r.marketEvidenceIds, ...r.researchEvidenceIds, ...r.claim.evidenceIds])])]
    const relevant = ids.map(id => byId.get(id)!).filter(e => !/^trend\./.test(e.metric) || e.metric === `trend.${outlook.horizon}`)
    const anchor = input.market.horizons.find(h => h.horizon === outlook.horizon)
    const trend = relevant.find(e => e.metric === `trend.${outlook.horizon}` && anchor?.evidenceIds.includes(e.id))
    const availability = relevant.map(e => evidenceAvailability(e, at))
    const opposite = outlook.direction.includes('bullish') && trend?.value === 'bearish' || outlook.direction.includes('bearish') && trend?.value === 'bullish'
    const blocked = !trend || !related.length || availability.some(a => a !== 'available') || related.some(r => ['UNVERIFIED', 'OUTDATED', 'CONFLICTING'].includes(r.status)) || opposite
    const original = outlook.direction
    let reason = ''
    if (blocked) {
      outlook.direction = 'uncertain'
      reason = !trend || !related.length ? '缺少同期限交叉验证' : availability.some(a => a !== 'available') ? '关键证据缺失或过期' : '同期限证据存在冲突或尚未核验'
    } else if (!related.some(r => r.status === 'CONFIRMED')) {
      if (outlook.direction === 'bullish' || outlook.direction === 'bearish') outlook.direction = `conditional-${outlook.direction}`
      else if (outlook.direction === 'neutral' && trend?.value !== 'sideways') outlook.direction = 'uncertain'
      reason = '独立证据不足，仅保留待验证条件'
    }
    if (reason) {
      outlook.conclusion = { text: `${label[outlook.horizon]}${directionLabels[outlook.direction]}：${reason}。`, evidenceIds: ids, inference: true }
      // Avoid an unconditional direction surviving in the other leading field.
      outlook.structure = { text: '结构标签仅为研究假设，须等待已声明的确认或失效条件。', evidenceIds: ids, inference: true }
      warnings.push(`${label[outlook.horizon]} ${original} → ${outlook.direction}：${reason}。`)
    }
  }
  draft.summary = { text: `${draft.outlooks.map(o => `${label[o.horizon]}${directionLabels[o.direction]}`).join('；')}。证据不足时等待确认，尚无已证明的预测优势。`, evidenceIds: [...new Set(draft.outlooks.flatMap(o => o.conclusion.evidenceIds))], inference: true }
  const allReferenced = new Set<string>()
  const collect = (node: unknown): void => { if (Array.isArray(node)) node.forEach(collect); else if (node && typeof node === 'object') { const o = node as Record<string, unknown>; if (Array.isArray(o.evidenceIds)) for (const id of o.evidenceIds as string[]) allReferenced.add(id); Object.values(o).forEach(collect) } }
  collect(raw)
  const unusable = [...allReferenced].filter(id => evidenceAvailability(byId.get(id)!, at) !== 'available')
  if (unusable.length) warnings.push(`${unusable.length} 条引用证据缺失时效或已过期；相应判断仅供待验证研究。`)
  return { draft, warnings, evidence }
}

const terminal = new Set<InvestmentThesisStatus>(['INVALIDATED', 'RESOLVED', 'EXPIRED'])
export function evaluateInvestmentThesis(thesis: InvestmentThesis, market: InvestmentInput['market'], previous: InvestmentThesisEvaluation | null, at: Date): InvestmentThesisEvaluation {
  const previousStatus = previous?.status ?? 'ACTIVE'
  const evidence: EvidenceReference[] = []
  const groups = [['support', thesis.supportConditions], ['invalidate', thesis.invalidationConditions], ['resolve', thesis.resolutionConditions]] as const
  const rows: InvestmentThesisEvaluation['rows'] = groups.flatMap(([kind, conditions]) => conditions.map(condition => {
    const e = market.evidence.find(e => e.metric === condition.metric) ?? null
    const usable = e && e.kind === 'observation' && evidenceAvailability(e, at) === 'available' && Number.isFinite(timestamp(e.retrievedAt)) && timestamp(e.retrievedAt) >= timestamp(thesis.createdAt) && timestamp(e.retrievedAt) <= timestamp(thesis.expiresAt) && Date.parse(e.dataAsOf!.slice(0, 10)) + 86_400_000 > timestamp(thesis.createdAt)
    if (e) evidence.push(e)
    const value = usable && typeof e.value === 'number' && Number.isFinite(e.value) ? e.value : null
    if (value === null) return { kind, condition, value, result: 'unknown' as const, evidence: e }
    const cmp = new Decimal(value).cmp(condition.threshold)
    const met = condition.operator === 'gt' ? cmp > 0 : condition.operator === 'gte' ? cmp >= 0 : condition.operator === 'lt' ? cmp < 0 : cmp <= 0
    return { kind, condition, value, result: met ? 'met' as const : 'not-met' as const, evidence: e }
  }))
  const invalidated = rows.some(r => r.kind === 'invalidate' && r.result === 'met')
  const support = rows.filter(r => r.kind === 'support'), resolutions = rows.filter(r => r.kind === 'resolve')
  const allSupport = support.length > 0 && support.every(r => r.result === 'met')
  const wasSupported = previous?.rows.some(r => r.kind === 'support' && r.result === 'met') ?? false
  let status: InvestmentThesisStatus = 'ACTIVE', reason = '尚未触发已声明的客观确认或失效条件。'
  if (terminal.has(previousStatus)) { status = previousStatus; reason = '终止状态保留，后续 AI 分析或价格不能重置原观点。' }
  else if (invalidated) { status = 'INVALIDATED'; reason = '已收盘可用指标触发事先定义的失效条件。' }
  else if (resolutions.length && resolutions.every(r => r.result === 'met')) { status = 'RESOLVED'; reason = '已收盘可用指标满足全部事先定义的终点条件。' }
  else if (at.getTime() >= timestamp(thesis.expiresAt)) { status = 'EXPIRED'; reason = '观察期限结束，未以过期后的数据追溯确认或失效。' }
  else if (rows.some(r => r.result === 'unknown')) { status = 'CHALLENGED'; reason = '当前缺少可用的已收盘指标，不能认定观点已获验证。' }
  else if (allSupport) { status = 'STRENGTHENING'; reason = '全部事先定义的支持条件得到当前已收盘指标支持。' }
  else if (wasSupported && support.some(r => r.result === 'not-met')) { status = 'WEAKENING'; reason = '此前满足的支持条件不再全部满足。' }
  const uniqueEvidence = [...new Map(evidence.map(e => [e.id, e])).values()]
  const fingerprint = createHash('sha256').update(JSON.stringify({ thesis: thesis.id, status, rows: rows.map(r => [r.kind, r.result, r.value, r.evidence?.dataAsOf]) })).digest('hex')
  const row: InvestmentThesisEvaluation = { id: `eval-${fingerprint}`, thesisId: thesis.id, thesisRevision: 1, evaluatedAt: at.toISOString(), marketSnapshotId: market.snapshotId, previousStatus, status, reason, rows, evidence: uniqueEvidence, recordHash: '' }
  row.recordHash = intelligenceRecordHash(row)
  return row
}
