import { createHash } from 'node:crypto'
import Decimal from 'decimal.js'
import { z } from 'zod'
import type { EvidenceReference } from './intelligence-types.js'
import type { InvestmentDraft, InvestmentInput, InvestmentSnapshot, InvestmentThesis, InvestmentThesisEvaluation, InvestmentThesisStatus, ValidationStatus } from './investment-types.js'

const claim = z.object({ text: z.string().min(1).max(2400), evidenceIds: z.array(z.string().min(1)).min(1).max(24), inference: z.boolean() }).strict()
const horizon = z.enum(['short', 'medium', 'long'])
const direction = z.enum(['bullish', 'neutral', 'bearish', 'conditional-bullish', 'conditional-bearish', 'uncertain'])
const condition = z.object({ metric: z.enum(['daily-close', 'daily-change-percent', 'volume-ratio']), operator: z.enum(['gt', 'gte', 'lt', 'lte']), threshold: z.number().finite(), thresholdEvidenceId: z.string().nullable(), description: z.string().min(1).max(600) }).strict()
export const investmentDraftSchema = z.object({
  summary: claim,
  crossValidation: z.array(z.object({ claim, marketEvidenceIds: z.array(z.string()).min(1).max(24), researchEvidenceIds: z.array(z.string()).min(1).max(24), status: z.enum(['CONFIRMED', 'PARTIALLY_CONFIRMED', 'CONFLICTING', 'UNVERIFIED', 'OUTDATED']), explanation: z.string().min(1).max(1800) }).strict()).min(1).max(16),
  outlooks: z.array(z.object({ horizon, direction, conclusion: claim, structure: claim, supportingEvidence: z.array(claim).max(16), opposingEvidence: z.array(claim).max(16), risks: z.array(claim).min(1).max(16), confirmation: z.array(claim).min(1).max(16), invalidation: z.array(claim).min(1).max(16), priceLevelLabels: z.array(z.string()).max(24) }).strict()).length(3),
  scenarios: z.array(z.object({ kind: z.enum(['bullish', 'neutral', 'bearish']), hypothesis: claim, conditions: z.array(claim).min(1).max(16), confirmation: z.array(claim).min(1).max(16), path: claim, invalidation: z.array(claim).min(1).max(16), supportingEvidence: z.array(claim).max(16), opposingEvidence: z.array(claim).max(16), priceLevelLabels: z.array(z.string()).max(24) }).strict()).length(3),
  priceMap: z.array(z.object({ label: z.string().min(1).max(160), price: z.number().positive().finite(), unit: z.literal('USD'), role: z.enum(['support', 'resistance', 'cost-basis', 'reference']), evidenceIds: z.array(z.string()).min(1).max(24) }).strict()).max(24),
  theses: z.array(z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), title: z.string().min(1).max(240), claim, horizon, observationDays: z.number().int().min(1).max(180), supportConditions: z.array(condition).min(1).max(12), invalidationConditions: z.array(condition).min(1).max(12), resolutionConditions: z.array(condition).max(12) }).strict()).min(1).max(12),
  limitations: z.array(claim).min(1).max(24),
}).strict()

export const intelligenceRecordHash = <T extends { recordHash: string }>(row: T) => createHash('sha256').update(JSON.stringify({ ...row, recordHash: '' })).digest('hex')
export const investmentInputHash = (input: InvestmentInput) => createHash('sha256').update(JSON.stringify({ version: 1, marketSnapshotId: input.market.snapshotId, researchSnapshotId: input.research.id, researchHash: input.research.recordHash })).digest('hex')
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
  const evidence = [...input.market.evidence, ...input.research.evidence]
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
  if (input.research.dataAsOf && Number.isFinite(timestamp(input.research.dataAsOf)) && at.getTime() - timestamp(input.research.dataAsOf) > 14 * 86_400_000) warnings.push('报告整体数据时间较旧；各指标仍按各自明确的截止时间独立检查。')
  if (!raw.summary.inference || raw.outlooks.some(o => !o.conclusion.inference || !o.structure.inference) || raw.scenarios.some(s => !s.hypothesis.inference || !s.path.inference)) throw new Error('综合结论与情景路径必须明确标记为 AI 推断。')
  const draft = structuredClone(raw)
  const marketIds = new Set(input.market.evidence.map(e => e.id)), researchIds = new Set(input.research.evidence.map(e => e.id))
  const researchBias = (ids: string[]) => {
    const bullish = input.research.bullishEvidence.some(c => c.evidenceIds.some(id => ids.includes(id)))
    const bearish = input.research.bearishEvidence.some(c => c.evidenceIds.some(id => ids.includes(id)))
    return { bullish, bearish }
  }
  for (const row of draft.crossValidation) {
    if (row.marketEvidenceIds.some(id => !marketIds.has(id)) || row.researchEvidenceIds.some(id => !researchIds.has(id))) throw new Error('交叉验证必须分别引用真实市场与研究证据。')
    const referencedIds = [...new Set([...row.marketEvidenceIds, ...row.researchEvidenceIds, ...row.claim.evidenceIds])]
    const refs = referencedIds.map(id => byId.get(id)!)
    const availability = refs.map(e => evidenceAvailability(e, at))
    if (!input.research.publicationTime || !Number.isFinite(timestamp(input.research.publicationTime)) || timestamp(input.research.publicationTime) > at.getTime()) availability.push('unverified')
    if (input.research.dataAsOf !== null && (!Number.isFinite(timestamp(input.research.dataAsOf)) || timestamp(input.research.dataAsOf) > timestamp(input.research.publicationTime))) availability.push('unverified')
    const marketReferences = referencedIds.filter(id => marketIds.has(id))
    const researchReferences = referencedIds.filter(id => researchIds.has(id))
    const marketBias = { bullish: marketReferences.some(id => byId.get(id)?.value === 'bullish'), bearish: marketReferences.some(id => byId.get(id)?.value === 'bearish') }
    const research = researchBias(researchReferences)
    const conflicting = marketBias.bullish && research.bearish || marketBias.bearish && research.bullish || marketBias.bullish && marketBias.bearish || research.bullish && research.bearish
    const aligned = marketBias.bullish && research.bullish || marketBias.bearish && research.bearish
    let status: ValidationStatus = availability.includes('unverified') ? 'UNVERIFIED' : availability.includes('outdated') ? 'OUTDATED' : conflicting || row.status === 'CONFLICTING' ? 'CONFLICTING' : aligned ? (row.status === 'CONFIRMED' ? 'CONFIRMED' : row.status) : 'UNVERIFIED'
    // A model's conflict/uncertainty is never promoted merely because metadata passes.
    if (!conflicting && status === 'CONFIRMED' && row.status !== 'CONFIRMED') status = row.status
    const original = row.status
    row.status = status
    const explanation = status === 'CONFLICTING' ? '市场方向与报告多空依据存在冲突，不能由 AI 合并为确认。' : status === 'OUTDATED' ? '关键证据已超出时效，须更新后重新验证。' : status === 'UNVERIFIED' ? '缺少可核验的同向、同期证据；未知截止时间、未来资料或不可用数据不能确认。' : '仅表示引用证据的支持关系，不确认未来价格方向。'
    row.explanation = `${explanation} AI 原解释：${row.explanation}`
    if (status !== original) warnings.push(`交叉验证 ${original} → ${status}：${row.claim.text}`)
  }
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
