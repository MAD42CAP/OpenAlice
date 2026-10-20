// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MarketMovementAlerts, MarketMovementAlertsView, movementCheckOverdue } from './MarketMovementAlerts'
import { demoMovementReport } from '../../demo/fixtures/movement-alerts'
import { i18n } from '../../i18n'
import type { MovementPlan, MovementReport } from '../../api/market-movement-alerts'
const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../../hooks/useMarketMovementAlerts', () => ({ useMarketMovementAlerts: () => state.value }))
const actions = { create: vi.fn(async () => true), cancel: vi.fn(async () => true), refresh: vi.fn() }
beforeEach(async () => { await i18n.changeLanguage('zh'); localStorage.clear() })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })
const props = (report: MovementReport = demoMovementReport('BTC')) => ({ asset: report.asset, report, loading: false, busy: false, error: null, monitoringEnabled: true, intervalMinutes: 15, ...actions })
const expand = () => fireEvent.click(screen.getByRole('button', { name: '设置预警与查看条件' }))
const plan = (report: MovementReport): MovementPlan => ({ id: 'plan', asset: report.asset, createdAt: report.generatedAt, expiresAt: new Date(Date.parse(report.generatedAt) + 86_400_000).toISOString(), anchor: structuredClone(report.risk.reference!),
  up: { percent: 3, targetPrice: 82400, state: 'armed', event: null }, down: { percent: 3, targetPrice: 77600, state: 'armed', event: null }, latestCheck: null, lastObservedAsOf: null })
