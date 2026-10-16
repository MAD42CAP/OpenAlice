import { expect, it } from 'vitest'
import { currentOfficialEarnings } from './earnings-evidence.js'
import { judgmentSnapshot } from './judgment.fixture.js'

function fixture() {
  const s = judgmentSnapshot(); s.asset = 'TSLA'
  s.context.nextEarningsAt = '2026-10-21'
  s.context.earningsEvent = { asset: 'TSLA', status: 'confirmed', date: '2026-10-21', timing: 'after-close', webcastAt: null,
    sourceUrl: 'https://ir.tesla.com/press-release/synthetic-earnings', title: 'Synthetic announcement', publishedAt: '2026-09-18',
    retrievedAt: s.capturedAt, contentHash: 'a'.repeat(64), verification: 'research-reviewed', detail: 'Synthetic fixture' }
  s.sourceHealth.push({ id: 'tsla-earnings', label: 'Official earnings', provider: 'Tesla IR', status: 'ok', asOf: s.capturedAt,
    detail: 'Synthetic verified source', coverage: { earnings: 'available', news: 'not-configured' } })
  return s
}
it('keeps a verified announcement independent of unrelated context failures', () => {
  const s = fixture(); s.sourceHealth[2]!.status = 'unavailable'
  expect(currentOfficialEarnings(s, new Date(s.capturedAt))?.date).toBe('2026-10-21')
})
it('never promotes a reference estimate, retained failure, or malformed provenance', () => {
  for (const modify of [
    (s: ReturnType<typeof fixture>) => { s.context.earningsEvent!.status = 'estimated' },
    (s: ReturnType<typeof fixture>) => { s.sourceHealth.at(-1)!.retained = { asOf: s.capturedAt, expiresAt: s.capturedAt, fields: ['earningsEvent'] } },
    (s: ReturnType<typeof fixture>) => { s.context.earningsEvent!.sourceUrl = 'https://example.test/press/earnings' },
    (s: ReturnType<typeof fixture>) => { s.context.earningsEvent!.asset = 'MSTR' },
    (s: ReturnType<typeof fixture>) => { s.context.earningsEvent!.contentHash = '' },
  ]) { const s = fixture(); modify(s); expect(currentOfficialEarnings(s, new Date(s.capturedAt))).toBeNull() }
})
it('keeps fixed verification time and rejects expired, future and already-passed events', () => {
  const s = fixture(), before = structuredClone(s)
  expect(currentOfficialEarnings(s, new Date('2026-09-21T12:00:01Z'))).toBeNull()
  s.context.earningsEvent!.retrievedAt = '2026-09-20T12:00:01Z'
  expect(currentOfficialEarnings(s, new Date(s.capturedAt))).toBeNull()
  Object.assign(s, structuredClone(before)); s.context.nextEarningsAt = s.context.earningsEvent!.date = '2026-09-19'
  expect(currentOfficialEarnings(s, new Date(s.capturedAt))).toBeNull()
  expect(before.context.earningsEvent!.retrievedAt).toBe(before.capturedAt)
})
