import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dataPath } from '../../core/paths.js'
import { intelligenceRecordHash } from './investment.js'
import type { InvestmentSnapshot, InvestmentThesis, InvestmentThesisEvaluation } from './investment-types.js'

type Records = { publications: InvestmentSnapshot; theses: InvestmentThesis; evaluations: InvestmentThesisEvaluation }
/** An additive namespace; existing user-authored thesis-v1 records are untouched. */
export function createInvestmentStore(root = dataPath('market-monitor', 'investment-intelligence-v1')) {
  const path = (kind: keyof Records, id: string) => {
    if (!/^[a-zA-Z0-9-]{1,160}$/.test(id)) throw new Error('Invalid investment record identity')
    return `${root}/${kind}/${id}.json`
  }
  const read = async <K extends keyof Records>(kind: K, id: string): Promise<Records[K] | null> => {
    try {
      const row = JSON.parse(await readFile(path(kind, id), 'utf8')) as Records[K]
      if (row.id !== id || row.recordHash !== intelligenceRecordHash(row)) throw new Error('Investment archive integrity check failed')
      return row
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  const save = async <K extends keyof Records>(kind: K, row: Records[K]): Promise<{ stored: boolean; record: Records[K] }> => {
    if (row.recordHash !== intelligenceRecordHash(row)) throw new Error('Invalid investment record hash')
    await mkdir(`${root}/${kind}`, { recursive: true, mode: 0o700 })
    const target = path(kind, row.id), temp = `${target}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(row), { flag: 'wx', mode: 0o600 })
    let stored = true
    try { await link(temp, target) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; stored = false }
    finally { await unlink(temp) }
    const record = await read(kind, row.id)
    if (!record) throw new Error('Investment record publication failed')
    return { stored, record }
  }
  const list = async <K extends keyof Records>(kind: K): Promise<Records[K][]> => {
    let files: string[]
    try { files = await readdir(`${root}/${kind}`) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const records = await Promise.all(files.filter(f => /^[a-zA-Z0-9-]+\.json$/.test(f)).map(f => read(kind, f.slice(0, -5))))
    return records.filter(r => r !== null) as Records[K][]
  }
  return { read, save, list }
}
