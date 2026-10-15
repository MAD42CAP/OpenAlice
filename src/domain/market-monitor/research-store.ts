import { appendFile, link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { dataPath } from '../../core/paths.js'
import type { ResearchReport, ResearchSnapshot, ResearchSource } from './research-types.js'
import { researchContentHash } from './glassnode.js'
import { readRecentJsonLines } from './journal.js'

export const researchHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const researchRecordHash = (row: { recordHash: string }): string => researchHash({ ...row, recordHash: '' })
export const researchReportId = (contentHash: string): string => `gn-${contentHash.slice(0, 32)}`

export interface ResearchDiscoveryState { lastCheckedAt: string | null; lastError: string | null; latestReportId: string | null }
export interface ResearchStore {
  reports(): Promise<ResearchReport[]>
  source(reportId: string): Promise<ResearchSource | null>
  publishReport(report: ResearchReport, source: ResearchSource): Promise<boolean>
  snapshots(): Promise<ResearchSnapshot[]>
  publishSnapshot(snapshot: ResearchSnapshot): Promise<void>
  discovery(): Promise<ResearchDiscoveryState>
  saveDiscovery(state: ResearchDiscoveryState): Promise<void>
}

const validId = (id: string) => /^gn-[a-f0-9]{32}$/.test(id)
function verifyReport(row: ResearchReport): ResearchReport {
  if (row.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(row.contentHash) || row.id !== researchReportId(row.contentHash) || row.asset !== 'BTC') throw new Error('Research report integrity check failed.')
  return row
}

export function createResearchStore(root = dataPath('market-monitor', 'research-v1')): ResearchStore {
  const reportPath = (id: string) => { if (!validId(id)) throw new Error('Invalid research report identity.'); return `${root}/reports/${id}.json` }
  const sourcePath = (id: string) => { if (!validId(id)) throw new Error('Invalid research report identity.'); return `${root}/sources/${id}.json` }
  const immutable = async (path: string, row: unknown): Promise<boolean> => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temp = `${path}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify(row)}\n`, { flag: 'wx', mode: 0o600 })
    try { await link(temp, path); return true }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error }
    finally { await unlink(temp) }
  }
  return {
    async reports() {
      let names: string[]
      try { names = await readdir(`${root}/reports`) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
      const rows = await Promise.all(names.filter(name => /^gn-[a-f0-9]{32}\.json$/.test(name)).map(async name => verifyReport(JSON.parse(await readFile(`${root}/reports/${name}`, 'utf8')) as ResearchReport)))
      return rows.sort((a, b) => (a.publishedAt ?? a.retrievedAt).localeCompare(b.publishedAt ?? b.retrievedAt) || a.retrievedAt.localeCompare(b.retrievedAt)).slice(-500)
    },
    async source(reportId) {
      let row: ResearchSource
      try { row = JSON.parse(await readFile(sourcePath(reportId), 'utf8')) as ResearchSource }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
      if (row.reportId !== reportId || researchReportId(row.contentHash) !== reportId || !Array.isArray(row.paragraphs)
        || row.paragraphs.some(p => p.reportId !== reportId || typeof p.excerpt !== 'string')
        || researchContentHash(row.paragraphs.map(p => p.excerpt!)) !== row.contentHash) throw new Error('Research source integrity check failed.')
      return row
    },
    async publishReport(report, source) {
      verifyReport(report)
      if (source.reportId !== report.id || source.contentHash !== report.contentHash || report.paragraphCount !== source.paragraphs.length
        || researchContentHash(source.paragraphs.map(p => p.excerpt ?? '')) !== report.contentHash) throw new Error('Research source integrity check failed.')
      await immutable(sourcePath(report.id), source)
      const stored = await immutable(reportPath(report.id), report)
      return stored
    },
    async snapshots() {
      const rows = (await readRecentJsonLines<ResearchSnapshot>(`${root}/snapshot-index.jsonl`, 1000)).rows
      const snapshots = await Promise.all(rows.map(async item => {
        if (!/^rs-[a-f0-9-]{36}$/.test(item.id)) throw new Error('Invalid research snapshot identity.')
        const row = JSON.parse(await readFile(`${root}/snapshots/${item.id}.json`, 'utf8')) as ResearchSnapshot
        if (row.schemaVersion !== 1 || row.asset !== 'BTC' || row.id !== item.id || row.recordHash !== item.recordHash || researchRecordHash(row) !== row.recordHash) throw new Error('Research snapshot integrity check failed.')
        return row
      }))
      return snapshots.sort((a, b) => a.analysisTime.localeCompare(b.analysisTime) || a.revision - b.revision)
    },
    async publishSnapshot(row) {
      if (!/^rs-[a-f0-9-]{36}$/.test(row.id) || !validId(row.reportId) || researchRecordHash(row) !== row.recordHash) throw new Error('Research snapshot integrity check failed.')
      if (!await immutable(`${root}/snapshots/${row.id}.json`, row)) throw new Error('Research snapshot already exists.')
      // The index has no third-party source text and is only an append-only lookup.
      await appendFile(`${root}/snapshot-index.jsonl`, `${JSON.stringify({ id: row.id, recordHash: row.recordHash })}\n`, { mode: 0o600 })
    },
    async discovery() {
      try {
        const row = JSON.parse(await readFile(`${root}/discovery.json`, 'utf8')) as ResearchDiscoveryState
        return { lastCheckedAt: typeof row.lastCheckedAt === 'string' ? row.lastCheckedAt : null, lastError: typeof row.lastError === 'string' ? row.lastError : null, latestReportId: typeof row.latestReportId === 'string' && validId(row.latestReportId) ? row.latestReportId : null }
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { lastCheckedAt: null, lastError: null, latestReportId: null }; throw error }
    },
    async saveDiscovery(row) {
      await mkdir(root, { recursive: true, mode: 0o700 })
      const file = `${root}/discovery.json`, temp = `${file}.${randomUUID()}.tmp`
      await writeFile(temp, `${JSON.stringify(row)}\n`, { flag: 'wx', mode: 0o600 })
      await rename(temp, file)
    },
  }
}
