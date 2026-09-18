import { Decimal } from 'decimal.js'
import { closedBars } from './bar-policy.js'
import type { BarService } from '../market-data/bars/index.js'
import type { MarketMonitorStore } from './store.js'
import type { MarketMonitorAsset, MarketMonitorSnapshot } from './types.js'
import type { DashboardMetric, DashboardModule, DashboardObservation, DashboardSeries, DashboardSource, MarketDashboardReport } from './dashboard-types.js'
import { createBtcDashboard } from './btc-dashboard.js'
import { createStrategyDashboard } from './strategy-dashboard.js'

const DAY = 86_400_000
const OBSERVATION_LIMIT = 20_000
const CONTEXT_FIELDS = [
  ['fundingRate', 'funding-8h', 'Deribit 八小时资金费率', 'percent', 100],
  ['openInterest', 'perpetual-open-interest', 'Deribit 永续未平仓量', 'usd', 1],
  ['annualizedBasisPercent', 'annualized-basis', 'Deribit 年化期货基差', 'percent', 1],
  ['optionOpenInterest', 'option-open-interest', 'Deribit 期权未平仓量', 'btc', 1],
  ['putCallOpenInterestRatio', 'put-call-ratio', 'Deribit 看跌／看涨持仓比', 'ratio', 1],
] as const

/** A repeated scan still records fresh derivatives even if its judgment is unchanged. */
export function dashboardContextMetrics(snapshot: Pick<MarketMonitorSnapshot, 'context' | 'sourceHealth' | 'capturedAt'>): DashboardMetric[] {
  const health = snapshot.sourceHealth.find(row => row.id === 'btc-derivatives')
  if (!health) return []
  return CONTEXT_FIELDS.map(([field, id, label, unit, factor]) => {
    const raw = snapshot.context[field]
    const retained = health.retained?.fields.includes(field)
    const value = typeof raw === 'number' && Number.isFinite(raw) ? new Decimal(raw).times(factor).toNumber() : null
    return { id, label, value, unit,
      description: 'Deribit 单一交易场所背景；时间为平台扫描观察标记，未提供交易所源时间。曲线只记录实际采集值，不补造缺失历史。',
      source: { provider: health.provider, url: 'https://www.deribit.com', dataAt: retained ? health.retained!.asOf : health.asOf,
        fetchedAt: snapshot.capturedAt, status: retained ? 'stale' : value == null || !health.asOf ? 'unavailable' : 'ok',
        detail: `${health.detail} 时间为平台扫描观察标记，不代表交易所发布或逐笔更新时刻。`, formulaVersion: 'deribit-context-v1',
        formula: field === 'fundingRate' ? 'funding_8h × 100；八小时费率，未年化' : undefined } }
  })
}

const validAt = (at: string | null | undefined): at is string => typeof at === 'string' && Number.isFinite(Date.parse(at))

function contextSeries(observations: DashboardObservation[], from: number, at: Date): DashboardSeries[] {
  const groups = new Map<string, DashboardSeries>()
  const seenTimes = new Map<string, Set<string>>()
  for (const row of observations) {
    if (!validAt(row.capturedAt) || Date.parse(row.capturedAt) > at.getTime()) continue
    for (const metric of row.metrics) {
      const source = metric.source
      const derivatives = CONTEXT_FIELDS.some(([, id]) => id === metric.id)
      if (metric.value == null || !Number.isFinite(metric.value) || source.status === 'unavailable'
        || (derivatives && (source.status !== 'ok' || !validAt(source.dataAt)))
        || (validAt(source.dataAt) && Date.parse(source.dataAt) > Date.parse(row.capturedAt) + 60_000)) continue
      // Issuer facts are plotted at first acquisition, never backdated to a report period.
      const stamp = derivatives ? source.dataAt! : row.capturedAt
      if (Date.parse(stamp) < from) continue
      const key = `${metric.id}:${source.provider}:${source.formulaVersion ?? 'unspecified'}`
      let series = groups.get(key)
      if (!series) {
        series = { id: key, label: metric.label, unit: metric.unit, group: derivatives ? 'derivatives' : metric.id.startsWith('strc') ? 'strc' : 'strategy',
          points: [], source: { ...source }, ...(derivatives ? { maxGapMs: 3_600_000 } : {}) }
        groups.set(key, series)
        seenTimes.set(key, new Set())
      }
      // Cached repeated values do not create a new historical observation.
      if (seenTimes.get(key)!.has(stamp)) continue
      seenTimes.get(key)!.add(stamp)
      series.points.push({ at: stamp, value: metric.value })
      series.source = { ...source }
    }
  }
  return [...groups.values()].map(series => ({ ...series, points: series.points.sort((a, b) => a.at.localeCompare(b.at)) }))
}

