import { appendFile, link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { readRecentJsonLines } from './journal.js'
import { dataPath } from '../../core/paths.js'
import type {
  MarketAiNarration,
  MarketMonitorAlert,
  MarketMonitorAsset,
  MarketMonitorReceipt,
  MarketMonitorSettings,
  MarketMonitorSnapshot,
} from './types.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS, DEFAULT_MARKET_MONITOR_STRATEGY_ID } from './types.js'

import { analysisInputHash, type MarketAnalysisArchive } from './replay.js'
const compress = promisify(gzip)
const decompress = promisify(gunzip)

const ROOT = dataPath('market-monitor')

function seriesFile(root: string, asset: MarketMonitorAsset, strategyId: string): string {
  const safeStrategy = strategyId.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${root}/series-${asset.toLowerCase()}-${safeStrategy}.json`
}

async function readSeriesFile(file: string): Promise<MarketMonitorSnapshot['chart'] | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as MarketMonitorSnapshot['chart'] }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

async function ensureParent(file: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
}

async function appendJsonLine(file: string, value: unknown): Promise<void> {
  await ensureParent(file)
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8')
}

export interface MarketMonitorStore {
  archive(id: string): Promise<MarketAnalysisArchive | null>
  saveArchive(archive: MarketAnalysisArchive): Promise<void>
  settings(): Promise<MarketMonitorSettings>
  saveSettings(settings: MarketMonitorSettings): Promise<void>
  snapshots(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorSnapshot[]>
  appendSnapshot(snapshot: MarketMonitorSnapshot): Promise<void>
  alerts(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorAlert[]>
  appendAlert(alert: MarketMonitorAlert): Promise<void>
  receipts(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorReceipt[]>
  appendReceipt(receipt: MarketMonitorReceipt): Promise<void>
  narrations(asset?: MarketMonitorAsset, limit?: number): Promise<MarketAiNarration[]>
  appendNarration(narration: MarketAiNarration): Promise<void>
  latestSeries(asset: MarketMonitorAsset, strategyId?: string): Promise<MarketMonitorSnapshot['chart'] | null>
  saveLatestSeries(asset: MarketMonitorAsset, chart: MarketMonitorSnapshot['chart'], strategyId?: string): Promise<void>
}

export function createMarketMonitorStore(root = ROOT): MarketMonitorStore {
  const SETTINGS_FILE = `${root}/settings.json`
  const SNAPSHOTS_FILE = `${root}/observations.jsonl`
  const ALERTS_FILE = `${root}/alerts.jsonl`
  const RECEIPTS_FILE = `${root}/receipts.jsonl`
  const NARRATIONS_FILE = `${root}/ai-narrations.jsonl`
  const archiveFile = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid observation identity')
    return `${root}/inputs/${id}.json.gz`
  }
  return {
    async archive(id) {
      let bytes: Buffer
      try { bytes = await readFile(archiveFile(id)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
      const archive = JSON.parse((await decompress(bytes, { maxOutputLength: 8 * 1024 * 1024 })).toString('utf8')) as MarketAnalysisArchive
      if (archive.snapshot.id !== id || archive.snapshot.analysisInput?.hash !== analysisInputHash(archive.input)
        || archive.snapshot.asset !== archive.input.asset || archive.snapshot.strategyId !== archive.input.strategyId
        || archive.snapshot.capturedAt !== archive.input.asOf
        || archive.snapshot.analysisInput.strategyVersion !== archive.input.strategyVersion) throw new Error('Analysis archive integrity check failed')
      return archive
    },
    async saveArchive(archive) {
      const file = archiveFile(archive.snapshot.id)
      await ensureParent(file)
      const temp = `${file}.${randomUUID()}.tmp`
      await writeFile(temp, await compress(JSON.stringify(archive)), { flag: 'wx' })
      // A hard link atomically publishes a complete immutable file; existing IDs fail closed.
      try { await link(temp, file) } finally { await unlink(temp) }
    },
    async settings() {
      try {
        const saved = JSON.parse(await readFile(SETTINGS_FILE, 'utf8')) as Partial<MarketMonitorSettings>
        return { ...DEFAULT_MARKET_MONITOR_SETTINGS, ...saved }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
          return { ...DEFAULT_MARKET_MONITOR_SETTINGS }
        }
        throw error
      }
    },
    async saveSettings(settings) {
      await ensureParent(SETTINGS_FILE)
      const temp = `${SETTINGS_FILE}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
      await rename(temp, SETTINGS_FILE)
    },
    async snapshots(asset, limit = 100) {
      return (await readRecentJsonLines<MarketMonitorSnapshot>(SNAPSHOTS_FILE, Math.max(1, Math.min(1000, limit)), (row) => !asset || row.asset === asset)).rows
    },
    appendSnapshot: (snapshot) => appendJsonLine(SNAPSHOTS_FILE, snapshot),
    async alerts(asset, limit = 100) {
      return (await readRecentJsonLines<MarketMonitorAlert>(ALERTS_FILE, Math.max(1, Math.min(1000, limit)), (row) => !asset || row.asset === asset)).rows
    },
    appendAlert: (alert) => appendJsonLine(ALERTS_FILE, alert),
    async receipts(asset, limit = 100) {
      return (await readRecentJsonLines<MarketMonitorReceipt>(RECEIPTS_FILE, Math.max(1, Math.min(10_000, limit)), (row) => !asset || row.asset === asset)).rows
    },
    appendReceipt: (receipt) => appendJsonLine(RECEIPTS_FILE, receipt),
    async narrations(asset, limit = 100) {
      return (await readRecentJsonLines<MarketAiNarration>(NARRATIONS_FILE, Math.max(1, Math.min(1000, limit)), (row) => !asset || row.asset === asset)).rows
    },
    appendNarration: (narration) => appendJsonLine(NARRATIONS_FILE, narration),
    async latestSeries(asset, strategyId = DEFAULT_MARKET_MONITOR_STRATEGY_ID) {
      const current = await readSeriesFile(seriesFile(root, asset, strategyId))
      if (current || strategyId !== DEFAULT_MARKET_MONITOR_STRATEGY_ID) return current
      return readSeriesFile(`${root}/series-${asset.toLowerCase()}.json`)
    },
    async saveLatestSeries(asset, chart, strategyId = DEFAULT_MARKET_MONITOR_STRATEGY_ID) {
      const file = seriesFile(root, asset, strategyId)
      await ensureParent(file)
      const temp = `${file}.${process.pid}.tmp`
      await writeFile(temp, `${JSON.stringify(chart)}\n`, 'utf8')
      await rename(temp, file)
    },
  }
}
