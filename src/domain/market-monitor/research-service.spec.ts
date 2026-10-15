import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResearchService } from './research-service.js'
import { createResearchStore, researchRecordHash } from './research-store.js'
import { RESEARCH_SECTION_KEYS, type ResearchDraft, type ResearchSource } from './research-types.js'

const URL = 'https://research.glassnode.com/the-week-onchain-week-41-2026/'
const OLD_URL = 'https://research.glassnode.com/the-week-onchain-week-40-2026/'
const AT = new Date('2026-10-14T20:00:00Z')
const paragraphs = [
  'Bitcoin faces a source-reported resistance zone at $88K. This synthetic public report describes price structure and demand confirmation. Data as-of October 13, 2026.',
  'ETF flows total $225.3 million and long-term holder selling has eased. These observations do not establish that a market bottom has formed. Demand recovery still requires confirmation.',
  'The report offers conditional interpretations rather than deterministic predictions. A close below support would challenge the recovery hypothesis. Report readers must also consider contradictory price evidence and the sampling limitations.',
]
const input = { url: URL, title: 'Synthetic public research', publishedAt: '2026-10-14T15:00:00Z', text: paragraphs.join('\n\n') }
const provenance = { workspaceId: 'workspace-test', runId: 'run-test', issueId: 'research-test', agent: 'codex', model: 'test-native-model' }
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function setup(fetcher = vi.fn<typeof fetch>()) {
  const root = await mkdtemp(join(tmpdir(), 'research-intelligence-')); roots.push(root)
  const store = createResearchStore(root)
  let at = AT
  const service = createResearchService({ store, fetch: fetcher, now: () => at })
  return { root, store, service, fetcher, clock: (value: Date) => { at = value } }
}
function draft(source: ResearchSource): ResearchDraft {
  const evidenceIds = [source.paragraphs[0].id]
  const fact = { text: '报告提出有条件的修复判断，价格仍需要需求确认。', evidenceIds, inference: false }
  const limitation = { text: '资料有限，尚不能确认市场底部。', evidenceIds: [], inference: true }
  return {
    dataAsOf: null, mainThesis: fact,
    sections: Object.fromEntries(RESEARCH_SECTION_KEYS.map(key => [key, [key === 'independentView' ? limitation : fact]])) as ResearchDraft['sections'],
    metrics: [], keyPriceLevels: [{ label: '报告中的压力参考位', price: 88_000, unit: 'USD', role: 'resistance', dataAsOf: '2026-10-13T00:00:00Z', evidenceIds }],
    bullishEvidence: [fact], bearishEvidence: [], uncertainties: [limitation], limitations: [limitation], weeklyChanges: [],
  }
}
function html(text: string, published = '2026-10-14T15:00:00Z') {
  return `<html><head><meta property="og:title" content="Synthetic report"><meta property="article:published_time" content="${published}"></head><body><section class="post-content">${text.split('\n\n').map(p => `<p>${p}</p>`).join('')}</section></body></html>`
}
function rss() {
  return `<rss><channel><item><title>Week 41</title><link>${URL}</link><pubDate>Wed, 14 Oct 2026 15:00:00 GMT</pubDate></item><item><title>Week 40</title><link>${OLD_URL}</link><pubDate>Wed, 07 Oct 2026 15:00:00 GMT</pubDate></item></channel></rss>`
}