export async function buildCoreDashboard(store: MarketMonitorStore, asset: MarketMonitorAsset, strategyId: string, days: 30 | 90 | 365, at: Date): Promise<DashboardModule> {
  const [all, chart, sampled, receipts] = await Promise.all([
    store.snapshots(asset, 2000), store.latestSeries(asset, strategyId), store.dashboardObservations(asset, OBSERVATION_LIMIT), store.receipts(asset, 100),
  ])
  const rows = all.filter(row => row.strategyId === strategyId && validAt(row.capturedAt) && Date.parse(row.capturedAt) <= at.getTime())
  const latest = rows.at(-1)
  const from = at.getTime() - days * DAY
  const history = sampled.filter(row => row.strategyId === strategyId && validAt(row.capturedAt) && Date.parse(row.capturedAt) <= at.getTime())
  const legacyContext: DashboardObservation[] = rows.map(row => ({ kind: 'scan-context', asset, strategyId, capturedAt: row.capturedAt, snapshotId: row.id, metrics: dashboardContextMetrics(row) }))
  const module: DashboardModule = { id: 'evidence-history', label: '价格结构与历史判断', metrics: [], series: [], events: [], notes: [
    '判断标记保留原始发布时间；点击可核对当时存档。新接入的研究指标尚未参与历史规则评分。',
    '日线只展示已收盘数据；衍生品曲线保留采样空档，不能用现在的数值填补过去。',
  ] }
  if (all.length >= 2000 || sampled.length >= OBSERVATION_LIMIT) module.notes.push('历史达到读取上限，图表仅代表实际载入的记录，不保证覆盖整个所选窗口。')
  const dailyFrom = new Date(from).toISOString().slice(0, 10)
  const bars = closedBars(chart?.daily ?? latest?.chart.daily ?? [], asset, '1d', at).filter(bar => bar.date.slice(0, 10) >= dailyFrom && Number.isFinite(bar.close))
  const health = latest?.sourceHealth.find(row => row.id === 'daily-bars')
  const scannedAt = receipts.filter(row => row.strategyId === strategyId && row.outcome !== 'failed' && Date.parse(row.requestedAt) <= at.getTime()).at(-1)?.requestedAt ?? latest?.capturedAt ?? at.toISOString()
  const priceSource: DashboardSource = { provider: chart?.dailyMeta.sourceId ?? chart?.dailyMeta.provider ?? health?.provider ?? 'OpenAlice BarService',
    dataAt: bars.at(-1)?.date ?? null, fetchedAt: scannedAt, status: bars.length ? 'ok' : 'unavailable',
    detail: '历史价格查询；分析发布时间与行情日期分别保留。', formulaVersion: 'closed-daily-v1' }
  if (bars.length) {
    const age = at.getTime() - Date.parse(bars.at(-1)!.date)
    if (age > (asset === 'BTC' ? 2 : 4) * DAY) priceSource.status = 'stale'
    module.series.push({ id: 'price-close', label: `${asset} 已收盘价格`, unit: 'usd', group: 'price',
      points: bars.map(bar => ({ at: bar.date.slice(0, 10), value: bar.close })), source: priceSource, maxGapMs: (asset === 'BTC' ? 1.5 : 4) * DAY })
    module.metrics.push({ id: 'closed-price', label: '最近收盘价', value: bars.at(-1)!.close, unit: 'usd', description: '与盘中实时价格区分。', source: priceSource })
  } else module.notes.push('尚无可用收盘行情，请先完成一次扫描。')
  const context = history.filter(row => row.metrics.some(metric => CONTEXT_FIELDS.some(([, id]) => id === metric.id))).at(-1)
  if (asset === 'BTC') {
    module.metrics.push(...(context?.metrics ?? (latest ? dashboardContextMetrics(latest) : [])).filter(metric => CONTEXT_FIELDS.some(([, id]) => id === metric.id)).map(metric => {
      const expired = validAt(metric.source.dataAt) && at.getTime() - Date.parse(metric.source.dataAt) > 30 * 60_000
      return expired && metric.source.status === 'ok' ? { ...metric, source: { ...metric.source, status: 'stale' as const } } : metric
    }))
    module.series.push(...contextSeries([...legacyContext, ...history], from, at).filter(series => series.group === 'derivatives'))
  }
  const dayKeys = new Set<string>(), eventKeys = new Set<string>()
  for (const row of rows) {
    if (Date.parse(row.capturedAt) < from) continue
    for (const filing of row.context.recentFilings ?? []) {
      const filingKey = `filing:${filing.url}`
      if (eventKeys.has(filingKey) || !validAt(filing.filingDate) || Date.parse(filing.filingDate) < from || Date.parse(filing.filingDate) > at.getTime()) continue
      eventKeys.add(filingKey)
      module.events.push({ id: filingKey, at: filing.filingDate, availableAt: row.capturedAt, kind: 'filing',
        label: `${asset} SEC ${filing.form}`, url: filing.url,
        detail: `申报日 ${filing.filingDate}；报告期 ${filing.reportDate ?? '未提供'}。链接为原始文件；没有从申报标题推断融资金额或资金用途。` })
    }
    const key = `${row.capturedAt.slice(0, 10)}:${row.analysisInput?.strategyVersion ?? 'legacy'}`
    if (!dayKeys.has(key)) {
      dayKeys.add(key)
      module.events.push({ id: row.id, at: row.capturedAt, availableAt: row.capturedAt, kind: 'judgment', snapshotId: row.id,
        label: `${row.hypothesis.label} · ${row.hypothesis.confidence}/100`, level: row.metrics.lastPrice,
        detail: row.analysisInput ? `规则版本 ${row.analysisInput.strategyVersion}；分数不是涨跌概率。` : '旧记录缺少可核验输入存档。' })
    }
    for (const event of row.wyckoff?.events ?? []) {
      const eventKey = `${event.kind}:${event.at}:${event.status}`
      if (eventKeys.has(eventKey) || !validAt(event.at) || Date.parse(event.at) > at.getTime() || Date.parse(event.at) < from) continue
      eventKeys.add(eventKey)
      module.events.push({ id: eventKey, at: event.at, availableAt: row.capturedAt, kind: 'wyckoff', label: `${event.kind} · ${event.status}`,
        snapshotId: row.id, ...(event.level == null ? {} : { level: event.level }), detail: '事件K线时间与首次记录该状态的时间不同；确认状态只针对该事件。' })
    }
  }
  module.events = module.events.sort((a, b) => a.at.localeCompare(b.at)).slice(-180)
  return module
}

