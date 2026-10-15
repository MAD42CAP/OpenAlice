import { describe, expect, it, vi } from 'vitest'
import { canonicalGlassnodeUrl, createGlassnodeClient, explicitResearchDates, paragraphDataAsOf, parseGlassnodeFeed, parseGlassnodeHtml } from './glassnode.js'

const URL = 'https://research.glassnode.com/the-week-onchain-week-41-2026/'
const AT = new Date('2026-10-14T20:00:00Z')
const paragraphs = [
  'Bitcoin faces a source-reported resistance zone at $88K. This synthetic public report describes price structure and the need for demand confirmation. Data as-of October 13, 2026.',
  'Long-term holder selling has eased, but this observation does not establish that a market bottom has formed. Flows remain uncertain and a further demand recovery is required.',
  'The report offers conditional interpretations rather than a deterministic prediction. A close below support would challenge the recovery hypothesis and confirms the importance of explicit invalidation rules.',
]
function html(extra = '', body = paragraphs.map(p => `<p>${p}</p>`).join('')) {
  return `<html><head><meta content="Synthetic report" property="og:title"><meta property="article:published_time" content="2026-10-14T15:00:00Z">${extra}</head><body><nav>Not article text</nav><section class="gh-content"><div>${body}</div></section><footer>Not article text</footer></body></html>`
}

describe('Glassnode public Week On-chain acquisition', () => {
  it('extracts the complete known Ghost content and separate original dates', () => {
    const report = parseGlassnodeHtml(html(), `${URL}?utm_source=email#overview`, AT)
    expect(report).toMatchObject({ url: URL, title: 'Synthetic report', publishedAt: '2026-10-14T15:00:00.000Z', reportPeriod: '2026-W41', paragraphs })
    expect(report.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(report)).not.toContain('Not article text')
  })

  it.each(['http://research.glassnode.com/the-week-onchain-week-41-2026/', 'https://127.0.0.1/the-week-onchain-week-41-2026/', 'https://research.glassnode.com.evil.test/the-week-onchain-week-41-2026/', 'https://name:secret@research.glassnode.com/the-week-onchain-week-41-2026/', 'https://research.glassnode.com:8080/the-week-onchain-week-41-2026/', 'https://research.glassnode.com/members/', 'https://research.glassnode.com/the-week-onchain-week-99-2026/'])('rejects unsupported or sensitive URL %s before networking', async url => {
    const fetcher = vi.fn()
    expect(() => canonicalGlassnodeUrl(url)).toThrow('Only an official')
    await expect(createGlassnodeClient({ fetch: fetcher }).report(url)).rejects.toThrow('Only an official')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses no credentials, rejects redirects, and never echoes transport errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      expect(options).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit' })
      expect(options?.headers).not.toHaveProperty('Authorization')
      throw new Error('Authorization: secret-token private value')
    })
    await expect(createGlassnodeClient({ fetch: fetcher }).report(URL)).rejects.toThrow('Glassnode public source network or response failure.')
    fetcher.mockResolvedValue(new Response('private upstream body', { status: 403 }))
    await expect(createGlassnodeClient({ fetch: fetcher }).report(URL)).rejects.toThrow('Glassnode HTTP 403; public source is unavailable.')
  })

  it('refuses restricted, incomplete and future reports', () => {
    expect(() => parseGlassnodeHtml(html('<script type="application/ld+json">{"@type":"Article","isAccessibleForFree":false}</script>'), URL, AT)).toThrow('restricted')
    expect(() => parseGlassnodeHtml(html('', '<div class="gh-post-upgrade-cta">Subscribe to continue</div>'), URL, AT)).toThrow('restricted or partial')
    expect(() => parseGlassnodeHtml(html('', '<p>Only the excerpt</p>'), URL, AT)).toThrow('too short')
    expect(() => parseGlassnodeHtml(html().replace('2026-10-14T15:00:00Z', '2026-10-15T15:00:00Z'), URL, AT)).toThrow('future')
    expect(() => parseGlassnodeHtml('<html><main>Subscription or bot challenge</main></html>', URL, AT)).toThrow('title')
  })

  it('discovers the latest two actual series entries and decodes CDATA without accepting other hosts', () => {
    const feed = `<rss><channel>
      <item><title><![CDATA[Week 40 &amp; evidence]]></title><link>https://research.glassnode.com/the-week-onchain-week-40-2026/</link><pubDate>Wed, 07 Oct 2026 12:00:00 GMT</pubDate></item>
      <item><title><![CDATA[Week 41 &amp; evidence]]></title><link>${URL}</link><pubDate>Wed, 14 Oct 2026 15:00:00 GMT</pubDate></item>
      <item><title>Future</title><link>https://research.glassnode.com/the-week-onchain-week-42-2026/</link><pubDate>Wed, 21 Oct 2026 12:00:00 GMT</pubDate></item>
      <item><title>Different series</title><link>https://research.glassnode.com/other-research/</link></item>
      <item><title>Untrusted</title><link>https://evil.test/the-week-onchain-week-41-2026/</link></item>
    </channel></rss>`
    expect(parseGlassnodeFeed(feed, AT).map(row => row.title)).toEqual(['Week 41 & evidence', 'Week 40 & evidence'])
    expect(() => parseGlassnodeFeed('<!DOCTYPE rss [<!ENTITY e SYSTEM "file:///private">]><rss/>', AT)).toThrow('supported public RSS')
  })

  it('bounds actual streamed bytes and validates content types', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(3 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } }))
    await expect(createGlassnodeClient({ fetch: fetcher, now: () => AT }).report(URL)).rejects.toThrow('content limit')
    fetcher.mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }))
    await expect(createGlassnodeClient({ fetch: fetcher, now: () => AT }).report(URL)).rejects.toThrow('unsupported content type')
  })

  it('times out without retaining provider error details', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('private transport error')))))
      const result = createGlassnodeClient({ fetch: fetcher }).report(URL)
      const expected = expect(result).rejects.toThrow('Glassnode request timed out.')
      await vi.advanceTimersByTimeAsync(12_001)
      await expected
    } finally { vi.useRealTimers() }
  })

  it('accepts explicit complete data dates and leaves ambiguous cutoffs unknown', () => {
    expect(explicitResearchDates('As-of October 13, 2026; 12 October 2026; 2026-02-30; October 8.')).toEqual(['2026-10-13T00:00:00.000Z', '2026-10-12T00:00:00.000Z'])
    expect(paragraphDataAsOf(paragraphs[0])).toBe('2026-10-13T00:00:00.000Z')
    expect(paragraphDataAsOf('Data as-of October 13, 2026 for chain metrics and October 12, 2026 for ETF flows.')).toBeNull()
    expect(paragraphDataAsOf('Published October 14, 2026.')).toBeNull()
  })
})
