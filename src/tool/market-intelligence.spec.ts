import type { Tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceToolContext } from '../core/workspace-tool-center.js'
import type { IntelligenceService } from '../domain/market-monitor/intelligence-service.js'
import { INTELLIGENCE_ISSUE_ID } from '../domain/market-monitor/intelligence-types.js'
import { createMarketIntelligenceToolFactories } from './market-intelligence.js'
import { resolveCommand } from '../server/cli-commands.js'
const execute = (t: Tool, args: Record<string, unknown>) => t.execute!(args, { toolCallId: 'test', messages: [] })
function ctx(kind = 'authorized'): WorkspaceToolContext {
  return { workspaceId: 'workspace', workspaceLabel: 'test', inboxStore: {} as never, entityStore: {} as never,
    ...(kind === 'missing' ? {} : { callerRun: { taskId: 'native-run', status: kind === 'finished' ? 'done' : 'running', agent: 'codex', model: 'native-model', trigger: { kind: 'issue', workspaceId: kind === 'wrong-workspace' ? 'other' : 'workspace', issueId: kind === 'wrong-issue' ? 'other' : INTELLIGENCE_ISSUE_ID } } }) }
}
describe('native investment publication boundary', () => {
  it.each(['missing', 'wrong-workspace', 'wrong-issue', 'finished'])('denies private input and both publications for %s', async kind => {
    const service = { nativeInput: vi.fn(), publishResearch: vi.fn(), publishSynthesis: vi.fn() } as unknown as IntelligenceService
    const tools = createMarketIntelligenceToolFactories(service)
    for (const factory of tools) expect(await execute(factory.build(ctx(kind)), {})).toMatchObject({ ok: false })
    expect(service.nativeInput).not.toHaveBeenCalled(); expect(service.publishResearch).not.toHaveBeenCalled(); expect(service.publishSynthesis).not.toHaveBeenCalled()
  })
  it('derives run provenance from authenticated context and exports all three through alice', async () => {
    const service = { nativeInput: vi.fn(async () => ({ id: 'frozen' })) } as unknown as IntelligenceService
    const factories = createMarketIntelligenceToolFactories(service)
    expect(await execute(factories[0]!.build(ctx()), {})).toMatchObject({ ok: true, result: { id: 'frozen' } })
    expect(service.nativeInput).toHaveBeenCalledWith({ workspaceId: 'workspace', runId: 'native-run', issueId: INTELLIGENCE_ISSUE_ID, agent: 'codex', model: 'native-model' })
    expect(resolveCommand('data', 'intelligence', 'input')).toBe(factories[0]!.name)
    expect(resolveCommand('data', 'intelligence', 'publish-research')).toBe(factories[1]!.name)
    expect(resolveCommand('data', 'intelligence', 'publish-synthesis')).toBe(factories[2]!.name)
  })
})
