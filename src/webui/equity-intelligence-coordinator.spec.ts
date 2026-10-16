import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readQuickChatPreferences } from '../core/preferences.js'
import { INTELLIGENCE_ISSUE_ID } from '../domain/market-monitor/intelligence-types.js'
import { createIssue, updateIssueFields } from '../workspaces/issues/mutate.js'
import { readWorkspaceIssues } from '../workspaces/issues/declaration.js'
import type { IssueDetail, IssueRunRecord } from '../workspaces/issues/board.js'
import type { WorkspaceService } from '../workspaces/service.js'
import { createEquityIntelligenceCoordinator, EQUITY_INTELLIGENCE_PROMPTS, equityIntelligenceIssueId, type EquityIntelligenceAsset } from './equity-intelligence-coordinator.js'

vi.mock('../core/preferences.js', () => ({ readQuickChatPreferences: vi.fn(async () => ({ recentChatWorkspaceId: 'chat' })) }))
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); vi.clearAllMocks() })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'equity-intelligence-coordinator-')); roots.push(dir)
  const workspace = { id: 'chat', tag: 'Chat', dir, template: 'chat', createdAt: '2026-10-15T00:00:00Z' }
  const runs = new Map<string, IssueRunRecord[]>()
  const issueDetail = vi.fn(async (ws: string, id: string): Promise<IssueDetail | null> => {
    if (ws !== workspace.id) return null
    const read = await readWorkspaceIssues(dir), issue = read.ok && read.issues.find(row => row.id === id)
    return issue ? { issue, runs: runs.get(id) ?? [], comments: [], inboxReports: [], provenance: [], activity: [] } : null
  })
  const runIssueNow = vi.fn(async (ws: string, id: string) => {
    runs.set(id, [task(id)])
    return (await issueDetail(ws, id))!
  })
  const service = {
    registry: { get: (id: string) => id === workspace.id ? workspace : undefined, list: () => [workspace] }, issueDetail, runIssueNow,
    resolveOrCreateChatWorkspace: vi.fn(async () => ({ ok: true, workspace })),
  } as unknown as WorkspaceService
  return { dir, workspace, runs, service, issueDetail, runIssueNow }
}
function task(issueId: string, patch: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return { taskId: `run-${issueId}`, resumeId: `resume-${issueId}`, wsId: 'chat', issueId, agent: 'codex', prompt: 'readonly frozen input', status: 'running', startedAt: Date.parse('2026-10-15T20:15:00Z'), resumable: true, ...patch }
}

