import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createReviewedEarningsStore } from './reviewed-earnings-store.js'
import type { OfficialEarningsResult } from './official-earnings.js'

let home: string
const at = new Date('2026-10-16T06:00:00Z')
const fixture = (asset: 'TSLA' | 'MSTR' = 'TSLA'): OfficialEarningsResult => ({
  asset, status: 'confirmed', date: asset === 'TSLA' ? '2026-10-21' : '2026-10-29', timing: 'after-close',
  webcastAt: asset === 'TSLA' ? '2026-10-21T21:30:00Z' : '2026-10-29T21:00:00Z',
  sourceUrl: asset === 'TSLA' ? 'https://ir.tesla.com/press-release/tesla-third-quarter-2026-production-deliveries-and-deployments'
    : 'https://www.strategy.com/press/strategy-announces-earnings-release-date-and-live-video-webinar-for-third-quarter-2026-financial-results_10-08-2026',
  title: `${asset} test-only official earnings event`, publishedAt: '2026-10-08', retrievedAt: '2026-10-16T05:49:00.000Z',
  contentHash: 'a'.repeat(64), verification: 'research-reviewed', detail: 'Test-only public announcement evidence; release after close; webcast time is separate.',
})
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'oa-reviewed-earnings-')); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at) })
afterEach(async () => { vi.useRealTimers(); await rm(home, { recursive: true, force: true }) })
const assetFiles = async (asset = 'tsla') => (await readdir(join(home, asset))).filter(name => name.endsWith('.json'))

