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
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

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
    const load = createSecEdgarContext({ fetcher: vi.fn(async () => { throw new Error(`SEC bad transport ${contact} Authorization: secret`) }), contactEmail: async () => contact })
    const result = await load('TSLA', at)
    expect(result.health[0].detail).toBe('SEC submissions network or response failure.')
  })
})
