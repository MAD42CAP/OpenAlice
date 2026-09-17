import { readFile } from 'node:fs/promises'
import { dataPath } from '../../core/paths.js'
import type { MarketContextProviderResult, MarketMonitorFetch } from './context.js'
import type { MarketContext } from './types.js'

class SecEdgarError extends Error {}

const COMPANIES = { TSLA: '0001318605', MSTR: '0001050446' } as const
const FORMS = new Set(['10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A'])
const CONTACT_FILE = dataPath('market-monitor', 'sec-contact.json')

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)
}

/** Private operator contact, kept out of public settings, snapshots and errors. */
export async function loadSecContactEmail(file = CONTACT_FILE): Promise<string | null> {
  try {
    const config: unknown = JSON.parse(await readFile(file, 'utf8'))
    const email = config && typeof config === 'object' && 'contactEmail' in config ? config.contactEmail : null
    if (!validEmail(email)) throw new SecEdgarError('invalid contact')
    return email
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new SecEdgarError('SEC contact configuration could not be read or is invalid. Check local market-monitor/sec-contact.json.')
  }
}

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
} = {}) {
  const fetcher = options.fetcher ?? fetch
  const contactEmail = options.contactEmail ?? loadSecContactEmail
  const now = options.now ?? Date.now
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  let gate = Promise.resolve()
  let nextRequestAt = 0
  let identity: string | null = null
  let blockedUntil = 0
  let blockReason = ''
  const inFlight = new Map<string, Promise<MarketContextProviderResult>>()

  return (asset: keyof typeof COMPANIES, at: Date): Promise<MarketContextProviderResult> => {
    const pending = inFlight.get(asset)
    if (pending) return pending
    const task = (async (): Promise<MarketContextProviderResult> => {
      const health = { id: `${asset.toLowerCase()}-sec-filings`, label: `${asset} SEC filings`, provider: 'SEC EDGAR' }
      let email: string | null = null
      try {
        email = await contactEmail()
        if (!validEmail(email)) throw new SecEdgarError('SEC contact email is not configured. Add contactEmail to local market-monitor/sec-contact.json; no API key is required.')
        if (identity !== email) { identity = email; blockedUntil = 0 }
        // One shared queue for both equities; requests start at most once a second.
        const slot = gate.then(async () => { await wait(Math.max(0, nextRequestAt - now())); nextRequestAt = now() + 1000 })
        gate = slot.catch(() => undefined)
        await slot
        if (blockedUntil > now()) throw new SecEdgarError(`${blockReason} Retry paused until ${new Date(blockedUntil).toISOString()}.`)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10_000)
        try {
          const response = await fetcher(`https://data.sec.gov/submissions/CIK${COMPANIES[asset]}.json`, {
            headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'User-Agent': `MAD42Lab Evidence Monitor/1.0 ${email}` },
            redirect: 'error', signal: controller.signal,
          })
          if (!response.ok) {
            const body = await response.text()
            const undeclared = /undeclared automated|unclassified bot/i.test(body)
            blockReason = `SEC HTTP ${response.status}${undeclared ? ': SEC rejected the automated-client declaration; verify the operator contact and network access.' : response.status === 403 ? ': SEC denied access; a valid declaration may still require SEC to review the network address.' : response.status === 429 ? ': SEC request limit reached.' : ': submissions request failed.'}`
            const retry = response.headers.get('retry-after')
            const seconds = retry != null && /^\d+$/.test(retry) ? Number(retry) : null
            const retryAt = seconds == null ? Date.parse(retry ?? '') : now() + seconds * 1000
            blockedUntil = Math.max(now() + (response.status === 403 ? 15 * 60_000 : 60_000), Number.isFinite(retryAt) ? retryAt : 0)
            throw new SecEdgarError(`${blockReason} Retry paused until ${new Date(blockedUntil).toISOString()}.`)
          }
          const filings = parseFilings(await response.json(), COMPANIES[asset])
          return { context: { recentFilings: filings }, health: [{ ...health, status: 'ok', asOf: at.toISOString(), detail: `${filings.length} recent material filings loaded from the official submissions feed.` }] }
        } finally { clearTimeout(timer) }
      } catch (error) {
        // Never persist a server body, contact value, request headers or filesystem path.
        const message = error instanceof Error ? error.message : ''
        const detail = error instanceof SecEdgarError ? message : error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError') ? 'SEC submissions request timed out.' : 'SEC submissions network or response failure.'
        return { context: {}, health: [{ ...health, status: 'unavailable', asOf: null, detail: email ? detail.replaceAll(email, '[REDACTED CONTACT]') : detail }] }
      }
    })().finally(() => { inFlight.delete(asset) })
    inFlight.set(asset, task)
    return task
  }
}
