import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readWorkspaceIssues } from '../workspaces/issues/declaration.js'
import { updateIssueFields } from '../workspaces/issues/mutate.js'
import type { WorkspaceService } from '../workspaces/service.js'
import { INTELLIGENCE_ISSUE_ID } from '../domain/market-monitor/intelligence-types.js'
import { createMarketIntelligenceCoordinator, INTELLIGENCE_PROMPT } from './market-intelligence-coordinator.js'
vi.mock('../core/preferences.js', () => ({ readQuickChatPreferences: vi.fn(async () => ({ recentChatWorkspaceId: 'chat' })) }))
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'investment-coordinator-')); roots.push(dir)
  const workspace = { id: 'chat', tag: 'Chat', dir }
  const run = vi.fn(async () => undefined)
  const service = { registry: { get: () => workspace, list: () => [workspace] }, resolveOrCreateChatWorkspace: vi.fn(async () => ({ ok: true, workspace })), runIssueNow: run,
    issueDetail: vi.fn(async (_ws, id) => { const result = await readWorkspaceIssues(dir); const issue = result.ok && result.issues.find(row => row.id === id); return issue ? { issue, runs: [] } : null }) } as unknown as WorkspaceService
  return { dir, run, service }
}
describe('single native investment Issue', () => {
  it('creates one scheduled Issue that inherits runtime and respects later owner selections', async () => {
    const { dir, service } = await fixture(), c = createMarketIntelligenceCoordinator(service)
    await c.ensure(); await c.ensure()
    const read = await readWorkspaceIssues(dir)
    expect(read.ok && read.issues).toHaveLength(1)
    const issue = read.ok && read.issues[0]
    expect(issue).toMatchObject({ id: INTELLIGENCE_ISSUE_ID, assignee: '@new-each-run', when: { kind: 'cron', catchUp: true } })
    expect(issue && issue.agent).toBeUndefined(); expect(issue && issue.model).toBeUndefined()
    await updateIssueFields(dir, INTELLIGENCE_ISSUE_ID, { agent: 'claude', model: 'owner-model', effort: 'high', status: 'canceled' })
    await c.ensure()
    const after = await readWorkspaceIssues(dir)
    expect(after.ok && after.issues[0]).toMatchObject({ agent: 'claude', model: 'owner-model', effort: 'high', status: 'canceled' })
    expect((await c.run()).state).toBe('blocked')
  })
  it('preregisters the v2 uncertainty, independent evidence and horizon discipline in the native prompt', () => {
    expect(INTELLIGENCE_PROMPT).toContain('investment-intelligence-v3')
    expect(INTELLIGENCE_PROMPT).toContain('uncertain（暂不判断）')
    expect(INTELLIGENCE_PROMPT).toContain('不重复计票')
    expect(INTELLIGENCE_PROMPT).toContain('trend.<horizon>')
    expect(INTELLIGENCE_PROMPT).toContain('不得以多个 AI 同意来代替验证')
    expect(INTELLIGENCE_PROMPT).toContain('不修改旧预测')
  })
  it('dispatches through the existing native scheduler, without a new model client', async () => {
    const { service, run } = await fixture(), c = createMarketIntelligenceCoordinator(service)
    await c.run(); expect(run).toHaveBeenCalledWith('chat', INTELLIGENCE_ISSUE_ID)
  })
})
