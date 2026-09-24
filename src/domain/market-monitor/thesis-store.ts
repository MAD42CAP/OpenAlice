import { appendFile, link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dataPath } from '../../core/paths.js'
import { readRecentJsonLines } from './journal.js'
import type { MarketMonitorAsset } from './types.js'
import type { ThesisCheck, ThesisRevision } from './thesis-types.js'

export class ThesisConflict extends Error {}
export const thesisHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const thesisRecordHash = (value: { recordHash: string }) => thesisHash({ ...value, recordHash: '' })

export function createThesisStore(root = dataPath('market-monitor', 'thesis-v1')) {
  const folder = (asset: MarketMonitorAsset) => {
    if (!['BTC', 'TSLA', 'MSTR'].includes(asset)) throw new Error('Invalid asset')
    return `${root}/${asset}`
  }
  const verify = <T extends { recordHash: string }>(row: T): T => {
    if (thesisRecordHash(row) !== row.recordHash) throw new Error('Thesis integrity check failed')
    return row
  }
  return {
    async revisions(asset: MarketMonitorAsset) {
      let names: string[]
      try { names = await readdir(folder(asset)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { rows: [], truncated: false }; throw error }
      names = names.filter(n => /^revision-\d{8}\.json$/.test(n)).sort()
      const rows = await Promise.all(names.slice(-50).map(async name => {
        const row = verify(JSON.parse(await readFile(`${folder(asset)}/${name}`, 'utf8')) as ThesisRevision)
        if (row.asset !== asset || name !== `revision-${String(row.revision).padStart(8, '0')}.json`) throw new Error('Invalid thesis identity')
        return row
      }))
      return { rows, truncated: names.length > 50 }
    },
    async publish(row: ThesisRevision) {
      verify(row)
      if (!Number.isInteger(row.revision) || row.revision < 1 || row.revision > 99999999) throw new Error('Invalid revision')
      const dir = folder(row.asset)
      await mkdir(dir, { recursive: true })
      const path = `${dir}/revision-${String(row.revision).padStart(8, '0')}.json`, temp = `${path}.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify(row), { flag: 'wx', mode: 0o600 })
      try { await link(temp, path) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ThesisConflict('Thesis changed'); throw error }
      finally { await unlink(temp) }
    },
    async checks(asset: MarketMonitorAsset) {
      const { rows } = await readRecentJsonLines<ThesisCheck>(`${folder(asset)}/checks.jsonl`, 101)
      rows.forEach(row => { verify(row); verify(row.revision); if (row.asset !== asset || row.revision.asset !== asset) throw new Error('Invalid thesis check identity') })
      return { rows: rows.slice(-100), truncated: rows.length > 100 }
    },
    async appendCheck(row: ThesisCheck) {
      verify(row)
      await mkdir(folder(row.asset), { recursive: true })
      await appendFile(`${folder(row.asset)}/checks.jsonl`, `${JSON.stringify(row)}\n`, { mode: 0o600 })
    },
  }
}
export type ThesisStore = ReturnType<typeof createThesisStore>
