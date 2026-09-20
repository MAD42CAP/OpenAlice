import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { dataPath } from '../../core/paths.js'
import { seal, unseal, isSealedEnvelope } from '../../core/sealing.js'
import { readRecentJsonLines } from './journal.js'
import { TYPESAFE_MODEL } from './typesafe-client.js'
import type { JevForecast, JevAudit } from './typesafe-types.js'

const configSchema = z.object({ apiKey: z.string().max(4096).default(''), automatic: z.boolean().default(false) })
export interface TypeSafeSettings { configured: boolean; automatic: boolean; model: string }
export function createTypeSafeStore(root = dataPath('market-monitor', 'typesafe')) {
  let writing: Promise<unknown> = Promise.resolve()
  const serialize = <T>(run: () => Promise<T>): Promise<T> => { const task = writing.then(run, run); writing = task; return task }
  const readConfig = async () => {
    try {
      const raw: unknown = JSON.parse(await readFile(`${root}/settings.json`, 'utf8'))
      if (!isSealedEnvelope(raw)) throw new Error('TypeSafe configuration is not sealed')
      return configSchema.parse(await unseal(raw))
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return configSchema.parse({}); throw new Error('TypeSafe 本机配置无法读取，请重新保存设置。') }
  }
  const status = (config: z.infer<typeof configSchema>): TypeSafeSettings => ({ configured: Boolean(config.apiKey), automatic: config.automatic, model: TYPESAFE_MODEL })
  return {
    config: readConfig,
    settings: async () => status(await readConfig()),
    save: (input: { apiKey?: string; automatic?: boolean; clearKey?: boolean }) => serialize(async () => {
      const current = await readConfig()
      const next = configSchema.parse({ apiKey: input.clearKey ? '' : input.apiKey?.trim() || current.apiKey, automatic: input.automatic ?? current.automatic })
      if (!next.apiKey) next.automatic = false
      await mkdir(root, { recursive: true })
      const temp = `${root}/settings.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify(await seal(next)), { mode: 0o600, flag: 'wx' })
      await rename(temp, `${root}/settings.json`)
      return status(next)
    }),
    forecasts: async () => (await readRecentJsonLines<JevForecast>(`${root}/forecasts.jsonl`, 2000)).rows,
    appendForecast: (row: JevForecast) => serialize(async () => { await mkdir(root, { recursive: true }); await appendFile(`${root}/forecasts.jsonl`, `${JSON.stringify(row)}\n`, { mode: 0o600 }) }),
    appendAudit: (row: JevAudit) => serialize(async () => { await mkdir(root, { recursive: true }); await appendFile(`${root}/audits.jsonl`, `${JSON.stringify(row)}\n`, { mode: 0o600 }) }),
  }
}
