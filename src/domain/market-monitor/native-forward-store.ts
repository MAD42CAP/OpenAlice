import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dataPath } from '../../core/paths.js'
import { NATIVE_FORWARD_PROTOCOL, type NativeForwardCommit, type NativeForwardPublication } from './native-forward-types.js'
import type { MarketMonitorAsset } from './types.js'

export const nativeForwardHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const nativeForwardRecordHash = (row: NativeForwardPublication): string => nativeForwardHash({ ...row, recordHash: '' })
export const nativeForwardCommitHash = (row: NativeForwardCommit): string => nativeForwardHash({ ...row, recordHash: '' })
const MAX_RECORDS = 10_000
/** Additive immutable files. An overfull listing fails closed rather than losing the earliest call. */
export function createNativeForwardStore(root = dataPath('market-monitor', 'native-investment-forward-v1')) {
  const directory = (asset: MarketMonitorAsset) => {
    if (!['BTC', 'TSLA', 'MSTR'].includes(asset)) throw new Error('Invalid native forward asset')
    return `${root}/${asset}`
  }
  const path = (asset: MarketMonitorAsset, id: string) => {
    if (!/^investment-[a-f0-9]{64}$/.test(id)) throw new Error('Invalid native forward identity')
    return `${directory(asset)}/${id}.json`
  }
  const read = async (asset: MarketMonitorAsset, id: string): Promise<NativeForwardPublication | null> => {
    try {
      const row = JSON.parse(await readFile(path(asset, id), 'utf8')) as NativeForwardPublication
      if (row.id !== id || row.asset !== asset || row.protocol !== NATIVE_FORWARD_PROTOCOL || nativeForwardRecordHash(row) !== row.recordHash) throw new Error('Native forward integrity check failed')
      return row
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  const commitPath = (asset: MarketMonitorAsset, id: string) => path(asset, id).replace(`/${id}.json`, `/commits/${id}.json`)
  const readCommit = async (asset: MarketMonitorAsset, id: string): Promise<NativeForwardCommit | null> => {
    try {
      const row = JSON.parse(await readFile(commitPath(asset, id), 'utf8')) as NativeForwardCommit
      if (row.schemaVersion !== 1 || row.id !== id || row.asset !== asset || row.protocol !== NATIVE_FORWARD_PROTOCOL || nativeForwardCommitHash(row) !== row.recordHash) throw new Error('Native forward commit integrity check failed')
      return row
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  return {
    read, readCommit,
    async saveCommit(row: NativeForwardCommit) {
      if (row.protocol !== NATIVE_FORWARD_PROTOCOL || nativeForwardCommitHash(row) !== row.recordHash) throw new Error('Invalid native forward commit hash')
      await mkdir(`${directory(row.asset)}/commits`, { recursive: true, mode: 0o700 })
      const target = commitPath(row.asset, row.id), temp = `${target}.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify(row), { flag: 'wx', mode: 0o600 })
      let stored = true
      try { await link(temp, target) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; stored = false }
      finally { await unlink(temp) }
      const record = await readCommit(row.asset, row.id)
      if (!record) throw new Error('Native forward commit publication failed')
      return { stored, record }
    },
    async save(row: NativeForwardPublication) {
      if (row.protocol !== NATIVE_FORWARD_PROTOCOL || nativeForwardRecordHash(row) !== row.recordHash) throw new Error('Invalid native forward hash')
      await mkdir(directory(row.asset), { recursive: true, mode: 0o700 })
      const target = path(row.asset, row.id), temp = `${target}.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify(row), { flag: 'wx', mode: 0o600 })
      let stored = true
      try { await link(temp, target) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; stored = false }
      finally { await unlink(temp) }
      const record = await read(row.asset, row.id)
      if (!record) throw new Error('Native forward publication failed')
      return { stored, record }
    },
    async list(asset: MarketMonitorAsset) {
      let files: string[]
      try { files = await readdir(directory(asset)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], invalidRecords: 0, truncated: false }; throw error }
      const names = files.filter(f => /^investment-[a-f0-9]{64}\.json$/.test(f)).sort()
      if (names.length > MAX_RECORDS) return { records: [], invalidRecords: 0, truncated: true }
      const records: NativeForwardPublication[] = []
      let invalidRecords = 0
      for (const name of names) {
        try { const row = await read(asset, name.slice(0, -5)); if (row) records.push(row) }
        catch { invalidRecords++ }
      }
      return { records, invalidRecords, truncated: false }
    },
  }
}
