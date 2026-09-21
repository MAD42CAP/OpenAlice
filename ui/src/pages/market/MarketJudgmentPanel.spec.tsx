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
  expect(screen.getByRole('button', { name: '未来 7 天' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByText('方向暂不明确')).toBeTruthy()
  expect(screen.queryByText('平台规则判断')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看综合依据与各方意见' }))
  expect(screen.getByText('平台规则判断')).toBeTruthy()
  expect(screen.getByText('独立威科夫结构')).toBeTruthy()
  expect(screen.getByText(/未经校准的概率暂不改变顶部综合结论/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '未来 1 天' }))
  expect(screen.getByRole('button', { name: '未来 1 天' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByText('方向暂不明确')).toBeNull()
})
it('does not present a cached bullish conclusion as currently valid after a read fails', () => {
  render(<MarketJudgmentView report={demoMarketJudgment('BTC')} loading={false} error refresh={vi.fn()} />)
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.getByText('当前证据不足')).toBeTruthy()
  expect(screen.queryByText('偏多')).toBeNull()
})
it('uses trading sessions for equities and leaves direction withheld when no evidence is loaded', () => {
  const { rerender } = render(<MarketJudgmentView report={demoMarketJudgment('TSLA')} loading={false} error={false} refresh={vi.fn()} />)
  expect(screen.getByRole('button', { name: '未来 5 个交易日' })).toBeTruthy()
  rerender(<MarketJudgmentView report={null} loading error={false} refresh={vi.fn()} />)
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.queryByText('偏多')).toBeNull()
})
