import { evidenceAvailability, investmentAdmission, intelligenceRecordHash } from './investment.js'
import { upcomingEquitySessionEnd } from './equity-session.js'
import { nativeForwardHash, nativeForwardRecordHash, nativeForwardCommitHash, type createNativeForwardStore } from './native-forward-store.js'
import type { InvestmentExplanation, InvestmentExplanationReasonCode, InvestmentInput, InvestmentSnapshot } from './investment-types.js'
import type { TrendDirection, TrendHorizon } from './types.js'

type InputStatus = InvestmentExplanation['inputStatus']
type Reason = InvestmentExplanation['outlooks'][number]['reasons'][number]
type OriginStore = Pick<ReturnType<typeof createNativeForwardStore>, 'read' | 'readCommit'>
const directions: TrendDirection[] = ['bullish', 'bearish', 'sideways', 'transition', 'insufficient']
const time = (value: string | null) => value === null ? NaN : Date.parse(value)
const directional = (value: string) => value.includes('bullish') || value.includes('bearish')

/** Explain the saved decision at its original clock, never reanalyse today's market.
 * Missing product coverage and uncited historical change references are not gates. */
export function explainInvestmentSnapshot(snapshot: InvestmentSnapshot, input: InvestmentInput | null = null, inputStatus: InputStatus = 'unavailable'): InvestmentExplanation {
  const at = new Date(snapshot.analysisTime)
  const source = inputStatus === 'verified' ? input : null
  // These explanation rules describe the shipped v4/equity-v2 guard. A later
  // analysis version must opt into its own policy rather than rewriting history.
  const knownPolicy = snapshot.analysisVersion === 'investment-intelligence-v4' || snapshot.analysisVersion === 'investment-intelligence-equity-v2'
  const evidence = source ? [...source.market.evidence, ...(source.research?.evidence ?? []), ...(source.researchFeedback?.evidence ?? [])] : snapshot.evidence
  const byId = new Map(evidence.map(e => [e.id, e]))
  const targetOf = (row: InvestmentSnapshot['crossValidation'][number]): TrendHorizon | null => {
    const anchors = (['short', 'medium', 'long'] as const).filter(h => row.marketEvidenceIds.some(id => {
      const ref = byId.get(id)
      return ref?.metric === `trend.${h}` && (!source || source.market.horizons.find(v => v.horizon === h)?.evidenceIds.includes(id))
    }))
    return row.horizon ? anchors.includes(row.horizon) ? row.horizon : null : anchors.length === 1 ? anchors[0]! : null
  }
  const outlooks = snapshot.outlooks.map(outlook => {
    const raw = snapshot.rawDraft?.outlooks.find(o => o.horizon === outlook.horizon)
    const rawDirection = raw?.direction ?? null
    const related = snapshot.crossValidation.filter(row => targetOf(row) === outlook.horizon)
    const ids = [...new Set([
      ...(raw ? [...raw.conclusion.evidenceIds, ...raw.structure.evidenceIds, ...raw.supportingEvidence.flatMap(c => c.evidenceIds)] : []),
      ...related.flatMap(row => [...row.marketEvidenceIds, ...row.researchEvidenceIds, ...row.claim.evidenceIds]),
    ])]
    const refs = ids.flatMap(id => { const e = byId.get(id); return e && (!e.metric.startsWith('trend.') || e.metric === `trend.${outlook.horizon}`) ? [e] : [] })
    const trend = refs.find(e => e.metric === `trend.${outlook.horizon}` && (!source || source.market.horizons.find(h => h.horizon === outlook.horizon)?.evidenceIds.includes(e.id)))
    const value = source?.market.horizons.find(h => h.horizon === outlook.horizon)?.direction ?? trend?.value
    const marketDirection = directions.includes(value as TrendDirection) ? value as TrendDirection : null
    const reasons: Reason[] = []
    const add = (code: InvestmentExplanationReasonCode, evidenceIds: string[] = []) => {
      const previous = reasons.find(r => r.code === code)
      if (previous) previous.evidenceIds = [...new Set([...previous.evidenceIds, ...evidenceIds])]
      else reasons.push({ code, evidenceIds: [...new Set(evidenceIds)] })
    }
    if (inputStatus === 'invalid' || inputStatus === 'read-error' || !Number.isFinite(at.getTime())) {
      return { horizon: outlook.horizon, direction: outlook.direction, rawDirection, marketDirection: null,
        primaryReason: 'explanation-unavailable' as const, reasons: [{ code: 'explanation-unavailable' as const, evidenceIds: [] }] }
    }
    // Source paragraphs intentionally have null numeric values. Their text
    // and explicit quality, rather than a missing number, determine availability.
    const unavailable = refs.filter(e => e.quality === 'unavailable')
    const outdated = refs.filter(e => evidenceAvailability(e, at) === 'outdated')
    const unverified = refs.filter(e => evidenceAvailability(e, at) === 'unverified' && !unavailable.includes(e))
    if (unavailable.length) add('data-unavailable', unavailable.map(e => e.id))
    if (outdated.length) add('data-outdated', outdated.map(e => e.id))
    if (unverified.length) add('evidence-unverified', unverified.map(e => e.id))
    const conflicting = related.filter(row => row.status === 'CONFLICTING')
    const opposite = rawDirection && (rawDirection.includes('bullish') && trend?.value === 'bearish' || rawDirection.includes('bearish') && trend?.value === 'bullish')
    if (conflicting.length || opposite) add('same-horizon-conflict', [...conflicting.flatMap(row => [...row.marketEvidenceIds, ...row.researchEvidenceIds]), ...(opposite && trend ? [trend.id] : [])])
    if (related.some(row => row.status === 'UNVERIFIED')) add('evidence-unverified', related.filter(row => row.status === 'UNVERIFIED').flatMap(row => [...row.marketEvidenceIds, ...row.researchEvidenceIds]))
    if (rawDirection === 'uncertain') add('model-uncertain')

    let hardReason: InvestmentExplanationReasonCode | null = null
    if (source && knownPolicy) {
      if (!trend || !related.length) add('cross-validation-missing', trend ? [trend.id] : [])
      const research = source.research
      // These are the original report metadata checks, not today's report age.
      if (snapshot.asset === 'BTC' && (!research?.publicationTime || !Number.isFinite(time(research.publicationTime)) || time(research.publicationTime) > at.getTime())
        || research && research.dataAsOf !== null && (!Number.isFinite(time(research.dataAsOf)) || time(research.dataAsOf) > time(research.publicationTime))) add('evidence-unverified', related.flatMap(row => row.researchEvidenceIds))
      if (outlook.horizon === 'short' && snapshot.asset !== 'BTC') {
        const event = source.market.evidence.find(e => e.metric === 'equity.next-earnings')
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
        const day = typeof event?.value === 'string' ? event.value.slice(0, 10) : ''
        const stamp = Date.parse(`${day}T12:00:00Z`)
        const validDay = /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day
        const end = upcomingEquitySessionEnd(today, 5)
        if (!event || event.kind !== 'observation' || event.reportId !== null || evidenceAvailability(event, at) !== 'available' || !validDay || day < today || !end) {
          add('earnings-calendar-unverified', event ? [event.id] : []); hardReason = 'earnings-calendar-unverified'
        } else if (day <= end) { add('earnings-risk-window', [event.id]); hardReason = 'earnings-risk-window' }
        if (!investmentAdmission(source.market, at)?.hourlyCurrent) {
          const hourly = source.market.evidence.find(e => e.metric === 'hourly-close')
          add('hourly-evidence-unavailable', hourly ? [hourly.id] : []); hardReason ??= 'hourly-evidence-unavailable'
        }
      }
      if (rawDirection && directional(rawDirection)) {
        const pair = raw?.decisionConditions
        if (!pair) { add('conditions-missing'); hardReason ??= 'conditions-missing' }
        else {
          const boundaryRefs = [pair.confirmation, pair.invalidation].flatMap(c => c.thresholdEvidenceId && byId.has(c.thresholdEvidenceId) ? [byId.get(c.thresholdEvidenceId)!] : [])
          const stale = boundaryRefs.filter(e => evidenceAvailability(e, at) === 'outdated')
          if (stale.length) { add('conditions-outdated', stale.map(e => e.id)); hardReason ??= 'conditions-outdated' }
          if (boundaryRefs.length !== 2 || boundaryRefs.some(e => evidenceAvailability(e, at) === 'unverified')) {
            add('conditions-unavailable', boundaryRefs.map(e => e.id)); hardReason ??= 'conditions-unavailable'
            add('evidence-unverified', boundaryRefs.map(e => e.id))
          }
        }
      }
      if (directional(outlook.direction) && related.length && !related.some(row => row.status === 'CONFIRMED')) add('independent-confirmation-missing', related.flatMap(row => [...row.marketEvidenceIds, ...row.researchEvidenceIds]))
      if (rawDirection === 'neutral' && outlook.direction === 'uncertain' && marketDirection !== 'sideways' && related.length && related.every(row => ['CONFIRMED', 'PARTIALLY_CONFIRMED'].includes(row.status))) add('range-unverified', trend ? [trend.id] : [])
    }
    const order: InvestmentExplanationReasonCode[] = ['cross-validation-missing', 'data-unavailable', 'data-outdated', 'evidence-unverified', 'same-horizon-conflict', 'conditions-missing', 'conditions-outdated', 'conditions-unavailable', 'range-unverified', 'independent-confirmation-missing']
    // A generic server constraint is not proof it caused the model to abstain.
    let primaryReason: InvestmentExplanationReasonCode | null = hardReason ?? (rawDirection === 'uncertain' ? 'model-uncertain' : order.find(code => reasons.some(r => r.code === code)) ?? null)
    if (!source || !knownPolicy || !raw || outlook.direction === 'uncertain' && !primaryReason) { add('explanation-unavailable'); primaryReason = 'explanation-unavailable' }
    return { horizon: outlook.horizon, direction: outlook.direction, rawDirection, marketDirection, primaryReason, reasons }
  })
  return { protocol: 'investment-explanation-v1', asset: snapshot.asset, snapshotId: snapshot.id, marketSnapshotId: snapshot.marketSnapshotId,
    analysisTime: snapshot.analysisTime, inputStatus, outlooks }
}

