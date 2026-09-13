import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { readRecentJsonLines } from './journal.js'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'monitor-tail-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

it('reads only recent blocks while filtering by asset in chronological order', async () => {
  const file = join(root, 'receipts.jsonl')
  const rows = Array.from({ length: 20_000 }, (_, id) => ({ id, asset: id % 2 ? 'BTC' : 'TSLA', detail: 'fixture'.repeat(20) }))
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
  const result = await readRecentJsonLines<(typeof rows)[number]>(file, 3, (row) => row.asset === 'TSLA')
  expect(result.rows.map((row) => row.id)).toEqual([19994, 19996, 19998])
  expect(result.bytesRead).toBe(64 * 1024)
  expect(result.bytesRead).toBeLessThan((await stat(file)).size / 10)
})

it('preserves multi-block UTF-8 records and skips corrupt or partial tail records', async () => {
  const file = join(root, 'records.jsonl')
  const rows = [{ id: 1, message: '来源恢复🙂'.repeat(20_000) }, { id: 2, message: '正常' }]
  await writeFile(file, `${JSON.stringify(rows[0])}\nnot-json\nnull\n${JSON.stringify(rows[1])}\n{"partial":`)
  expect((await readRecentJsonLines(file, 2)).rows).toEqual(rows)
})

it('handles missing, empty and non-newline-terminated journals', async () => {
  const file = join(root, 'records.jsonl')
  expect((await readRecentJsonLines(file, 2)).rows).toEqual([])
  await writeFile(file, '')
  expect((await readRecentJsonLines(file, 2)).rows).toEqual([])
  await writeFile(file, '{"id":1}\n{"id":2}')
  expect((await readRecentJsonLines(file, 1)).rows).toEqual([{ id: 2 }])
  expect((await readRecentJsonLines(file, 5)).rows).toEqual([{ id: 1 }, { id: 2 }])
})
