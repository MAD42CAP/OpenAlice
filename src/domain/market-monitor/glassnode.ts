import { createHash } from 'node:crypto'

export const GLASSNODE_FEED_URL = 'https://research.glassnode.com/rss/'
const HOST = 'research.glassnode.com'
const MAX_REPORT_BYTES = 3 * 1024 * 1024
const MAX_FEED_BYTES = 1024 * 1024

export interface ParsedGlassnodeReport {
  url: string
  title: string
  publishedAt: string | null
  reportPeriod: string | null
  paragraphs: string[]
  contentHash: string
}

export function canonicalGlassnodeUrl(input: string): string {
  let url: URL
  try { url = new URL(input) } catch { throw new Error('Only an official Glassnode Week On-chain HTTPS URL is allowed.') }
  if (url.protocol !== 'https:' || url.hostname !== HOST || url.port || url.username || url.password
    || !/^\/the-week-onchain-week-(?:[1-9]|[1-4]\d|5[0-3])-\d{4}\/?$/.test(url.pathname)) {
    throw new Error('Only an official Glassnode Week On-chain HTTPS URL is allowed.')
  }
  return `https://${HOST}${url.pathname.replace(/\/?$/, '/')}`
}

export function researchContentHash(paragraphs: string[]): string {
  return createHash('sha256').update(paragraphs.join('\n\n')).digest('hex')
}

function decode(input: string): string {
  return input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) => {
      const value = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10)
      return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : ''
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash|rsquo|lsquo|rdquo|ldquo);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }[name] ?? ''))
}

function plain(input: string): string {
  return decode(input).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

export function publicResearchDate(input: string | null | undefined, at: Date): string | null {
  if (!input) return null
  const date = new Date(input)
  if (!Number.isFinite(date.getTime()) || date.getTime() > at.getTime()) throw new Error('Glassnode publication date is invalid or in the future.')
  return date.toISOString()
}

function attrs(tag: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4])
  }
  return result
}

