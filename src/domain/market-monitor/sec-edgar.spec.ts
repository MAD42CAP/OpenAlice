import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSecEdgarContext, loadSecContactEmail } from './sec-edgar.js'

const contact = 'operator@example.test'
const at = new Date('2026-09-16T00:00:00Z')
const feed = { cik: 1318605, filings: { recent: {
  form: ['8-K', '4', '10-Q'], accessionNumber: ['0001318605-26-000001', '0001318605-26-000002', '0001318605-26-000003'],
  filingDate: ['2026-09-15', '2026-09-14', '2026-08-01'], reportDate: ['2026-09-14', '', '2026-06-30'],
  primaryDocument: ['tsla-8k.htm', 'ownership.xml', 'tsla-10q.htm'], primaryDocDescription: ['Current report', '', 'Quarterly report'],
} } }
const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('SEC declared read-only access', () => {
  it('loads only local contact configuration and keeps invalid values out of errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sec-contact-')); roots.push(root)
    const file = join(root, 'contact.json')
    expect(await loadSecContactEmail(file)).toBeNull()
    await writeFile(file, JSON.stringify({ contactEmail: contact }))
    expect(await loadSecContactEmail(file)).toBe(contact)
    await writeFile(file, JSON.stringify({ contactEmail: `${contact}\r\nInjected: header` }))
    await expect(loadSecContactEmail(file)).rejects.toThrow('configuration')
    try { await loadSecContactEmail(file) } catch (error) { expect(String(error)).not.toContain(contact); expect(String(error)).not.toContain(root) }
  })

  it('does not make undeclared requests or use invented contacts', async () => {
    const fetcher = vi.fn()
    for (const email of [null, 'invalid', `${contact}\nExtra: header`]) {
      const result = await createSecEdgarContext({ fetcher, contactEmail: async () => email })('TSLA', at)
      expect(result.health[0]).toMatchObject({ status: 'unavailable', detail: expect.stringContaining('contact email is not configured') })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('declares the operator to SEC, validates the feed, and never persists the contact', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      expect(init.headers['User-Agent']).toBe(`MAD42Lab Evidence Monitor/1.0 ${contact}`)
      expect(init.redirect).toBe('error')
      return Response.json(feed)
    })
    const result = await createSecEdgarContext({ fetcher, contactEmail: async () => contact })('TSLA', at)
    expect(result.context.recentFilings).toHaveLength(2)
    expect(result.health[0]).toMatchObject({ status: 'ok', asOf: at.toISOString() })
    expect(result.context.recentFilings![0].url).toContain('/1318605/000131860526000001/tsla-8k.htm')
    expect(JSON.stringify(result)).not.toContain(contact)
  })

  it('classifies 403, respects cooldown across assets, and rechecks after contact correction', async () => {
    let clock = at.getTime(), email = contact
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(`<title>SEC.gov | Your Request Originates from an Undeclared Automated Tool</title>${contact}`, { status: 403 })).mockResolvedValueOnce(Response.json({ ...feed, cik: 1050446 }))
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => email, now: () => clock, wait: async ms => { clock += ms } })
    const first = await load('TSLA', at)
    expect(first.health[0].detail).toContain('SEC HTTP 403: SEC rejected')
    expect(JSON.stringify(first)).not.toContain(contact)
    expect((await load('MSTR', at)).health[0].detail).toContain('Retry paused')
    expect(fetcher).toHaveBeenCalledTimes(1)
    email = 'corrected@example.test'
    expect((await load('MSTR', at)).health[0].status).toBe('ok')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each(['120', 'Wed, 16 Sep 2026 00:02:00 GMT'])('respects SEC Retry-After %s without an immediate retry', async (retry) => {
    let clock = at.getTime()
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('rate limit', { status: 429, headers: { 'Retry-After': retry } })).mockResolvedValueOnce(Response.json(feed))
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    expect((await load('TSLA', at)).health[0].detail).toContain('HTTP 429')
    clock += 60_000
    expect((await load('TSLA', at)).health[0].status).toBe('unavailable')
    expect(fetcher).toHaveBeenCalledTimes(1)
    clock += 60_000
    expect((await load('TSLA', at)).health[0].status).toBe('ok')
  })

  it('shares overlapping requests and spaces different companies by at least a second', async () => {
    let clock = at.getTime()
    const starts: number[] = []
    const fetcher = vi.fn(async url => { starts.push(clock); return Response.json({ ...feed, cik: String(url).includes('1050446') ? 1050446 : 1318605 }) })
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    const first = load('TSLA', at)
    expect(load('TSLA', at)).toBe(first)
    await Promise.all([first, load('MSTR', at)])
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000)
  })

  it.each([{}, { ...feed, cik: 1050446 }, { filings: { recent: { form: ['8-K'] } } }])('does not mark malformed or wrong-company feeds as healthy', async body => {
    const load = createSecEdgarContext({ fetcher: vi.fn(async () => Response.json(body)), contactEmail: async () => contact })
    expect((await load('TSLA', at)).health[0].status).toBe('unavailable')
  })

  it('does not leak arbitrary transport errors, even if they impersonate SEC diagnostics', async () => {
    let clock = at.getTime()
    const fetcher = vi.fn(async () => { throw new Error(`SEC bad transport ${contact} Authorization: secret`) })
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    const result = await load('TSLA', at)
    expect(result.health[0].detail).toContain('failed after 2 attempts')
    expect(result.health[0].detail).toContain('network or response failure')
    expect(JSON.stringify(result)).not.toMatch(/operator@example|Authorization|secret|bad transport/)
    expect((await load('MSTR', at)).health[0].detail).toContain('Retry paused')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each(['network', 'HTTP 503'])('recovers a transient %s failure once without changing source identity', async (kind) => {
    let clock = at.getTime()
    const starts: number[] = []
    const fetcher = vi.fn(async () => {
      starts.push(clock)
      if (starts.length === 1) {
        if (kind === 'network') throw new TypeError(`fetch failed ${contact}`)
        return new Response('temporary failure and private server text', { status: 503 })
      }
      return Response.json(feed)
    })
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    const result = await load('TSLA', at)
    expect(starts).toHaveLength(2)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000)
    expect(result.health[0]).toMatchObject({ provider: 'SEC EDGAR', status: 'ok', asOf: at.toISOString(), detail: expect.stringContaining('Recovered after one retry') })
    expect(result.context.recentFilings).toHaveLength(2)
    expect(JSON.stringify(result)).not.toMatch(/operator@example|private server text/)
  })

  it.each(['1', 'Wed, 16 Sep 2026 00:00:02 GMT'])('retries a 429 only after an explicit short Retry-After %s', async retry => {
    let clock = at.getTime()
    const starts: number[] = []
    const fetcher = vi.fn(async () => {
      starts.push(clock)
      return starts.length === 1 ? new Response('rate limit', { status: 429, headers: { 'Retry-After': retry } }) : Response.json(feed)
    })
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    expect((await load('TSLA', at)).health[0].status).toBe('ok')
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(retry === '1' ? 1000 : 2000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([undefined, 'invalid', '9'.repeat(60)])('does not immediately retry a 429 without a usable Retry-After (%s)', async retry => {
    let clock = at.getTime()
    const fetcher = vi.fn(async () => new Response('server text', { status: 429, headers: retry ? { 'Retry-After': retry } : undefined }))
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    expect((await load('TSLA', at)).health[0].detail).toContain('HTTP 429')
    clock += 59_000
    expect((await load('MSTR', at)).health[0].status).toBe('unavailable')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps the first and second failure stages when the retry also fails', async () => {
    let clock = at.getTime()
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('private network diagnostics')).mockResolvedValueOnce(new Response('private body', { status: 503 }))
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    const result = await load('TSLA', at)
    expect(result.health[0].detail).toMatch(/Attempt 1: SEC submissions network or response failure\..*Attempt 2: SEC HTTP 503/)
    expect(JSON.stringify(result)).not.toContain('private')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not retry malformed JSON, mismatched identities or permanent HTTP failures', async () => {
    for (const response of [new Response('{invalid'), Response.json({ ...feed, cik: 1050446 }), new Response('private', { status: 401 })]) {
      const fetcher = vi.fn(async () => response)
      const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact })
      expect((await load('TSLA', at)).health[0].status).toBe('unavailable')
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
    const result = await createSecEdgarContext({ fetcher: vi.fn(async () => Response.json({ cik: 1318605, filings: { recent: { form: [] } } })), contactEmail: async () => contact })('TSLA', at)
    expect(result.health[0].status).toBe('ok')
    expect(result.context.recentFilings).toEqual([])
  })

  it('distinguishes truncated JSON from invalid JSON and retries only the incomplete transfer', async () => {
    let clock = at.getTime()
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"cik":')).mockResolvedValueOnce(Response.json(feed))
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    const result = await load('TSLA', at)
    expect(result.health[0]).toMatchObject({ status: 'ok', detail: expect.stringContaining('incomplete submissions JSON') })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('retries a cancelled timeout within the total refresh budget', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at)
    const fetcher = vi.fn().mockImplementationOnce((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('private timeout text', 'AbortError')), { once: true })
    })).mockResolvedValueOnce(Response.json(feed))
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact })
    const pending = load('TSLA', at)
    await vi.advanceTimersByTimeAsync(6250)
    expect((await pending).health[0]).toMatchObject({ status: 'ok', detail: expect.stringContaining('request timed out') })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns at the deadline and retains ownership of an upstream request that ignores abort', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at)
    let finish: ((value: Response) => void) | undefined
    const fetcher = vi.fn(async () => new Promise<Response>(resolve => { finish = resolve }))
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact })
    const pending = load('TSLA', at)
    await vi.advanceTimersByTimeAsync(12_500)
    const result = await pending
    expect(result.health[0]).toMatchObject({ status: 'unavailable', asOf: null, detail: expect.stringContaining('12500ms refresh budget') })
    expect((await load('TSLA', new Date())).health[0].detail).toContain('prior aborted SEC request is still pending')
    expect(fetcher).toHaveBeenCalledTimes(1)
    finish!(Response.json(feed))
    await vi.advanceTimersByTimeAsync(0)
    // A late successful response is neither published nor accepted as a fresh retry.
    const next = await load('TSLA', new Date())
    expect(next.context).toEqual({})
    expect(next.health[0].detail).toContain('Retry paused')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    fetcher.mockResolvedValueOnce(Response.json(feed))
    expect((await load('TSLA', new Date())).health[0].status).toBe('ok')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('keeps a 403 observed by another company authoritative over a pending retry', async () => {
    let clock = at.getTime()
    let failFirst: ((value: Response) => void) | undefined
    const fetcher = vi.fn(async url => {
      if (String(url).includes('1318605')) return new Promise<Response>(resolve => { failFirst = resolve })
      return new Response('SEC denied', { status: 403 })
    })
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact, now: () => clock, wait: async ms => { clock += ms } })
    const first = load('TSLA', at)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect((await load('MSTR', at)).health[0].detail).toContain('HTTP 403')
    failFirst!(new Response('transient', { status: 503 }))
    expect((await first).health[0].detail).toContain('HTTP 403')
    expect(fetcher).toHaveBeenCalledTimes(2)
    clock += 14 * 60_000
    expect((await load('TSLA', at)).health[0].detail).toContain('HTTP 403')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('keeps the 403 restriction even when its diagnostic response body never finishes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at)
    let finishBody: ((value: string) => void) | undefined
    const denied = new Response('denied', { status: 403 })
    vi.spyOn(denied, 'text').mockImplementation(() => new Promise(resolve => { finishBody = resolve }))
    const fetcher = vi.fn(async () => denied)
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact })
    const pending = load('TSLA', at)
    await vi.advanceTimersByTimeAsync(12_500)
    expect((await pending).health[0].detail).toContain('HTTP 403')
    expect((await load('MSTR', new Date())).health[0].detail).toContain('HTTP 403')
    expect(fetcher).toHaveBeenCalledTimes(1)
    finishBody!('undeclared automated client')
    await vi.advanceTimersByTimeAsync(14 * 60_000)
    expect((await load('TSLA', new Date())).health[0].detail).toContain('HTTP 403')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('retains the first failure when a second request overruns the total refresh deadline', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at)
    let finish: ((value: Response) => void) | undefined
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('sensitive network text')).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
    const load = createSecEdgarContext({ fetcher, contactEmail: async () => contact })
    const pending = load('TSLA', at)
    await vi.advanceTimersByTimeAsync(12_500)
    expect((await pending).health[0].detail).toMatch(/12500ms refresh budget.*Attempt 1: SEC submissions network or response failure/)
    expect(JSON.stringify(await pending)).not.toContain('sensitive')
    expect(fetcher).toHaveBeenCalledTimes(2)
    finish!(Response.json(feed))
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
