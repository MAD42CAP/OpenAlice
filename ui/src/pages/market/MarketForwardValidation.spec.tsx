// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { demoForecastValidation } from '../../demo/fixtures/forecast-validation'
import { i18n } from '../../i18n'
import { ForwardValidationDetails, MarketForwardJevView, MarketForwardValidationSummary } from './MarketForwardValidation'
const actions = { refresh: vi.fn(), collect: vi.fn() }
beforeEach(async () => { await i18n.changeLanguage('zh') })
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('leads with guarded abstention and hides raw percentages and scoring until requested', () => {
  const report = demoForecastValidation('BTC')
  render(<MarketForwardJevView report={report} loading={false} error={null} collecting={false} {...actions} />)
  expect(screen.getAllByText('暂不判断')).toHaveLength(2)
  expect(screen.getByText('平盘估计偏离历史频率过大，暂不采用该判断。')).toBeTruthy()
  expect(screen.getByText('方向不确定，保持暂不判断，不再归作平盘。')).toBeTruthy()
  expect(screen.queryByText(/\d+\.\d%/)).toBeNull()
  const raw = screen.getByRole('button', { name: 'Jev 原始输出 · 实验数据，不是已校准胜率' })
  expect(raw.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(raw)
  expect(screen.getAllByText('模型原始选择：flat')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '记录今日新版判断' }))
  expect(actions.collect).toHaveBeenCalledOnce()
})

it('permits freezing rules and combined evidence without a key and never fabricates a model result', () => {
  const report = demoForecastValidation('BTC'); report.configured = false; report.latest!.candidate = null
  render(<MarketForwardJevView report={report} loading={false} error={null} collecting={false} {...actions} />)
  expect(screen.getByText('Jev 尚未配置；仍可记录规则与综合判断。')).toBeTruthy()
  expect(screen.getAllByText('暂不判断')).toHaveLength(3)
  expect(screen.queryByRole('button', { name: /Jev 原始输出/ })).toBeNull()
  expect((screen.getByRole('button', { name: '记录今日新版判断' }) as HTMLButtonElement).disabled).toBe(false)
})

