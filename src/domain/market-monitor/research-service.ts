import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { EvidenceReference } from './intelligence-types.js'
import { canonicalGlassnodeUrl, createGlassnodeClient, explicitResearchDates, normalizeResearchParagraphs, paragraphDataAsOf, publicResearchDate, researchContentHash, type ParsedGlassnodeReport } from './glassnode.js'
import { createResearchStore, researchHash, researchRecordHash, researchReportId, type ResearchStore } from './research-store.js'
import { RESEARCH_ANALYSIS_VERSION, type ResearchClaim, type ResearchDiscoveryResult, type ResearchDraft, type ResearchImportResult, type ResearchProvenance, type ResearchReport, type ResearchSnapshot, type ResearchSource, type ResearchStatus } from './research-types.js'

const DAY = 86_400_000
const text = z.string().trim().min(1).max(1500)
const evidenceIds = z.array(z.string().regex(/^gn-[a-f0-9]{32}-p\d{3}-[a-f0-9]{12}$/)).max(20)
const claim = z.object({ text: text.refine(value => /[\u3400-\u9fff]/.test(value), 'Chinese research text is required.'), evidenceIds, inference: z.boolean() }).strict()
  .refine(value => value.inference || value.evidenceIds.length > 0, 'Observed and interpreted conclusions need source evidence.')
const claims = z.array(claim).max(12)
const date = z.string().datetime({ offset: true }).nullable()
export const researchDraftSchema = z.object({
  dataAsOf: date,
  mainThesis: claim,
  sections: z.object({ coreConclusion: claims.min(1), onchainMetrics: claims.min(1), holderBehavior: claims.min(1), capitalFlows: claims.min(1), costStructure: claims.min(1), marketCycle: claims.min(1), keyPriceAreas: claims.min(1), scenarios: claims.min(1), limitations: claims.min(1), independentView: claims.min(1) }).strict(),
  metrics: z.array(z.object({ name: z.string().trim().min(1).max(120), value: z.union([z.number().finite(), z.string().trim().max(300), z.null()]), unit: z.string().trim().max(60).nullable(), dataAsOf: date,
    kind: z.enum(['observation', 'interpretation', 'inference']), evidenceIds, meaning: claim, change: claim.nullable() }).strict()).max(30),
  keyPriceLevels: z.array(z.object({ label: z.string().trim().min(1).max(160), price: z.number().finite().positive().max(1e9), unit: z.literal('USD'), role: z.enum(['support', 'resistance', 'cost-basis', 'reference']), dataAsOf: date, evidenceIds: evidenceIds.min(1) }).strict()).max(20),
  bullishEvidence: claims, bearishEvidence: claims, uncertainties: claims.min(1), limitations: claims.min(1),
  weeklyChanges: z.array(z.object({ topic: z.string().trim().min(1).max(160), text, currentEvidenceIds: evidenceIds.min(1), previousEvidenceIds: evidenceIds.min(1), inference: z.boolean() }).strict()).max(12),
}).strict()

function numericValues(input: string): number[] {
  const values: number[] = []
  for (const match of input.matchAll(/[-+]?\d[\d,]*(?:\.\d+)?\s*(?:trillion|billion|million|thousand|[kmbt](?![a-z]))?/gi)) {
    const parts = /^([-+]?\d[\d,]*(?:\.\d+)?)\s*(.*)$/i.exec(match[0])!
    const factor = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 }[parts[2].toLowerCase()] ?? 1
    values.push(Number(parts[1].replace(/,/g, '')) * factor)
  }
  return values.filter(Number.isFinite)
}

function sourcePrices(input: string): number[] {
  const tokens = input.match(/(?:\$|\bUSD\s*)[-+]?\d[\d,]*(?:\.\d+)?\s*(?:trillion|billion|million|thousand|[kmbt](?![a-z]))?|[-+]?\d[\d,]*(?:\.\d+)?\s*(?:trillion|billion|million|thousand|[kmbt](?![a-z]))?\s*(?:USD\b|dollars?\b)/gi) ?? []
  return tokens.flatMap(numericValues)
}

