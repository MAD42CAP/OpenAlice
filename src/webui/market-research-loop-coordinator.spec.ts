import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readAutoPredictionPreferences, readAutoQuantPreferences } from '../core/preferences.js'
import { RESEARCH_LOOP_ISSUES, type ResearchRole } from '../domain/market-monitor/research-loop-types.js'
import { readWorkspaceIssues } from '../workspaces/issues/declaration.js'
import { updateIssueFields } from '../workspaces/issues/mutate.js'
import type { IssueDetail, IssueRunRecord } from '../workspaces/issues/board.js'
import type { WorkspaceService } from '../workspaces/service.js'
import { createMarketResearchLoopCoordinator, RESEARCH_LOOP_PROMPTS } from './market-research-loop-coordinator.js'

vi.mock('../core/preferences.js', () => ({
  readAutoPredictionPreferences: vi.fn(), readAutoQuantPreferences: vi.fn(),
}))
const roots: string[] = []
beforeEach(() => {
  vi.mocked(readAutoPredictionPreferences).mockResolvedValue({ defaultWorkspaceId: 'prediction' })
  vi.mocked(readAutoQuantPreferences).mockResolvedValue({ defaultWorkspaceId: 'quant' })
})
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.clearAllMocks()
})
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'research-loop-coordinator-')); roots.push(dir)
  const workspaces = {
    prediction: { id: 'prediction', tag: 'Prediction', dir: join(dir, 'prediction'), template: 'auto-prediction', createdAt: '2026-10-15T00:00:00Z' },
    quant: { id: 'quant', tag: 'Quant', dir: join(dir, 'quant'), template: 'auto-quant-v2', createdAt: '2026-10-15T00:00:00Z' },
  }
  const runs: Partial<Record<ResearchRole, IssueRunRecord[]>> = {}
  const issueDetail = vi.fn(async (ws: string, id: string): Promise<IssueDetail | null> => {
    const workspace = workspaces[ws as ResearchRole]
    if (!workspace) return null
    const read = await readWorkspaceIssues(workspace.dir)
    const issue = read.ok && read.issues.find(row => row.id === id)
    return issue ? { issue, runs: runs[ws as ResearchRole] ?? [], comments: [], inboxReports: [], provenance: [], activity: [] } : null
  })
  const runIssueNow = vi.fn(async (ws: string, id: string) => {
    runs[ws as ResearchRole] = [task(ws as ResearchRole)]
    return (await issueDetail(ws, id))!
  })
  const service = {
    registry: { get: (id: string) => workspaces[id as ResearchRole], list: () => Object.values(workspaces) },
    runIssueNow, issueDetail, resolveOrCreateChatWorkspace: vi.fn(), createWorkspace: vi.fn(),
  } as unknown as WorkspaceService
  return { dir, service, workspaces, runs, issueDetail, runIssueNow }
}
function task(role: ResearchRole, patch: Partial<IssueRunRecord> = {}): IssueRunRecord {
  return { taskId: `run-${role}`, resumeId: `resume-${role}`, wsId: role, issueId: RESEARCH_LOOP_ISSUES[role], agent: 'codex', prompt: RESEARCH_LOOP_PROMPTS[role], status: 'running', startedAt: Date.parse('2026-10-15T15:00:00Z'), resumable: true, ...patch }
}

