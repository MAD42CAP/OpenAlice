import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createSecEarningsReader, SecEarningsError } from './sec-earnings.js'
import type { SecEdgarDocument, SecEdgarSubmissionsDocument, SecEdgarTransport } from './sec-edgar-transport.js'

const at = new Date('2026-10-16T19:00:00Z')
const original = { accession: '0001628280-26-064366', filed: '2026-10-02', primary: 'tsla-20261002.htm', accepted: '2026-10-02T13:04:26.000Z' }
const newer = { accession: '0001628280-26-065101', filed: '2026-10-15', primary: 'schedule-update.htm', accepted: '2026-10-15T13:00:00.000Z' }
type Row = typeof original
const archiveUrl = (row: Row, file: string) => `https://www.sec.gov/Archives/edgar/data/1318605/${row.accession.replaceAll('-', '')}/${file}`
const primary = (exhibits: Array<{ number: string; file?: string }> = [{ number: '99.1', file: 'unexpected-announcement-name.htm' }]) => `<html><div>TESLA, INC.</div><table>${exhibits.map(row => `<tr><td>Exhibit ${row.number}</td><td>${row.file ? `<a href="${row.file}">Company press release</a>` : 'Not linked'}</td></tr>`).join('')}</table></html>`
const announcement = (body = 'Tesla will post its financial results for the third quarter of 2026 after market close on Wednesday, October 21, 2026. Tesla management will hold a live question and answer webcast that day at 4:30 p.m. Central Time (5:30 p.m.&#xa0;Eastern Time) to discuss results.', title = 'Tesla Third Quarter 2026 Financial Results Schedule') => `<html><div>Exhibit 99.1</div><div>${title}</div><div>${body}</div></html>`
const payload = (rows: Row[], complete = true) => ({ cik: '0001318605', filings: { recent: {
  form: [...rows.map(() => '8-K'), ...(complete ? ['4'] : [])],
  accessionNumber: [...rows.map(row => row.accession), ...(complete ? ['0000000000-26-000001'] : [])],
  filingDate: [...rows.map(row => row.filed), ...(complete ? ['2026-01-02'] : [])],
  primaryDocument: [...rows.map(row => row.primary), ...(complete ? ['old.xml'] : [])],
  acceptanceDateTime: [...rows.map(row => row.accepted), ...(complete ? ['2026-01-02T13:00:00.000Z'] : [])],
} } })
function transport(rows: Row[] = [original], documents: Record<string, string> = {}, complete = true) {
  const submissions = vi.fn<SecEdgarTransport['submissions']>(async () => ({ asset: 'TSLA', url: 'https://data.sec.gov/submissions/CIK0001318605.json', payload: payload(rows, complete), body: JSON.stringify(payload(rows, complete)), retrievedAt: at.toISOString(), attemptFailures: [] }))
  const archive = vi.fn<SecEdgarTransport['archive']>(async (_asset, accession, file) => {
    const row = rows.find(row => row.accession === accession)!
    const body = documents[`${accession}/${file}`] ?? (file === row.primary ? primary() : announcement())
    return { asset: 'TSLA', url: archiveUrl(row, file), body, retrievedAt: at.toISOString(), attemptFailures: [] }
  })
  return { submissions, archive }
}
afterEach(() => vi.useRealTimers())