describe('Structured, immutable Glassnode research', () => {
  it('imports original content privately, exposes only metadata, and deduplicates concurrent copies', async () => {
    const { service, root, fetcher } = await setup()
    const [first, repeated] = await Promise.all([service.importText(input), service.importText(input)])
    expect(first.stored).toBe(true); expect(repeated).toEqual({ ...first, stored: false })
    expect(fetcher).not.toHaveBeenCalled()
    const source = await service.source(first.report.id)
    expect(source?.paragraphs.map(p => p.excerpt)).toEqual(paragraphs)
    expect(source?.paragraphs[0]).toMatchObject({ dataAsOf: '2026-10-13T00:00:00.000Z', publishedAt: '2026-10-14T15:00:00.000Z', retrievedAt: AT.toISOString() })
    expect((await stat(`${root}/sources/${first.report.id}.json`)).mode & 0o777).toBe(0o600)
    expect((await service.reports())[0]).not.toHaveProperty('paragraphs')
    expect(JSON.stringify(await service.reports())).not.toContain(paragraphs[2])
    expect(first.report.preview.length).toBeLessThanOrEqual(180)
    expect(await service.status()).toMatchObject({ state: 'never-checked', pendingReportIds: [first.report.id] })
  })

  it('publishes evidence-backed Chinese sections and retains new analysis versions', async () => {
    const { service } = await setup()
    const { report } = await service.importText(input), source = (await service.source(report.id))!
    const before = JSON.stringify(source)
    const first = await service.publish(report.id, draft(source), provenance)
    const second = await service.publish(report.id, { ...draft(source), mainThesis: { ...draft(source).mainThesis, text: '新增反面解释，维持有条件的研究结论。' } }, { ...provenance, runId: 'run-second' })
    expect(first).toMatchObject({ reportId: report.id, revision: 1, previousSnapshotId: null, analysisModel: 'test-native-model' })
    expect(first.evidence[0].dataAsOf).toBe('2026-10-13T00:00:00.000Z')
    expect(second.revision).toBe(2)
    expect(second.id).not.toBe(first.id)
    expect(first.recordHash).toBe(researchRecordHash(first))
    expect(await service.snapshots()).toEqual([first, second])
    expect(await service.latest()).toEqual(second)
    expect(await service.status()).toMatchObject({ pendingReportIds: [] })
    expect(JSON.stringify(await service.source(report.id))).toBe(before)
    expect(JSON.stringify(first)).not.toContain(paragraphs[0])
  })

  it('refuses invented references, prices, metric values, cutoffs and unsupported factual claims', async () => {
    const { service } = await setup()
    const { report } = await service.importText(input), source = (await service.source(report.id))!
    const base = draft(source)
    const invented = source.paragraphs[0].id.replace(/.{12}$/, '000000000000')
    await expect(service.publish(report.id, { ...base, mainThesis: { ...base.mainThesis, evidenceIds: [invented] } }, provenance)).rejects.toThrow('outside its frozen report')
    await expect(service.publish(report.id, { ...base, mainThesis: { ...base.mainThesis, evidenceIds: [] } }, provenance)).rejects.toThrow('structured Chinese')
    await expect(service.publish(report.id, { ...base, keyPriceLevels: [{ ...base.keyPriceLevels[0], price: 99_999 }] }, provenance)).rejects.toThrow('not present')
    await expect(service.publish(report.id, { ...base, keyPriceLevels: [{ ...base.keyPriceLevels[0], price: 2026 }] }, provenance)).rejects.toThrow('not present')
    await expect(service.publish(report.id, { ...base, keyPriceLevels: [{ ...base.keyPriceLevels[0], dataAsOf: '2026-10-12T00:00:00Z' }] }, provenance)).rejects.toThrow('explicit date')
    await expect(service.publish(report.id, { ...base, dataAsOf: '2026-10-15T00:00:00Z' }, provenance)).rejects.toThrow('after publication')
    await expect(service.publish(report.id, { ...base, metrics: [{ name: 'MVRV', value: 1.234, unit: 'ratio', dataAsOf: null, kind: 'observation', evidenceIds: [source.paragraphs[0].id], meaning: base.mainThesis, change: null }] }, provenance)).rejects.toThrow('not present')
    await expect(service.publish(report.id, { ...base, metrics: [{ name: 'MVRV', value: '9.7 ratio', unit: 'ratio', dataAsOf: null, kind: 'inference', evidenceIds: [], meaning: { ...base.mainThesis, evidenceIds: [], inference: true }, change: null }] }, provenance)).rejects.toThrow('not present')
    expect(await service.snapshots()).toEqual([])
  })

  it('accepts explicit K and million normalization and does not invent missing cutoff dates', async () => {
    const { service } = await setup()
    const { report } = await service.importText(input), source = (await service.source(report.id))!, base = draft(source)
    const result = await service.publish(report.id, { ...base, metrics: [{ name: 'ETF flows', value: 225_300_000, unit: 'USD', dataAsOf: null, kind: 'observation', evidenceIds: [source.paragraphs[1].id], meaning: { ...base.mainThesis, evidenceIds: [source.paragraphs[1].id] }, change: null }] }, provenance)
    expect(result.metrics[0].dataAsOf).toBeNull()
    expect(result.keyPriceLevels[0].price).toBe(88_000)
    expect(result.evidence.find(row => row.id === source.paragraphs[1].id)?.dataAsOf).toBeNull()
  })

  it('normalizes date-only cutoffs and refuses invented intraday precision for every date field', async () => {
    const { service } = await setup()
    const report = (await service.importText(input)).report, source = (await service.source(report.id))!, base = draft(source)
    const precise = '2026-10-13T14:30:00Z'
    await expect(service.publish(report.id, { ...base, dataAsOf: precise }, provenance)).rejects.toThrow('UTC midnight')
    await expect(service.publish(report.id, { ...base, keyPriceLevels: [{ ...base.keyPriceLevels[0], dataAsOf: precise }] }, provenance)).rejects.toThrow('UTC midnight')
    await expect(service.publish(report.id, { ...base, metrics: [{ name: 'Price', value: 88_000, unit: 'USD', dataAsOf: precise, kind: 'observation', evidenceIds: [source.paragraphs[0].id], meaning: base.mainThesis, change: null }] }, provenance)).rejects.toThrow('UTC midnight')
    const result = await service.publish(report.id, { ...base, dataAsOf: '2026-10-13T00:00:00+00:00' }, provenance)
    expect(result.dataAsOf).toBe('2026-10-13T00:00:00.000Z')
    expect(result.keyPriceLevels[0].dataAsOf).toBe('2026-10-13T00:00:00.000Z')
    expect(result.evidence[0].dataAsOf).toBe('2026-10-13T00:00:00.000Z')
  })

  it('retains an intraday cutoff only when the exact timestamp is in a cited source paragraph', async () => {
    const { service } = await setup()
    const report = (await service.importText({ ...input, text: input.text.replace('October 13, 2026.', '2026-10-13T14:30:00Z.') })).report
    const source = (await service.source(report.id))!, base = draft(source)
    const result = await service.publish(report.id, { ...base, keyPriceLevels: [{ ...base.keyPriceLevels[0], dataAsOf: '2026-10-13T14:30:00Z' }] }, provenance)
    expect(result.keyPriceLevels[0].dataAsOf).toBe('2026-10-13T14:30:00.000Z')
    expect(result.evidence[0].dataAsOf).toBe('2026-10-13T14:30:00.000Z')
  })

  it('compares only two available report snapshots and keeps older analysis from becoming current', async () => {
    const { service } = await setup()
    const oldInput = { ...input, url: OLD_URL, title: 'Prior actual issue', publishedAt: '2026-10-07T15:00:00Z', text: input.text.replaceAll('October 13', 'October 6').replace('$88K', '$86K') }
    const priorReport = (await service.importText(oldInput)).report, priorSource = (await service.source(priorReport.id))!, priorDraft = draft(priorSource)
    priorDraft.keyPriceLevels = [{ ...priorDraft.keyPriceLevels[0], price: 86_000, dataAsOf: '2026-10-06T00:00:00Z' }]
    const old = await service.publish(priorReport.id, priorDraft, provenance)
    const report = (await service.importText(input)).report, source = (await service.source(report.id))!
    const current = await service.publish(report.id, { ...draft(source), weeklyChanges: [{ topic: '成本区域', text: '报告中的价格参考区间发生变化，尚不能确认需求恢复。', currentEvidenceIds: [source.paragraphs[0].id], previousEvidenceIds: [old.evidence[0].id], inference: true }] }, provenance)
    expect(current.previousSnapshotId).toBe(old.id)
    expect(current.weeklyChanges).toHaveLength(1)
    await service.publish(priorReport.id, priorDraft, { ...provenance, runId: 'late-old-reanalysis' })
    expect((await service.latest())?.id).toBe(current.id)
  })

  it('does not manufacture a previous week or accept evidence unavailable at a historical analysis time', async () => {
    const { service, clock } = await setup()
    const report = (await service.importText(input)).report, source = (await service.source(report.id))!
    await expect(service.publish(report.id, { ...draft(source), weeklyChanges: [{ topic: '上周', text: '假设的周度变化', currentEvidenceIds: [source.paragraphs[0].id], previousEvidenceIds: [source.paragraphs[1].id], inference: true }] }, provenance)).rejects.toThrow('earlier available')
    clock(new Date('2026-10-13T20:00:00Z'))
    await expect(service.publish(report.id, draft(source), provenance)).rejects.toThrow('not available at analysis time')
  })

  it('freezes the allowed previous version while permitting earlier same-run publication', async () => {
    const { service } = await setup()
    const priorReport = (await service.importText({ ...input, url: OLD_URL, publishedAt: '2026-10-07T15:00:00Z', text: input.text.replaceAll('October 13', 'October 6').replace('$88K', '$86K') })).report
    const priorSource = (await service.source(priorReport.id))!, priorDraft = draft(priorSource)
    priorDraft.keyPriceLevels = [{ ...priorDraft.keyPriceLevels[0], price: 86_000, dataAsOf: '2026-10-06T00:00:00Z' }]
    const first = await service.publish(priorReport.id, priorDraft, provenance)
    const later = await service.publish(priorReport.id, priorDraft, { ...provenance, runId: 'later-unrelated-run' })
    const report = (await service.importText(input)).report, source = (await service.source(report.id))!
    const result = await service.publish(report.id, draft(source), provenance, { allowedPreviousSnapshotIds: [first.id] })
    expect(result.previousSnapshotId).toBe(first.id)
    expect(result.previousSnapshotId).not.toBe(later.id)
    const withoutPrevious = await service.publish(report.id, draft(source), provenance, { allowedPreviousSnapshotIds: [] })
    expect(withoutPrevious.previousSnapshotId).toBeNull()
  })

  it('loads the two latest public issues once daily and resumes the persisted due check after restart', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith('/rss/')
      ? new Response(rss(), { headers: { 'content-type': 'application/rss+xml' } })
      : new Response(String(url) === OLD_URL ? html(input.text.replace('October 13', 'October 6').replace('$88K', '$86K'), '2026-10-07T15:00:00Z') : html(input.text), { headers: { 'content-type': 'text/html' } }))
    const { service, store } = await setup(fetcher)
    const first = await service.discover()
    expect(first).toMatchObject({ checked: true, imported: true, status: { state: 'current', lastCheckedAt: AT.toISOString() } })
    expect(await service.reports()).toHaveLength(2)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect((await service.discover()).checked).toBe(false)
    const restarted = createResearchService({ store, fetch: fetcher, now: () => new Date(AT.getTime() + 25 * 60 * 60_000) })
    expect((await restarted.discover()).checked).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(await restarted.reports()).toHaveLength(2)
  })

  it('preserves prior reports when a daily check fails and makes retry explicit', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private Authorization body'))
    const { service } = await setup(fetcher)
    const { report } = await service.importText(input)
    const result = await service.discover(true)
    expect(result).toMatchObject({ checked: true, imported: false, report, status: { state: 'failed', lastError: 'Glassnode public source network or response failure.' } })
    expect(await service.reports()).toEqual([report])
    expect(JSON.stringify(result)).not.toContain('Authorization')
  })

  it.each([true, false])('returns the settled status to concurrent discover callers (success: %s)', async success => {
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).endsWith('/rss/')) {
        await held
        if (!success) throw new Error('unavailable transport')
        return new Response(rss(), { headers: { 'content-type': 'application/rss+xml' } })
      }
      return new Response(String(url) === OLD_URL ? html(input.text.replace('October 13', 'October 6').replace('$88K', '$86K'), '2026-10-07T15:00:00Z') : html(input.text), { headers: { 'content-type': 'text/html' } })
    })
    const { service } = await setup(fetcher)
    const first = service.discover(true), second = service.discover(true)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect((await service.status()).state).toBe('checking')
    release()
    const results = await Promise.all([first, second])
    expect(results.map(result => result.status.state)).toEqual(success ? ['current', 'current'] : ['failed', 'failed'])
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/rss/'))).toHaveLength(1)
  })

  it('detects tampering with both original source and immutable snapshot files', async () => {
    const { service, root } = await setup()
    const { report } = await service.importText(input), source = (await service.source(report.id))!
    const snapshot = await service.publish(report.id, draft(source), provenance)
    const original = `${root}/sources/${report.id}.json`
    const changed = JSON.parse(await readFile(original, 'utf8'))
    changed.paragraphs[0].excerpt += ' Invented mutation.'
    await writeFile(original, JSON.stringify(changed))
    await expect(service.source(report.id)).rejects.toThrow('integrity')
    const path = `${root}/snapshots/${snapshot.id}.json`, row = JSON.parse(await readFile(path, 'utf8'))
    row.mainThesis.text = '覆盖历史观点'
    await writeFile(path, JSON.stringify(row))
    await expect(service.snapshots()).rejects.toThrow('integrity')
  })
})
