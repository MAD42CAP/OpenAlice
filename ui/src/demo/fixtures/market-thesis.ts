import type { MonitorAsset } from '../../api/market-monitor'
import type { ThesisCheck, ThesisDraft, ThesisEvaluation, ThesisReport, ThesisRevision } from '../../api/market-thesis-types'

export function demoThesisReport(asset: MonitorAsset, draft?: ThesisDraft, previous?: ThesisReport): ThesisReport {
  const time = '2026-09-23T12:00:00Z', price = asset === 'BTC' ? 70000 : asset === 'TSLA' ? 400 : 300
  const revision: ThesisRevision = { ...(draft ?? { thesis: '演示逻辑 / Illustrative thesis：观察价格能否保持在设定水平之上。', horizon: '演示：未来一个月 / Demo: one month', enabled: true, changeNote: 'Synthetic demo only', conditions: [
    { id: 'price', label: '价格保持在观察水平之上 / Price support', kind: 'support', metric: 'daily-close', operator: 'gte', threshold: price - 10 },
    { id: 'filing', label: '需要核对申报正文 / Review filing text', kind: 'invalidate', metric: 'manual', operator: 'lt', threshold: null },
  ] }), schemaVersion: 1, asset, revision: (previous?.revision?.revision ?? 0) + 1, createdAt: time, recordHash: `demo-${asset}-${(previous?.revision?.revision ?? 0) + 1}` }
  const rows: ThesisEvaluation['rows'] = revision.conditions.map(c => {
    const value = c.metric === 'daily-close' ? price : c.metric === 'daily-change' ? 2 : c.metric === 'volume-ratio' ? 1.2 : null
    const difference = value !== null && c.threshold !== null ? value - c.threshold : null
    return { condition: c, result: difference === null ? 'unknown' : (c.operator === 'gt' ? difference > 0 : c.operator === 'gte' ? difference >= 0 : c.operator === 'lt' ? difference < 0 : difference <= 0) ? 'met' : 'not-met',
      evidence: { metric: c.metric, value, unit: c.metric === 'daily-close' ? 'usd' : c.metric === 'daily-change' ? 'percent' : c.metric === 'manual' ? 'text' : 'ratio', provider: value !== null ? 'Synthetic demo data' : null, dataAt: '2026-09-22', observedAt: time, expiresAt: null, formulaVersion: 'demo', reason: c.metric === 'manual' ? 'manual' : value === null ? 'missing' : 'available' } }
  })
  const supported = rows.filter(r => r.condition.kind === 'support' && r.result === 'met').length, triggered = rows.filter(r => r.condition.kind === 'invalidate' && r.result === 'met').length, unknown = rows.filter(r => r.result === 'unknown').length
  const evaluation: ThesisEvaluation = { rows, supported, triggered, unknown, status: !revision.enabled ? 'paused' : triggered ? 'triggered' : unknown ? 'incomplete' : supported ? 'supported' : 'watch' }
  const check: ThesisCheck & { evaluation: ThesisEvaluation } = { schemaVersion: 1, asset, revision, checkedAt: time, evidence: rows.map(r => r.evidence), recordHash: `check-${revision.recordHash}`, dedupKey: revision.recordHash, evaluation }
  return { asset, generatedAt: time, revision, current: evaluation, lastCheckedAt: time, checkError: false, revisions: [...previous?.revisions ?? [], revision], checks: [...previous?.checks ?? [], check], truncated: false }
}
