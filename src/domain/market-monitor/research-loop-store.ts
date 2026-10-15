import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dataPath } from '../../core/paths.js'
import { hashJevInput } from './typesafe-input.js'
import { RESEARCH_LOOP_PROTOCOL, type ResearchFeedbackRecord, type ResearchLoopInput } from './research-loop-types.js'

export const researchLoopInputHash = (row: ResearchLoopInput) => hashJevInput({ ...row, hash: '' })
export const researchLoopRecordHash = (row: ResearchFeedbackRecord) => hashJevInput({ ...row, recordHash: '' })
type Rows = { inputs: ResearchLoopInput; feedback: ResearchFeedbackRecord }

/** An additive archive. A run's frozen input and its first result are immutable. */
export function createResearchLoopStore(root = dataPath('market-monitor', 'research-loop-v1')) {
  const path = (kind: keyof Rows, id: string) => {
    if (!/^(loop-input|feedback)-[a-f0-9]{64}$/.test(id)) throw new Error('研究闭环档案标识无效。')
    return `${root}/${kind}/${id}.json`
  }
  const read = async <K extends keyof Rows>(kind: K, id: string): Promise<Rows[K] | null> => {
    try {
      const row = JSON.parse(await readFile(path(kind, id), 'utf8')) as Rows[K]
      if (!row || row.schemaVersion !== 1 || row.protocol !== RESEARCH_LOOP_PROTOCOL || row.id !== id
        || (kind === 'inputs' ? researchLoopInputHash(row as ResearchLoopInput) !== (row as ResearchLoopInput).hash
          : researchLoopRecordHash(row as ResearchFeedbackRecord) !== (row as ResearchFeedbackRecord).recordHash)) throw new Error('invalid')
      return row
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('研究闭环档案未通过完整性检查，原记录未被覆盖。')
    }
  }
  const save = async <K extends keyof Rows>(kind: K, row: Rows[K]): Promise<Rows[K]> => {
    const target = path(kind, row.id)
    await mkdir(`${root}/${kind}`, { recursive: true, mode: 0o700 })
    const temp = `${target}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(row), { flag: 'wx', mode: 0o600 })
    try { await link(temp, target) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    finally { await unlink(temp) }
    const existing = await read(kind, row.id)
    if (!existing || JSON.stringify(existing) !== JSON.stringify(row)) throw new Error('该运行已冻结不同的档案，不能覆盖。')
    return existing
  }
  return {
    input: (id: string) => read('inputs', id),
    saveInput: (row: ResearchLoopInput) => save('inputs', row),
    saveFeedback: (row: ResearchFeedbackRecord) => save('feedback', row),
    feedback: (id: string) => read('feedback', id),
    async list() {
      let files: string[]
      try { files = await readdir(`${root}/feedback`) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { rows: [], invalid: 0 }; throw error }
      // Filenames are hashes, not time; read all identities so an older hash cannot hide the latest publication.
      const settled = await Promise.allSettled(files.filter(f => /^feedback-[a-f0-9]{64}\.json$/.test(f)).map(f => read('feedback', f.slice(0, -5))))
      return { rows: settled.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []), invalid: settled.filter(r => r.status === 'rejected').length }
    },
  }
}
