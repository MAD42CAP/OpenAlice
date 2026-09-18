import type { DashboardModule, DashboardSource, DashboardWindow, MarketDashboardReport } from '../../api/market-dashboard'
import type { MonitorAsset } from '../../api/market-monitor'
import { demoMonitorSnapshot } from './market-monitor'

/** Public-looking numbers are illustrative, never represented as live evidence. */
export function demoMarketDashboard(asset: MonitorAsset, days: DashboardWindow = 90): MarketDashboardReport {
  const snapshot = demoMonitorSnapshot(asset)
  const generatedAt = '2026-09-12T12:36:00.000Z'
  const source: DashboardSource = { provider: `demo/${asset === 'BTC' ? 'Coinbase' : 'Alpaca'}`, dataAt: '2026-09-11', fetchedAt: generatedAt, status: 'ok', formulaVersion: 'closed-daily-v1', formula: 'Completed daily close; illustrative demo observations.' }
  const daily = snapshot.chart.daily.slice(-days)
  const price: DashboardModule = {
    id: 'price', label: '价格结构与当时判断', metrics: [],
    series: [{ id: 'price-close', label: '日线收盘价', group: 'price', unit: 'usd', source, maxGapMs: 129_600_000, points: daily.map(bar => ({ at: bar.date, value: bar.close })) }],
    events: [{ id: 'demo-judgment', kind: 'judgment', label: '当时的趋势判断', at: snapshot.capturedAt, availableAt: snapshot.capturedAt, snapshotId: snapshot.id, detail: '演示原始判断入口，输入档案不可用时仍明确显示。' }],
    notes: ['历史价格与判断分别按实际日期展示；演示数据不计入真实复盘。'],
  }
  const modules: DashboardModule[] = [price]
  if (asset === 'BTC') {
    const derivatives: DashboardSource = { provider: 'demo/Deribit public API', dataAt: generatedAt, fetchedAt: generatedAt, status: 'ok', formula: 'funding_8h × 100; percent units', formulaVersion: 'deribit-funding-8h-v1' }
    const points = [0, 1, 2, 8, 9, 10].map(index => ({ at: new Date(Date.parse('2026-09-12T07:00:00Z') + index * 1_800_000).toISOString(), value: 0.003 + index * 0.0002 }))
    modules.push({ id: 'derivatives', label: 'BTC 衍生品背景 · Deribit', metrics: [], series: [
      { id: 'funding', label: '8 小时资金费率', group: 'derivatives', unit: 'percent', source: derivatives, maxGapMs: 3_600_000, points },
      { id: 'oi', label: '永续合约未平仓量', group: 'derivatives', unit: 'usd', source: { ...derivatives, formula: 'Deribit perpetual open interest in USD' }, maxGapMs: 3_600_000, points: points.map((point, index) => ({ ...point, value: 700_000_000 + index * 8_000_000 })) },
    ], notes: ['仅代表 Deribit 市场。缺失时段保留断点，不连接为连续走势。'], events: [] })
    const sentiment: DashboardSource = { provider: 'Alternative.me · demo', url: 'https://alternative.me/crypto/fear-and-greed-index/', dataAt: '2026-09-11', fetchedAt: generatedAt, status: 'ok', formulaVersion: 'alternative-me-fng-v1' }
    modules.push({ id: 'cycle', label: 'BTC 周期背景', metrics: [{ id: 'ma200w', label: '200 周均线', value: null, unit: 'usd', description: '历史长度不足时保留为空。', source: { ...source, status: 'unavailable', detail: 'Requires 200 completed weeks.' } }], series: [{ id: 'fear-greed', label: '恐惧与贪婪指数', group: 'cycle', unit: 'index', maxGapMs: 129_600_000, source: sentiment, points: daily.slice(-30).map((bar, index) => ({ at: bar.date, value: 40 + Math.round(Math.sin(index / 3) * 12) })) }], events: [], notes: ['情绪指数是背景指标，不代表未来涨跌概率。'] })
  }
  if (asset === 'MSTR') {
    const issuer: DashboardSource = { provider: 'Strategy · demo', url: 'https://www.strategy.com/notes', dataAt: '2026-09-07', publishedAt: '2026-09-08T12:00:00Z', fetchedAt: generatedAt, status: 'ok', formula: 'MSTR share price / Net Bitcoin Per Share (USD)', formulaVersion: 'strategy-mnav-2026-07-23' }
    modules.push({ id: 'strategy', label: 'Strategy 持币与每股价值', metrics: [{ id: 'mnav', label: 'mNAV', value: 1.12, unit: 'ratio', description: '按公式生效日期区分口径，历史版本不直接拼接。', source: issuer }, { id: 'net-bps', label: '每股净含币量', value: null, unit: 'btc', description: '缺少净资产扣减项，暂不计算。', source: { ...issuer, status: 'unavailable' } }], series: [
      { id: 'mstr-normalized', label: 'MSTR', group: 'strategy', unit: 'index', maxGapMs: 345_600_000, referenceValue: 100, source, points: daily.map(bar => ({ at: bar.date, value: bar.close / daily[0]!.close * 100 })) },
      { id: 'btc-normalized', label: 'BTC', group: 'strategy', unit: 'index', maxGapMs: 345_600_000, referenceValue: 100, source: { ...source, provider: 'demo/Coinbase' }, points: daily.map((bar, index) => ({ at: bar.date, value: 100 + index / 4 + Math.sin(index / 7) })) },
    ], events: [], notes: ['BTC Yield 与股价投资回报不同。'] })
    const strc: DashboardSource = { ...source, provider: 'demo/STRC', formulaVersion: 'market-price-v1' }
    modules.push({ id: 'strc', label: 'STRC 优先股', metrics: [], series: [{ id: 'strc-price', label: 'STRC 市场价格', group: 'strc', unit: 'usd', referenceValue: 100, maxGapMs: 345_600_000, source: strc, points: daily.map((bar, index) => ({ at: bar.date, value: 99 + Math.sin(index / 5) })) }], events: [{ id: 'strc-dividend-demo', label: '股息记录示例', kind: 'dividend', at: '2026-09-11', detail: '演示记录，不构成真实派息日历。' }], notes: ['100 美元为参考线，并非到期或回售保证；总回报需要核对实际股息。'] })
  }
  return { schemaVersion: 1, asset, generatedAt, windowDays: days, illustrative: true, modules }
}