/** Only a hash-bound original input may explain hidden admission checks.
 * An absent/corrupt companion never prevents the existing report from loading. */
export async function readInvestmentExplanation(snapshot: InvestmentSnapshot, store: OriginStore | null, asOf: Date): Promise<InvestmentExplanation> {
  if (!store || !snapshot.forwardValidation) return explainInvestmentSnapshot(snapshot)
  let origin, commit
  try { [origin, commit] = await Promise.all([store.read(snapshot.asset, snapshot.id), store.readCommit(snapshot.asset, snapshot.id)]) }
  catch (error) {
    const invalid = error instanceof SyntaxError || error instanceof Error && /integrity check failed/.test(error.message)
    return explainInvestmentSnapshot(snapshot, null, invalid ? 'invalid' : 'read-error')
  }
  if (!origin || !commit) return explainInvestmentSnapshot(snapshot)
  if (Number.isFinite(time(commit.publishedAt)) && time(commit.publishedAt) > asOf.getTime()) return explainInvestmentSnapshot(snapshot)
  try {
    if (origin.schemaVersion !== 1 || commit.schemaVersion !== 1 || origin.protocol !== 'native-investment-forward-v1' || commit.protocol !== origin.protocol
      || snapshot.forwardValidation.protocol !== origin.protocol
      || origin.recordHash !== nativeForwardRecordHash(origin) || commit.recordHash !== nativeForwardCommitHash(commit)
      || origin.id !== snapshot.id || origin.asset !== snapshot.asset || origin.issuedAt !== snapshot.analysisTime
      || origin.snapshot.recordHash !== snapshot.recordHash || intelligenceRecordHash(origin.snapshot) !== snapshot.recordHash || intelligenceRecordHash(snapshot) !== snapshot.recordHash
      || origin.originInputHash !== nativeForwardHash(origin.input) || origin.originInputHash !== snapshot.forwardValidation.originInputHash
      || origin.input.market.asset !== snapshot.asset || origin.input.market.snapshotId !== snapshot.marketSnapshotId
      || (origin.input.research?.id ?? null) !== snapshot.researchSnapshotId || origin.snapshot.analysisVersion !== snapshot.analysisVersion
      || commit.id !== snapshot.id || commit.asset !== snapshot.asset || commit.captureHash !== origin.recordHash || commit.snapshotHash !== snapshot.recordHash
      || !Number.isFinite(time(commit.publishedAt)) || time(commit.publishedAt) < time(snapshot.analysisTime) || time(commit.publishedAt) > asOf.getTime()) return explainInvestmentSnapshot(snapshot, null, 'invalid')
    return explainInvestmentSnapshot(snapshot, origin.input, 'verified')
  } catch { return explainInvestmentSnapshot(snapshot, null, 'invalid') }
}