describe('BTC native research Issue coordinator', () => {
  it('creates two bounded daily Issues in their explicit default desks and inherits their native runtime', async () => {
    const { service, workspaces } = await fixture(), coordinator = createMarketResearchLoopCoordinator(service)
    await Promise.all([coordinator.ensure(), coordinator.ensure()])
    await coordinator.ensure()
    for (const role of ['prediction', 'quant'] as const) {
      const read = await readWorkspaceIssues(workspaces[role].dir)
      expect(read.ok && read.issues).toHaveLength(1)
      expect(read.ok && read.issues[0]).toMatchObject({
        id: RESEARCH_LOOP_ISSUES[role], status: 'in_progress', assignee: '@new-each-run', timeout: '15m', what: RESEARCH_LOOP_PROMPTS[role],
        when: { kind: 'cron', cron: role === 'prediction' ? '0 8 * * *' : '5 8 * * *', timezone: 'America/Vancouver', catchUp: true },
      })
      for (const field of ['agent', 'model', 'effort', 'credential', 'credentialSource']) expect(read.ok && read.issues[0]).not.toHaveProperty(field)
    }
    expect(service.resolveOrCreateChatWorkspace).not.toHaveBeenCalled()
  })

  it('does not guess, clone or create a desk when the default is missing or points to another template', async () => {
    const { service, workspaces, runIssueNow } = await fixture(), coordinator = createMarketResearchLoopCoordinator(service)
    vi.mocked(readAutoPredictionPreferences).mockResolvedValue({ defaultWorkspaceId: null })
    vi.mocked(readAutoQuantPreferences).mockResolvedValue({ defaultWorkspaceId: 'prediction' })
    await coordinator.ensure()
    expect(await coordinator.run('prediction')).toMatchObject({ state: 'blocked', workspaceId: null, runId: null })
    expect(await coordinator.status('quant')).toMatchObject({ state: 'blocked', workspaceId: null })
    for (const workspace of Object.values(workspaces)) {
      const read = await readWorkspaceIssues(workspace.dir)
      expect(read).toMatchObject({ ok: false, reason: 'absent' })
    }
    expect(runIssueNow).not.toHaveBeenCalled()
    expect(service.resolveOrCreateChatWorkspace).not.toHaveBeenCalled()
    expect((service as unknown as { createWorkspace: () => unknown }).createWorkspace).not.toHaveBeenCalled()
  })

  it('reconciles only the prompt while preserving owner runtime, cadence, budget and terminal choices', async () => {
    const { service, workspaces, runIssueNow } = await fixture(), coordinator = createMarketResearchLoopCoordinator(service)
    await coordinator.ensure()
    await updateIssueFields(workspaces.prediction.dir, RESEARCH_LOOP_ISSUES.prediction, {
      what: 'older loop prompt', agent: 'claude', model: 'owner-model', effort: 'high', credentialSource: 'native', timeout: '45m',
      when: { kind: 'cron', cron: '3 9 * * 1', timezone: 'America/New_York', catchUp: false }, status: 'canceled',
    })
    await updateIssueFields(workspaces.quant.dir, RESEARCH_LOOP_ISSUES.quant, { status: 'done' })
    await coordinator.ensure()
    const read = await readWorkspaceIssues(workspaces.prediction.dir)
    expect(read.ok && read.issues[0]).toMatchObject({
      what: RESEARCH_LOOP_PROMPTS.prediction, agent: 'claude', model: 'owner-model', effort: 'high', credentialSource: 'native', timeout: '45m', status: 'canceled',
      when: { kind: 'cron', cron: '3 9 * * 1', timezone: 'America/New_York', catchUp: false },
    })
    expect((await coordinator.run('prediction')).state).toBe('blocked')
    expect((await coordinator.run('quant')).state).toBe('blocked')
    expect(runIssueNow).not.toHaveBeenCalled()
  })

  it('coalesces concurrent role requests and returns the native dispatched run identity', async () => {
    const { service, runIssueNow, issueDetail } = await fixture(), coordinator = createMarketResearchLoopCoordinator(service)
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    runIssueNow.mockImplementationOnce(async (ws, id) => {
      await blocked
      const detail = (await issueDetail(ws, id))!
      return { ...detail, runs: [task('prediction', { taskId: 'native-execution' })] }
    })
    const first = coordinator.run('prediction'), second = coordinator.run('prediction')
    expect(first).toBe(second)
    release()
    expect(await first).toMatchObject({ state: 'running', runId: 'native-execution', workspaceId: 'prediction', updatedAt: '2026-10-15T15:00:00.000Z' })
    expect(runIssueNow).toHaveBeenCalledTimes(1)
    expect(runIssueNow).toHaveBeenCalledWith('prediction', RESEARCH_LOOP_ISSUES.prediction)
    expect((await coordinator.run('quant')).runId).toBe('run-quant')
  })

  it('blocks an already running Issue and reports native completion separately from a published artifact', async () => {
    const { service, runs, runIssueNow } = await fixture(), coordinator = createMarketResearchLoopCoordinator(service)
    await coordinator.ensure()
    runs.prediction = [task('prediction')]
    expect((await coordinator.run('prediction')).state).toBe('running')
    expect(runIssueNow).not.toHaveBeenCalled()
    runs.prediction = [task('prediction', { status: 'done', finishedAt: Date.parse('2026-10-15T15:02:00Z') })]
    expect(await coordinator.status('prediction')).toMatchObject({ state: 'success', runId: 'run-prediction', updatedAt: '2026-10-15T15:02:00.000Z' })
    expect((await coordinator.status('prediction')).message).toContain('发布记录单独验证')
    runs.prediction = [task('prediction', { status: 'failed' })]
    expect((await coordinator.status('prediction')).state).toBe('failed')
  })

  it('rechecks current defaults rather than continuing a previously selected desk', async () => {
    const { service } = await fixture(), coordinator = createMarketResearchLoopCoordinator(service)
    await coordinator.ensure()
    expect((await coordinator.status('prediction')).workspaceId).toBe('prediction')
    vi.mocked(readAutoPredictionPreferences).mockResolvedValue({ defaultWorkspaceId: 'unregistered' })
    expect(await coordinator.run('prediction')).toMatchObject({ state: 'blocked', workspaceId: null, runId: null })
  })

  it('routes both roles through the authoritative frozen input and feedback publication tool', () => {
    for (const [role, prompt] of Object.entries(RESEARCH_LOOP_PROMPTS)) {
      expect(prompt).toContain(`本任务角色是 ${role}`)
      expect(prompt).toContain('AGENTS.md、README')
      expect(prompt).toContain('alice intelligence input')
      expect(prompt).toContain('alice intelligence publish-research --inputId <input.id> --feedback <JSON对象>')
      expect(prompt).toContain('Python subprocess 参数数组')
      expect(prompt).toContain('不得自报 provenance、runId 或 Session')
      expect(prompt).toContain('冻结 input.evidence')
      expect(prompt).toContain('不能补造缺失资料')
      expect(prompt).toContain('不修改项目代码、策略权重、旧预测或历史成绩')
      for (const field of ['summary', 'horizon', 'conclusion', 'supportingEvidenceIds', 'opposingEvidenceIds', 'confirmation', 'invalidation', 'limitations', 'recommendations']) expect(prompt).toContain(field)
    }
    expect(RESEARCH_LOOP_PROMPTS.prediction).toContain('事件、机制、条件假说和反证')
    expect(RESEARCH_LOOP_PROMPTS.prediction).toContain('不使用多个 AI 一致来投票')
    expect(RESEARCH_LOOP_PROMPTS.quant).toContain('matched')
    expect(RESEARCH_LOOP_PROMPTS.quant).toContain('Brier')
    expect(RESEARCH_LOOP_PROMPTS.quant).toContain('重复和重叠窗口')
    expect(RESEARCH_LOOP_PROMPTS.quant).toContain('archive-audit')
    expect(RESEARCH_LOOP_PROMPTS.quant).toContain('不是 Core backtest')
  })
})
