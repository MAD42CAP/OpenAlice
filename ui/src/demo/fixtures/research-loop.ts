import type { MonitorAsset } from '../../api/market-monitor'
import type { EvidenceReference } from '../../api/market-intelligence-types'
import { researchLoopProtocol, type ResearchFeedbackRecord, type ResearchLoopReport, type ResearchRole } from '../../api/research-loop-types'

/** Invented feedback only; availability never represents verified trading performance. */
export function demoResearchLoop(scenario: 'ready' | 'failed' = 'ready', asset: MonitorAsset = 'BTC'): ResearchLoopReport {
  const protocol = researchLoopProtocol(asset)
  const prefix = asset === 'BTC' ? 'demo' : `demo-${asset.toLowerCase()}`
  const contextHash = `${asset === 'BTC' ? 'illustrative' : prefix}-loop-${scenario}`
  const now = '2026-10-15T18:10:00Z'
  const evidence = (id: string): EvidenceReference => ({ id, asset, sourceName: 'Illustrative research feedback', sourceUrl: null, metric: 'research-feedback', value: 'Unvalidated illustrative interpretation', unit: null, dataAsOf: now, publishedAt: now, retrievedAt: now, quality: 'available', reportId: null, kind: 'inference' })
  const record = (role: ResearchRole): ResearchFeedbackRecord => ({
    schemaVersion: 1, protocol, id: `${prefix}-feedback-${role}`, asset, role,
    inputId: `${prefix}-input-${role}`, inputHash: `illustrative-${role}-input`, issuedAt: now, expiresAt: '2026-10-16T18:10:00Z',
    basis: { snapshotId: `${prefix}-scan`, marketDataAsOf: now, capturedAt: now },
    provenance: { workspaceId: `demo-${role}`, runId: `demo-${role}-run`, issueId: `demo-${role}-issue`, agent: 'Illustrative' },
    validation: 'unvalidated', evidence: [evidence(`${prefix}-feedback-${role}`)], recordHash: `illustrative-${role}-hash`,
    summary: role === 'prediction' ? '演示：事件研究尚不能确认需求持续，保留突破条件。' : '演示：近期样本不足，不能据此认定预测优势。',
    horizon: 'all', conclusion: 'inconclusive', supportingEvidenceIds: [], opposingEvidenceIds: [],
    confirmation: '演示：等待后续收盘行情。', invalidation: '演示：预设条件失效。', limitations: ['虚构示例，预测效果未验证。'], recommendations: ['保留后续验证。'],
  })
  const prediction = record('prediction'), quant = record('quant')
  const records = scenario === 'ready' ? [prediction, quant] : [prediction]
  return {
    protocol, asset, generatedAt: now, illustrative: true,
    contributors: [
      { source: 'prediction', state: 'ready', updatedAt: now, summary: prediction.summary, recordId: prediction.id, workspaceId: 'demo-prediction', runId: 'demo-prediction-run' },
      { source: 'jev', state: 'ready', updatedAt: now, summary: '演示：方向不确定，保持暂不判断。', recordId: `${prefix}-forward-v2`, workspaceId: null, runId: null },
      { source: 'quant', state: scenario === 'ready' ? 'ready' : 'failed', updatedAt: now, summary: scenario === 'ready' ? quant.summary : '演示：研究未完成，失败结果不参与综合研判。', recordId: scenario === 'ready' ? quant.id : null, workspaceId: 'demo-quant', runId: 'demo-quant-run' },
    ],
    context: { protocol, ...(asset === 'BTC' ? {} : { asset }), hash: contextHash, asOf: now, records,
      jev: { publicationId: `${prefix}-forward-v2`, candidateHash: 'illustrative-candidate-hash', issuedAt: now, inputHash: 'illustrative-forward-input', snapshotId: `${prefix}-scan`, decisions: { short: { choice: null, reasons: ['signal-uncertain'] }, medium: { choice: null, reasons: ['signal-uncertain'] }, long: { choice: 'up', reasons: [] } } },
      evidence: [...records.flatMap(row => row.evidence), evidence(`${prefix}-feedback-jev`)],
    },
    history: records, invalidRecords: 0,
    synthesis: scenario === 'ready' ? { contextHash, snapshotId: `${prefix}-investment-2`, analysisTime: now } : null,
  }
}