function validateDraft(input: unknown, source: ResearchSource, previous: ResearchSnapshot | null, report: ResearchReport, at: Date): ResearchDraft {
  const parsed = researchDraftSchema.safeParse(input)
  if (!parsed.success) throw new Error('Research analysis failed its structured Chinese result validation.')
  const draft = parsed.data
  const current = new Map(source.paragraphs.map(p => [p.id, p]))
  const prior = new Map((previous?.evidence ?? []).map(p => [p.id, p]))
  const requireIds = (ids: string[], map = current) => {
    if (new Set(ids).size !== ids.length || ids.some(id => !map.has(id))) throw new Error('Research analysis references evidence outside its frozen report inputs.')
  }
  const verifyClaim = (value: ResearchClaim) => requireIds(value.evidenceIds)
  const knownDate = (value: string | null, ids: string[]) => {
    if (value === null) return null
    const ms = Date.parse(value)
    if (!Number.isFinite(ms) || ms > at.getTime() || report.publishedAt && ms > Date.parse(report.publishedAt)) throw new Error('Research data time cannot be after publication or analysis.')
    const day = value.slice(0, 10)
    const sourceHasTime = ids.some(id => [...(current.get(id)?.excerpt ?? '').matchAll(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})\b/g)].some(match => Date.parse(match[0]) === ms))
    if (!sourceHasTime && !ids.some(id => explicitResearchDates(current.get(id)?.excerpt ?? '').some(sourceDate => sourceDate.slice(0, 10) === day))) throw new Error('Research data cutoff needs an explicit date in its cited source; otherwise use null.')
    // A source that names only a calendar day supplies no intraday precision.
    // Require UTC midnight, then normalize equivalent ISO representations.
    if (!sourceHasTime && ms !== Date.parse(`${day}T00:00:00.000Z`)) throw new Error('Research date-only cutoffs must use UTC midnight; an intraday time needs an exact source timestamp.')
    return new Date(ms).toISOString()
  }
  const supportedNumber = (value: number, ids: string[]) => ids.some(id => numericValues(current.get(id)?.excerpt ?? '').some(candidate => Math.abs(candidate - value) <= Math.max(1e-9, Math.abs(value) * 1e-9)))
  verifyClaim(draft.mainThesis)
  Object.values(draft.sections).flat().forEach(verifyClaim)
  ;[...draft.bullishEvidence, ...draft.bearishEvidence, ...draft.uncertainties, ...draft.limitations].forEach(verifyClaim)
  for (const metric of draft.metrics) {
    requireIds(metric.evidenceIds)
    verifyClaim(metric.meaning)
    if (metric.change) verifyClaim(metric.change)
    if (metric.kind !== 'inference' && !metric.evidenceIds.length) throw new Error('Research metric observation is not present in its source paragraphs.')
    const numbers = typeof metric.value === 'number' ? [metric.value] : typeof metric.value === 'string' ? numericValues(metric.value) : []
    if (numbers.some(value => !supportedNumber(value, metric.evidenceIds))) throw new Error('Research metric observation is not present in its source paragraphs.')
    metric.dataAsOf = knownDate(metric.dataAsOf, metric.evidenceIds)
  }
  for (const level of draft.keyPriceLevels) {
    requireIds(level.evidenceIds)
    if (!level.evidenceIds.some(id => sourcePrices(current.get(id)?.excerpt ?? '').some(value => Math.abs(value - level.price) <= Math.max(1e-9, level.price * 1e-9)))) throw new Error('Research price level is not present in its source paragraphs.')
    level.dataAsOf = knownDate(level.dataAsOf, level.evidenceIds)
  }
  draft.dataAsOf = knownDate(draft.dataAsOf, [...current.keys()])
  for (const change of draft.weeklyChanges) {
    if (!previous) throw new Error('Weekly comparison requires an earlier available research snapshot.')
    requireIds(change.currentEvidenceIds)
    requireIds(change.previousEvidenceIds, prior)
  }
  return draft
}

