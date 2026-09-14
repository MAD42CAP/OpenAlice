import { tool } from 'ai'
import { z } from 'zod'

import type { WorkspaceToolContext, WorkspaceToolFactory } from '../core/workspace-tool-center.js'
import type { MarketMonitorService } from '../domain/market-monitor/service.js'
import { MARKET_DAILY_NARRATION_ISSUE_ID, MARKET_MONITOR_ASSETS } from '../domain/market-monitor/types.js'
export { MARKET_DAILY_NARRATION_ISSUE_ID } from '../domain/market-monitor/types.js'

const text = z.string().trim().min(1).max(4_000)
const list = z.array(z.string().trim().min(1).max(1_000)).max(8)

export function createMarketMonitorToolFactories(service: MarketMonitorService): WorkspaceToolFactory[] {
  return [
    {
      name: 'market_monitor_daily_input',
      build() {
        return tool({
          description: 'Refresh BTC, TSLA and MSTR read-only evidence, then return compact deterministic daily inputs. Skip assets marked already-published. This tool never places trades.',
          inputSchema: z.object({ assets: z.array(z.enum(MARKET_MONITOR_ASSETS)).min(1).max(MARKET_MONITOR_ASSETS.length).optional() }),
          execute: ({ assets }) => service.dailyNarrationInput(assets),
        })
      },
    },
    {
      name: 'market_monitor_publish_narration',
      build(ctx: WorkspaceToolContext) {
        return tool({
          description: 'Publish one Chinese Codex interpretation for the current deterministic daily period. Only the authorized MAD42Lab scheduled Codex Issue can write; duplicates are ignored.',
          inputSchema: z.object({
            asset: z.enum(MARKET_MONITOR_ASSETS),
            strategyId: z.string().trim().min(1).max(128),
            periodKey: z.string().trim().min(1).max(64),
            headline: text,
            summary: text,
            shortTerm: text,
            mediumTerm: text,
            longTerm: text,
            evidence: list,
            risks: list,
            watchFor: list,
          }),
          execute: async (input) => {
            const run = ctx.callerRun
            const trigger = run?.trigger
            if (!run || trigger?.kind !== 'issue' || trigger.issueId !== MARKET_DAILY_NARRATION_ISSUE_ID || trigger.workspaceId !== ctx.workspaceId || run.agent !== 'codex') {
              return { ok: false as const, error: 'Only the authorized scheduled Codex market narration Issue may publish.' }
            }
            try {
              const result = await service.publishNarration(input, {
                workspaceId: ctx.workspaceId,
                runId: run.taskId,
                issueId: trigger.issueId,
                agent: run.agent,
                ...(run.model ? { model: run.model } : {}),
                ...(run.effort ? { effort: run.effort } : {}),
              })
              return { ok: true as const, ...result }
            } catch (error) {
              return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
            }
          },
        })
      },
    },
  ]
}
