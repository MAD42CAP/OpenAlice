// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { i18n } from '../../i18n'
import { demoMarketIntelligence } from '../../demo/fixtures/market-intelligence'
import { demoMarketJudgment } from '../../demo/fixtures/market-judgment'
import { demoInvestmentExplanation, type DemoExplanationScenario } from '../../demo/fixtures/investment-explanation'
import { MarketIntelligenceReadContext } from './MarketIntelligenceContext'
import { MarketStateSentence } from './MarketStateSentence'
import { formatMonitorDate } from './market-monitor-format'

beforeEach(async () => { await i18n.changeLanguage('zh') })
afterEach(cleanup)
function fixture(scenario: DemoExplanationScenario = 'model') {
  const native = demoMarketIntelligence('MSTR'), snapshot = native.investment.latest!, report = demoMarketJudgment('MSTR')
  native.investment.explanation = demoInvestmentExplanation(snapshot, scenario)
  report.snapshotId = snapshot.marketSnapshotId
  report.horizons.short.rules = 'sideways'
  report.horizons.medium = { ...report.horizons.medium, rules: 'transition', direction: 'unclear', reasons: ['rules-mixed'] }
  report.horizons.long.rules = 'bullish'
  return { native, snapshot, report }
}
function view(f: ReturnType<typeof fixture>, options: { error?: boolean; nativeError?: string } = {}) {
  return <MarketIntelligenceReadContext.Provider value={{ asset: 'MSTR', report: f.native, loading: false, error: options.nativeError ?? null }}>
    <MarketStateSentence report={f.report} horizon="medium" error={!!options.error} />
  </MarketIntelligenceReadContext.Provider>
}

it.each([
  ['data', '相关输入缺失'], ['conflict', '同一期限的信号相互冲突'],
  ['independent', '缺少独立证据确认'], ['model', '模型本身仍拿不准'],
] as const)('explains %s separately while technical observations remain distinct from AI forecasts', (scenario, reason) => {
  const f = fixture(scenario); render(view(f))
  const sentence = screen.getByTestId('market-state-sentence').textContent!
  expect(sentence).toContain('MSTR技术观察：短期震荡、中期分歧、长期技术偏多')
  expect(sentence).toContain(`AI综合中期暂不判断，主因是${reason}`)
  expect(sentence).not.toContain('证据不足')
})

it('keeps effective conditional AI direction and states its limitation without replacing it with abstention', () => {
  const f = fixture('independent'); f.snapshot.outlooks.find(row => row.horizon === 'medium')!.direction = 'conditional-bullish'
  f.native.investment.explanation = demoInvestmentExplanation(f.snapshot, 'independent')
  render(view(f))
  expect(screen.getByText(/AI综合中期有条件偏多，主要限制是缺少独立证据确认/)).toBeTruthy()
  expect(screen.queryByText(/AI综合中期暂不判断/)).toBeNull()
})

it.each(['bullish', 'neutral', 'conditional-bearish'] as const)('does not invent a limitation for a verified %s conclusion with no primary reason', direction => {
  const f = fixture(); f.snapshot.outlooks.find(row => row.horizon === 'medium')!.direction = direction
  f.native.investment.explanation = demoInvestmentExplanation(f.snapshot)
  const row = f.native.investment.explanation.outlooks[1]!; row.primaryReason = null; row.reasons = []
  render(view(f))
  expect(screen.getByTestId('market-state-sentence').textContent).not.toMatch(/主因|限制|无法核验/)
})

it('keeps the exact earlier AI cause and date while newer technical observations use their own snapshot', () => {
  const f = fixture('model'); f.report.snapshotId = 'new-current-observation'; f.report.horizons.long.rules = 'bearish'
  f.native.investment.explanation!.outlooks[2]!.marketDirection = 'bullish'
  render(view(f))
  const sentence = screen.getByTestId('market-state-sentence').textContent!
  expect(sentence).toContain('长期技术偏空')
  expect(sentence).toContain(`上次分析（${formatMonitorDate(f.snapshot.analysisTime)}）`)
  expect(sentence).toContain('AI综合中期暂不判断，主因是模型本身仍拿不准')
  expect(sentence).toContain('基于较早行情')
})

it.each(['snapshotId', 'marketSnapshotId', 'analysisTime', 'asset'] as const)('does not infer a cause from a companion with mismatched %s', key => {
  const f = fixture('data')
  Object.assign(f.native.investment.explanation!, { [key]: key === 'asset' ? 'TSLA' : 'wrong-identity' })
  render(view(f))
  expect(screen.getByText(/主因尚无法核验/)).toBeTruthy()
  expect(screen.queryByText(/主因是相关输入缺失/)).toBeNull()
})

it('does not treat partial quality or absent diagnostics as missing data', () => {
  const f = fixture('data'); f.native.investment.explanation = undefined; f.native.market!.dataQuality = 'partial'
  render(view(f))
  expect(screen.getByText(/主因尚无法核验/)).toBeTruthy()
  expect(screen.queryByText(/相关输入缺失/)).toBeNull()
})

it.each(['unavailable', 'invalid', 'read-error'] as const)('withholds the primary cause for %s input without turning it into a market-data defect', inputStatus => {
  const f = fixture('model'); f.native.investment.explanation!.inputStatus = inputStatus
  render(view(f))
  expect(screen.getByText(/主因尚无法核验/)).toBeTruthy()
  expect(screen.queryByText(/主因是模型本身/)).toBeNull()
})

it('describes a coexisting conflict without claiming a guard caused the raw model abstention', () => {
  const f = fixture('model'); f.native.investment.explanation!.outlooks[1]!.reasons.push({ code: 'same-horizon-conflict', evidenceIds: [] })
  render(view(f))
  expect(screen.getByText(/模型本身仍拿不准，同期限信号也有分歧/)).toBeTruthy()
})

it('keeps fresh technical state but refuses a retained AI success after a read failure', () => {
  const f = fixture('data'); render(view(f, { nativeError: 'private failure body' }))
  expect(screen.getByText(/MSTR技术观察.*当前AI原因说明未能刷新/)).toBeTruthy()
  expect(screen.queryByText(/相关输入缺失|private failure body/)).toBeNull()
})

it('does not present retained technical state or a fresh AI cause as one current assessment after technical read failure', () => {
  render(view(fixture('model'), { error: true }))
  expect(screen.getByText(/当前技术状态未能刷新/)).toBeTruthy()
  expect(screen.queryByText(/MSTR技术观察|主因是模型本身/)).toBeNull()
})

it.each([['en', 'the model itself remains uncertain'], ['zh-Hant', '模型本身仍無法確定'], ['ja', 'モデル自体がまだ判断できない']] as const)('uses the %s explanation locale', async (language, text) => {
  await i18n.changeLanguage(language); render(view(fixture('model')))
  expect(screen.getByTestId('market-state-sentence').textContent).toContain(text)
})
