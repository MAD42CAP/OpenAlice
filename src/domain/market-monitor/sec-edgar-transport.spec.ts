import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSecEdgarContext } from './sec-edgar.js'
import { createSecEdgarTransport, isSecEdgarArchiveUrl, type SecEdgarAsset } from './sec-edgar-transport.js'

const contact = 'operator@example.test', at = new Date('2026-10-16T05:00:00Z')
const accession = '0001628280-26-064366', digits = accession.replaceAll('-', '')
const feed = { cik: 1318605, filings: { recent: { form: ['8-K'], accessionNumber: [accession], filingDate: ['2026-10-02'], primaryDocument: ['tsla-20261002.htm'], acceptanceDateTime: ['2026-10-02T13:04:26.000Z'] } } }
afterEach(() => vi.useRealTimers())

describe('shared SEC public-document transport', () => {
  it('shares submissions between context and earnings, and paces archive requests through the same queue', async () => {
    let clock = at.getTime()
    const starts: number[] = [], urls: string[] = []
    const fetcher = vi.fn(async (url, init: RequestInit = {}) => {
      starts.push(clock); urls.push(String(url))
      expect((init.headers as Record<string, string>)['User-Agent']).toBe(`MAD42Lab Evidence Monitor/1.0 ${contact}`)
      expect(init.redirect).toBe('error')
      return String(url).includes('/submissions/') ? Response.json(feed) : new Response('<html><body>Official exhibit</body></html>')
    })
    const transport = createSecEdgarTransport({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    const context = createSecEdgarContext({ transport })
    const [filings, full, exhibit, index] = await Promise.all([
      context('TSLA', at), transport.submissions('TSLA', { at }),
      transport.archive('TSLA', accession, 'exhibit991111111.htm', { at }), transport.archive('TSLA', digits, 'index.json', { at }),
    ])
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(urls.filter(url => url.includes('/submissions/'))).toHaveLength(1)
    expect(starts.slice(1).every((start, i) => start - starts[i]! >= 1000)).toBe(true)
    expect(full.payload).toEqual(feed)
    expect((full.payload as typeof feed).filings.recent.acceptanceDateTime).toEqual(['2026-10-02T13:04:26.000Z'])
    expect(filings.health[0]?.status).toBe('ok')
    expect(exhibit).toMatchObject({ url: `https://www.sec.gov/Archives/edgar/data/1318605/${digits}/exhibit991111111.htm`, retrievedAt: at.toISOString() })
    expect(index.url).toMatch(/\/index\.json$/)
    expect(JSON.stringify([filings, full, exhibit, index])).not.toContain(contact)
  })

  it.each(['submissions', 'archive'] as const)('makes a %s 403 authoritative across both readers and assets', async stage => {
    let clock = at.getTime()
    const fetcher = vi.fn(async () => new Response('Undeclared automated client', { status: 403 }))
    const transport = createSecEdgarTransport({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    const failed = stage === 'submissions' ? transport.submissions('TSLA', { at }) : transport.archive('TSLA', accession, 'exhibit.htm', { at })
    await expect(failed).rejects.toThrow('HTTP 403')
    await expect(transport.archive('MSTR', accession, 'another.htm', { at })).rejects.toThrow('Retry paused')
    expect((await createSecEdgarContext({ transport })('MSTR', at)).health[0]?.detail).toContain('HTTP 403')
    clock += 14 * 60_000
    await expect(transport.submissions('TSLA', { at })).rejects.toThrow('HTTP 403')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('shares Retry-After restrictions with an archive consumer without leaking response diagnostics', async () => {
    let clock = at.getTime()
    const fetcher = vi.fn(async () => new Response(`private body ${contact}`, { status: 429, headers: { 'Retry-After': '120' } }))
    const transport = createSecEdgarTransport({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    await expect(transport.archive('TSLA', accession, 'exhibit.htm')).rejects.toThrow('HTTP 429')
    clock += 60_000
    try { await transport.submissions('MSTR') } catch (error) { expect(String(error)).toContain('Retry paused'); expect(String(error)).not.toMatch(/private body|operator@example/) }
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('honors a shorter coalesced caller deadline without cancelling the shared metadata request', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at)
    let finish: ((response: Response) => void) | undefined, signal: AbortSignal | undefined
    const fetcher = vi.fn(async (_url, options: RequestInit = {}) => { signal = options.signal!; return new Promise<Response>(resolve => { finish = resolve }) })
    const transport = createSecEdgarTransport({ fetcher, contactEmail: async () => contact })
    const metadata = transport.submissions('TSLA', { at, deadline: Date.now() + 12_500 })
    const earnings = transport.submissions('TSLA', { at, deadline: Date.now() + 1000 }).catch(error => error as Error)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await earnings).toMatchObject({ message: expect.stringContaining('shared request remains pending') })
    expect(signal?.aborted).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
    finish!(Response.json(feed))
    expect((await metadata).payload).toEqual(feed)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses one absolute chain deadline across queued documents instead of resetting a budget for every hop', async () => {
    let clock = at.getTime()
    const fetcher = vi.fn(async url => String(url).includes('/submissions/') ? Response.json(feed) : new Response('<html>Public document</html>'))
    const transport = createSecEdgarTransport({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    const deadline = clock + 1500
    await transport.submissions('TSLA', { at, deadline })
    await transport.archive('TSLA', accession, 'primary.htm', { at, deadline })
    await expect(transport.archive('TSLA', accession, 'exhibit.htm', { at, deadline })).rejects.toThrow(/budget|paused/)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('bounds a stalled archive body and retains its ownership until the stream settles', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at)
    let finish: ReadableStreamDefaultController<Uint8Array> | undefined
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { finish = controller } }))
    const fetcher = vi.fn(async () => response), transport = createSecEdgarTransport({ fetcher, contactEmail: async () => contact })
    const pending = transport.archive('TSLA', accession, 'exhibit.htm', { at }).catch(error => error as Error)
    await vi.advanceTimersByTimeAsync(12_500)
    expect(await pending).toMatchObject({ message: expect.stringContaining('12500ms refresh budget') })
    await expect(transport.archive('TSLA', accession, 'exhibit.htm', { at })).rejects.toThrow('prior aborted SEC request is still pending')
    expect(fetcher).toHaveBeenCalledTimes(1)
    finish!.enqueue(new TextEncoder().encode('<html>Late successful source</html>')); finish!.close()
    await vi.advanceTimersByTimeAsync(0)
    await expect(transport.submissions('MSTR')).rejects.toThrow('Retry paused')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds successful response bytes and does not retry a document that is oversized', async () => {
    const fetcher = vi.fn(async () => new Response('x'.repeat(2_000_001)))
    const transport = createSecEdgarTransport({ fetcher, contactEmail: async () => contact })
    await expect(transport.archive('TSLA', accession, 'exhibit.htm')).rejects.toThrow('size limit')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('bounds a denied response body without weakening its shared 403 restriction', async () => {
    let clock = at.getTime()
    const fetcher = vi.fn(async () => new Response('x'.repeat(2_000_001), { status: 403 }))
    const transport = createSecEdgarTransport({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    await expect(transport.archive('TSLA', accession, 'exhibit.htm')).rejects.toThrow('HTTP 403')
    clock += 14 * 60_000
    await expect(transport.submissions('MSTR')).rejects.toThrow('Retry paused')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not issue a request without a valid declaration or accept runtime prototype names as assets', async () => {
    const fetcher = vi.fn()
    const missing = createSecEdgarTransport({ fetcher, contactEmail: async () => null })
    await expect(missing.archive('TSLA', accession, 'exhibit.htm')).rejects.toThrow('contact email is not configured')
    await expect(missing.submissions('toString' as SecEdgarAsset)).rejects.toThrow('Unsupported SEC company')
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('SEC archive URL boundaries', () => {
  const valid = `https://www.sec.gov/Archives/edgar/data/1318605/${digits}/exhibit991111111.htm`
  it('accepts only the matching official company archive document', () => {
    expect(isSecEdgarArchiveUrl('TSLA', valid)).toBe(true)
    expect(isSecEdgarArchiveUrl('MSTR', valid)).toBe(false)
  })
  it.each([
    valid.replace('https:', 'http:'), valid.replace('www.sec.gov', 'data.sec.gov'), valid.replace('www.sec.gov', 'www.sec.gov.evil.test'),
    `${valid}?token=synthetic`, `${valid}#secret`, valid.replace('www.sec.gov', 'operator@example.test@www.sec.gov'),
    valid.replace(digits, '123'), valid.replace('exhibit991111111.htm', '../exhibit.htm'), valid.replace('exhibit991111111.htm', '%65xhibit.htm'),
  ])('rejects a noncanonical archive identity', url => expect(isSecEdgarArchiveUrl('TSLA', url)).toBe(false))
  it.each(['../exhibit.htm', '/private.txt', 'a?secret=x', 'a#x', '%65xhibit.htm', 'a..htm'])('rejects unsafe file names before making a request', async filename => {
    const fetcher = vi.fn(), transport = createSecEdgarTransport({ fetcher, contactEmail: async () => contact })
    await expect(transport.archive('TSLA', accession, filename)).rejects.toThrow('Invalid SEC public archive identity')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