export function createMarketDashboard(options: {
  store: MarketMonitorStore
  barService: BarService
  fetcher?: typeof fetch
  now?: () => Date
  readers?: Partial<Record<'BTC' | 'MSTR', { read(days: 30 | 90 | 365): Promise<DashboardModule> }>>
}) {
  const now = options.now ?? (() => new Date())
  const readers = options.readers ?? { BTC: createBtcDashboard(options), MSTR: createStrategyDashboard(options) }
  const inFlight = new Map<string, Promise<MarketDashboardReport>>()
  const writers = new Map<MarketMonitorAsset, Promise<void>>()
  async function recordResearch(asset: MarketMonitorAsset, strategyId: string, capturedAt: string, metrics: DashboardMetric[]): Promise<void> {
    const previousWrite = writers.get(asset)
    const task = (async () => {
      await previousWrite?.catch(() => undefined)
      const previous = (await options.store.dashboardObservations(asset, 200)).filter(row => row.kind === 'research' && row.strategyId === strategyId).at(-1)
      const signature = (values: DashboardMetric[]) => JSON.stringify(values.map(m => [m.id, m.value, m.source.provider, m.source.dataAt, m.source.status, m.source.formulaVersion]))
      if (!previous || signature(previous.metrics) !== signature(metrics)) await options.store.appendDashboardObservation({ kind: 'research', asset, strategyId, capturedAt, snapshotId: null, metrics })
    })()
    writers.set(asset, task)
    try { await task } finally { if (writers.get(asset) === task) writers.delete(asset) }
  }
  return {
    read(asset: MarketMonitorAsset, days: 30 | 90 | 365 = 90): Promise<MarketDashboardReport> {
      if (![30, 90, 365].includes(days)) return Promise.reject(new Error('Invalid dashboard window'))
      const key = `${asset}:${days}`
      const pending = inFlight.get(key)
      if (pending) return pending
      const task = (async () => {
        const at = now(), strategyId = (await options.store.settings()).strategyId
        const modules = [await buildCoreDashboard(options.store, asset, strategyId, days, at)]
        const reader = asset === 'TSLA' ? undefined : readers[asset]
        if (reader) {
          let research: DashboardModule
          try { research = await reader.read(days) }
          catch { research = { id: `${asset.toLowerCase()}-research`, label: `${asset} 研究数据`, metrics: [], series: [], events: [], notes: ['研究数据读取失败；价格扫描和已存档判断仍然保留。'] } }
          // The finished acquisition time is distinct from every underlying source time.
          const capturedAt = now().toISOString()
          const metrics = research.metrics.filter(metric => metric.value != null && Number.isFinite(metric.value) && metric.source.status !== 'unavailable')
          if (metrics.length) await recordResearch(asset, strategyId, capturedAt, metrics)
          if (asset === 'MSTR') {
            const observations = (await options.store.dashboardObservations(asset, OBSERVATION_LIMIT)).filter(row => row.strategyId === strategyId)
            const derived = contextSeries(observations, at.getTime() - days * DAY, now())
            const historicalMetricIds = new Set(derived.map(series => series.id.split(':')[0]))
            research = { ...research, series: [...research.series.filter(series => !historicalMetricIds.has(series.id)), ...derived],
              notes: [...research.notes, '发行人指标历史从平台实际采集时开始积累，不倒填为过去已经掌握的信息。'] }
          }
          modules.push(research)
        }
        return { schemaVersion: 1 as const, asset, generatedAt: now().toISOString(), windowDays: days, modules }
      })().finally(() => inFlight.delete(key))
      inFlight.set(key, task)
      return task
    },
  }
}
