import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOfficialEarningsReader, isOfficialEarningsSourceUrl, type OfficialEarningsAsset, type OfficialEarningsResult } from './official-earnings.js'
import { SecEarningsError } from './sec-earnings.js'

const at = new Date('2027-04-10T12:00:00Z')
const urls = {
  TSLA: 'https://ir.tesla.com/press-release/tesla-first-quarter-2027-production-deliveries-and-deployments',
  MSTR: 'https://www.strategy.com/press/strategy-announces-earnings-release-date-and-live-video-webinar-for-first-quarter-2027-financial-results_04-08-2027',
} as const
const indexUrl = { TSLA: 'https://ir.tesla.com/', MSTR: 'https://www.strategy.com/press' } as const
function announcement(asset: OfficialEarningsAsset, options: { date?: string; published?: string; title?: string; body?: string } = {}) {
  const date = options.date ?? 'April 21, 2027'
  const title = options.title ?? `${asset === 'TSLA' ? 'Tesla' : 'Strategy'} First Quarter 2027 Financial Results Release Date`
  const heading = asset === 'TSLA' ? `<h1>Tesla</h1><h2 class="press-release__title">${title}</h2>` : `<h1>${title}</h1>`
  const published = asset === 'TSLA' ? `<time datetime="${options.published ?? '2027-04-02T12:00:00Z'}">April 2, 2027</time>` : `<p>Press Release<!-- --> &nbsp;•&nbsp; <!-- -->${options.published ?? 'April 8, 2027'}</p>`
  const body = options.body ?? `${asset === 'TSLA' ? 'Tesla' : 'Strategy'} will report its financial results for the first quarter of 2027 after ${asset === 'TSLA' ? 'market close' : 'the U.S. financial markets close'} on Wednesday, ${date}. The company will host a live webcast that day at ${asset === 'TSLA' ? '4:30 p.m. Central Time (5:30 p.m. Eastern Time)' : '5:00 p.m. Eastern Time'} to discuss results.`
  return `${heading}${published}<p>${body}</p>`
}
function listing(asset: OfficialEarningsAsset, candidates: Array<{ url: string; date: string }> = [{ url: urls[asset], date: '2027-04-21' }]) {
  if (asset === 'MSTR') return `<h1>Press Releases</h1>${candidates.map(row => `<div><a href="${row.url}">Strategy Announces Earnings Release Date</a><p>April 8, 2027</p></div>`).join('')}`
  return `<h1>Tesla Investor Relations</h1><table class="quarterly-disclosure-table"><thead><tr><th>Earnings Date</th></tr></thead>${candidates.map(row => `<tr><td>2027</td><td>Q1</td><td style="--columnHeader: 'Earnings Date';"><a href="${row.url}"><time datetime="${row.date}T12:00:00Z">${row.date}</time></a></td></tr>`).join('')}</table>`
}
function responses(asset: OfficialEarningsAsset, body = announcement(asset), index = listing(asset)) {
  return vi.fn<typeof fetch>(async input => new Response(String(input) === indexUrl[asset] ? index : body, { headers: { 'Content-Type': 'text/html' } }))
}
function reviewed(asset: OfficialEarningsAsset = 'TSLA'): OfficialEarningsResult {
  return { asset, status: 'confirmed', date: '2027-04-21', timing: 'after-close', webcastAt: '2027-04-21T21:30:00Z', sourceUrl: urls[asset], title: `${asset === 'TSLA' ? 'Tesla' : 'Strategy'} official financial-results release announcement`, publishedAt: '2027-04-02T12:00:00Z', retrievedAt: '2027-04-10T10:00:00Z', contentHash: 'a'.repeat(64), verification: 'research-reviewed', detail: 'Public official source independently reviewed.' }
}
afterEach(() => vi.useRealTimers())

