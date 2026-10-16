import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, realpath, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { dataPath } from '../../core/paths.js'
import { isOfficialEarningsSourceUrl, type OfficialEarningsResult } from './official-earnings.js'

const MAX_BYTES = 16_384
const MAX_FILES = 1_024
const MAX_AGE_MS = 24 * 60 * 60 * 1_000
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const error = () => new Error('已核实财报记录未通过完整性检查，原记录未被覆盖。')
const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const instant = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && day(value.slice(0, 10)) && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
const nyDay = (at: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-')
}
const dateSchema = z.string().refine(day)
const instantSchema = z.string().refine(instant)
const recordSchema = z.object({
  asset: z.enum(['TSLA', 'MSTR']),
  status: z.literal('confirmed'),
  date: dateSchema,
  timing: z.enum(['after-close', 'before-open', 'unknown']),
  webcastAt: instantSchema.nullable(),
  sourceUrl: z.string().min(1).max(512),
  title: z.string().min(1).max(400).refine(value => value.trim().length > 0),
  publishedAt: z.union([dateSchema, instantSchema]),
  retrievedAt: instantSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  verification: z.literal('research-reviewed'),
  detail: z.string().min(1).max(2_000).refine(value => value.trim().length > 0),
}).strict()
const envelopeSchema = z.object({ schemaVersion: z.literal(1), recordHash: z.string().regex(/^[a-f0-9]{64}$/), record: recordSchema }).strict()
type Reviewed = z.infer<typeof recordSchema>

function officialUrl(record: Reviewed): boolean {
  try {
    const url = new URL(record.sourceUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return false
    if (url.href !== record.sourceUrl) return false
    return isOfficialEarningsSourceUrl(record.asset, record.sourceUrl)
  } catch { return false }
}

function parseRecord(input: unknown): Reviewed {
  const record = recordSchema.parse(input)
  if (!officialUrl(record) || Date.parse(record.publishedAt) > Date.parse(record.retrievedAt)
    || (record.publishedAt.length === 10 && record.publishedAt > nyDay(new Date(record.retrievedAt)))
    || record.date < nyDay(new Date(record.retrievedAt))
    || (record.webcastAt !== null && nyDay(new Date(record.webcastAt)) !== record.date)) throw error()
  return record
}

/** Public, manually reviewed official events only. No credential or provider state is read. */
export function createReviewedEarningsStore(root = dataPath('market-monitor', 'official-earnings')) {
  const configuredRoot = resolve(root)
  const directory = async (asset: Reviewed['asset'], create: boolean) => {
    if (asset !== 'TSLA' && asset !== 'MSTR') throw error()
    if (create) await mkdir(configuredRoot, { recursive: true, mode: 0o700 })
    const rootStat = await lstat(configuredRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw error()
    const canonicalRoot = await realpath(configuredRoot)
    const target = join(canonicalRoot, asset.toLowerCase())
    if (create) await mkdir(target, { mode: 0o700 }).catch(e => { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e })
    const targetStat = await lstat(target)
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink() || await realpath(target) !== target) throw error()
    return target
  }
  const filename = (record: Reviewed) => `${record.asset}-${Date.parse(record.retrievedAt)}-${hash(JSON.stringify(record))}.json`
  const load = async (directory: string, name: string): Promise<Reviewed> => {
    const path = join(directory, name)
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink()) throw error()
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino || info.size < 2 || info.size > MAX_BYTES) throw error()
      const bytes = Buffer.alloc(MAX_BYTES + 1)
      let size = 0
      while (size < bytes.length) {
        const read = await handle.read(bytes, size, bytes.length - size, null)
        if (!read.bytesRead) break
        size += read.bytesRead
      }
      if (size > MAX_BYTES) throw error()
      const envelope = envelopeSchema.parse(JSON.parse(bytes.subarray(0, size).toString('utf8')))
      const record = parseRecord(envelope.record)
      if (hash(JSON.stringify(record)) !== envelope.recordHash || filename(record) !== name) throw error()
      return record
    } finally { await handle.close() }
  }
  const files = async (directory: string, asset: Reviewed['asset']) => {
    const entries = await readdir(directory)
    if (entries.length > MAX_FILES) throw error()
    const pattern = new RegExp(`^${asset}-(\\d{13})-[a-f0-9]{64}\\.json$`)
    const json = entries.filter(name => name.endsWith('.json'))
    if (json.some(name => !pattern.test(name))) throw error()
    return json.map(name => ({ name, timestamp: Number(pattern.exec(name)![1]) }))
  }
  return {
    async read(asset: Reviewed['asset'], at: Date | string): Promise<OfficialEarningsResult | null> {
      try {
        const now = at instanceof Date ? at : new Date(at)
        if (!Number.isFinite(now.getTime())) return null
        const target = await directory(asset, false)
        const eligible = (await files(target, asset)).filter(file => file.timestamp <= now.getTime()).sort((a, b) => b.timestamp - a.timestamp)
        if (!eligible.length || now.getTime() - eligible[0].timestamp > MAX_AGE_MS) return null
        // Inspect the newest identity, never the newest record that happens to validate.
        if (eligible.length > 1 && eligible[0].timestamp === eligible[1].timestamp) return null
        const record = await load(target, eligible[0].name)
        if (record.asset !== asset || record.date < nyDay(now)) return null
        return record
      } catch { return null }
    },
    async save(input: OfficialEarningsResult): Promise<void> {
      try {
        const record = parseRecord(input)
        if (Date.parse(record.retrievedAt) > Date.now()) throw error()
        const content = JSON.stringify({ schemaVersion: 1, recordHash: hash(JSON.stringify(record)), record })
        if (Buffer.byteLength(content) > MAX_BYTES) throw error()
        const target = await directory(record.asset, true)
        const existing = await files(target, record.asset)
        const name = filename(record)
        if (existing.length >= MAX_FILES && !existing.some(file => file.name === name)) throw error()
        const temporary = join(target, `${name}.${randomUUID()}.tmp`)
        await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
        try { await link(temporary, join(target, name)) }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
        finally { await unlink(temporary) }
        if (JSON.stringify(await load(target, name)) !== JSON.stringify(record)) throw error()
      } catch { throw error() }
    },
  }
}