export function normalizeResearchParagraphs(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split(/\n\s*\n+/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/** Only full dates actually written by the source qualify; no publication-year inference. */
export function explicitResearchDates(text: string): string[] {
  const dates = text.match(/\b\d{4}-\d{2}-\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}\b|\b\d{1,2}(?:st|nd|rd|th)? (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/gi) ?? []
  return [...new Set(dates.flatMap(value => {
    const clean = value.replace(/(\d)(?:st|nd|rd|th)/g, '$1'), ms = Date.parse(clean)
    if (!Number.isFinite(ms)) return []
    const iso = new Date(ms).toISOString().slice(0, 10)
    // Date.parse normalizes impossible ISO dates; they are not source cutoffs.
    if (/^\d{4}-/.test(clean) && iso !== clean) return []
    return [`${iso}T00:00:00.000Z`]
  }))]
}

export function paragraphDataAsOf(text: string): string | null {
  const cutoff = /(?:data\s+as[- ]of|as[- ]of|data\s+(?:through|cutoff)|截至)\s*[:：]?\s*/i.exec(text)
  if (!cutoff) return null
  const dates = explicitResearchDates(text.slice(cutoff.index))
  return dates.length === 1 ? dates[0] : null
}

export function parseGlassnodeHtml(html: string, inputUrl: string, at: Date): ParsedGlassnodeReport {
  const url = canonicalGlassnodeUrl(inputUrl)
  const metadata = new Map<string, string>()
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const values = attrs(match[0])
    if ((values.property || values.name) && values.content) metadata.set(values.property || values.name, values.content)
  }
  const articles: Record<string, unknown>[] = []
  const collectArticle = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(collectArticle); return }
    const row = value as Record<string, unknown>
    if (['Article', 'BlogPosting', 'NewsArticle'].some(t => Array.isArray(row['@type']) ? row['@type'].includes(t) : row['@type'] === t)) articles.push(row)
    if (row['@graph']) collectArticle(row['@graph'])
  }
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { collectArticle(JSON.parse(match[1])) } catch { /* A malformed non-content script is not the article. */ }
  }
  if (articles.some(article => article.isAccessibleForFree === false || article.isAccessibleForFree === 'False' || article.isAccessibleForFree === 'false')) {
    throw new Error('Glassnode report is restricted; provide legally usable content manually.')
  }
  const article = articles[0]
  const publication = metadata.get('article:published_time') ?? (typeof article?.datePublished === 'string' ? article.datePublished : null)
    ?? /<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i.exec(html)?.[1] ?? null
  const publishedAt = publicResearchDate(publication, at)
  const title = plain(metadata.get('og:title') ?? ((typeof article?.headline === 'string' ? article.headline : '')
    || /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html)?.[1] || /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] || ''))
  if (!title || title.length > 300) throw new Error('Glassnode report title is unavailable.')
  // Ghost exposes the complete public article in gh-content / post-content.
  // Refuse navigation-only pages and never fall back to a paywall/RSS excerpt.
  const contentStart = /<(?:section|div)\b[^>]*class=["'][^"']*\b(?:gh-content|post-content|post-full-content|article-content)\b[^"']*["'][^>]*>/i.exec(html)
  let content: string | null = null
  if (contentStart?.index !== undefined) {
    const tag = /^<(\w+)/.exec(contentStart[0])![1]
    const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi')
    tags.lastIndex = contentStart.index + contentStart[0].length
    let depth = 1, next: RegExpExecArray | null
    while ((next = tags.exec(html))) {
      depth += next[0].startsWith('</') ? -1 : next[0].endsWith('/>') ? 0 : 1
      if (depth === 0) { content = html.slice(contentStart.index + contentStart[0].length, next.index); break }
    }
  }
  if (!content) throw new Error('Complete public Glassnode article content is unavailable; manual content import is supported.')
  if (/\bgh-post-upgrade-cta\b|\bdata-members-only\b|class=["'][^"']*\bpaywall\b/i.test(content)) throw new Error('Glassnode report is restricted or partial; manual content import is supported.')
  const body = content.replace(/<(?:script|style|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript)\s*>/gi, '')
    .replace(/<\/(?:p|li|h[1-6]|blockquote|figcaption|table|tr|section|div)\s*>/gi, '\n\n')
    .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  const paragraphs = normalizeResearchParagraphs(decode(body))
  if (paragraphs.length < 3 || paragraphs.join(' ').length < 400 || paragraphs.length > 600) throw new Error('Glassnode report is too short, incomplete or exceeds the analysis limit.')
  const match = /week-(\d+)-(\d{4})/.exec(url)
  return { url, title, publishedAt, reportPeriod: match ? `${match[2]}-W${match[1].padStart(2, '0')}` : null, paragraphs, contentHash: researchContentHash(paragraphs) }
}

export interface GlassnodeFeedItem { url: string; title: string; publishedAt: string | null }

export function parseGlassnodeFeed(xml: string, at: Date): GlassnodeFeedItem[] {
  if (!/<rss\b|<feed\b/i.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Glassnode feed is not a supported public RSS feed.')
  const items: GlassnodeFeedItem[] = []
  for (const match of xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)\s*>/gi)) {
    const body = match[1]
    const rawLink = /<link\b[^>]*>([\s\S]*?)<\/link\s*>/i.exec(body)?.[1]
      ?? /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i.exec(body)?.[1]
    if (!rawLink) continue
    let url: string
    try { url = canonicalGlassnodeUrl(decode(rawLink).trim()) } catch { continue }
    const rawDate = /<(?:pubDate|published)\b[^>]*>([\s\S]*?)<\/(?:pubDate|published)\s*>/i.exec(body)?.[1] ?? null
    let publishedAt: string | null
    try { publishedAt = publicResearchDate(rawDate ? decode(rawDate).trim() : null, at) } catch { continue }
    const title = plain(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(body)?.[1] ?? '')
    items.push({ url, title, publishedAt })
  }
  return [...new Map(items.map(item => [item.url, item])).values()].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
}

export function createGlassnodeClient(options: { fetch?: typeof fetch; now?: () => Date } = {}) {
  const fetcher = options.fetch ?? globalThis.fetch, now = options.now ?? (() => new Date())
  const read = async (url: string, maxBytes: number, kind: 'html' | 'rss'): Promise<string> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12_000)
    try {
      const response = await fetcher(url, { method: 'GET', signal: controller.signal, redirect: 'error', credentials: 'omit',
        headers: { Accept: kind === 'html' ? 'text/html' : 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'MAD42Lab read-only research/1.0' } })
      if (!response.ok) throw new Error(`Glassnode HTTP ${response.status}; public source is unavailable.`)
      if (response.url) {
        const final = new URL(response.url)
        if (final.protocol !== 'https:' || final.hostname !== HOST || final.port || final.username || final.password) throw new Error('Glassnode redirected outside its allowed public host.')
      }
      const type = response.headers.get('content-type') ?? ''
      if (type && !(kind === 'html' ? /\btext\/html\b/i : /\b(?:application\/(?:rss\+xml|atom\+xml|xml)|text\/xml)\b/i).test(type)) throw new Error('Glassnode response has an unsupported content type.')
      const length = Number(response.headers.get('content-length') ?? 0)
      if (!Number.isFinite(length) || length > maxBytes) throw new Error('Glassnode response exceeds the content limit.')
      if (!response.body) throw new Error('Glassnode response body is unavailable.')
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let bytes = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > maxBytes) { controller.abort(); throw new Error('Glassnode response exceeds the content limit.') }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    } catch (error) {
      // Transport exceptions and error bodies can contain arbitrary secret-like
      // text. Only our allowlisted diagnostics cross the domain boundary.
      if (error instanceof Error && /^Glassnode (?:HTTP \d+; public source is unavailable\.|redirected outside its allowed public host\.|response (?:has an unsupported content type\.|exceeds the content limit\.|body is unavailable\.))$/.test(error.message)) throw error
      throw new Error(controller.signal.aborted ? 'Glassnode request timed out.' : 'Glassnode public source network or response failure.')
    } finally { clearTimeout(timeout) }
  }
  return {
    async report(url: string) { const canonical = canonicalGlassnodeUrl(url); return parseGlassnodeHtml(await read(canonical, MAX_REPORT_BYTES, 'html'), canonical, now()) },
    async feed() { return parseGlassnodeFeed(await read(GLASSNODE_FEED_URL, MAX_FEED_BYTES, 'rss'), now()) },
  }
}
