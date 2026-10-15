// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MarketJudgmentView } from './MarketJudgmentPanel'
import { demoMarketJudgment } from '../../demo/fixtures/market-judgment'
import { i18n } from '../../i18n'
beforeEach(async () => { await i18n.changeLanguage('zh') })
afterEach(cleanup)

it('defaults to the weekly headline, switches horizons and keeps independent model opinion behind disclosure', () => {
  const report = demoMarketJudgment('BTC')
  report.horizons.medium.direction = 'unclear'; report.horizons.medium.reasons = ['structure-conflict']
  render(<MarketJudgmentView report={report} loading={false} error={false} refresh={vi.fn()} />)
  expect(screen.getByRole('button', { name: '7 天视角' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getAllByText('方向暂不明确')).toHaveLength(2)
  expect(screen.queryByText('平台规则判断')).toBeNull()
  expect(screen.queryByText('威科夫结构的确认条件')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看综合依据与各方意见' }))
  expect(screen.getByText('平台规则判断')).toBeTruthy()
  expect(screen.getByText('威科夫结构的确认条件')).toBeTruthy()
  expect(screen.getByText('独立威科夫结构')).toBeTruthy()
  expect(screen.getByText(/未经校准的概率暂不改变顶部综合结论/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '1 天视角' }))
  expect(screen.getByRole('button', { name: '1 天视角' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getAllByText('方向暂不明确')).toHaveLength(1)
})
it('does not present a cached bullish conclusion as currently valid after a read fails', () => {
  render(<MarketJudgmentView report={demoMarketJudgment('BTC')} loading={false} error refresh={vi.fn()} />)
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.getAllByText('当前证据不足')).toHaveLength(4)
  expect(screen.queryByText('偏多')).toBeNull()
})
it('uses trading sessions for equities and leaves direction withheld when no evidence is loaded', () => {
  const { rerender } = render(<MarketJudgmentView report={demoMarketJudgment('TSLA')} loading={false} error={false} refresh={vi.fn()} />)
  expect(screen.getByRole('button', { name: '5 个交易日视角' })).toBeTruthy()
  rerender(<MarketJudgmentView report={null} loading error={false} refresh={vi.fn()} />)
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.queryByText('偏多')).toBeNull()
})

it('leads with the conditional result and leaves important data risks visible before expansion', () => {
  const report = demoMarketJudgment('TSLA')
  report.horizons.medium.direction = 'bullish'
  report.horizons.medium.risks = ['calendar-unknown']
  render(<MarketJudgmentView report={report} loading={false} error={false} refresh={vi.fn()} />)
  const direction = screen.getAllByText('偏多')[0]!
  const choices = screen.getByRole('group', { name: '判断期限' })
  expect(direction.compareDocumentPosition(choices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByText('下一次财报日期尚未核实，事件风险仍未知。')).toBeTruthy()
  expect(screen.getByText(/并非已验证的收益预测/)).toBeTruthy()
})

it('renders v2 conditional and abstention decisions without presenting an unconditional directional claim', () => {
  const report = demoMarketJudgment('BTC', 'v2')
  report.horizons.short.direction = 'bullish'; report.horizons.short.decision = 'abstain'
  render(<MarketJudgmentView report={report} loading={false} error={false} refresh={vi.fn()} />)
  expect(screen.getAllByText('偏多 · 待确认').length).toBeGreaterThan(0)
  expect(screen.getByText('暂不判断')).toBeTruthy()
  expect(screen.queryByText('偏多')).toBeNull()
  expect(screen.getByText('新版综合研判实验中 · 条件性证据，预测效果待验证。')).toBeTruthy()
})
