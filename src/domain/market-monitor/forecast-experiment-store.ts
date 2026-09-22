import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dataPath } from '../../core/paths.js'
import { hashJevInput } from './typesafe-input.js'
import { TypeSafeError } from './typesafe-client.js'
import type { MarketMonitorAsset } from './types.js'
import type { ExperimentCandidate, ExperimentPublication } from './forecast-experiment-types.js'

export const recordHash = <T extends { recordHash: string }>(row: T) => hashJevInput({ ...row, recordHash: '' })
export function createForecastExperimentStore(root = dataPath('market-monitor', 'forecast-experiment-v1')) {
  const file = (asset: MarketMonitorAsset, session: string, candidate = false) => {
    if (!['BTC', 'TSLA', 'MSTR'].includes(asset) || !/^\d{4}-\d{2}-\d{2}$/.test(session)) throw new Error('Invalid experiment identity')
    return `${root}/${asset}-${session}${candidate ? '.candidate' : ''}.json`
  }
  const read = async <T extends { recordHash: string }>(path: string): Promise<T | null> => {
    try {
      const row = JSON.parse(await readFile(path, 'utf8')) as T
      if (recordHash(row) !== row.recordHash) throw new Error('integrity')
      return row
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new TypeSafeError('integrity', '对照档案未通过完整性检查，原记录未被覆盖。')
    }
  }
  const publish = async <T extends { recordHash: string }>(path: string, row: T): Promise<T> => {
    await mkdir(root, { recursive: true })
    if (recordHash(row) !== row.recordHash) throw new Error('Invalid experiment hash')
    const temp = `${path}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(row), { flag: 'wx', mode: 0o600 })
    try { await link(temp, path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    finally { await unlink(temp) }
    return (await read<T>(path))!
  }
  return {
    publication: (asset: MarketMonitorAsset, session: string) => read<ExperimentPublication>(file(asset, session)),
    candidate: (asset: MarketMonitorAsset, session: string) => read<ExperimentCandidate>(file(asset, session, true)),
    savePublication: (asset: MarketMonitorAsset, session: string, row: ExperimentPublication) => publish(file(asset, session), row),
    saveCandidate: (asset: MarketMonitorAsset, session: string, row: ExperimentCandidate) => publish(file(asset, session, true), row),
    async sessions(asset: MarketMonitorAsset) {
      let files: string[]
      try { files = await readdir(root) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { sessions: [], truncated: false }; throw error }
      const sessions = files.filter(name => new RegExp(`^${asset}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(name)).map(name => name.slice(asset.length + 1, -5)).sort()
      return { sessions: sessions.slice(-90), truncated: sessions.length > 90 }
    },
  }
}