describe('equity native synthesis Issue coordinator', () => {
  it('creates separate stock Issues while leaving the BTC Issue and native runtime untouched', async () => {
    const { dir, service } = await fixture()
    await createIssue(dir, { id: INTELLIGENCE_ISSUE_ID, title: 'BTC owner research', status: 'in_progress', what: 'BTC owner instructions', assignee: '@new-each-run', when: { kind: 'cron', cron: '0 9 * * *', timezone: 'America/Vancouver', catchUp: false } })
    const tsla = createEquityIntelligenceCoordinator(service, 'TSLA'), mstr = createEquityIntelligenceCoordinator(service, 'MSTR')
    await Promise.all([tsla.ensure(), tsla.ensure(), mstr.ensure()])
    await tsla.ensure(); await mstr.ensure()
    const read = await readWorkspaceIssues(dir)
    expect(read.ok && read.issues).toHaveLength(3)
    for (const asset of ['TSLA', 'MSTR'] as const) {
      const issue = read.ok && read.issues.find(row => row.id === equityIntelligenceIssueId(asset))
      expect(issue).toMatchObject({ id: `mad42lab-${asset.toLowerCase()}-investment-intelligence`, title: `${asset} 综合投资研究`, what: EQUITY_INTELLIGENCE_PROMPTS[asset], status: 'in_progress', assignee: '@new-each-run', timeout: '15m', when: { kind: 'cron', cron: asset === 'TSLA' ? '40 16 * * 1-5' : '0 17 * * 1-5', timezone: 'America/New_York', catchUp: true } })
      for (const field of ['agent', 'model', 'effort', 'credential', 'credentialSource']) expect(issue).not.toHaveProperty(field)
    }
    expect(read.ok && read.issues.find(row => row.id === INTELLIGENCE_ISSUE_ID)?.what).toBe('BTC owner instructions')
    expect(vi.mocked(service.resolveOrCreateChatWorkspace).mock.calls.every(args => args[0] === 'chat')).toBe(true)
  })

  it.each(['canceled', 'done'] as const)('preserves owner runtime, cadence, budget and %s status', async status => {
    const { dir, service, runIssueNow } = await fixture(), c = createEquityIntelligenceCoordinator(service, 'TSLA')
    await c.ensure()
    await updateIssueFields(dir, equityIntelligenceIssueId('TSLA'), { what: 'old stock prompt', agent: 'claude', model: 'owner-model', effort: 'high', credentialSource: 'native', timeout: '45m', when: { kind: 'cron', cron: '3 9 * * 1', timezone: 'America/Vancouver', catchUp: false }, status })
    await c.ensure()
    const read = await readWorkspaceIssues(dir)
    expect(read.ok && read.issues[0]).toMatchObject({ what: EQUITY_INTELLIGENCE_PROMPTS.TSLA, agent: 'claude', model: 'owner-model', effort: 'high', credentialSource: 'native', timeout: '45m', status, when: { kind: 'cron', cron: '3 9 * * 1', timezone: 'America/Vancouver', catchUp: false } })
    expect((await c.run()).state).toBe('blocked')
    expect(runIssueNow).not.toHaveBeenCalled()
  })

  it('reuses the existing stock Issue rather than creating a replacement Chat workspace', async () => {
    const { dir, service } = await fixture()
    await createIssue(dir, { id: equityIntelligenceIssueId('MSTR'), title: 'owner MSTR task', status: 'in_progress', what: 'older', assignee: '@new-each-run', when: { kind: 'cron', cron: '0 9 * * *', timezone: 'America/Vancouver', catchUp: false } })
    const c = createEquityIntelligenceCoordinator(service, 'MSTR')
    await c.ensure()
    expect(service.resolveOrCreateChatWorkspace).not.toHaveBeenCalled()
    expect((await c.run()).runId).toBe(`run-${equityIntelligenceIssueId('MSTR')}`)
  })

  it('coalesces simultaneous dispatch and keeps each asset on its own authoritative Issue', async () => {
    const { service, runIssueNow, issueDetail } = await fixture()
    const tsla = createEquityIntelligenceCoordinator(service, 'TSLA'), mstr = createEquityIntelligenceCoordinator(service, 'MSTR')
    await Promise.all([tsla.ensure(), mstr.ensure()])
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    runIssueNow.mockImplementationOnce(async (ws, id) => { await wait; return { ...(await issueDetail(ws, id))!, runs: [task(id, { taskId: 'native-tsla' })] } })
    const first = tsla.run(), second = tsla.run()
    expect(first).toBe(second)
    release()
    expect(await first).toMatchObject({ state: 'running', runId: 'native-tsla', updatedAt: '2026-10-15T20:15:00.000Z' })
    expect(await mstr.run()).toMatchObject({ state: 'running', runId: `run-${equityIntelligenceIssueId('MSTR')}` })
    expect(runIssueNow.mock.calls).toEqual([['chat', equityIntelligenceIssueId('TSLA')], ['chat', equityIntelligenceIssueId('MSTR')]])
  })

  it('blocks active native runs and separates native completion from publication', async () => {
    const { runs, service, runIssueNow } = await fixture(), c = createEquityIntelligenceCoordinator(service, 'TSLA'), id = equityIntelligenceIssueId('TSLA')
    await c.ensure()
    runs.set(id, [task(id)])
    expect((await c.run()).state).toBe('running')
    expect(runIssueNow).not.toHaveBeenCalled()
    runs.set(id, [task(id, { status: 'done', finishedAt: Date.parse('2026-10-15T20:17:00Z') })])
    expect(await c.status()).toMatchObject({ state: 'success', runId: `run-${id}`, updatedAt: '2026-10-15T20:17:00.000Z' })
    expect((await c.status()).message).toContain('发布记录单独验证')
    runs.set(id, [task(id, { status: 'failed' })])
    expect((await c.status()).state).toBe('failed')
  })

  it('returns a bounded error when the Chat runtime cannot be resolved', async () => {
    const { service, runIssueNow } = await fixture()
    vi.mocked(service.resolveOrCreateChatWorkspace).mockResolvedValue({ ok: false, reason: 'workspace-not-found' } as never)
    const c = createEquityIntelligenceCoordinator(service, 'MSTR')
    await expect(c.run()).rejects.toThrow('MSTR 研究工作区暂不可用')
    expect(runIssueNow).not.toHaveBeenCalled()
  })

  it.each(['TSLA', 'MSTR'] as const)('requires frozen, asset-scoped, read-only %s synthesis and an exact feedback receipt', (asset: EquityIntelligenceAsset) => {
    const text = EQUITY_INTELLIGENCE_PROMPTS[asset]
    for (const part of [asset, 'investment-intelligence-equity-v2', 'AGENTS.md', 'alice intelligence input', 'alice intelligence publish-synthesis', '省略 researchSnapshotId', 'Python subprocess 参数数组', 'researchEvidenceIds 使用空数组', 'trend.<horizon>', '1、5、20 个交易日', 'observationWindow', 'SEC 元数据只证明申报事件和日期', 'uncertain（暂不判断）', 'neutral（横盘）', '不重复计票', '研究反馈不验证自身', 'researchFeedback.evidence 的所有 ID', '本次冻结 ID', '不读取未来资料', '不访问、输出或记录凭据']) expect(text).toContain(part)
    expect(text).toContain('不修改项目代码')
    for (const field of ['decisionConditions', 'thresholdEvidenceId', 'resistance.<horizon>', 'support.<horizon>', '旧 thesis 的 key 和条件不可']) expect(text).toContain(field)
    expect(text).not.toContain('researchSnapshotId 采用最新周报')
    if (asset === 'MSTR') expect(text).toContain('BTC 价格判断不能替代 MSTR')
  })
})
