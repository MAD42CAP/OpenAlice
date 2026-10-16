import { readFile } from 'node:fs/promises'
import { dataPath } from '../../core/paths.js'
import type { MarketContextProviderResult, MarketMonitorFetch } from './context.js'
import type { MarketContext } from './types.js'

class SecEdgarError extends Error {}

class SecRequestFailure extends SecEdgarError {
  constructor(message: string, readonly retryable: boolean, readonly retryAt: number | null = null) {
    super(message)
  }
}

const COMPANIES = { TSLA: '0001318605', MSTR: '0001050446' } as const
const FORMS = new Set(['10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A'])
const CONTACT_FILE = dataPath('market-monitor', 'sec-contact.json')
const REQUEST_TIMEOUT_MS = 6_000
const REFRESH_BUDGET_MS = 12_500
const FAILURE_COOLDOWN_MS = 60_000

function retryAfter(response: Response, at: number): number | null {
  const value = response.headers.get('retry-after')
  if (value == null) return null
  const parsed = /^\d+$/.test(value) ? at + Number(value) * 1000 : Date.parse(value)
  return Number.isFinite(new Date(parsed).getTime()) && parsed >= at ? parsed : null
}

function requestFailure(error: unknown, aborted: boolean): SecRequestFailure | SecEdgarError {
  if (error instanceof SecEdgarError) return error
  if (aborted || error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new SecRequestFailure('SEC submissions request timed out.', true)
  }
  if (error instanceof SyntaxError) {
    const incomplete = /unexpected end|unterminated string/i.test(error.message)
    return new SecRequestFailure(incomplete ? 'SEC returned incomplete submissions JSON.' : 'SEC returned invalid submissions JSON.', incomplete)
  }
  // Arbitrary transport text can contain request headers or the operator contact.
  return new SecRequestFailure('SEC submissions network or response failure.', true)
}

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
  const wait = options.wait ?? (ms => ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve())
  let gate = Promise.resolve()
  let nextRequestAt = 0
  let identity: string | null = null
  let blockedUntil = 0
  let blockReason = ''
  const inFlight = new Map<string, { task: Promise<MarketContextProviderResult>; expired: () => boolean; pending: () => MarketContextProviderResult }>()

  return (asset: keyof typeof COMPANIES, at: Date): Promise<MarketContextProviderResult> => {
    const pending = inFlight.get(asset)
    if (pending) return pending.expired() ? Promise.resolve(pending.pending()) : pending.task
    const health = { id: `${asset.toLowerCase()}-sec-filings`, label: `${asset} SEC filings`, provider: 'SEC EDGAR' }
    const startedAt = now(), deadline = startedAt + REFRESH_BUDGET_MS
    let email: string | null = null
    let expired = false
    let activeController: AbortController | undefined
    const failures: string[] = []
    const failureHistory = () => failures.map((reason, index) => `Attempt ${index + 1}: ${reason}`).join(' ')
    const unavailable = (detail: string): MarketContextProviderResult => ({
      context: {}, health: [{ ...health, status: 'unavailable', asOf: null, detail: email ? detail.replaceAll(email, '[REDACTED CONTACT]') : detail }],
    })
    const paused = () => `${blockReason} Retry paused until ${new Date(blockedUntil).toISOString()}.`
    const pause = (reason: string, until: number) => {
      // A later transient failure cannot shorten another request's SEC restriction.
      if (until >= blockedUntil) { blockedUntil = until; blockReason = reason }
    }
    const work = (async (): Promise<MarketContextProviderResult> => {
      try {
        email = await contactEmail()
        if (!validEmail(email)) throw new SecEdgarError('SEC contact email is not configured. Add contactEmail to local market-monitor/sec-contact.json; no API key is required.')
        if (identity !== email) { identity = email; blockedUntil = 0 }
        for (let attempt = 0; attempt < 2; attempt++) {
          // Retries use the same cross-company start queue as initial requests.
          const slot = gate.then(async () => {
            if (expired || now() >= deadline) throw new SecEdgarError('SEC submissions refresh budget expired before the request could start.')
            const startAt = Math.max(nextRequestAt, attempt ? blockedUntil : 0)
            if (startAt >= deadline) throw new SecEdgarError(paused())
            await wait(Math.max(0, startAt - now()))
            if (expired || now() >= deadline) throw new SecEdgarError('SEC submissions refresh budget expired before the request could start.')
            if (blockedUntil > now()) throw new SecEdgarError(paused())
            nextRequestAt = now() + 1000
          })
          gate = slot.catch(() => undefined)
          await slot
          const controller = new AbortController()
          activeController = controller
          const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, deadline - now()))
          try {
            const response = await fetcher(`https://data.sec.gov/submissions/CIK${COMPANIES[asset]}.json`, {
              headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'User-Agent': `MAD42Lab Evidence Monitor/1.0 ${email}` },
              redirect: 'error', signal: controller.signal,
            })
            if (expired || controller.signal.aborted) throw new SecRequestFailure('SEC submissions request timed out.', true)
            if (!response.ok) {
              const status = response.status, requestedRetry = retryAfter(response, now())
              // Declare access restrictions before reading the diagnostic body, which
              // may itself fail or stall. Never persist that body's arbitrary text.
              const reason = `SEC HTTP ${status}${status === 403 ? ': SEC denied access; a valid declaration may still require SEC to review the network address.' : status === 429 ? ': SEC request limit reached.' : ': submissions request failed.'}`
              const retryable = status >= 500 && status <= 599 || status === 429 && requestedRetry !== null
              const until = Math.max(now() + (status === 403 ? 15 * 60_000 : retryable && attempt === 0 ? 1000 : FAILURE_COOLDOWN_MS), requestedRetry ?? 0)
              pause(reason, until)
              if (status === 403) {
                const body = await response.text().catch(() => '')
                if (/undeclared automated|unclassified bot/i.test(body)) {
                  pause('SEC HTTP 403: SEC rejected the automated-client declaration; verify the operator contact and network access.', until)
                }
              } else {
                // No body is needed to classify retryable HTTP failures.
                void response.body?.cancel().catch(() => undefined)
              }
              throw new SecRequestFailure(blockReason, retryable, requestedRetry)
            }
            const raw: unknown = await response.json()
            if (expired || controller.signal.aborted) throw new SecRequestFailure('SEC submissions request timed out.', true)
            const filings = parseFilings(raw, COMPANIES[asset])
            return { context: { recentFilings: filings }, health: [{ ...health, status: 'ok', asOf: at.toISOString(), detail: `${filings.length} recent material filings loaded from the official submissions feed.${failures.length ? ` Recovered after one retry (${failures[0]})` : ''}` }] }
          } catch (error) {
            const failure = requestFailure(error, controller.signal.aborted)
            failures.push(failure.message)
            const retryAt = failure instanceof SecRequestFailure ? failure.retryAt : null
            if (!expired && attempt === 0 && failure instanceof SecRequestFailure && failure.retryable && Math.max(now() + 250, retryAt ?? 0, blockedUntil) + 1000 < deadline) {
              await wait(Math.max(250, (retryAt ?? 0) - now()))
              continue
            }
            const detail = failures.length === 1 ? failures[0] : `SEC submissions failed after ${failures.length} attempts. ${failureHistory()}`
            pause(detail, Math.max(now() + FAILURE_COOLDOWN_MS, retryAt ?? 0))
            throw new SecEdgarError(paused())
          } finally {
            clearTimeout(timer)
            activeController = undefined
          }
        }
        throw new SecEdgarError('SEC submissions refresh did not complete.')
      } catch (error) {
        // Never persist a server body, contact value, request headers or filesystem path.
        return unavailable(requestFailure(error, expired).message)
      }
    })()
    let budgetTimer: ReturnType<typeof setTimeout>
    const task = Promise.race([work, new Promise<MarketContextProviderResult>(resolve => {
      budgetTimer = setTimeout(() => {
        expired = true
        activeController?.abort()
        pause(`SEC submissions request timed out within the ${REFRESH_BUDGET_MS}ms refresh budget.${failures.length ? ` ${failureHistory()}` : ''}`, now() + FAILURE_COOLDOWN_MS)
        resolve(unavailable(`${paused()} The prior request remains tracked until it settles.`))
      }, REFRESH_BUDGET_MS)
    })]).finally(() => { clearTimeout(budgetTimer) })
    const entry = { task, expired: () => expired, pending: () => unavailable(`${blockReason} The prior aborted SEC request is still pending; no additional request will start until it settles.`) }
    inFlight.set(asset, entry)
    // An upstream implementation may ignore abort. Return promptly, but retain its
    // ownership until settlement; later scans must not overlap or accept late data.
    void work.finally(() => { if (inFlight.get(asset) === entry) inFlight.delete(asset) })
    return task
  }
}
