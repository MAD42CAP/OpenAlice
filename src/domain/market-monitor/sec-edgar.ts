import { COMPANIES, SecEdgarError, createSecEdgarTransport, type SecEdgarTransport } from './sec-edgar-transport.js'
import type { MarketContextProviderResult, MarketMonitorFetch } from './context.js'
import type { MarketContext } from './types.js'
export { loadSecContactEmail } from './sec-edgar-transport.js'

const FORMS = new Set(['10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A'])

function parseFilings(raw: unknown, cik: string): NonNullable<MarketContext['recentFilings']> {
  if (!raw || typeof raw !== 'object') throw new SecEdgarError('SEC returned an invalid submissions response')
  const payload = raw as { cik?: unknown; filings?: { recent?: Record<string, unknown> } }
  if (payload.cik != null && Number(payload.cik) !== Number(cik)) throw new SecEdgarError('SEC submissions company identity does not match')
  const recent = payload.filings?.recent
  if (!recent || !Array.isArray(recent.form)) throw new SecEdgarError('SEC response is missing recent filings')
  const columns = ['accessionNumber', 'filingDate', 'primaryDocument'] as const
  if (recent.form.length && columns.some(key => !Array.isArray(recent[key]) || recent[key].length !== (recent.form as unknown[]).length)) throw new SecEdgarError('SEC filing columns are incomplete')
  const rows: NonNullable<MarketContext['recentFilings']> = []
  const field = (key: string, index: number) => Array.isArray(recent[key]) && typeof recent[key][index] === 'string' ? recent[key][index] as string : ''
  for (let i = 0; i < recent.form.length && rows.length < 6; i++) {
    const form = field('form', i), accession = field('accessionNumber', i), date = field('filingDate', i), document = field('primaryDocument', i)
    if (!FORMS.has(form)) continue
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[\w.-]+$/.test(document)) throw new SecEdgarError('SEC returned an invalid material filing')
    const report = field('reportDate', i)
    rows.push({ form, filingDate: date, reportDate: /^\d{4}-\d{2}-\d{2}$/.test(report) ? report : null,
      description: field('primaryDocDescription', i).trim() || null,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/${encodeURIComponent(document)}` })
  }
  return rows
}

export function createSecEdgarContext(options: {
  fetcher?: MarketMonitorFetch
  contactEmail?: () => Promise<string | null>
  now?: () => number
  wait?: (ms: number) => Promise<void>
  transport?: SecEdgarTransport
} = {}) {
  const transport = options.transport ?? createSecEdgarTransport(options)
  const inFlight = new Map<string, Promise<MarketContextProviderResult>>()
  return (asset: keyof typeof COMPANIES, at: Date): Promise<MarketContextProviderResult> => {
    const pending = inFlight.get(asset)
    if (pending) return pending
    const health = { id: `${asset.toLowerCase()}-sec-filings`, label: `${asset} SEC filings`, provider: 'SEC EDGAR' }
    const task: Promise<MarketContextProviderResult> = transport.submissions(asset, { at }).then<MarketContextProviderResult>(document => {
      const filings = parseFilings(document.payload, COMPANIES[asset])
      return { context: { recentFilings: filings }, health: [{ ...health, status: 'ok', asOf: document.retrievedAt,
        detail: `${filings.length} recent material filings loaded from the official submissions feed.${document.attemptFailures.length ? ` Recovered after one retry (${document.attemptFailures[0]})` : ''}` }] }
    }).catch(error => ({ context: {}, health: [{ ...health, status: 'unavailable', asOf: null,
      detail: error instanceof SecEdgarError ? error.message : 'SEC submissions network or response failure.' }] }))
    inFlight.set(asset, task)
    void task.then(() => { if (inFlight.get(asset) === task) inFlight.delete(asset) })
    return task
  }
}
