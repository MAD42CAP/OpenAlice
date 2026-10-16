import { createHash } from 'node:crypto'
import { isSecEdgarArchiveUrl, SecEdgarError } from './sec-edgar-transport.js'
import { SecEarningsError } from './sec-earnings.js'

export type OfficialEarningsAsset = 'TSLA' | 'MSTR'
export interface OfficialEarningsResult {
  asset: OfficialEarningsAsset
  status: 'confirmed' | 'unannounced' | 'conflict'
  date: string | null
  timing: 'after-close' | 'before-open' | 'unknown'
  webcastAt: string | null
  sourceUrl: string
  title: string
  publishedAt: string | null
  retrievedAt: string
  contentHash: string
  verification: 'live-official' | 'research-reviewed'
  detail: string
}

const INDEX = { TSLA: 'https://ir.tesla.com/', MSTR: 'https://www.strategy.com/press' } as const
const TIMEOUT = 6_000
const MAX_BYTES = 2_000_000
const CACHE_MS = 5 * 3_600_000
const REVIEW_TTL = 24 * 3_600_000
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const ENGLISH_DATE = '(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+20\\d{2}'
const WEEKDAY = '(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\\s+)?'
const clock = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
class OfficialEarningsError extends Error {}
const failure = (message: string) => new OfficialEarningsError(`Official earnings ${message}`)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const sessionDay = (at: Date) => clock.formatToParts(at).filter(p => ['year', 'month', 'day'].includes(p.type)).map(p => p.value).join('-')
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day