describe('official keyless earnings discovery', () => {
  it.each(['TSLA', 'MSTR'] as const)('discovers %s from its official listing and verifies the release sentence separately from publication and webcast time', async asset => {
    const fetcher = responses(asset), read = createOfficialEarningsReader({ fetcher, now: () => at })
    const result = await read(asset, at)
    expect(result).toMatchObject({ asset, status: 'confirmed', date: '2027-04-21', timing: 'after-close', sourceUrl: urls[asset], retrievedAt: at.toISOString(), verification: 'live-official', webcastAt: asset === 'TSLA' ? '2027-04-21T21:30:00.000Z' : '2027-04-21T21:00:00.000Z' })
    expect(result.publishedAt).toBe(asset === 'TSLA' ? '2027-04-02T12:00:00Z' : '2027-04-08')
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([indexUrl[asset], urls[asset]])
    expect(fetcher.mock.calls.every(call => call[1]?.redirect === 'error' && call[1]?.method === 'GET')).toBe(true)
    expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/authorization|bearer|cookie|api.key/i)
  })
  it('accepts before-open timing without using the period-end date as the announcement date', async () => {
    const body = announcement('TSLA', { body: 'Tesla will release its financial results for the first quarter of 2027, which ended on March 31, 2027, before market open on April 21, 2027.' })
    expect(await createOfficialEarningsReader({ fetcher: responses('TSLA', body) })('TSLA', at)).toMatchObject({ date: '2027-04-21', timing: 'before-open', webcastAt: null })
  })
  it('keeps a separately announced next-day webcast distinct from the earnings release', async () => {
    const body = announcement('TSLA', { body: 'Tesla will report its financial results for the first quarter of 2027 after market close on April 21, 2027. A live webcast will be held on April 22, 2027 at 5:30 p.m. Eastern Time.' })
    expect(await createOfficialEarningsReader({ fetcher: responses('TSLA', body) })('TSLA', at)).toMatchObject({ date: '2027-04-21', webcastAt: '2027-04-22T21:30:00.000Z' })
  })
  it.each(['wrong-year', 'period-end-only', 'webcast-only', 'non-earnings', 'wrong-company', 'foreign-body', 'premature-quarter', 'future-publication'] as const)('does not confirm %s content as an earnings release date', failure => {
    let body = announcement('TSLA')
    if (failure === 'wrong-year') body = announcement('TSLA', { date: 'April 21, 2026' })
    if (failure === 'period-end-only') body = announcement('TSLA', { body: 'Tesla will report its financial results for the first quarter of 2027 which ended on March 31, 2027.' })
    if (failure === 'webcast-only') body = announcement('TSLA', { body: 'Tesla will host a financial results webcast on April 21, 2027 at 5:30 p.m. Eastern Time.' })
    if (failure === 'non-earnings') body = announcement('TSLA', { body: 'Tesla delivered vehicles on April 21, 2027; no financial results release date was announced.' })
    if (failure === 'foreign-body') body = announcement('TSLA', { body: 'Strategy will report its financial results for the first quarter of 2027 after market close on April 21, 2027.' })
    if (failure === 'premature-quarter') body = announcement('TSLA', { date: 'March 21, 2027', published: '2027-03-02T12:00:00Z' })
    if (failure === 'wrong-company') body = announcement('TSLA', { title: 'Strategy Financial Results Release Date' })
    if (failure === 'future-publication') body = announcement('TSLA', { published: '2027-04-11T12:00:00Z' })
    return expect(createOfficialEarningsReader({ fetcher: responses('TSLA', body) })('TSLA', at)).rejects.toThrow('Official earnings')
  })
  it('does not let script or hidden template prose create a release sentence', async () => {
    const valid = announcement('TSLA')
    const body = announcement('TSLA', { body: 'No upcoming earnings date is announced in this paragraph.' }) + `<script>const fake=${JSON.stringify(valid)}</script><template>${valid}</template>`
    await expect(createOfficialEarningsReader({ fetcher: responses('TSLA', body) })('TSLA', at)).rejects.toThrow('explicitly announce')
  })
  it('treats past valid announcements as unannounced future context without renewing the past date', async () => {
    const body = announcement('TSLA', { date: 'April 3, 2027' })
    const result = await createOfficialEarningsReader({ fetcher: responses('TSLA', body, listing('TSLA', [{ url: urls.TSLA, date: '2027-04-03' }])) })('TSLA', at)
    expect(result).toMatchObject({ status: 'unannounced', date: null, timing: 'unknown', webcastAt: null })
  })
  it('distinguishes a valid official listing with no scheduled announcement from an empty/malformed page', async () => {
    const valid = '<h1>Strategy Press Releases</h1><a href="/press/strategy-publishes-public-company-update">Strategy public company update</a>'
    expect(await createOfficialEarningsReader({ fetcher: responses('MSTR', '', valid) })('MSTR', at)).toMatchObject({ status: 'unannounced', date: null })
    await expect(createOfficialEarningsReader({ fetcher: responses('TSLA', '', '<html><body>Service unavailable</body></html>') })('TSLA', at)).rejects.toThrow('table is missing')
  })
  it('does not silently choose a date when the Tesla table disagrees with the release text', async () => {
    const result = await createOfficialEarningsReader({ fetcher: responses('TSLA', announcement('TSLA'), listing('TSLA', [{ url: urls.TSLA, date: '2027-04-22' }])) })('TSLA', at)
    expect(result).toMatchObject({ status: 'conflict', date: null })
  })
  it.each([false, true])('keeps conflicts visible, or honors an explicitly newer reschedule (%s)', async reschedule => {
    const newerUrl = `${urls.MSTR}-updated`, second = announcement('MSTR', { date: 'April 22, 2027', published: 'April 9, 2027', title: reschedule ? 'Strategy Reschedules Earnings Release Date for First Quarter 2027' : 'Strategy Announces Earnings Release Date for First Quarter 2027' })
    const index = listing('MSTR', [{ url: newerUrl, date: '2027-04-22' }, { url: urls.MSTR, date: '2027-04-21' }])
    const fetcher = vi.fn<typeof fetch>(async input => new Response(String(input) === indexUrl.MSTR ? index : String(input) === newerUrl ? second : announcement('MSTR'), { headers: { 'Content-Type': 'text/html' } }))
    const result = await createOfficialEarningsReader({ fetcher })('MSTR', at)
    expect(result.status).toBe(reschedule ? 'confirmed' : 'conflict')
    expect(result.date).toBe(reschedule ? '2027-04-22' : null)
  })
})

