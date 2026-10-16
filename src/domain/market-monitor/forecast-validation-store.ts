import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dataPath } from '../../core/paths.js'
import { hashJevInput } from './typesafe-input.js'
import { TypeSafeError } from './typesafe-client.js'
import { FORWARD_PROTOCOL, type ForwardCandidate, type ForwardProtocol, type ForwardPublication } from './forecast-validation-types.js'
import type { MarketMonitorAsset } from './types.js'

export const forwardRecordHash = <T extends { recordHash: string }>(row: T) => hashJevInput({ ...row, recordHash: '' })

/** A separate append-only cohort. No reads or writes touch either v1 ledger. */
export function createForecastValidationStore(root: string | undefined = undefined, protocol: ForwardProtocol = FORWARD_PROTOCOL) {
  root ??= dataPath('market-monitor', protocol === 'market-forward-v4' ? 'forecast-validation-v4' : protocol === 'market-forward-v3' ? 'forecast-validation-v3' : 'forecast-validation-v2')
  const file = (asset: MarketMonitorAsset, session: string, candidate = false) => {
    if (!['BTC', 'TSLA', 'MSTR'].includes(asset) || !/^\d{4}-\d{2}-\d{2}$/.test(session) || !Number.isFinite(Date.parse(session))) throw new Error('Invalid forward identity')
    return `${root}/${asset}-${session}${candidate ? '.candidate' : ''}.json`
  }
  const read = async <T extends { recordHash: string; protocol: string }>(path: string): Promise<T | null> => {
    try {
      const row = JSON.parse(await readFile(path, 'utf8')) as T
      if (!row || row.protocol !== protocol || forwardRecordHash(row) !== row.recordHash) throw new Error('integrity')
      return row
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new TypeSafeError('integrity', '新版验证档案未通过完整性检查，原记录未被覆盖。')
    }
  }
  const publish = async <T extends { recordHash: string; protocol: string }>(path: string, row: T): Promise<T> => {
    if (row.protocol !== protocol || forwardRecordHash(row) !== row.recordHash) throw new Error('Invalid forward hash')
    await mkdir(root, { recursive: true })
    const temp = `${path}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(row), { flag: 'wx', mode: 0o600 })
    try { await link(temp, path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    finally { await unlink(temp) }
    return (await read<T>(path))!
  }
  return {
    publication: (asset: MarketMonitorAsset, session: string) => read<ForwardPublication>(file(asset, session)),
    candidate: (asset: MarketMonitorAsset, session: string) => read<ForwardCandidate>(file(asset, session, true)),
    savePublication: (asset: MarketMonitorAsset, session: string, row: ForwardPublication) => publish(file(asset, session), row),
    saveCandidate: (asset: MarketMonitorAsset, session: string, row: ForwardCandidate) => publish(file(asset, session, true), row),
    async sessions(asset: MarketMonitorAsset) {
      if (!['BTC', 'TSLA', 'MSTR'].includes(asset)) throw new Error('Invalid forward asset')
      let files: string[]
      try { files = await readdir(root) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { sessions: [], truncated: false }; throw error }
      const sessions = files.filter(name => new RegExp(`^${asset}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(name)).map(name => name.slice(asset.length + 1, -5)).sort()
      return { sessions: sessions.slice(-90), truncated: sessions.length > 90 }
    },
  }
}
