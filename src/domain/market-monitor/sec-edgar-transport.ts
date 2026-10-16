import { readFile } from 'node:fs/promises'
import { dataPath } from '../../core/paths.js'

export type SecEdgarAsset = 'TSLA' | 'MSTR'
export const COMPANIES = { TSLA: '0001318605', MSTR: '0001050446' } as const
export class SecEdgarError extends Error {}
class SecRequestFailure extends SecEdgarError {
  constructor(message: string, readonly retryable: boolean, readonly retryAt: number | null = null) { super(message) }
}
export interface SecEdgarRequestOptions { at?: Date; deadline?: number }
export interface SecEdgarDocument {
  asset: SecEdgarAsset
  url: string
  body: string
  retrievedAt: string
  /** Sanitized causes only, never response bodies or request configuration. */
  attemptFailures: string[]
}
export interface SecEdgarSubmissionsDocument extends SecEdgarDocument { payload: unknown }
export interface SecEdgarTransport {
  submissions(asset: SecEdgarAsset, options?: SecEdgarRequestOptions): Promise<SecEdgarSubmissionsDocument>
  archive(asset: SecEdgarAsset, accession: string, filename: string, options?: SecEdgarRequestOptions): Promise<SecEdgarDocument>
}
const CONTACT_FILE = dataPath('market-monitor', 'sec-contact.json')
const REQUEST_TIMEOUT_MS = 6_000
const REFRESH_BUDGET_MS = 12_500
const FAILURE_COOLDOWN_MS = 60_000
const MAX_BODY_BYTES = 2_000_000

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)
}
/** Private operator contact: never returned by a public-source reader. */
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
function accessionDigits(accession: string): string | null {
  return /^\d{10}-\d{2}-\d{6}$/.test(accession) ? accession.replaceAll('-', '') : /^\d{18}$/.test(accession) ? accession : null
}
const validFilename = (filename: string) => typeof filename === 'string' && filename.length <= 240 && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(filename) && !filename.includes('..')
/** Exact public archive allowlist; it is not a general HTTP proxy. */
export function isSecEdgarArchiveUrl(asset: SecEdgarAsset, input: string): boolean {
  if (!(Object.hasOwn(COMPANIES, asset))) return false
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.hostname !== 'www.sec.gov' || url.port || url.username || url.password || url.search || url.hash || url.href !== input) return false
    const match = /^\/Archives\/edgar\/data\/(\d+)\/(\d{18})\/([^/]+)$/.exec(url.pathname)
    return Boolean(match && match[1] === String(Number(COMPANIES[asset])) && validFilename(match[3]!))
  } catch { return false }
}
function retryAfter(response: Response, at: number): number | null {
  const value = response.headers.get('retry-after')
  if (value == null) return null
  const parsed = /^\d+$/.test(value) ? at + Number(value) * 1000 : Date.parse(value)
  return Number.isFinite(new Date(parsed).getTime()) && parsed >= at ? parsed : null
}
function requestFailure(error: unknown, aborted: boolean, stage: string): SecRequestFailure | SecEdgarError {
  if (error instanceof SecEdgarError) return error
  if (aborted || error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return new SecRequestFailure(`SEC ${stage} request timed out.`, true)
  if (error instanceof SyntaxError) {
    const incomplete = /unexpected end|unterminated string/i.test(error.message)
    return new SecRequestFailure(incomplete ? 'SEC returned incomplete submissions JSON.' : 'SEC returned invalid submissions JSON.', incomplete)
  }
  return new SecRequestFailure(`SEC ${stage} network or response failure.`, true)
}
function validateSubmissions(raw: unknown, asset: SecEdgarAsset): void {
  if (!raw || typeof raw !== 'object') throw new SecEdgarError('SEC returned an invalid submissions response')
  const payload = raw as { cik?: unknown; filings?: { recent?: Record<string, unknown> } }
  if (payload.cik != null && Number(payload.cik) !== Number(COMPANIES[asset])) throw new SecEdgarError('SEC submissions company identity does not match')
  const recent = payload.filings?.recent
  if (!recent || !Array.isArray(recent.form)) throw new SecEdgarError('SEC response is missing recent filings')
  if (recent.form.length && ['accessionNumber', 'filingDate', 'primaryDocument'].some(key => !Array.isArray(recent[key]) || recent[key].length !== (recent.form as unknown[]).length)) throw new SecEdgarError('SEC filing columns are incomplete')
}
async function bodyText(response: Response): Promise<string> {
  const length = response.headers.get('content-length')
  if (length && Number(length) > MAX_BODY_BYTES) { void response.body?.cancel().catch(() => undefined); throw new SecEdgarError('SEC response exceeds the public-document size limit.') }
  if (!response.body) return ''
  const reader = response.body.getReader(), decoder = new TextDecoder(), chunks: string[] = []
  let bytes = 0
  try {
    while (true) {
      const row = await reader.read()
      if (row.done) break
      bytes += row.value.byteLength
      if (bytes > MAX_BODY_BYTES) { void reader.cancel().catch(() => undefined); throw new SecEdgarError('SEC response exceeds the public-document size limit.') }
      chunks.push(decoder.decode(row.value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return chunks.join('')
  } finally { reader.releaseLock() }
}

/** One transport instance owns SEC-wide pacing, restrictions and request ownership
 * for both ordinary filing context and earnings evidence. */
export function createSecEdgarTransport(options: {
  fetcher?: typeof fetch; contactEmail?: () => Promise<string | null>; now?: () => number; wait?: (ms: number) => Promise<void>
} = {}): SecEdgarTransport {
  const fetcher = options.fetcher ?? fetch, contactEmail = options.contactEmail ?? loadSecContactEmail, now = options.now ?? Date.now
  const wait = options.wait ?? (ms => ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve())
  let gate = Promise.resolve(), nextRequestAt = 0, identity: string | null = null, blockedUntil = 0, blockReason = ''
  type Pending = { task: Promise<SecEdgarSubmissionsDocument>; deadline: number; expired: () => boolean }
  const inFlight = new Map<string, Pending>()
  const paused = () => `${blockReason} Retry paused until ${new Date(blockedUntil).toISOString()}.`
  const pause = (reason: string, until: number) => { if (until >= blockedUntil) { blockedUntil = until; blockReason = reason } }
  const request = (asset: SecEdgarAsset, url: string, stage: 'submissions' | 'archive', input: SecEdgarRequestOptions = {}): Promise<SecEdgarSubmissionsDocument> => {
    const startedAt = now(), deadline = Math.min(startedAt + REFRESH_BUDGET_MS, input.deadline ?? Infinity)
    if (!Number.isFinite(deadline) || deadline <= startedAt || input.at && !Number.isFinite(input.at.getTime())) return Promise.reject(new SecEdgarError(`SEC ${stage} refresh budget expired before the request could start.`))
    const pending = inFlight.get(url)
    if (pending) {
      if (pending.expired()) return Promise.reject(new SecEdgarError(`${blockReason} The prior aborted SEC request is still pending; no additional request will start until it settles.`))
      if (deadline >= pending.deadline) return pending.task
      let timer: ReturnType<typeof setTimeout>
      return Promise.race([pending.task, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SecEdgarError(`SEC ${stage} refresh budget expired while the shared request remains pending.`)), deadline - now()) })]).finally(() => clearTimeout(timer))
    }
    let email: string | null = null, expired = false, activeController: AbortController | undefined
    const failures: string[] = []
    const failureHistory = () => failures.map((reason, index) => `Attempt ${index + 1}: ${reason}`).join(' ')
    const work = (async (): Promise<SecEdgarSubmissionsDocument> => {
      try {
        email = await contactEmail()
        if (!validEmail(email)) throw new SecEdgarError('SEC contact email is not configured. Add contactEmail to local market-monitor/sec-contact.json; no API key is required.')
        if (identity !== email) { identity = email; blockedUntil = 0 }
        for (let attempt = 0; attempt < 2; attempt++) {
          const slot = gate.then(async () => {
            if (expired || now() >= deadline) throw new SecEdgarError(`SEC ${stage} refresh budget expired before the request could start.`)
            const startAt = Math.max(nextRequestAt, attempt ? blockedUntil : 0)
            if (startAt >= deadline) throw new SecEdgarError(paused())
            await wait(Math.max(0, startAt - now()))
            if (expired || now() >= deadline) throw new SecEdgarError(`SEC ${stage} refresh budget expired before the request could start.`)
            if (blockedUntil > now()) throw new SecEdgarError(paused())
            nextRequestAt = now() + 1000
          })
          gate = slot.catch(() => undefined)
          await slot
          const controller = new AbortController(); activeController = controller
          const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, deadline - now()))
          try {
            const response = await fetcher(url, { headers: { Accept: stage === 'submissions' || url.endsWith('.json') ? 'application/json' : 'text/html, text/plain;q=0.9', 'Accept-Encoding': 'gzip, deflate', 'User-Agent': `MAD42Lab Evidence Monitor/1.0 ${email}` }, redirect: 'error', signal: controller.signal })
            if (expired || controller.signal.aborted) throw new SecRequestFailure(`SEC ${stage} request timed out.`, true)
            if (!response.ok) {
              const status = response.status, requestedRetry = retryAfter(response, now())
              const reason = `SEC HTTP ${status}${status === 403 ? ': SEC denied access; a valid declaration may still require SEC to review the network address.' : status === 429 ? ': SEC request limit reached.' : `: ${stage} request failed.`}`
              const retryable = status >= 500 && status <= 599 || status === 429 && requestedRetry !== null
              const until = Math.max(now() + (status === 403 ? 15 * 60_000 : retryable && attempt === 0 ? 1000 : FAILURE_COOLDOWN_MS), requestedRetry ?? 0)
              pause(reason, until)
              if (status === 403) {
                const body = await bodyText(response).catch(() => '')
                if (/undeclared automated|unclassified bot/i.test(body)) pause('SEC HTTP 403: SEC rejected the automated-client declaration; verify the operator contact and network access.', until)
              } else void response.body?.cancel().catch(() => undefined)
              throw new SecRequestFailure(blockReason, retryable, requestedRetry)
            }
            const body = await bodyText(response)
            if (expired || controller.signal.aborted) throw new SecRequestFailure(`SEC ${stage} request timed out.`, true)
            const payload: unknown = stage === 'submissions' ? JSON.parse(body) : null
            if (stage === 'submissions') validateSubmissions(payload, asset)
            return { asset, url, retrievedAt: (input.at ?? new Date(startedAt)).toISOString(), body, payload, attemptFailures: [...failures] }
          } catch (error) {
            const failure = requestFailure(error, controller.signal.aborted, stage); failures.push(failure.message)
            const retryAt = failure instanceof SecRequestFailure ? failure.retryAt : null
            if (!expired && attempt === 0 && failure instanceof SecRequestFailure && failure.retryable && Math.max(now() + 250, retryAt ?? 0, blockedUntil) + 1000 < deadline) { await wait(Math.max(250, (retryAt ?? 0) - now())); continue }
            const detail = failures.length === 1 ? failures[0]! : `SEC ${stage} failed after ${failures.length} attempts. ${failureHistory()}`
            pause(detail, Math.max(now() + FAILURE_COOLDOWN_MS, retryAt ?? 0)); throw new SecEdgarError(paused())
          } finally { clearTimeout(timer); activeController = undefined }
        }
        throw new SecEdgarError(`SEC ${stage} refresh did not complete.`)
      } catch (error) {
        const message = requestFailure(error, expired, stage).message
        throw new SecEdgarError(email ? message.replaceAll(email, '[REDACTED CONTACT]') : message)
      }
    })()
    let budgetTimer: ReturnType<typeof setTimeout>
    const task = Promise.race([work, new Promise<never>((_, reject) => {
      budgetTimer = setTimeout(() => {
        expired = true; activeController?.abort()
        pause(`SEC ${stage} request timed out within the ${REFRESH_BUDGET_MS}ms refresh budget.${failures.length ? ` ${failureHistory()}` : ''}`, now() + FAILURE_COOLDOWN_MS)
        reject(new SecEdgarError(`${paused()} The prior request remains tracked until it settles.`))
      }, deadline - startedAt)
    })]).finally(() => clearTimeout(budgetTimer))
    const entry = { task, deadline, expired: () => expired }; inFlight.set(url, entry)
    const cleanup = () => { if (inFlight.get(url) === entry) inFlight.delete(url) }
    void work.then(cleanup, cleanup)
    return task
  }
  return {
    submissions(asset, input) {
      if (!(Object.hasOwn(COMPANIES, asset))) return Promise.reject(new SecEdgarError('Unsupported SEC company identity.'))
      return request(asset, `https://data.sec.gov/submissions/CIK${COMPANIES[asset]}.json`, 'submissions', input)
    },
    archive(asset, accession, filename, input) {
      const digits = accessionDigits(accession), url = Object.hasOwn(COMPANIES, asset) && digits && validFilename(filename) ? `https://www.sec.gov/Archives/edgar/data/${Number(COMPANIES[asset])}/${digits}/${filename}` : ''
      if (!url || !isSecEdgarArchiveUrl(asset, url)) return Promise.reject(new SecEdgarError('Invalid SEC public archive identity.'))
      return request(asset, url, 'archive', input)
    },
  }
}
