import { createHash } from 'node:crypto'
import type { OfficialEarningsAsset, OfficialEarningsResult } from './official-earnings.js'
import { SecEdgarError, isSecEdgarArchiveUrl, type SecEdgarDocument, type SecEdgarTransport } from './sec-edgar-transport.js'

type Failure = 'unsupported' | 'unavailable' | 'incomplete' | 'invalid' | 'timeout'
const MESSAGES: Record<Failure, string> = {
  unsupported: 'SEC earnings reader does not support this asset.',
  unavailable: 'SEC earnings public-source request is unavailable.',
  incomplete: 'SEC earnings coverage is incomplete; a previous announcement cannot be renewed.',
  invalid: 'SEC earnings public evidence is invalid or ambiguous.',
  timeout: 'SEC earnings total verification budget expired.',
}
/** Branded, fixed diagnostics only: arbitrary network errors never become public text. */
export class SecEarningsError extends Error {
  constructor(readonly code: Failure, readonly blocksFallback = false) { super(MESSAGES[code]); this.name = 'SecEarningsError' }
}
const SUBMISSIONS = 'https://data.sec.gov/submissions/CIK0001318605.json'
const LOOKBACK_DAYS = 120
const MAX_FILINGS = 8
const MAX_EXHIBITS = 3
const MAX_BYTES = 2_000_000
const DAY_MS = 86_400_000
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const ENGLISH_DATE = '(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+20\\d{2}'
const WEEKDAY = '(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\\s+)?'
const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const invalid = () => new SecEarningsError('invalid', true)
const incomplete = () => new SecEarningsError('incomplete', true)
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day
const validInstant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && validDay(value.slice(0, 10)) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
const sessionDay = (at: Date) => ['year', 'month', 'day'].map(key => clock.formatToParts(at).find(part => part.type === key)!.value).join('-')
function inert(html: string) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template|noscript|svg|iframe)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
}
function decode(value: string) {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, token: string) => {
    const point = token[0].toLowerCase() === 'x' ? Number.parseInt(token.slice(1), 16) : Number(token)
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
  }).replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash|rsquo|lsquo|rdquo|ldquo);/gi, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' })[name.toLowerCase()] ?? '')
}
const plain = (html: string) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
const blocks = (html: string) => inert(html).replace(/<(?:br|hr)\b[^>]*\/?\s*>|<\/(?:div|p|tr|h[1-6])\s*>/gi, '\n').split('\n').map(plain).filter(Boolean)
function englishDay(value: string): string | null {
  const match = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})$/i.exec(value.trim())
  if (!match) return null
  const month = MONTHS.indexOf(match[1].toLowerCase()) + 1
  const day = `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`
  return validDay(day) ? day : null
}
function period(text: string): string | null {
  const match = /\b(first|second|third|fourth)\s*[-–]?\s*quarter\s+(?:of\s+)?(20\d{2})\b/i.exec(text) ?? /\b(Q[1-4])\s+(20\d{2})\b/i.exec(text)
  if (!match) return null
  return `${match[2]}-Q${['first', 'second', 'third', 'fourth'].indexOf(match[1].toLowerCase()) + 1 || Number(match[1].slice(1))}`
}
interface Filing { accession: string; primary: string; acceptedAt: string }
function filings(payload: unknown, at: Date): { rows: Filing[]; complete: boolean } {
  if (!payload || typeof payload !== 'object') throw incomplete()
  const source = payload as { cik?: unknown; filings?: { recent?: Record<string, unknown> } }
  if (Number(source.cik) !== 1318605) throw incomplete()
  const recent = source.filings?.recent
  if (!recent || !Array.isArray(recent.form) || !recent.form.length || recent.form.length > 20_000) throw incomplete()
  const forms = recent.form
  const columns = ['accessionNumber', 'filingDate', 'primaryDocument', 'acceptanceDateTime'] as const
  if (columns.some(key => !Array.isArray(recent[key]) || recent[key].length !== forms.length)) throw incomplete()
  const cutoff = new Date(at.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10)
  let coverage = false
  const rows: Filing[] = []
  for (let i = 0; i < forms.length; i++) {
    const date = (recent.filingDate as unknown[])[i], form = forms[i]
    if (typeof date !== 'string' || !validDay(date) || typeof form !== 'string') throw incomplete()
    if (date <= cutoff) coverage = true
    if (form !== '8-K' && form !== '8-K/A') continue
    if (date < cutoff) continue
    const accession = (recent.accessionNumber as unknown[])[i], primary = (recent.primaryDocument as unknown[])[i], acceptedAt = (recent.acceptanceDateTime as unknown[])[i]
    if (typeof accession !== 'string' || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || typeof primary !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*\.html?$/.test(primary) || primary.includes('..') || !validInstant(acceptedAt) || Date.parse(acceptedAt) > at.getTime()) throw incomplete()
    rows.push({ accession, primary, acceptedAt })
  }
  if (new Set(rows.map(row => row.accession)).size !== rows.length) throw incomplete()
  return { rows: rows.sort((a, b) => Date.parse(b.acceptedAt) - Date.parse(a.acceptedAt)), complete: coverage }
}
function exhibitLinks(html: string, primaryUrl: string): string[] {
  const safe = inert(html), rows = [...safe.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].filter(row => /\b99\s*\.\s*\d+\b/.test(plain(row[1])))
  const documents = new Set<string>()
  for (const row of rows) {
    let linked = false
    for (const link of row[1].matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
      let url: URL
      try { url = new URL(decode(link[1]), primaryUrl) } catch { throw incomplete() }
      const base = new URL(primaryUrl)
      if (!isSecEdgarArchiveUrl('TSLA', url.href) || url.pathname.slice(0, url.pathname.lastIndexOf('/')) !== base.pathname.slice(0, base.pathname.lastIndexOf('/')) || !/\.html?$/i.test(url.pathname)) throw incomplete()
      documents.add(url.pathname.slice(url.pathname.lastIndexOf('/') + 1)); linked = true
    }
    if (!linked) throw incomplete()
  }
  if (!rows.length && /\b(?:exhibit|ex[.-]?)\s*99\s*\.\s*\d+\b/i.test(plain(safe))) throw incomplete()
  if (documents.size > MAX_EXHIBITS) throw incomplete()
  return [...documents]
}
interface Announcement { result: OfficialEarningsResult; period: string; revised: boolean; cancelled: boolean }
function webcast(day: string, text: string): string | null {
  const marker = /\b(?:webcast|webinar|conference\s+call|question\s+and\s+answer)\b/i.exec(text)
  if (!marker) return null
  const source = text.slice(marker.index), time = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\s+(?:Eastern\s+(?:Time|Standard\s+Time|Daylight\s+Time)|E[DS]?T)\b/i.exec(source)
  if (!time) return null
  const hour = Number(time[1]), minute = Number(time[2] ?? 0)
  if (hour < 1 || hour > 12 || minute > 59) throw invalid()
  const explicit = new RegExp(`\\bon\\s+${WEEKDAY}(${ENGLISH_DATE})`, 'i').exec(source)
  const date = explicit ? englishDay(explicit[1]) : /that\s+day|same\s+day/i.test(source) ? day : null
  if (!date) return null
  const target = Date.parse(`${date}T${String(hour % 12 + (time[3].toLowerCase() === 'p' ? 12 : 0)).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`)
  let candidate = target
  for (let i = 0; i < 3; i++) {
    const parts = clock.formatToParts(candidate), get = (name: string) => parts.find(part => part.type === name)!.value
    candidate += target - Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`)
  }
  return new Date(candidate).toISOString()
}
function parseAnnouncement(document: SecEdgarDocument, filing: Filing, retrievedAt: string): Announcement | null {
  if (Date.parse(filing.acceptedAt) > Date.parse(retrievedAt)) throw incomplete()
  const paragraphs = blocks(document.body), all = paragraphs.join(' ')
  if (!/\bTesla\b/i.test(all)) throw incomplete()
  const title = paragraphs.find(row => /^Tesla\b/i.test(row) && row.length >= 15 && row.length <= 400 && /quarter|financial|earnings/i.test(row)) ?? 'Tesla official financial-results disclosure furnished to SEC'
  const releaseAction = /\b(?:(?:will|plans?\s+to|is\s+scheduled\s+to)\s+(?:now\s+)?(?:post|report|release|announce|publish)\s+(?:(?:its|our|the)\s+)?(?:financial\s+)?results|(?:has\s+)?(?:rescheduled|postponed)\s+(?:the\s+)?(?:release|announcement|publication)\s+of\s+(?:(?:its|our|the)\s+)?(?:financial\s+)?results)\b/i
  const statements = paragraphs.filter(row => {
    const action = releaseAction.exec(row)
    return action && /\b(?:Tesla|the Company|we)\b/i.test(row.slice(0, action.index))
  })
  const negative = paragraphs.find(row => /\b(?:cancel\w*|withdraw\w*|will\s+not|no\s+longer|not\s+(?:be\s+)?(?:released|reported|published|announced))\b/i.test(row) && /financial\s+results|earnings/i.test(row))
  const change = negative ?? paragraphs.find(row => /\b(?:reschedul\w*|postpon\w*)\b/i.test(row) && /financial\s+results|earnings/i.test(row))
  const base = { asset: 'TSLA' as const, sourceUrl: document.url, title, publishedAt: filing.acceptedAt, retrievedAt, contentHash: hash(document.body), verification: 'live-official' as const }
  if (negative || !statements.length) {
    if (change) {
      const reportingPeriod = period(change) ?? period(title)
      if (!reportingPeriod) throw incomplete()
      return { result: { ...base, status: 'conflict', date: null, timing: 'unknown', webcastAt: null, detail: 'A newer SEC disclosure changes or withdraws the earnings schedule without a usable replacement date.' }, period: reportingPeriod, revised: true, cancelled: true }
    }
    return null
  }
  const events = statements.map(row => {
    const statement = row.slice(row.search(releaseAction)).replace(/U\.S\./gi, 'US')
    const beforeWebcast = statement.split(/\b(?:webcast|webinar|conference\s+call)\b/i)[0]
    const dates = [...beforeWebcast.matchAll(new RegExp(`\\b(?:on|to)\\s+${WEEKDAY}(${ENGLISH_DATE})`, 'gi'))].filter(match => !/end(?:ed|ing)\s*$/i.test(beforeWebcast.slice(Math.max(0, match.index! - 12), match.index)))
    const days = [...new Set(dates.map(match => englishDay(match[1])).filter((day): day is string => day !== null))]
    const reportingPeriod = period(statement) ?? period(title)
    if (days.length !== 1 || !reportingPeriod) throw invalid()
    const year = Number(reportingPeriod.slice(0, 4)), quarter = Number(reportingPeriod.slice(-1)), day = days[0]!
    const periodEnd = new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10)
    if (day <= periodEnd || day < filing.acceptedAt.slice(0, 10) || Number(day.slice(0, 4)) > year + 1 || Number(day.slice(0, 4)) === year + 1 && quarter !== 4) throw invalid()
    const timing: OfficialEarningsResult['timing'] = /after\s+(?:the\s+)?(?:US\s+financial\s+markets?\s+close|market\s+close|(?:US\s+)?markets?\s+close)/i.test(beforeWebcast) ? 'after-close' : /before\s+(?:the\s+)?(?:US\s+financial\s+markets?\s+open|market\s+open|(?:US\s+)?markets?\s+open)/i.test(beforeWebcast) ? 'before-open' : 'unknown'
    return { day, reportingPeriod, timing, webcastAt: webcast(day, row) }
  })
  if (new Set(events.map(event => `${event.reportingPeriod}|${event.day}`)).size !== 1) throw invalid()
  const event = events[0]!
  return { result: { ...base, status: 'confirmed', date: event.day, timing: event.timing, webcastAt: event.webcastAt, detail: 'SEC company disclosure explicitly announces the financial-results release date; all newer 8-K filings through this announcement and their linked 99-series exhibits were checked.' }, period: event.reportingPeriod,
    revised: /reschedul|postpon|revis(?:ed|es)|will\s+now|new\s+earnings\s+release\s+date/i.test(`${title} ${statements.join(' ')}`), cancelled: false }
}

/** TSLA only; transport owns the shared SEC queue, private declaration and cooldown. */
export function createSecEarningsReader(options: { transport: SecEdgarTransport; budgetMs?: number }) {
  const budget = Math.min(10_000, Math.max(1, options.budgetMs ?? 10_000))
  return async (asset: OfficialEarningsAsset, at: Date): Promise<OfficialEarningsResult> => {
    if (asset !== 'TSLA') throw new SecEarningsError('unsupported')
    if (!Number.isFinite(at.getTime())) throw invalid()
    const deadline = Date.now() + budget
    let expired = false, coverageStarted = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => { if (expired || Date.now() >= deadline) throw new SecEarningsError('timeout', coverageStarted) }
    const verified = (document: SecEdgarDocument, expected: string) => {
      if (document.asset !== asset || document.url !== expected || !validInstant(document.retrievedAt) || Date.parse(document.retrievedAt) > at.getTime() || !document.body.trim() || Buffer.byteLength(document.body) > MAX_BYTES) throw incomplete()
    }
    const work = (async (): Promise<OfficialEarningsResult> => {
      check()
      const metadata = await options.transport.submissions(asset, { at, deadline })
      check(); coverageStarted = true; verified(metadata, SUBMISSIONS)
      const recent = filings(metadata.payload, at), announcements: Announcement[] = []
      let fallback: SecEdgarDocument = metadata
      let retrievedAt = metadata.retrievedAt
      let reviewed = 0, found = false
      for (const filing of recent.rows) {
        if (++reviewed > MAX_FILINGS) throw incomplete()
        check()
        const base = `https://www.sec.gov/Archives/edgar/data/1318605/${filing.accession.replaceAll('-', '')}/`
        const primary = await options.transport.archive(asset, filing.accession, filing.primary, { at, deadline })
        check(); verified(primary, base + filing.primary)
        if (Date.parse(primary.retrievedAt) < Date.parse(retrievedAt)) retrievedAt = primary.retrievedAt
        fallback = primary
        const primaryAnnouncement = parseAnnouncement(primary, filing, retrievedAt)
        if (primaryAnnouncement) announcements.push(primaryAnnouncement)
        for (const filename of exhibitLinks(primary.body, primary.url)) {
          check()
          const exhibit = await options.transport.archive(asset, filing.accession, filename, { at, deadline })
          check(); verified(exhibit, base + filename)
          if (Date.parse(exhibit.retrievedAt) < Date.parse(retrievedAt)) retrievedAt = exhibit.retrievedAt
          const announcement = parseAnnouncement(exhibit, filing, retrievedAt)
          if (announcement) announcements.push(announcement)
        }
        // Newer disclosures have all been read. Older immutable announcements
        // cannot renew or supersede the most recent useful release disclosure.
        if (announcements.some(row => row.cancelled || row.result.date! >= sessionDay(at))) { found = true; break }
      }
      check()
      if (!found && !recent.complete) throw incomplete()
      const resolved: OfficialEarningsResult[] = []
      for (const reportingPeriod of new Set(announcements.map(row => row.period))) {
        const group = announcements.filter(row => row.period === reportingPeriod).sort((a, b) => Date.parse(b.result.publishedAt!) - Date.parse(a.result.publishedAt!))
        let newest = group[0]!
        const withdrawn = group.find(row => row.cancelled && row.result.publishedAt! >= newest.result.publishedAt!)
        const revisions = group.filter(row => row.revised && !row.cancelled && row.result.publishedAt! >= newest.result.publishedAt!)
        if (withdrawn) newest = withdrawn
        else if (revisions.length === 1) newest = revisions[0]!
        const atLeastAsRecent = group.filter(row => row !== newest).every(row => row.result.publishedAt! <= newest.result.publishedAt!)
        const different = new Set(group.map(row => row.result.date)).size > 1
        if (newest.cancelled || different && !(newest.revised && atLeastAsRecent && revisions.length === 1)) {
          resolved.push({ ...newest.result, status: 'conflict', date: null, timing: 'unknown', webcastAt: null, detail: newest.cancelled ? newest.result.detail : 'SEC disclosures contain conflicting earnings dates for the same reporting period; a replacement date is not confirmed.' })
        } else if (newest.result.date! >= sessionDay(at)) {
          resolved.push({ ...newest.result, detail: different ? 'A newer SEC disclosure explicitly reschedules the same reporting period; the earlier date is superseded.' : newest.result.detail })
        }
      }
      const conflict = resolved.find(result => result.status === 'conflict')
      if (conflict) return { ...conflict, retrievedAt }
      const next = resolved.sort((a, b) => a.date!.localeCompare(b.date!))[0]
      if (next) return { ...next, retrievedAt }
      return { asset, status: 'unannounced', date: null, timing: 'unknown', webcastAt: null, sourceUrl: fallback.url, title: 'Tesla SEC filings reviewed for an upcoming financial-results schedule', publishedAt: null, retrievedAt, contentHash: hash(fallback.body), verification: 'live-official', detail: 'The complete bounded SEC review found no usable upcoming earnings date; this is not evidence that event risk is absent.' }
    })()
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new SecEarningsError('timeout', coverageStarted)) }, budget) })])
    } catch (error) {
      if (error instanceof SecEarningsError) throw error
      // A failed later document cannot be hidden by reusing an older announcement.
      if (coverageStarted) throw incomplete()
      if (error instanceof SecEdgarError) throw error
      throw new SecEarningsError('unavailable')
    } finally { clearTimeout(timer) }
  }
}
