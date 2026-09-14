import type { Tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import type { MarketMonitorService } from '../domain/market-monitor/service.js'
import { createMarketMonitorToolFactories, MARKET_DAILY_NARRATION_ISSUE_ID } from './market-monitor.js'

async function run(tool: Tool, args: Record<string, unknown>) {
  return tool.execute!(args, { toolCallId: 'test', messages: [] })
}

function context(over: Partial<WorkspaceToolContext> = {}): WorkspaceToolContext {
  return { workspaceId: 'chat-1', workspaceLabel: 'Chat', inboxStore: {} as never, entityStore: {} as never, ...over }
}

function service(): MarketMonitorService {
  return {
    dailyNarrationInput: vi.fn(async () => ({ generatedAt: '2026-04-01T00:00:00Z', strategyId: 'evidence-chain-v1', assets: [] })),
    publishNarration: vi.fn(async (input, provenance) => ({ stored: true, narration: { ...input, id: 'n-1', promptVersion: 'codex-daily-v1', generatedAt: '2026-04-01T00:00:00Z', language: 'zh-CN', agent: 'codex', provenance } as never })),
  } as unknown as MarketMonitorService
}

const narration = { asset: 'BTC', strategyId: 'evidence-chain-v1', periodKey: '2026-03-31', headline: '标题', summary: '总结', shortTerm: '短期', mediumTerm: '中期', longTerm: '长期', evidence: [], risks: [], watchFor: [] }

describe('market monitor Workspace tools', () => {
  it('refreshes deterministic daily input without accepting write provenance from the agent', async () => {
    const svc = service()
    const input = createMarketMonitorToolFactories(svc).find((factory) => factory.name === 'market_monitor_daily_input')!
    await expect(run(input.build(context()), { assets: ['BTC'] })).resolves.toMatchObject({ strategyId: 'evidence-chain-v1' })
    expect(svc.dailyNarrationInput).toHaveBeenCalledWith(['BTC'])
  })

  it('allows only the exact scheduled Codex Issue to publish', async () => {
    const svc = service()
    const publish = createMarketMonitorToolFactories(svc).find((factory) => factory.name === 'market_monitor_publish_narration')!
    await expect(run(publish.build(context()), narration)).resolves.toMatchObject({ ok: false })
    const authorized = context({ callerRun: { taskId: 'run-1', status: 'running', agent: 'codex', trigger: { kind: 'issue', workspaceId: 'chat-1', issueId: MARKET_DAILY_NARRATION_ISSUE_ID } } })
    await expect(run(publish.build(authorized), narration)).resolves.toMatchObject({ ok: true, stored: true })
    expect(svc.publishNarration).toHaveBeenCalledWith(expect.objectContaining({ asset: 'BTC' }), expect.objectContaining({ workspaceId: 'chat-1', runId: 'run-1', agent: 'codex' }))
  })
})
