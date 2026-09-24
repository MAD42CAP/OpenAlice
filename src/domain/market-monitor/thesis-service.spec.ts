import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createThesisService, thesisSaveSchema } from './thesis-service.js'
import { createThesisStore, ThesisConflict, thesisRecordHash } from './thesis-store.js'
import { judgmentSnapshot } from './judgment.fixture.js'
import type { ThesisDraft } from './thesis-types.js'
import type { MarketMonitorSnapshot } from './types.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'thesis-test-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const draft = (): ThesisDraft => ({ thesis: 'Synthetic public thesis', horizon: 'One month', enabled: true, changeNote: 'Initial', conditions: [{ id: 'price', kind: 'support', label: 'Price floor', metric: 'daily-close', operator: 'gte', threshold: 101 }] })
function setup() {
  let at = new Date('2026-09-20T12:00:00Z')
  const snapshot = vi.fn(async (): Promise<MarketMonitorSnapshot | null> => judgmentSnapshot()), research = vi.fn(async () => [])
  const store = createThesisStore(root)
  const make = () => createThesisService({ store, snapshot, research, now: () => at })
  return { store, service: make(), make, snapshot, research, setTime: (value: string) => { at = new Date(value) } }
}

describe('thesis archive service', () => {
  it('starts unconfigured without provider reads; saves versions and reuses identical checks after restart', async () => {
    const s = setup()
    expect((await s.service.report('BTC')).revision).toBeNull()
    await s.service.afterScan(judgmentSnapshot())
    expect(s.snapshot).not.toHaveBeenCalled()
    const first = await s.service.save('BTC', 0, draft())
    expect(first.current?.status).toBe('supported')
    expect(first.checks).toHaveLength(1)
    expect((await s.service.check('BTC')).checks).toHaveLength(1)
    const later = judgmentSnapshot(); later.capturedAt = '2026-09-20T12:10:00Z'
    s.setTime(later.capturedAt)
    await s.service.afterScan(later)
    expect((await s.make().check('BTC')).checks).toHaveLength(1)
    expect(s.research).not.toHaveBeenCalled()
    expect((await stat(join(root, 'BTC/revision-00000001.json'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(root, 'BTC/checks.jsonl'))).mode & 0o777).toBe(0o600)
  })
  it('never rewrites old conditions/results and separates historical validity from current expiry', async () => {
    const s = setup(), first = await s.service.save('BTC', 0, draft())
    const bytes = await readFile(join(root, 'BTC/revision-00000001.json'), 'utf8')
    const changed = draft(); changed.conditions[0]!.threshold = 102; changed.changeNote = 'Raise floor'
    const next = await s.service.save('BTC', 1, changed)
    expect(next.current?.status).toBe('watch')
    expect(next.checks[0]).toEqual(first.checks[0])
    expect(await readFile(join(root, 'BTC/revision-00000001.json'), 'utf8')).toBe(bytes)
    s.setTime('2026-09-23T00:00:00Z')
    const expired = await s.service.report('BTC')
    expect(expired.current?.status).toBe('incomplete')
    expect(expired.checks[0]!.evaluation.status).toBe('supported')
    expect(expired.checks).toHaveLength(2)
  })
  it('rejects simultaneous stale edits even across separate service instances', async () => {
    const s = setup()
    const writes = await Promise.allSettled([s.service.save('BTC', 0, draft()), s.make().save('BTC', 0, draft())])
    expect(writes.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(writes.find(r => r.status === 'rejected')).toMatchObject({ reason: expect.any(ThesisConflict) })
    await expect(s.service.save('BTC', 0, draft())).rejects.toBeInstanceOf(ThesisConflict)
    expect((await s.service.report('BTC')).revisions).toHaveLength(1)
  })
  it('keeps a saved revision when checking fails, and exposes the independent failure', async () => {
    const s = setup(); s.snapshot.mockRejectedValueOnce(new Error('local input unavailable'))
    const report = await s.service.save('BTC', 0, draft())
    expect(report).toMatchObject({ checkError: true, current: null, revision: { revision: 1 } })
    expect((await s.service.check('BTC')).checkError).toBe(false)
    const paused = draft(); paused.enabled = false
    expect((await s.service.save('BTC', 1, paused)).current?.status).toBe('paused')
  })
  it('does not resurrect a prior passing value when the current input is missing entirely', async () => {
    const s = setup(); await s.service.save('BTC', 0, draft())
    s.snapshot.mockResolvedValueOnce(null)
    const report = await s.service.check('BTC')
    expect(report.current).toMatchObject({ status: 'incomplete', supported: 0, unknown: 1 })
    expect(report.checks[0]!.evaluation.status).toBe('supported')
  })
  it('does not regress duplicate-scan derivatives to an older market snapshot on a manual check', async () => {
    const s = setup(), d = draft(); d.conditions[0] = { id: 'funding', kind: 'invalidate', label: 'Funding', metric: 'funding-8h', operator: 'gt', threshold: 0.01 }
    await s.service.save('BTC', 0, d)
    s.setTime('2026-09-20T12:15:00Z')
    const fresh = judgmentSnapshot(); fresh.capturedAt = '2026-09-20T12:15:00Z'; fresh.sourceHealth[2]!.id = 'btc-derivatives'; fresh.sourceHealth[2]!.asOf = fresh.capturedAt; fresh.context.fundingRate = 0.0003
    await s.service.afterScan(fresh)
    const report = await s.make().check('BTC')
    expect(report.current).toMatchObject({ status: 'triggered', triggered: 1 })
    expect(report.current!.rows[0]!.evidence.value).toBe(0.03)
  })
  it('fails closed on changed archive contents without overwriting the file', async () => {
    const s = setup(); await s.service.save('BTC', 0, draft())
    const file = join(root, 'BTC/revision-00000001.json'), old = await readFile(file, 'utf8')
    await writeFile(file, old.replace('Synthetic public thesis', 'Changed content'))
    await expect(s.service.report('BTC')).rejects.toThrow('integrity')
    await expect(s.service.save('BTC', 1, draft())).rejects.toThrow('integrity')
  })
  it('validates asset/metric compatibility, bounded text, finite thresholds and unique condition ids', () => {
    const input = { asset: 'BTC', expectedRevision: 0, draft: draft() }
    expect(thesisSaveSchema.safeParse(input).success).toBe(true)
    input.draft.conditions[0]!.metric = 'strategy-mnav'
    expect(thesisSaveSchema.safeParse(input).success).toBe(false)
    input.draft = draft(); input.draft.conditions.push(input.draft.conditions[0]!)
    expect(thesisSaveSchema.safeParse(input).success).toBe(false)
    input.draft = draft(); input.draft.conditions[0]!.threshold = Infinity
    expect(thesisSaveSchema.safeParse(input).success).toBe(false)
    input.draft = draft(); input.draft.thesis = 'x'.repeat(2001)
    expect(thesisSaveSchema.safeParse(input).success).toBe(false)
  })
  it('bounds returned history while keeping older files and every original check intact', async () => {
    const s = setup(), first = await s.service.save('BTC', 0, draft())
    for (let revision = 2; revision <= 52; revision++) {
      const row = { ...first.revision!, revision, recordHash: '' }; row.recordHash = thesisRecordHash(row)
      await s.store.publish(row)
    }
    for (let i = 1; i <= 101; i++) {
      const row = { ...first.checks[0]!, dedupKey: String(i), recordHash: '' }; row.recordHash = thesisRecordHash(row)
      await s.store.appendCheck(row)
    }
    const bounded = await s.service.report('BTC')
    expect(bounded.truncated).toBe(true)
    expect(bounded.revisions).toHaveLength(50)
    expect(bounded.revisions[0]!.revision).toBe(3)
    expect(bounded.checks).toHaveLength(100)
    expect(await readFile(join(root, 'BTC/revision-00000001.json'), 'utf8')).toContain(first.revision!.recordHash)
  })
})