function decode(value: string): string {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, token: string) => {
    const point = token[0].toLowerCase() === 'x' ? Number.parseInt(token.slice(1), 16) : Number(token)
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
  }).replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash|rsquo|lsquo);/gi, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' })[name.toLowerCase()] ?? '')
}
function inertHtml(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template|noscript|svg|iframe)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
}
const text = (html: string) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return match ? decode(match[1] ?? match[2]) : null
}
function englishDay(value: string): string | null {
  const match = new RegExp(`\\b(${ENGLISH_DATE})\\b`, 'i').exec(value)
  if (!match) return null
  const parts = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})$/i.exec(match[1])!
  const day = `${parts[3]}-${String(MONTHS.indexOf(parts[1].toLowerCase()) + 1).padStart(2, '0')}-${parts[2].padStart(2, '0')}`
  return validDay(day) ? day : null
}
function canonical(asset: OfficialEarningsAsset, href: string, index = false): string | null {
  try {
    const url = new URL(href, INDEX[asset]), base = new URL(INDEX[asset])
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash) return null
    const allowed = index ? url.pathname === base.pathname : asset === 'TSLA' ? /^\/press-release\/[a-z0-9-]+\/?$/.test(url.pathname) : /^\/press\/[a-z0-9_-]+\/?$/.test(url.pathname)
    return allowed ? url.href : null
  } catch { return null }
}
export const isOfficialEarningsSourceUrl = (asset: OfficialEarningsAsset, url: string): boolean => canonical(asset, url) === url || asset === 'TSLA' && isSecEdgarArchiveUrl(asset, url)
interface Candidate { url: string; title: string; tableDate: string | null }
function links(html: string, asset: OfficialEarningsAsset): Candidate[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].flatMap(match => {
    const href = attribute(match[1], 'href'), url = href && canonical(asset, href)
    return url ? [{ url, title: text(match[2]), tableDate: null }] : []
  })
}
function discover(html: string, asset: OfficialEarningsAsset): Candidate[] {
  const safe = inertHtml(html)
  let candidates: Candidate[]
  if (asset === 'TSLA') {
    const table = [...safe.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)].map(match => match[0]).find(value => /earnings\s+date/i.test(text(value)))
    if (!table) throw failure('Tesla investor-relations earnings table is missing or malformed.')
    candidates = [...table.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td\s*>/gi)].filter(match => /earnings\s+date/i.test(decode(match[1]))).flatMap(match => {
      const date = /<time\b([^>]*)>/i.exec(match[2]), value = date && attribute(date[1], 'datetime')
      const day = value?.slice(0, 10) ?? englishDay(text(match[2]))
      if (day && !validDay(day)) throw failure('Tesla earnings-table date is invalid.')
      return links(match[2], asset).map(link => ({ ...link, tableDate: day }))
    })
  } else {
    const all = links(safe, asset)
    if (!all.length || !/press|news|earnings/i.test(text(safe))) throw failure('Strategy press listing is missing or malformed.')
    candidates = all.filter(link => /earnings.*release.*date|(?:reschedul|postpon|revis|chang).*earnings/i.test(`${link.title} ${link.url}`))
  }
  return [...new Map(candidates.map(candidate => [candidate.url, candidate])).values()].slice(0, 6)
}
function publication(html: string, paragraphs: string[], at: Date): string {
  const datetime = [...html.matchAll(/<time\b([^>]*)>/gi)].map(match => attribute(match[1], 'datetime')).find(value => value && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value))
  const published = datetime ?? paragraphs.filter(p => /^press\s+release\b/i.test(p)).map(englishDay).find(Boolean)
  if (!published || !Number.isFinite(Date.parse(published)) || Date.parse(published) > at.getTime()) throw failure('announcement publication date is missing, invalid or later than the evidence capture.')
  // A date-only publication cannot prove intraday availability on that day.
  if (published.length === 10 && (!validDay(published) || published >= sessionDay(at))) throw failure('announcement has no verified publication time for the current session.')
  return published
}
function webcastInstant(day: string, paragraph: string): string | null {
  if (!/webcast|webinar|conference\s+call|question\s+and\s+answer/i.test(paragraph)) return null
  const webcastText = paragraph.slice(paragraph.search(/webcast|webinar|conference\s+call|question\s+and\s+answer/i))
  const match = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\s+(?:Eastern\s+(?:Time|Standard\s+Time|Daylight\s+Time)|E[DS]?T)\b/i.exec(webcastText)
  if (!match) return null
  const hour12 = Number(match[1]), minute = Number(match[2] ?? 0)
  if (hour12 < 1 || hour12 > 12 || minute > 59) throw failure('webcast time is invalid.')
  const hour = hour12 % 12 + (match[3].toLowerCase() === 'p' ? 12 : 0)
  const explicit = new RegExp(`\\bon\\s+${WEEKDAY}(${ENGLISH_DATE})`, 'i').exec(webcastText)
  const webcastDay = explicit ? englishDay(explicit[1]) : /that\s+day|same\s+day/i.test(webcastText) ? day : null
  if (!webcastDay) return null
  const target = Date.parse(`${webcastDay}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`)
  let candidate = target
  for (let i = 0; i < 3; i++) {
    const parts = clock.formatToParts(candidate), get = (name: string) => parts.find(part => part.type === name)!.value
    const represented = Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`)
    candidate += target - represented
  }
  return new Date(candidate).toISOString()
}
interface Announcement extends OfficialEarningsResult { period: string; revised: boolean }
function parseAnnouncement(html: string, candidate: Candidate, asset: OfficialEarningsAsset, at: Date): Announcement | null {
  const safe = inertHtml(html)
  const paragraphs = [...safe.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map(match => text(match[1])).filter(Boolean)
  const titleTag = asset === 'TSLA' ? /<h[12]\b[^>]*class=["'][^"']*press-release__title[^"']*["'][^>]*>([\s\S]*?)<\/h[12]\s*>/i.exec(safe) : /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(safe)
  const title = titleTag ? text(titleTag[1]) : null
  if (!title || title.length < 15 || !new RegExp(asset === 'TSLA' ? 'Tesla' : 'Strategy|MicroStrategy', 'i').test(title) || !paragraphs.length) throw failure('official announcement title or body is missing.')
  const publishedAt = publication(safe, paragraphs, at)
  const releaseAction = /\b(?:will|plans?\s+to|is\s+scheduled\s+to)\s+(?:now\s+)?(?:post|report|release|announce|publish)\s+(?:its\s+)?(?:financial\s+)?results\b/i
  const company = new RegExp(asset === 'TSLA' ? '\\bTesla\\b' : '\\b(?:Strategy|MicroStrategy)\\b', 'i')
  const statements = paragraphs.filter(paragraph => {
    const action = releaseAction.exec(paragraph)
    return action && company.test(paragraph.slice(0, action.index))
  })
  const events = statements.flatMap(paragraph => {
    const statement = paragraph.slice(paragraph.search(releaseAction)).replace(/U\.S\./gi, 'US')
    const beforeWebcast = statement.split(/\b(?:webcast|webinar|conference\s+call)\b/i)[0]
    const dates = [...beforeWebcast.matchAll(new RegExp(`\\bon\\s+${WEEKDAY}(${ENGLISH_DATE})`, 'gi'))].filter(match => !/end(?:ed|ing)\s*$/i.test(beforeWebcast.slice(Math.max(0, match.index! - 12), match.index)))
    const days = [...new Set(dates.map(match => englishDay(match[1])).filter((day): day is string => day !== null))]
    if (days.length !== 1) throw failure('financial-results release date is missing or ambiguous; webcast and period-end dates are not substitutes.')
    const period = /\b(first|second|third|fourth)\s+quarter\s+(?:of\s+)?(20\d{2})\b/i.exec(statement) ?? /\b(Q[1-4])\s+(20\d{2})\b/i.exec(statement)
    if (!period) throw failure('financial reporting period is missing.')
    const quarter = ['first', 'second', 'third', 'fourth'].indexOf(period[1].toLowerCase()) + 1 || Number(period[1].slice(1))
    const year = Number(period[2]), day = days[0]!, releaseYear = Number(day.slice(0, 4))
    const periodEnd = new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10)
    if (day <= periodEnd || releaseYear < year || releaseYear > year + 1 || releaseYear === year + 1 && quarter !== 4 || day < publishedAt.slice(0, 10)) throw failure('financial reporting year and announced release date conflict.')
    const timing: OfficialEarningsResult['timing'] = /after\s+(?:the\s+)?(?:US\s+financial\s+markets?\s+close|market\s+close|(?:US\s+)?markets?\s+close)/i.test(beforeWebcast) ? 'after-close' : /before\s+(?:the\s+)?(?:US\s+financial\s+markets?\s+open|market\s+open|(?:US\s+)?markets?\s+open)/i.test(beforeWebcast) ? 'before-open' : 'unknown'
    return [{ day, period: `${year}-Q${quarter}`, timing, webcastAt: webcastInstant(day, paragraph) }]
  })
  if (!events.length) throw failure('linked announcement does not explicitly announce a financial-results release date.')
  if (new Set(events.map(event => event.day)).size !== 1) throw failure('announcement contains conflicting financial-results release dates.')
  const event = events[0]!
  if (event.day < sessionDay(at)) return null
  const tableConflict = candidate.tableDate !== null && candidate.tableDate !== event.day
  return { asset, status: tableConflict ? 'conflict' : 'confirmed', date: tableConflict ? null : event.day, timing: event.timing, webcastAt: event.webcastAt,
    sourceUrl: candidate.url, title, publishedAt, retrievedAt: at.toISOString(), contentHash: hash(safe), verification: 'live-official',
    detail: tableConflict ? 'Official earnings table and announcement give different dates; no date is confirmed.' : 'Official announcement explicitly names the upcoming financial-results release date; webcast time is separate.',
    period: event.period, revised: /reschedul|postpon|revis(?:ed|es)|new\s+earnings\s+release\s+date|chang(?:es|ed)\s+(?:its\s+)?earnings/i.test(`${title} ${statements.join(' ')}`) }
}

/** Keyless public-company IR reader. No accounts, credentials or script execution. */
export function createOfficialEarningsReader(options: {
  fetcher?: typeof fetch
  now?: () => Date
  reviewed?: (asset: OfficialEarningsAsset, at: Date) => Promise<OfficialEarningsResult | null>
  /** Uses the same SEC transport as the filings provider, including its cooldown. */
  sec?: (asset: OfficialEarningsAsset, at: Date) => Promise<OfficialEarningsResult>
} = {}) {
  const fetcher = options.fetcher ?? fetch, now = options.now ?? (() => new Date())
  const cache = new Map<OfficialEarningsAsset, { savedAt: number; result: OfficialEarningsResult }>()
  const pending = new Map<OfficialEarningsAsset, Promise<OfficialEarningsResult>>()
  const fetchHtml = async (url: string, asset: OfficialEarningsAsset, index = false, deadline = Date.now() + TIMEOUT): Promise<string> => {
    if (!canonical(asset, url, index)) throw failure('URL is outside the fixed public-company allowlist.')
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw failure('request timed out after 6000ms.')
    const controller = new AbortController()
    let responseReader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const work = (async () => {
      const response = await fetcher(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Accept: 'text/html', 'User-Agent': 'MAD42Lab public earnings calendar' } })
      if (response.url && canonical(asset, response.url, index) !== url) throw failure('response left the fixed public-company allowlist.')
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw failure(`HTTP ${response.status}; official page unavailable.`) }
      const contentType = response.headers.get('content-type') ?? ''
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw failure('response is not an official HTML page.')
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw failure('response exceeds the size limit.')
      const reader = response.body?.getReader()
      if (!reader) throw failure('response body is empty.')
      responseReader = reader
      const decoder = new TextDecoder(), chunks: string[] = []
      let bytes = 0
      try {
        while (true) {
          const item = await reader.read()
          if (item.done) break
          bytes += item.value.byteLength
          if (bytes > MAX_BYTES) { void reader.cancel().catch(() => undefined); throw failure('response exceeds the size limit.') }
          chunks.push(decoder.decode(item.value, { stream: true }))
        }
        chunks.push(decoder.decode())
      } finally { reader.releaseLock() }
      const html = chunks.join('')
      if (controller.signal.aborted) throw failure('request timed out after 6000ms.')
      if (!html.trim()) throw failure('response body is empty.')
      return html
    })()
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); void responseReader?.cancel().catch(() => undefined); reject(failure('request timed out after 6000ms.')) }, remaining) })])
    } catch (error) { throw error instanceof OfficialEarningsError ? error : failure('network or response failure.') }
    finally { clearTimeout(timer) }
  }
  const validReviewed = (result: OfficialEarningsResult | null, asset: OfficialEarningsAsset, at: Date): result is OfficialEarningsResult => Boolean(result
    && result.asset === asset && result.status === 'confirmed' && result.verification === 'research-reviewed'
    && result.date && validDay(result.date) && result.date >= sessionDay(at) && canonical(asset, result.sourceUrl)
    && result.publishedAt && Number.isFinite(Date.parse(result.publishedAt)) && Date.parse(result.publishedAt) <= at.getTime()
    && Number.isFinite(Date.parse(result.retrievedAt)) && Date.parse(result.retrievedAt) <= at.getTime()
    && Date.parse(result.publishedAt) <= Date.parse(result.retrievedAt) && at.getTime() - Date.parse(result.retrievedAt) <= REVIEW_TTL
    && /^[a-f0-9]{64}$/.test(result.contentHash) && result.title.trim().length >= 15
    && ['after-close', 'before-open', 'unknown'].includes(result.timing)
    && (result.webcastAt === null || Number.isFinite(Date.parse(result.webcastAt)) && result.webcastAt.slice(0, 10) >= result.date))
  const load = async (asset: OfficialEarningsAsset, at: Date): Promise<OfficialEarningsResult> => {
    const deadline = Date.now() + (asset === 'TSLA' && options.sec ? 12_000 : TIMEOUT)
    let secFailure: string | null = null
    if (asset === 'TSLA' && options.sec) {
      try {
        // A verified conflict/unannounced result is authoritative. A failed SEC
        // read may recover through IR; neither failure renews reviewed evidence.
        return await options.sec(asset, at)
      } catch (error) {
        if (error instanceof SecEarningsError && error.blocksFallback) throw error
        // Only transport/parser summaries cross this boundary, never raw bodies.
        secFailure = error instanceof SecEarningsError || error instanceof SecEdgarError
          ? error.message : 'SEC earnings verification unavailable.'
      }
    }
    try {
      const irDeadline = Math.min(deadline, Date.now() + TIMEOUT)
      const index = await fetchHtml(INDEX[asset], asset, true, irDeadline), candidates = discover(index, asset)
      const announcements: Announcement[] = []
      for (const candidate of candidates) {
        const announcement = parseAnnouncement(await fetchHtml(candidate.url, asset, false, irDeadline), candidate, asset, at)
        if (announcement) announcements.push(announcement)
      }
      const clean = (announcement: Announcement): OfficialEarningsResult => { const { period: _, revised: __, ...result } = announcement; return result }
      announcements.sort((a, b) => a.date?.localeCompare(b.date ?? '') ?? 0)
      const first = announcements[0]
      if (first) {
        const samePeriod = announcements.filter(value => value.period === first.period).sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
        if (samePeriod.some(value => value.status === 'conflict')) return clean(samePeriod.find(value => value.status === 'conflict')!)
        const newest = samePeriod[0]!
        if (new Set(samePeriod.map(value => value.date)).size > 1) {
          if (newest.revised && samePeriod.slice(1).every(value => value.publishedAt! < newest.publishedAt!)) return { ...clean(newest), detail: 'A newer official announcement explicitly reschedules the release; earlier official dates are superseded.' }
          return { ...clean(newest), status: 'conflict', date: null, webcastAt: null, timing: 'unknown', detail: 'Official announcements for the same reporting period contain conflicting release dates; no date is confirmed.' }
        }
        return clean(newest)
      }
      return { asset, status: 'unannounced', date: null, timing: 'unknown', webcastAt: null, sourceUrl: INDEX[asset], title: asset === 'TSLA' ? 'Tesla official investor-relations earnings table' : 'Strategy official press listing', publishedAt: null, retrievedAt: at.toISOString(), contentHash: hash(inertHtml(index)), verification: 'live-official', detail: 'The verified official listing contains no usable upcoming financial-results announcement; this does not mean event risk is absent.' }
    } catch (error) {
      const irFailure = error instanceof OfficialEarningsError ? error.message : failure('network or response failure.').message
      const cause = secFailure ? `${secFailure} ${irFailure}` : irFailure
      let reviewed: OfficialEarningsResult | null = null
      try { reviewed = await options.reviewed?.(asset, at) ?? null } catch { /* A local public-evidence read failure cannot expose file contents. */ }
      if (validReviewed(reviewed, asset, at)) return { ...structuredClone(reviewed), detail: `${cause} Using a still-current research-reviewed official announcement; its original retrieval time is preserved.` }
      throw new OfficialEarningsError(cause)
    }
  }
  return async (asset: OfficialEarningsAsset, at: Date): Promise<OfficialEarningsResult> => {
    if (!['TSLA', 'MSTR'].includes(asset) || !Number.isFinite(at.getTime())) throw failure('asset or evidence-capture time is invalid.')
    const cached = cache.get(asset)
    if (cached && now().getTime() >= cached.savedAt && now().getTime() - cached.savedAt < CACHE_MS && Date.parse(cached.result.retrievedAt) <= at.getTime()
      && (!cached.result.date || cached.result.date >= sessionDay(at)) && at.getTime() - Date.parse(cached.result.retrievedAt) <= REVIEW_TTL) return structuredClone(cached.result)
    if (pending.has(asset)) {
      const result = await pending.get(asset)!
      if (Date.parse(result.retrievedAt) <= at.getTime() && at.getTime() - Date.parse(result.retrievedAt) <= REVIEW_TTL && (!result.date || result.date >= sessionDay(at))) return structuredClone(result)
    }
    const work = load(asset, at)
    pending.set(asset, work)
    try {
      const result = await work
      cache.set(asset, { savedAt: now().getTime(), result: structuredClone(result) })
      return result
    } finally { if (pending.get(asset) === work) pending.delete(asset) }
  }
}