describe('SEC official earnings discovery through the shared transport', () => {
  it('discovers the actual linked exhibit in three requests and keeps availability, source hash and webcast distinct', async () => {
    const source = transport(), read = createSecEarningsReader({ transport: source })
    const result = await read('TSLA', at)
    expect(result).toMatchObject({ asset: 'TSLA', status: 'confirmed', date: '2026-10-21', timing: 'after-close', webcastAt: '2026-10-21T21:30:00.000Z', publishedAt: original.accepted, retrievedAt: at.toISOString(), sourceUrl: archiveUrl(original, 'unexpected-announcement-name.htm'), verification: 'live-official' })
    expect(result.contentHash).toBe(createHash('sha256').update(announcement()).digest('hex'))
    expect(source.archive.mock.calls.map(call => call.slice(0, 3))).toEqual([['TSLA', original.accession, original.primary], ['TSLA', original.accession, 'unexpected-announcement-name.htm']])
    const deadlines = [source.submissions.mock.calls[0][1]?.deadline, ...source.archive.mock.calls.map(call => call[3]?.deadline)]
    expect(new Set(deadlines).size).toBe(1)
    expect(source.archive.mock.calls.every(call => call[3]?.at === at)).toBe(true)
  })
  it('does not demand older history or fetch older filings after the latest useful announcement is fully checked', async () => {
    const older = Array.from({ length: 12 }, (_, i) => ({ ...original, accession: `0001628280-26-${String(62000 + i).padStart(6, '0')}`, filed: '2026-09-20', accepted: `2026-09-20T13:${String(i).padStart(2, '0')}:00.000Z` }))
    const source = transport([original, ...older], {}, false)
    expect(await createSecEarningsReader({ transport: source })('TSLA', at)).toMatchObject({ status: 'confirmed' })
    expect(source.archive).toHaveBeenCalledTimes(2)
  })
  it('walks all newer non-earnings 8-K filings and their exhibits before renewing an older date', async () => {
    const source = transport([original, newer], { [`${newer.accession}/${newer.primary}`]: primary([{ number: '99.2', file: 'other-public-update.htm' }]), [`${newer.accession}/other-public-update.htm`]: '<div>Tesla announces a software product update.</div>' })
    expect(await createSecEarningsReader({ transport: source })('TSLA', at)).toMatchObject({ date: '2026-10-21' })
    expect(source.archive.mock.calls.map(call => call[1])).toEqual([newer.accession, newer.accession, original.accession, original.accession])
  })
  it.each([
    ['fourth quarter of 2026', 'January 27, 2027', '2026-12-15', '2027-01-27'],
    ['first quarter of 2027', 'April 21, 2027', '2027-04-02', '2027-04-21'],
  ])('discovers a new reporting cycle %s without hardcoding dates', async (quarter, release, filed, expected) => {
    const capture = new Date(`${filed.slice(0, 7)}-20T19:00:00Z`)
    const row = { ...original, filed, accepted: `${filed}T13:00:00.000Z` }
    const source = transport([row], { [`${row.accession}/unexpected-announcement-name.htm`]: announcement(`Tesla will report its financial results for the ${quarter} before market open on ${release}.`) })
    source.submissions.mockImplementation(async () => ({ asset: 'TSLA', url: 'https://data.sec.gov/submissions/CIK0001318605.json', payload: payload([row]), body: '{}', retrievedAt: capture.toISOString(), attemptFailures: [] }))
    const originalArchive = source.archive.getMockImplementation()!
    source.archive.mockImplementation(async (...args) => ({ ...await originalArchive(...args), retrievedAt: capture.toISOString() }))
    expect(await createSecEarningsReader({ transport: source })('TSLA', capture)).toMatchObject({ date: expected, timing: 'before-open', webcastAt: null })
  })
  it.each([
    'Tesla will now post its financial results for the third quarter of 2026 after market close on October 28, 2026.',
    'Tesla has rescheduled the release of its financial results for the third quarter of 2026 from October 21, 2026 to October 28, 2026 after market close.',
  ])('takes an explicitly revised date from a newly discovered 99.2 exhibit', async body => {
    const source = transport([original, newer], { [`${newer.accession}/${newer.primary}`]: primary([{ number: '99.2', file: 'new-schedule.htm' }]), [`${newer.accession}/new-schedule.htm`]: announcement(body, 'Tesla Reschedules Third Quarter 2026 Financial Results') })
    expect(await createSecEarningsReader({ transport: source })('TSLA', at)).toMatchObject({ date: '2026-10-28', publishedAt: newer.accepted, sourceUrl: archiveUrl(newer, 'new-schedule.htm') })
    expect(source.archive).toHaveBeenCalledTimes(2)
  })
  it.each([
    'Tesla has cancelled the release of its financial results for the third quarter of 2026 until further notice.',
    'Tesla has withdrawn the financial results release schedule for the third quarter of 2026.',
    'Tesla will not report its financial results for the third quarter of 2026 on October 21, 2026.',
    'Tesla will no longer report its financial results for the third quarter of 2026 on October 21, 2026.',
  ])('does not revive an older date after a newer withdrawal or negative future action', async body => {
    const source = transport([original, newer], { [`${newer.accession}/${newer.primary}`]: primary([{ number: '99.3', file: 'withdrawn.htm' }]), [`${newer.accession}/withdrawn.htm`]: announcement(body) })
    expect(await createSecEarningsReader({ transport: source })('TSLA', at)).toMatchObject({ status: 'conflict', date: null, webcastAt: null, sourceUrl: archiveUrl(newer, 'withdrawn.htm') })
    expect(source.archive).toHaveBeenCalledTimes(2)
  })
  it('checks every 99-series exhibit and reports unresolved same-period conflicts', async () => {
    const source = transport([original], {
      [`${original.accession}/${original.primary}`]: primary([{ number: '99.1', file: 'a.htm' }, { number: '99.2', file: 'b.htm' }]),
      [`${original.accession}/a.htm`]: announcement(),
      [`${original.accession}/b.htm`]: announcement('Tesla will post its financial results for the third quarter of 2026 after market close on October 22, 2026.'),
    })
    expect(await createSecEarningsReader({ transport: source })('TSLA', at)).toMatchObject({ status: 'conflict', date: null })
    expect(source.archive).toHaveBeenCalledTimes(3)
  })
  it('honors one explicit replacement in the same filing instead of arbitrary exhibit order', async () => {
    const source = transport([original], {
      [`${original.accession}/${original.primary}`]: primary([{ number: '99.1', file: 'a.htm' }, { number: '99.2', file: 'b.htm' }]),
      [`${original.accession}/a.htm`]: announcement(),
      [`${original.accession}/b.htm`]: announcement('Tesla will now post its financial results for the third quarter of 2026 after market close on October 28, 2026.'),
    })
    expect(await createSecEarningsReader({ transport: source })('TSLA', at)).toMatchObject({ status: 'confirmed', date: '2026-10-28' })
  })
  it('does not choose between two equally current explicit revisions', async () => {
    const source = transport([original], {
      [`${original.accession}/${original.primary}`]: primary([{ number: '99.1', file: 'a.htm' }, { number: '99.2', file: 'b.htm' }]),
      [`${original.accession}/a.htm`]: announcement('Tesla will now post its financial results for the third quarter of 2026 after market close on October 27, 2026.'),
      [`${original.accession}/b.htm`]: announcement('Tesla will now post its financial results for the third quarter of 2026 after market close on October 28, 2026.'),
    })
    expect(await createSecEarningsReader({ transport: source })('TSLA', at)).toMatchObject({ status: 'conflict', date: null })
  })
  it.each(['missing', 'foreign-origin', 'wrong-accession', 'pdf', 'too-many'])('fails closed when a potentially material exhibit is %s', async mode => {
    let rows = [{ number: '99.2', file: 'new.htm' }]
    if (mode === 'missing') rows = [{ number: '99.2', file: '' }]
    if (mode === 'foreign-origin') rows[0].file = 'https://foreign.test/update.htm'
    if (mode === 'wrong-accession') rows[0].file = archiveUrl(original, 'new.htm')
    if (mode === 'pdf') rows[0].file = 'new.pdf'
    if (mode === 'too-many') rows = Array.from({ length: 4 }, (_, i) => ({ number: `99.${i + 1}`, file: `new${i}.htm` }))
    const source = transport([original, newer], { [`${newer.accession}/${newer.primary}`]: primary(rows) })
    await expect(createSecEarningsReader({ transport: source })('TSLA', at)).rejects.toMatchObject({ code: 'incomplete', blocksFallback: true })
    expect(source.archive).toHaveBeenCalledTimes(1)
  })
  it('blocks fallback if any newer linked document cannot be read', async () => {
    const source = transport([original, newer])
    source.archive.mockRejectedValueOnce(new Error('private transport text must not leak'))
    await expect(createSecEarningsReader({ transport: source })('TSLA', at)).rejects.toMatchObject({ code: 'incomplete', blocksFallback: true })
    expect(source.archive).toHaveBeenCalledTimes(1)
  })
  it.each(['missing-column', 'wrong-cik', 'future-acceptance', 'duplicate-accession'])('rejects %s metadata before reading an archive', async mode => {
    const source = transport(), data = payload([original])
    if (mode === 'missing-column') data.filings.recent.acceptanceDateTime = []
    if (mode === 'wrong-cik') data.cik = '0001050446'
    if (mode === 'future-acceptance') data.filings.recent.acceptanceDateTime[0] = '2026-10-17T13:00:00Z'
    if (mode === 'duplicate-accession') Object.assign(data, payload([original, original]))
    source.submissions.mockResolvedValue({ asset: 'TSLA', url: 'https://data.sec.gov/submissions/CIK0001318605.json', payload: data, body: '{}', retrievedAt: at.toISOString(), attemptFailures: [] })
    await expect(createSecEarningsReader({ transport: source })('TSLA', at)).rejects.toMatchObject({ blocksFallback: true })
    expect(source.archive).not.toHaveBeenCalled()
  })
  it('does not mistake a webcast-only or script-only statement for a release date', async () => {
    const source = transport([original], { [`${original.accession}/unexpected-announcement-name.htm`]: announcement('Tesla will host an earnings webcast on October 21, 2026 at 5:30 p.m. Eastern Time.') + `<script>${announcement()}</script><template>${announcement()}</template>` })
    expect(await createSecEarningsReader({ transport: source })('TSLA', at)).toMatchObject({ status: 'unannounced', date: null })
  })
  it.each([
    'Tesla will post its financial results for the third quarter of 2026 which ended on September 30, 2026.',
    'Tesla will post its financial results for the third quarter of 2026 on October 21, 2025.',
    'Tesla will post its financial results for the fourth quarter of 2026 on October 21, 2026.',
  ])('rejects ambiguous, mismatched-year, and period-end release substitutes', async body => {
    const source = transport([original], { [`${original.accession}/unexpected-announcement-name.htm`]: announcement(body) })
    await expect(createSecEarningsReader({ transport: source })('TSLA', at)).rejects.toMatchObject({ code: 'invalid', blocksFallback: true })
  })
  it('cannot renew unavailable or partial history as proof of an event-free calendar', async () => {
    const source = transport([original], { [`${original.accession}/unexpected-announcement-name.htm`]: '<div>Tesla public corporate update.</div>' }, false)
    await expect(createSecEarningsReader({ transport: source })('TSLA', at)).rejects.toMatchObject({ code: 'incomplete', blocksFallback: true })
  })
  it('bounds the search without skipping unreviewed newer filings to reach an older announcement', async () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ ...original, accession: `0001628280-26-${String(65000 + i).padStart(6, '0')}`, accepted: `2026-10-15T13:${String(i).padStart(2, '0')}:00.000Z` }))
    const source = transport(rows)
    source.archive.mockImplementation(async (_asset, accession, file) => ({ asset: 'TSLA', url: archiveUrl(rows.find(row => row.accession === accession)!, file), body: '<div>Tesla unrelated public corporate update.</div>', retrievedAt: at.toISOString(), attemptFailures: [] }))
    await expect(createSecEarningsReader({ transport: source })('TSLA', at)).rejects.toMatchObject({ code: 'incomplete', blocksFallback: true })
    expect(source.archive).toHaveBeenCalledTimes(8)
  })
  it('preserves the oldest verification cutoff used by the chain rather than refreshing cached evidence clocks', async () => {
    const source = transport()
    const metadata = await source.submissions('TSLA')
    source.submissions.mockResolvedValue({ ...metadata, retrievedAt: '2026-10-16T18:59:00Z' })
    expect(await createSecEarningsReader({ transport: source })('TSLA', at)).toMatchObject({ retrievedAt: '2026-10-16T18:59:00Z' })
  })
  it('sanitizes arbitrary early transport failures and rejects unsupported assets without a request', async () => {
    const source = transport(), read = createSecEarningsReader({ transport: source })
    await expect(read('MSTR', at)).rejects.toMatchObject({ code: 'unsupported', blocksFallback: false })
    expect(source.submissions).not.toHaveBeenCalled()
    source.submissions.mockRejectedValue(new Error('Authorization: test-only hidden transport payload'))
    const error = await read('TSLA', at).catch(error => error)
    expect(error).toBeInstanceOf(SecEarningsError)
    expect(error.message).not.toMatch(/Authorization|payload|test-only/)
    expect(error.blocksFallback).toBe(false)
  })
  it('enforces the total budget and a late primary cannot start any further request', async () => {
    vi.useFakeTimers()
    const source = transport()
    let finish!: (value: SecEdgarDocument) => void
    source.archive.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = createSecEarningsReader({ transport: source, budgetMs: 25 })('TSLA', at)
    const expectation = expect(pending).rejects.toMatchObject({ code: 'timeout', blocksFallback: true })
    await vi.advanceTimersByTimeAsync(25)
    await expectation
    finish({ asset: 'TSLA', url: archiveUrl(original, original.primary), body: primary(), retrievedAt: at.toISOString(), attemptFailures: [] })
    await Promise.resolve(); await Promise.resolve()
    expect(source.archive).toHaveBeenCalledTimes(1)
  })
})