export function createResearchService(options: { store?: ResearchStore; fetch?: typeof fetch; now?: () => Date } = {}) {
  const store = options.store ?? createResearchStore(), now = options.now ?? (() => new Date())
  const client = createGlassnodeClient({ fetch: options.fetch, now })
  let pending: Promise<unknown> = Promise.resolve(), discovery: Promise<ResearchDiscoveryResult> | null = null
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const work = pending.catch(() => {}).then(action)
    pending = work
    return work
  }
  const reports = () => store.reports()
  const snapshots = () => store.snapshots()
  const latest = async (): Promise<ResearchSnapshot | null> => {
    const rows = (await snapshots()).filter(row => Date.parse(row.analysisTime) <= now().getTime())
    return rows.sort((a, b) => (a.publicationTime ?? a.analysisTime).localeCompare(b.publicationTime ?? b.analysisTime) || a.analysisTime.localeCompare(b.analysisTime) || a.revision - b.revision).at(-1) ?? null
  }
  const status = async (): Promise<ResearchStatus> => {
    const [state, allReports, allSnapshots] = await Promise.all([store.discovery(), reports(), snapshots()])
    const last = state.lastCheckedAt && Date.parse(state.lastCheckedAt) <= now().getTime() ? state.lastCheckedAt : null
    return { state: discovery ? 'checking' : state.lastError ? 'failed' : last ? 'current' : 'never-checked', lastCheckedAt: last,
      nextCheckAt: last ? new Date(Date.parse(last) + DAY).toISOString() : null, lastError: state.lastError,
      latestReportId: allReports.at(-1)?.id ?? null,
      pendingReportIds: allReports.filter(row => !allSnapshots.some(snapshot => snapshot.reportId === row.id && snapshot.analysisVersion === RESEARCH_ANALYSIS_VERSION)).map(row => row.id) }
  }
  const saveParsed = async (parsed: ParsedGlassnodeReport, origin: 'url' | 'manual'): Promise<ResearchImportResult> => serial(async () => {
    const existing = (await reports()).find(row => row.contentHash === parsed.contentHash)
    if (existing) return { stored: false, report: existing }
    const id = researchReportId(parsed.contentHash), retrievedAt = now().toISOString()
    const report: ResearchReport = { schemaVersion: 1, id, asset: 'BTC', sourceName: 'Glassnode', url: parsed.url, title: parsed.title,
      publishedAt: parsed.publishedAt, retrievedAt, reportPeriod: parsed.reportPeriod, contentHash: parsed.contentHash,
      paragraphCount: parsed.paragraphs.length, preview: parsed.paragraphs[0].slice(0, 180), origin }
    const paragraphs: EvidenceReference[] = parsed.paragraphs.map((excerpt, index) => ({
      id: `${id}-p${String(index + 1).padStart(3, '0')}-${researchHash(excerpt).slice(0, 12)}`, asset: 'BTC', sourceName: 'Glassnode', sourceUrl: report.url,
      metric: 'report-paragraph', value: null, unit: null, dataAsOf: paragraphDataAsOf(excerpt), publishedAt: report.publishedAt, retrievedAt,
      quality: report.publishedAt ? 'available' : 'unknown', reportId: id, kind: 'observation', excerpt,
    }))
    const stored = await store.publishReport(report, { reportId: id, contentHash: report.contentHash, paragraphs })
    return { stored, report }
  })
  const importUrl = async (url: string) => saveParsed(await client.report(url), 'url')
  return {
    reports, snapshots, latest, status,
    source: (reportId: string) => store.source(reportId),
    importUrl,
    async importText(input: { url: string; title: string; publishedAt?: string | null; text: string }): Promise<ResearchImportResult> {
      const url = canonicalGlassnodeUrl(input.url), at = now()
      const title = input.title.trim(), paragraphs = normalizeResearchParagraphs(input.text)
      if (!title || title.length > 300 || input.text.length > 250_000 || paragraphs.length < 3 || paragraphs.length > 600 || paragraphs.join(' ').length < 400) throw new Error('Manual research content needs a title and complete legally usable report text within the content limit.')
      const publishedAt = publicResearchDate(input.publishedAt, at), period = /week-(\d+)-(\d{4})/.exec(url)
      return saveParsed({ url, title, publishedAt, reportPeriod: period ? `${period[2]}-W${period[1].padStart(2, '0')}` : null, paragraphs, contentHash: researchContentHash(paragraphs) }, 'manual')
    },
    discover(force = false): Promise<ResearchDiscoveryResult> {
      if (discovery) return discovery.then(async result => ({ ...result, status: await status() }))
      discovery = (async () => {
        const prior = await store.discovery(), at = now()
        const last = Date.parse(prior.lastCheckedAt ?? '')
        if (!force && Number.isFinite(last) && last <= at.getTime() && at.getTime() - last < DAY) return { checked: false, imported: false, report: (await reports()).at(-1) ?? null, status: await status() }
        try {
          const feed = await client.feed(), item = feed[0]
          if (!item) throw new Error('Glassnode feed contains no available public Week On-chain report.')
          let imported = false, report: ResearchReport | null = null, previousUnavailable = false
          // Bootstrap the prior issue when available, so a first real analysis
          // can compare two actual reports. Never retrieve more than two issues.
          for (const candidate of feed.slice(0, 2).reverse()) {
            try {
              const existing = (await reports()).find(row => row.url === candidate.url)
              const result = existing && !force ? { stored: false, report: existing } : await importUrl(candidate.url)
              imported ||= result.stored
              if (candidate.url === item.url) report = result.report
            } catch (error) { if (candidate.url === item.url) throw error; previousUnavailable = true }
          }
          if (!report) throw new Error('Glassnode latest report is unavailable.')
          await store.saveDiscovery({ lastCheckedAt: at.toISOString(), lastError: previousUnavailable ? 'Glassnode previous report is unavailable; the latest report remains available.' : null, latestReportId: report.id })
          return { checked: true, imported, report, status: await status() }
        } catch (error) {
          const message = error instanceof Error && /^(?:Glassnode|Only an official)/.test(error.message) ? error.message.slice(0, 240) : 'Glassnode research check failed; existing reports remain available.'
          await store.saveDiscovery({ ...prior, lastCheckedAt: at.toISOString(), lastError: message })
          return { checked: true, imported: false, report: (await reports()).at(-1) ?? null, status: await status() }
        }
      })().finally(() => { discovery = null })
      return discovery.then(async result => ({ ...result, status: await status() }))
    },
    publish(reportId: string, input: ResearchDraft, provenance: ResearchProvenance, context?: { allowedPreviousSnapshotIds: string[] }): Promise<ResearchSnapshot> {
      return serial(async () => {
        const report = (await reports()).find(row => row.id === reportId), at = now()
        if (!report) throw new Error('Research report is unavailable.')
        const source = await store.source(reportId)
        if (!source || source.contentHash !== report.contentHash || Date.parse(report.retrievedAt) > at.getTime() || report.publishedAt && Date.parse(report.publishedAt) > at.getTime()) throw new Error('Research input is unavailable or was not available at analysis time.')
        if (![provenance.workspaceId, provenance.runId, provenance.issueId, provenance.agent].every(value => typeof value === 'string' && value.length > 0 && value.length <= 200)) throw new Error('Research analysis requires native run provenance.')
        const all = await snapshots()
        const allowed = context ? new Set(context.allowedPreviousSnapshotIds) : null
        const previous = report.publishedAt ? all.filter(row => (!allowed || allowed.has(row.id)) && row.reportId !== report.id && row.publicationTime && row.publicationTime < report.publishedAt! && row.analysisTime <= at.toISOString()).sort((a, b) => a.publicationTime!.localeCompare(b.publicationTime!) || a.analysisTime.localeCompare(b.analysisTime)).at(-1) ?? null : null
        const draft = validateDraft(input, source, previous, report, at)
        const used = new Set<string>([draft.mainThesis, ...Object.values(draft.sections).flat(), ...draft.bullishEvidence, ...draft.bearishEvidence, ...draft.uncertainties, ...draft.limitations, ...draft.metrics.flatMap(metric => [metric.meaning, ...(metric.change ? [metric.change] : [])])].flatMap(c => c.evidenceIds)
          .concat(draft.metrics.flatMap(metric => metric.evidenceIds), draft.keyPriceLevels.flatMap(level => level.evidenceIds), draft.weeklyChanges.flatMap(change => change.currentEvidenceIds)))
        const cutoffs = new Map<string, Set<string>>()
        for (const item of [...draft.metrics, ...draft.keyPriceLevels]) if (item.dataAsOf) for (const id of item.evidenceIds) {
          const values = cutoffs.get(id) ?? new Set<string>()
          values.add(item.dataAsOf); cutoffs.set(id, values)
        }
        let excerptBudget = 800
        const evidence = source.paragraphs.filter(p => used.has(p.id)).map(p => {
          const size = Math.min(100, excerptBudget), excerpt = size > 0 ? p.excerpt!.slice(0, size) : undefined
          excerptBudget -= size
          const dates = cutoffs.get(p.id)
          return { ...p, dataAsOf: dates ? dates.size === 1 ? [...dates][0] : null : p.dataAsOf, ...(excerpt ? { excerpt } : { excerpt: undefined }) }
        })
        const row: ResearchSnapshot = { ...draft, schemaVersion: 1, id: `rs-${randomUUID()}`, asset: 'BTC', reportId: report.id, reportUrl: report.url,
          reportTitle: report.title, publicationTime: report.publishedAt, reportPeriod: report.reportPeriod, reportHash: report.contentHash, previousSnapshotId: previous?.id ?? null,
          analysisVersion: RESEARCH_ANALYSIS_VERSION, analysisTime: at.toISOString(), analysisModel: provenance.model ?? null, revision: all.filter(row => row.reportId === report.id).length + 1,
          provenance: { ...provenance }, evidence, recordHash: '' }
        row.recordHash = researchRecordHash(row)
        await store.publishSnapshot(row)
        return row
      })
    },
  }
}
export type ResearchService = ReturnType<typeof createResearchService>