describe('bounded official requests and reviewed public-source recovery', () => {
  it.each(['https://example.invalid/press/earnings', 'https://www.strategy.com.evil.invalid/press/earnings', 'http://www.strategy.com/press/earnings', 'https://www.strategy.com/press/earnings?token=bad', 'https://user:password@www.strategy.com/press/earnings'])('rejects noncanonical source URLs: %s', url => {
    expect(isOfficialEarningsSourceUrl('MSTR', url)).toBe(false)
  })
  it('never follows external listing links or makes a credentialed request', async () => {
    const index = '<h1>Strategy Press Releases</h1><a href="https://example.invalid/press/earnings-release-date">Strategy Announces Earnings Release Date</a>'
    const fetcher = responses('MSTR', '', index)
    await expect(createOfficialEarningsReader({ fetcher })('MSTR', at)).rejects.toThrow('listing is missing')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([403, 429, 503])('preserves HTTP %s safely instead of calling a failed page unannounced', async status => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('Bearer syntheticSensitiveMarkerForTestsOnly', { status }))
    await expect(createOfficialEarningsReader({ fetcher })('TSLA', at)).rejects.toThrow(`HTTP ${status}`)
    await expect(createOfficialEarningsReader({ fetcher })('TSLA', at)).rejects.not.toThrow('syntheticSensitiveMarker')
  })
  it('sanitizes arbitrary network errors and rejects non-HTML and oversized bodies', async () => {
    const sensitive = 'Bearer syntheticSensitiveMarkerForTestsOnly'
    await expect(createOfficialEarningsReader({ fetcher: vi.fn(async () => { throw new Error(sensitive) }) })('TSLA', at)).rejects.toThrow('network or response failure')
    for (const response of [new Response('{}', { headers: { 'Content-Type': 'application/json' } }), new Response('x'.repeat(2_000_001), { headers: { 'Content-Type': 'text/html' } })]) {
      await expect(createOfficialEarningsReader({ fetcher: vi.fn(async () => response) })('TSLA', at)).rejects.toThrow('Official earnings')
    }
  })
  it('bounds a stalled transport and aborts it even when it ignores the signal', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined))
    const task = createOfficialEarningsReader({ fetcher })('TSLA', at)
    const assertion = expect(task).rejects.toThrow('6000ms')
    await vi.advanceTimersByTimeAsync(6_001)
    await assertion
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true)
  })
  it('bounds a stalled response stream independently of fetch resolution', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'text/html' } }))
    const task = createOfficialEarningsReader({ fetcher })('TSLA', at), assertion = expect(task).rejects.toThrow('6000ms')
    await vi.advanceTimersByTimeAsync(6_001); await assertion
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('coalesces identical in-flight reads, caches for five hours and preserves original retrieval times', async () => {
    let now = at
    const fetcher = responses('TSLA'), read = createOfficialEarningsReader({ fetcher, now: () => now })
    const [a, b] = await Promise.all([read('TSLA', at), read('TSLA', at)])
    expect(a).toEqual(b); expect(fetcher).toHaveBeenCalledTimes(2)
    now = new Date(at.getTime() + 4 * 3_600_000)
    expect((await read('TSLA', now)).retrievedAt).toBe(at.toISOString()); expect(fetcher).toHaveBeenCalledTimes(2)
    now = new Date(at.getTime() + 6 * 3_600_000)
    expect((await read('TSLA', now)).retrievedAt).toBe(now.toISOString()); expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('uses only still-current reviewed official evidence after direct rejection and never renews its retrieval time', async () => {
    const record = reviewed(), before = JSON.stringify(record), callback = vi.fn(async () => record)
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 403 }))
    const result = await createOfficialEarningsReader({ fetcher, reviewed: callback })('TSLA', at)
    expect(result).toMatchObject({ status: 'confirmed', verification: 'research-reviewed', retrievedAt: record.retrievedAt, contentHash: record.contentHash })
    expect(result.detail).toMatch(/HTTP 403.*research-reviewed/)
    expect(JSON.stringify(record)).toBe(before)
  })
  it.each(['stale', 'future-retrieval', 'future-publication', 'foreign-url', 'wrong-asset', 'estimate', 'bad-hash', 'past-date'] as const)('does not promote %s reviewed data into a confirmed date', failure => {
    const record = reviewed()
    if (failure === 'stale') record.retrievedAt = '2027-04-09T10:00:00Z'
    if (failure === 'future-retrieval') record.retrievedAt = '2027-04-11T10:00:00Z'
    if (failure === 'future-publication') record.publishedAt = '2027-04-11T10:00:00Z'
    if (failure === 'foreign-url') record.sourceUrl = 'https://example.invalid/press/earnings'
    if (failure === 'wrong-asset') record.asset = 'MSTR'
    if (failure === 'estimate') record.verification = 'live-official'
    if (failure === 'bad-hash') record.contentHash = 'invalid'
    if (failure === 'past-date') record.date = '2027-04-09'
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 403 }))
    return expect(createOfficialEarningsReader({ fetcher, reviewed: async () => record })('TSLA', at)).rejects.toThrow('HTTP 403')
  })
  it('prefers direct official evidence and never hides a verified table conflict behind a reviewed fallback', async () => {
    const callback = vi.fn(async () => reviewed())
    const direct = await createOfficialEarningsReader({ fetcher: responses('TSLA'), reviewed: callback })('TSLA', at)
    expect(direct.verification).toBe('live-official'); expect(callback).not.toHaveBeenCalled()
    const conflict = await createOfficialEarningsReader({ fetcher: responses('TSLA', announcement('TSLA'), listing('TSLA', [{ url: urls.TSLA, date: '2027-04-22' }])), reviewed: callback })('TSLA', at)
    expect(conflict.status).toBe('conflict'); expect(callback).not.toHaveBeenCalled()
  })
})