it('keeps new results experimental even with lower Brier, and leaves coverage inside the disclosure', () => {
  const report = demoForecastValidation('BTC')
  Object.assign(report.validation!.current.summaries[0]!, { uniqueWindows: 2, pending: 0, probability: { count: 2, nonOverlappingWindows: 2, jevBrier: 0.1, frequencyBrier: 0.9, difference: -0.8 } })
  render(<MarketForwardValidationSummary report={report} loading={false} error={null} refresh={actions.refresh} />)
  expect(screen.getByText('本轮新版 · 2 个窗口已到期，是否带来额外提升仍在验证。')).toBeTruthy()
  expect(screen.queryByText(/Brier：/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看验证明细' }))
  expect(screen.getByText('同批原始概率 Brier：Jev 0.100 · 历史频率 0.900 · 2 个窗口')).toBeTruthy()
  expect(screen.getByText(/单凭较低 Brier 不代表新版已经验证有效/)).toBeTruthy()
  expect(screen.queryByText(/命中 0\/0/)).toBeNull()
})

it('distinguishes missing archives from failed reads and never exposes provider diagnostics', () => {
  render(<MarketForwardValidationSummary report={null} loading={false} error="read" refresh={actions.refresh} />)
  expect(screen.getByRole('alert').textContent).toContain('暂时无法读取新版验证结果')
  expect(screen.queryByText('新版已就绪 · 尚未冻结后续验证记录。')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(actions.refresh).toHaveBeenCalledOnce()
})

it('shows collection failure separately from the saved rules and combined publication', () => {
  const report = demoForecastValidation('BTC'); report.latest!.candidate = null; report.lastError = 'private provider diagnostic'
  render(<MarketForwardJevView report={report} loading={false} error={null} collecting={false} {...actions} />)
  expect(screen.getByRole('alert').textContent).toContain('不会覆盖已冻结的规则与综合记录')
  expect(screen.queryByText('private provider diagnostic')).toBeNull()
})

it.each([
  { asset: 'BTC' as const, issued: '2026-10-15T23:30:00Z', generated: '2026-10-16T00:30:00Z', current: false },
  { asset: 'BTC' as const, issued: '2026-10-16T00:01:00Z', generated: '2026-10-16T00:30:00Z', current: true },
  { asset: 'TSLA' as const, issued: '2026-10-15T23:30:00Z', generated: '2026-10-16T00:30:00Z', current: true },
  { asset: 'MSTR' as const, issued: '2026-10-15T23:30:00Z', generated: '2026-10-16T00:30:00Z', current: true },
  { asset: 'TSLA' as const, issued: '2026-10-16T03:59:00Z', generated: '2026-10-16T04:00:00Z', current: false },
  { asset: 'MSTR' as const, issued: '2026-12-16T04:59:00Z', generated: '2026-12-16T05:00:00Z', current: false },
])('uses the report clock and $asset session boundary for current=$current ($generated)', ({ asset, issued, generated, current }) => {
  const report = demoForecastValidation(asset)
  report.generatedAt = generated
  report.latest!.publication.issuedAt = issued
  report.latest!.candidate!.requestedAt = issued
  report.latest!.candidate!.issuedAt = issued
  render(<><MarketForwardValidationSummary report={report} loading={false} error={null} refresh={actions.refresh} /><MarketForwardJevView report={report} loading={false} error={null} collecting={false} {...actions} /></>)
  const warnings = screen.queryAllByText('历史记录 · 等待今日采集，当前暂无今日 Jev 判断。')
  expect(warnings).toHaveLength(current ? 0 : 2)
  expect(screen.queryAllByText(/Jev · 看涨$/)).toHaveLength(0)
  expect(screen.queryAllByText('看涨')).toHaveLength(current ? 1 : 0)
  expect(screen.getByRole('button', { name: current ? 'Jev 原始输出 · 实验数据，不是已校准胜率' : '历史 Jev 原始输出 · 实验数据，不是已校准胜率' }).getAttribute('aria-expanded')).toBe('false')
})

it('keeps historical raw output and outcome scoring available behind disclosures', () => {
  const report = demoForecastValidation('BTC')
  report.generatedAt = '2026-10-17T01:00:00Z'
  report.latest!.publication.issuedAt = '2026-10-15T20:31:00Z'
  render(<><MarketForwardValidationSummary report={report} loading={false} error={null} refresh={actions.refresh} /><MarketForwardJevView report={report} loading={false} error={null} collecting={false} {...actions} /></>)
  fireEvent.click(screen.getByRole('button', { name: '历史 Jev 原始输出 · 实验数据，不是已校准胜率' }))
  expect(screen.getAllByText('模型原始选择：flat')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '查看验证明细' }))
  expect(screen.getAllByText(/同批原始概率 Brier：/)).toHaveLength(3)
})

it('keeps current strategy results separate from older aggregate successes and shows fair pairs only on demand', () => {
  const report = demoForecastValidation('MSTR')
  report.summaries[0]!.complete = 40
  report.summaries[0]!.methods.jev = { scored: 40, correct: 40, abstained: 0 }
  const current = report.validation!.current.summaries[0]!
  Object.assign(current, { uniqueWindows: 2, pending: 0 })
  current.pairwise.combined = { count: 2, rulesCorrect: 1, candidateCorrect: 1, accuracyDifference: 0, disagreements: 0, candidateOnlyCorrect: 0, rulesOnlyCorrect: 0, nonOverlappingWindows: 2, status: 'insufficient' }
  render(<MarketForwardValidationSummary report={report} loading={false} error={null} refresh={actions.refresh} />)
  expect(screen.getByText('本轮新版 · 2 个窗口已到期，是否带来额外提升仍在验证。')).toBeTruthy()
  expect(screen.queryByText(/同样 2 次判断/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看验证明细' }))
  expect(screen.getByText('规则版本 3；不混入旧版成绩。')).toBeTruthy()
  expect(screen.getByText(/综合判断对照规则：同样 2 次判断，命中 1\/2 对 1\/2/)).toBeTruthy()
  expect(screen.queryByText(/40\/40/)).toBeNull()
})

it('withholds same-date model output based on an older strategy version', () => {
  const report = demoForecastValidation('TSLA')
  report.latest!.publication.basis.strategyVersion = 2
  render(<MarketForwardJevView report={report} loading={false} error={null} collecting={false} {...actions} />)
  expect(screen.getByText('历史记录 · 等待今日采集，当前暂无今日 Jev 判断。')).toBeTruthy()
  expect(screen.queryByText('看涨')).toBeNull()
})

it('keeps actual previous-version scores visible even when its current strategy cohort is empty', () => {
  const report = demoForecastValidation('BTC', 'market-forward-v2')
  report.validation = demoForecastValidation('BTC').validation
  Object.assign(report.summaries[0]!.methods.jev, { scored: 2, correct: 1 })
  render(<ForwardValidationDetails report={report} />)
  expect(screen.getByText('新版 Jev：命中 1/2 · 0 暂不判断')).toBeTruthy()
  expect(screen.queryByText('规则版本 3；不混入旧版成绩。')).toBeNull()
})