describe('reviewed official earnings archive', () => {
  it('isolates assets, preserves actual retrieval times, and creates private additive records', async () => {
    const store = createReviewedEarningsStore(home)
    expect(await store.read('TSLA', at)).toBeNull()
    for (const asset of ['TSLA', 'MSTR'] as const) {
      const row = fixture(asset)
      await store.save(row)
      expect(await store.read(asset, at)).toEqual(row)
      const [name] = await assetFiles(asset.toLowerCase())
      const path = join(home, asset.toLowerCase(), name)
      const saved = JSON.parse(await readFile(path, 'utf8'))
      expect(saved).toMatchObject({ schemaVersion: 1, record: row })
      expect(saved.recordHash).toMatch(/^[a-f0-9]{64}$/)
      if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
  })

  it('makes identical concurrent saves idempotent and never changes older bytes', async () => {
    const store = createReviewedEarningsStore(home), old = fixture()
    await Promise.all([store.save(old), store.save(old)])
    const [name] = await assetFiles(), before = await readFile(join(home, 'tsla', name), 'utf8')
    const newer = { ...old, retrievedAt: '2026-10-16T05:59:00Z', contentHash: 'b'.repeat(64) }
    await store.save(newer)
    expect(await assetFiles()).toHaveLength(2)
    expect(await readFile(join(home, 'tsla', name), 'utf8')).toBe(before)
    expect(await store.read('TSLA', at)).toEqual(newer)
    expect(await store.read('TSLA', '2026-10-16T05:50:00Z')).toEqual(old)
  })

  it('bounds freshness to exactly 24 hours without extending the review clock', async () => {
    const store = createReviewedEarningsStore(home), row = fixture()
    await store.save(row)
    expect(await store.read('TSLA', new Date('2026-10-17T05:49:00Z'))).toEqual(row)
    expect(await store.read('TSLA', new Date('2026-10-17T05:49:00.001Z'))).toBeNull()
    expect(await store.read('TSLA', new Date('2026-10-16T05:48:59Z'))).toBeNull()
    expect(await store.read('TSLA', new Date('invalid'))).toBeNull()
  })

  it('does not reuse an event whose New York reporting day has passed', async () => {
    const store = createReviewedEarningsStore(home)
    const row = { ...fixture(), date: '2026-10-15', webcastAt: '2026-10-15T21:30:00Z', retrievedAt: '2026-10-15T22:00:00Z' }
    await store.save(row)
    expect(await store.read('TSLA', '2026-10-16T03:59:59Z')).toEqual(row)
    expect(await store.read('TSLA', '2026-10-16T04:00:00Z')).toBeNull()
  })

  it.each([
    { sourceUrl: 'https://ir.tesla.com.evil.test/press-release/announcement' },
    { sourceUrl: 'https://www.strategy.com/press/strategy-announces-earnings-release-date-and-live-video-webinar-for-third-quarter-2026-financial-results_10-08-2026' },
    { sourceUrl: 'https://ir.tesla.com/press-release/announcement?token=test-only' },
    { sourceUrl: 'https://ir.tesla.com/press-release/announcement#date' },
    { sourceUrl: 'https://test-only@ir.tesla.com/press-release/announcement' },
    { sourceUrl: 'http://ir.tesla.com/press-release/announcement' },
    { sourceUrl: 'https://ir.tesla.com/account' },
    { date: '2026-02-30' }, { date: '2026-10-15' }, { retrievedAt: '2026-10-16T06:00:00.001Z' },
    { retrievedAt: '2026-10-16T24:00:00Z' }, { publishedAt: '2026-10-17' }, { publishedAt: null },
    { publishedAt: '2026-10-16', retrievedAt: '2026-10-16T02:00:00Z' },
    { contentHash: 'A'.repeat(64) }, { contentHash: 'not-a-hash' }, { status: 'unannounced' },
    { verification: 'live-official' }, { asset: '../tsla' }, { webcastAt: '2026-10-20T21:30:00Z' },
    { unexpectedProviderKey: 'test-only-unaccepted-field' },
  ])('rejects invalid, future, unconfirmed, or nonofficial record %#', async override => {
    const store = createReviewedEarningsStore(home)
    await expect(store.save({ ...fixture(), ...override } as OfficialEarningsResult)).rejects.toThrow('完整性检查')
    expect(await store.read('TSLA', at)).toBeNull()
  })

  it.each(['invalid-json', 'changed-data', 'wrong-asset', 'wrong-schema', 'oversized'])('fails closed on newest %s rather than reviving older reviewed data', async failure => {
    const store = createReviewedEarningsStore(home)
    await store.save(fixture())
    await store.save({ ...fixture(), retrievedAt: '2026-10-16T05:59:00Z', contentHash: 'b'.repeat(64) })
    const names = (await assetFiles()).sort(), latest = join(home, 'tsla', names[1])
    const envelope = JSON.parse(await readFile(latest, 'utf8'))
    if (failure === 'changed-data') envelope.record.date = '2026-10-22'
    if (failure === 'wrong-asset') envelope.record.asset = 'MSTR'
    if (failure === 'wrong-schema') envelope.schemaVersion = 2
    await writeFile(latest, failure === 'invalid-json' ? '{broken' : failure === 'oversized' ? ' '.repeat(16_385) : JSON.stringify(envelope))
    expect(await store.read('TSLA', at)).toBeNull()
    expect(await assetFiles()).toHaveLength(2)
    expect(JSON.parse(await readFile(join(home, 'tsla', names[0]), 'utf8')).record).toEqual(fixture())
    await expect(store.save({ ...fixture(), retrievedAt: '2026-10-16T05:59:00Z', contentHash: 'b'.repeat(64) })).rejects.toThrow('完整性检查')
  })

  it('does not pick an arbitrary event when two different reviews share a timestamp', async () => {
    const store = createReviewedEarningsStore(home)
    await store.save(fixture())
    await store.save({ ...fixture(), contentHash: 'b'.repeat(64) })
    expect(await store.read('TSLA', at)).toBeNull()
  })

  it('rejects mismatched filename timestamps and unknown JSON identities', async () => {
    const store = createReviewedEarningsStore(home)
    await store.save(fixture())
    await writeFile(join(home, 'tsla', `TSLA-${Date.parse('2026-10-16T05:59:00Z')}-${'f'.repeat(64)}.json`), await readFile(join(home, 'tsla', (await assetFiles())[0])))
    expect(await store.read('TSLA', at)).toBeNull()
    await writeFile(join(home, 'tsla', 'unexpected.json'), '{}')
    await expect(store.save(fixture())).rejects.toThrow('完整性检查')
  })

  it('limits directory cardinality and does not read an unbounded archive', async () => {
    const store = createReviewedEarningsStore(home)
    await store.save(fixture())
    await Promise.all(Array.from({ length: 1_024 }, (_, i) => writeFile(join(home, 'tsla', `ignored-${i}.tmp`), '')))
    expect(await store.read('TSLA', at)).toBeNull()
    await expect(store.save(fixture())).rejects.toThrow('完整性检查')
  })

  it.skipIf(process.platform === 'win32')('rejects a symlinked root, asset directory, and record without reading outside the configured archive', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'oa-reviewed-outside-'))
    try {
      const linkedRoot = join(home, 'linked')
      await symlink(outside, linkedRoot)
      const linkedStore = createReviewedEarningsStore(linkedRoot)
      await expect(linkedStore.save(fixture())).rejects.toThrow('完整性检查')
      expect(await linkedStore.read('TSLA', at)).toBeNull()
      await symlink(outside, join(home, 'tsla'))
      const store = createReviewedEarningsStore(home)
      await expect(store.save(fixture())).rejects.toThrow('完整性检查')
      expect(await store.read('TSLA', at)).toBeNull()
      await rm(join(home, 'tsla'))
      await store.save(fixture())
      const [name] = await assetFiles(), path = join(home, 'tsla', name), destination = join(outside, 'public-test.json')
      await writeFile(destination, await readFile(path))
      await rm(path)
      await symlink(destination, path)
      expect(await store.read('TSLA', at)).toBeNull()
      await expect(store.save(fixture())).rejects.toThrow('完整性检查')
    } finally { await rm(outside, { recursive: true, force: true }) }
  })
})