describe('automatic SEC earnings recovery', () => {
  const sourceUrl = 'https://www.sec.gov/Archives/edgar/data/1318605/000162828027000001/exhibit991.htm'
  function secEvent(at: Date, overrides: Partial<OfficialEarningsResult> = {}): OfficialEarningsResult {
    return { ...reviewed(), sourceUrl, publishedAt: '2027-04-02T13:00:00Z', retrievedAt: at.toISOString(), verification: 'live-official', ...overrides }
  }
  it('uses current SEC company evidence without reading blocked IR or manual reviewed state', async () => {
    const fetcher = vi.fn<typeof fetch>(), reviewed = vi.fn(async () => null)
    const read = createOfficialEarningsReader({ fetcher, reviewed, sec: async (_, at) => secEvent(at) })
    expect(await read('TSLA', at)).toMatchObject({ sourceUrl, verification: 'live-official', retrievedAt: at.toISOString() })
    expect(fetcher).not.toHaveBeenCalled(); expect(reviewed).not.toHaveBeenCalled()
  })
  it('refreshes automatically beyond 24 hours and preserves cache-hit verification time', async () => {
    let time = at
    const fetcher = vi.fn<typeof fetch>(), reviewed = vi.fn(async () => null), sec = vi.fn(async (_asset: OfficialEarningsAsset, at: Date) => secEvent(at))
    const read = createOfficialEarningsReader({ fetcher, reviewed, sec, now: () => time })
    const first = await read('TSLA', time)
    time = new Date(at.getTime() + 4 * 3_600_000)
    expect((await read('TSLA', time)).retrievedAt).toBe(first.retrievedAt)
    time = new Date(at.getTime() + 25 * 3_600_000)
    expect(await read('TSLA', time)).toMatchObject({ date: '2027-04-21', verification: 'live-official', retrievedAt: time.toISOString() })
    expect(sec).toHaveBeenCalledTimes(2); expect(fetcher).not.toHaveBeenCalled(); expect(reviewed).not.toHaveBeenCalled()
  })
  it.each(['conflict', 'unannounced'] as const)('does not overwrite a verified SEC %s with a convenient older date', async status => {
    const fetcher = responses('TSLA'), fallback = vi.fn(async () => reviewed())
    const result = await createOfficialEarningsReader({ fetcher, reviewed: fallback,
      sec: async (_, at) => secEvent(at, { status, date: null, timing: 'unknown', webcastAt: null }) })('TSLA', at)
    expect(result.status).toBe(status); expect(result.date).toBeNull()
    expect(fetcher).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled()
  })
  it('recovers a failed SEC read through direct IR while preserving manual evidence time if both fail', async () => {
    const sec = vi.fn(async () => { throw new Error('unexpected upstream transport text') })
    expect((await createOfficialEarningsReader({ sec, fetcher: responses('TSLA') })('TSLA', at)).sourceUrl).toBe(urls.TSLA)
    const record = reviewed()
    const result = await createOfficialEarningsReader({ sec, fetcher: vi.fn(async () => new Response('', { status: 403 })), reviewed: async () => record })('TSLA', at)
    expect(result.retrievedAt).toBe(record.retrievedAt)
    expect(result.detail).toContain('SEC earnings verification unavailable.'); expect(result.detail).toContain('HTTP 403')
    expect(result.detail).not.toContain('unexpected upstream')
  })
  it('does not call the Tesla SEC reader for MSTR', async () => {
    const sec = vi.fn()
    expect((await createOfficialEarningsReader({ sec, fetcher: responses('MSTR') })('MSTR', at)).date).toBe('2027-04-21')
    expect(sec).not.toHaveBeenCalled()
  })
  it('never revives an older reviewed date when current SEC coverage is incomplete', async () => {
    const fetcher = responses('TSLA'), fallback = vi.fn(async () => reviewed())
    const sec = async () => { throw new SecEarningsError('incomplete', true) }
    await expect(createOfficialEarningsReader({ sec, fetcher, reviewed: fallback })('TSLA', at)).rejects.toThrow('SEC earnings')
    expect(fetcher).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled()
  })
  it('cannot renew expired reviewed evidence after a failed automatic refresh', async () => {
    const record = reviewed(), originalTime = record.retrievedAt
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 403 }))
    const sec = async () => { throw new SecEarningsError('unavailable') }
    await expect(createOfficialEarningsReader({sec, fetcher, reviewed: async () => record})('TSLA', new Date(at.getTime() + 25 * 3_600_000))).rejects.toThrow('HTTP 403')
    expect(record.retrievedAt).toBe(originalTime)
  })
})
