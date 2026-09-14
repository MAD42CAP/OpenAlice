import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readWorkspaceIssues } from '../workspaces/issues/declaration.js'
import type { WorkspaceService } from '../workspaces/service.js'
import { createMarketNarratorCoordinator, MARKET_NARRATION_CRON, MARKET_NARRATION_TIMEZONE } from './market-monitor-narrator.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'market-narrator-'))
  roots.push(dir)
  const workspace = { id: 'chat-1', tag: 'Chat', dir, createdAt: '2026-01-01T00:00:00Z', template: 'chat' }
  const runIssueNow = vi.fn(async () => undefined)
  const service = {
    registry: { get: (id: string) => id === workspace.id ? workspace : undefined, list: () => [workspace] },
    resolveOrCreateChatWorkspace: vi.fn(async () => ({ ok: true, workspace })),
    issueDetail: vi.fn(async (_wsId: string, id: string) => {
      const result = await readWorkspaceIssues(dir)
      if (!result.ok) return null
      const issue = result.issues.find((row) => row.id === id)
      return issue ? { issue, comments: [], runs: [], inboxReports: [], provenance: [], activity: [] } : null
    }),
    runIssueNow,
  } as unknown as WorkspaceService
  const deps = { readQuickChatPreferences: vi.fn(async () => ({ recentChatWorkspaceId: 'chat-1' })), rememberRecentChatWorkspace: vi.fn(async () => undefined) }
  return { dir, service, deps, runIssueNow }
}

describe('Codex daily market narrator coordinator', () => {
  it('creates one default-on native Codex Issue and reconciles idempotently', async () => {
    const { dir, service, deps } = await fixture()
    const coordinator = createMarketNarratorCoordinator(service, deps)
    await expect(coordinator.reconcile(true)).resolves.toMatchObject({ state: 'ready', workspaceId: 'chat-1' })
    await expect(coordinator.reconcile(true)).resolves.toMatchObject({ state: 'ready', workspaceId: 'chat-1' })
    const result = await readWorkspaceIssues(dir)
    expect(result.ok && result.issues).toHaveLength(1)
    expect(result.ok && result.issues[0]).toMatchObject({
      id: 'mad42lab-market-daily-interpretation', status: 'in_progress', assignee: '@new-each-run',
      agent: 'codex', credentialSource: 'native', effort: 'medium', timeout: '15m',
      when: { kind: 'cron', cron: MARKET_NARRATION_CRON, timezone: MARKET_NARRATION_TIMEZONE },
    })
  })

  it('can disable the Issue and dispatch an immediate run when enabled', async () => {
    const { service, deps, runIssueNow } = await fixture()
    const coordinator = createMarketNarratorCoordinator(service, deps)
    await coordinator.reconcile(true)
    await coordinator.runNow()
    expect(runIssueNow).toHaveBeenCalledWith('chat-1', 'mad42lab-market-daily-interpretation')
    await expect(coordinator.reconcile(false)).resolves.toMatchObject({ state: 'disabled' })
  })
})