const checkNow = Date.parse('2026-10-19T20:00:00Z')
const minutesAgo = (minutes: number) => new Date(checkNow - minutes * 60_000).toISOString()
it('marks a never-checked plan overdue only after two background intervals', () => {
  expect(movementCheckOverdue({ createdAt: minutesAgo(31), latestCheck: null }, 15, checkNow)).toBe(true)
  expect(movementCheckOverdue({ createdAt: minutesAgo(30), latestCheck: null }, 15, checkNow)).toBe(false)
})
it('uses the latest completed check time rather than an old creation time', () => {
  const saved = { createdAt: minutesAgo(120), latestCheck: { checkedAt: minutesAgo(31), status: 'observed' as const, reason: null, quote: null } }
  expect(movementCheckOverdue(saved, 15, checkNow)).toBe(true)
  saved.latestCheck.checkedAt = minutesAgo(2)
  expect(movementCheckOverdue(saved, 15, checkNow)).toBe(false)
})
it('allows a newly created plan to wait and applies a five-minute minimum grace', () => {
  expect(movementCheckOverdue({ createdAt: minutesAgo(1), latestCheck: null }, 15, checkNow)).toBe(false)
  expect(movementCheckOverdue({ createdAt: minutesAgo(4), latestCheck: null }, 1, checkNow)).toBe(false)
  expect(movementCheckOverdue({ createdAt: minutesAgo(6), latestCheck: null }, 1, checkNow)).toBe(true)
})
it('shows overdue status before expansion and gives disabled monitoring priority', () => {
  const report = demoMovementReport('BTC'); report.generatedAt = new Date(checkNow).toISOString()
  const saved = plan(report); saved.createdAt = minutesAgo(31); report.plans = [saved]
  const { rerender } = render(<MarketMovementAlertsView {...props(report)} nowMs={checkNow} />)
  expect(screen.getByText('待核实 · 最近未完成行情检查')).toBeTruthy()
  expect(screen.queryByText(/上涨 3% · 待触发/)).toBeNull()
  rerender(<MarketMovementAlertsView {...props(report)} monitoringEnabled={false} nowMs={checkNow} />)
  expect(screen.getByText('后台监测未开启')).toBeTruthy()
  expect(screen.queryByText('待核实 · 最近未完成行情检查')).toBeNull()
  saved.createdAt = minutesAgo(1)
  rerender(<MarketMovementAlertsView {...props(report)} nowMs={checkNow} />)
  expect(screen.getByText(/上涨 3% · 待触发/)).toBeTruthy()
})
it('shows a recent unavailable check outside details, and stale checks take priority', () => {
  const report = demoMovementReport('BTC'); report.generatedAt = new Date(checkNow).toISOString()
  const saved = plan(report); saved.createdAt = minutesAgo(120)
  saved.latestCheck = { checkedAt: minutesAgo(2), status: 'unavailable', reason: 'quote-unavailable', quote: null }; report.plans = [saved]
  const { rerender } = render(<MarketMovementAlertsView {...props(report)} nowMs={checkNow} />)
  expect(screen.getByText('最近检查未能取得有效价格，不代表阈值未被触及。')).toBeTruthy()
  expect(screen.queryByText(/上涨 3% · 待触发/)).toBeNull()
  saved.latestCheck.checkedAt = minutesAgo(31)
  rerender(<MarketMovementAlertsView {...props(report)} nowMs={checkNow} />)
  expect(screen.getByText('待核实 · 最近未完成行情检查')).toBeTruthy()
})
it('keeps the homepage concise with signed short-structure distances and no automatic arming', () => {
  render(<MarketMovementAlertsView {...props()} />)
  expect(screen.getByText('尚未设置价格预警')).toBeTruthy()
  expect(screen.getByText(/下方支撑.*-3.00%.*上方阻力.*\+3.00%/)).toBeTruthy()
  expect(screen.queryByRole('spinbutton')).toBeNull(); expect(actions.create).not.toHaveBeenCalled()
  expand()
  expect(screen.getByText('条件情景（非概率预测）')).toBeTruthy()
  expect(screen.getAllByText(/若跌破此支撑，可另参考/)).toHaveLength(3)
  expect(screen.getByText('以上为当前结构价位，未追踪其后日线收盘确认。')).toBeTruthy()
})
it('submits default two-sided thresholds only after the user acts, and supports one enabled leg', () => {
  render(<MarketMovementAlertsView {...props()} />); expand()
  fireEvent.click(screen.getByRole('button', { name: '以当前价格设置' }))
  expect(actions.create).toHaveBeenLastCalledWith({ upPercent: 3, downPercent: 3, expiresInHours: 24 })
  fireEvent.click(screen.getByRole('checkbox', { name: '启用下跌预警' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: '上涨幅度（%）' }), { target: { value: '4' } })
  fireEvent.click(screen.getByRole('button', { name: '以当前价格设置' }))
  expect(actions.create).toHaveBeenLastCalledWith({ upPercent: 4, expiresInHours: 24 })
})
it('rejects no enabled direction and out-of-range thresholds without creating', () => {
  render(<MarketMovementAlertsView {...props()} />); expand()
  fireEvent.click(screen.getByRole('checkbox', { name: '启用上涨预警' })); fireEvent.click(screen.getByRole('checkbox', { name: '启用下跌预警' }))
  fireEvent.submit(screen.getByRole('button', { name: '以当前价格设置' }).closest('form')!)
  expect(screen.getByRole('alert').textContent).toContain('0.1–50%'); expect(actions.create).not.toHaveBeenCalled()
})
it('shows frozen provenance, single-use status and explicitly cancels only remaining legs', () => {
  const report = demoMovementReport('BTC'); report.plans = [plan(report)]
  report.plans[0]!.anchor.priceKind = 'completed-daily-close'; report.plans[0]!.anchor.status = 'delayed'
  render(<MarketMovementAlertsView {...props(report)} />); expand()
  expect(screen.getByText(/冻结基准/)).toBeTruthy(); expect(screen.getByText(/已完成日线收盘.*延迟或受限/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '以当前价格设置' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '取消剩余预警' }))
  expect(actions.cancel).toHaveBeenCalledWith('plan'); expect(actions.create).not.toHaveBeenCalled()
})
it('does not turn a crossed signed boundary into remaining downside or a confirmed forecast', () => {
  const report = demoMovementReport('BTC'), boundary = report.risk.horizons[0]!.downside!.boundary
  boundary.distancePercent = 1.25; boundary.price = 81000; boundary.priceCrossed = true
  report.risk.horizons[0]!.downside!.nextBoundary = { ...boundary, sourceHorizon: 'long', price: 57000, distancePercent: -29.73, priceCrossed: false }
  render(<MarketMovementAlertsView {...props(report)} />)
  expect(screen.getByText(/\+1.25%.*参考价已越界/)).toBeTruthy(); expand()
  expect(screen.getByText('参考价已越过此结构边界，不能据此确认后续走势。')).toBeTruthy()
  expect(screen.getByText(/可另参考长期结构支撑.*57,000.*-29.73%.*并非下跌目标/)).toBeTruthy()
  expect(screen.queryByText(/还有.*空间/)).toBeNull(); expect(screen.queryByText(/等待已完成日线收盘确认/)).toBeNull()
})
it('withholds cached healthy status on read/check failures and explains disabled monitoring', () => {
  const report = demoMovementReport('BTC'); report.plans = [plan(report)]; report.checkError = true
  const { rerender } = render(<MarketMovementAlertsView {...props(report)} monitoringEnabled={false} />)
  expect(screen.getByRole('alert').textContent).toContain('后台检查'); expand()
  expect(screen.getByText(/后台监测尚未开启/)).toBeTruthy(); expect(screen.getByText(/关闭时不提供设备推送/)).toBeTruthy()
  rerender(<MarketMovementAlertsView {...props(report)} error="read" />)
  expect(screen.queryByText(/冻结基准/)).toBeNull(); expect(screen.getByRole('alert').textContent).toContain('暂时无法读取')
  fireEvent.click(screen.getByRole('button', { name: '刷新' })); expect(actions.refresh).toHaveBeenCalledOnce()
})
it('keeps expired and triggered records distinct, with source changes disclosed', () => {
  const report = demoMovementReport('BTC'), saved = plan(report)
  saved.up!.state = 'expired'; saved.down!.state = 'triggered'
  saved.down!.event = { id: 'event', planId: saved.id, asset: 'BTC', direction: 'down', percent: 3, targetPrice: 77600, price: 77500, asOf: report.generatedAt, observedAt: report.generatedAt, provider: 'yfinance', feed: 'Yahoo Finance', providerChanged: true }
  report.plans = [saved]
  render(<MarketMovementAlertsView {...props(report)} />); expand()
  expect(screen.getAllByText(/上涨 3% · 已到期/).length).toBeGreaterThan(0)
  expect(screen.getByText(/触发行情源与冻结基准不同/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '取消剩余预警' })).toBeNull()
})
it('only notifies a newly observed saved event after initial load, once, without asking permission', () => {
  const notify = vi.fn(), requestPermission = vi.fn()
  vi.stubGlobal('Notification', Object.assign(notify, { permission: 'granted', requestPermission }))
  const report = demoMovementReport('BTC'); report.illustrative = false
  state.value = props(report)
  const wrapper = { asset: 'BTC' as const, visible: true, revisionKey: '', notifications: true, monitoringEnabled: true, intervalMinutes: 15 }
  const { rerender } = render(<MarketMovementAlerts {...wrapper} />)
  const changed = structuredClone(report), saved = plan(changed)
  saved.up!.state = 'triggered'; saved.up!.event = { id: 'new-event', planId: saved.id, asset: 'BTC', direction: 'up', percent: 3, targetPrice: 82400, price: 82500, asOf: report.generatedAt, observedAt: new Date(Date.parse(report.generatedAt) + 1000).toISOString(), provider: 'coinbase', feed: 'Coinbase Exchange', providerChanged: false }
  changed.plans = [saved]; state.value = props(changed); rerender(<MarketMovementAlerts {...wrapper} />)
  expect(notify).toHaveBeenCalledTimes(1); expect(requestPermission).not.toHaveBeenCalled()
  state.value = props(structuredClone(changed)); rerender(<MarketMovementAlerts {...wrapper} />)
  expect(notify).toHaveBeenCalledTimes(1)
})
