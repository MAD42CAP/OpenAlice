import { readQuickChatPreferences, rememberRecentChatWorkspace } from '../core/preferences.js'
import { MARKET_DAILY_NARRATION_ISSUE_ID } from '../domain/market-monitor/types.js'
import { createIssue, updateIssueFields } from '../workspaces/issues/mutate.js'
import type { WorkspaceService } from '../workspaces/service.js'

export const MARKET_NARRATION_CRON = '30 17 * * *'
export const MARKET_NARRATION_TIMEZONE = 'America/Vancouver'

const ISSUE_TITLE = 'MAD42Lab 每日市场解读'
const ISSUE_WHAT = `你是 MAD42Lab 的每日市场解读员。本任务只做研究解读，不交易、不下单，也不修改确定性分析结果。

每次运行必须：
1. 调用 Workspace 工具 market_monitor_daily_input，刷新并读取 BTC、TSLA 与 MSTR 的当天结构化证据。
2. 对 status=ready 的每个资产分别生成一份简体中文解读；status=already-published 的资产必须跳过，status=failed 的资产说明失败原因。
3. 每份解读都要清楚区分事实与解释，并覆盖：一句话标题、总体总结、短期、中期、长期、关键证据、风险/反证、下一步观察条件。威科夫阶段只能称为“候选”，不得把“主力意图”写成事实。
4. 调用 Workspace 工具 market_monitor_publish_narration 逐份发布。asset、strategyId、periodKey 必须原样采用输入工具返回值；不得猜测或改写。
5. 最后调用 inbox_push，向用户发送一条简短中文摘要，注明哪些资产已发布、跳过或失败，并提醒这不是投资建议。

不得使用未来数据，不得伪造缺失数据，不得把 AI 文字反写为趋势分数或威科夫确认事件。`

export interface MarketNarratorStatus {
  enabled: boolean
  state: 'ready' | 'disabled' | 'blocked' | 'failed'
  issueId: string
  workspaceId?: string
  workspaceLabel?: string
  schedule: { cron: string; timezone: string; localTime: string }
  message: string
  nextRunAt?: string | null
  lastRun?: {
    taskId: string
    status: string
    startedAt: string
    finishedAt?: string
    model?: string
    effort?: string
    error?: string
  }
}

export interface MarketNarratorCoordinator {
  reconcile(enabled: boolean): Promise<MarketNarratorStatus>
  status(enabled: boolean): Promise<MarketNarratorStatus>
  runNow(): Promise<MarketNarratorStatus>
}

export interface MarketNarratorCoordinatorDeps {
  readQuickChatPreferences(): Promise<{ recentChatWorkspaceId: string | null }>
  rememberRecentChatWorkspace(workspaceId: string): Promise<unknown>
}

function base(enabled: boolean): Pick<MarketNarratorStatus, 'enabled' | 'issueId' | 'schedule'> {
  return {
    enabled,
    issueId: MARKET_DAILY_NARRATION_ISSUE_ID,
    schedule: { cron: MARKET_NARRATION_CRON, timezone: MARKET_NARRATION_TIMEZONE, localTime: '17:30' },
  }
}

export function createMarketNarratorCoordinator(service: WorkspaceService, deps: MarketNarratorCoordinatorDeps = {
  readQuickChatPreferences,
  rememberRecentChatWorkspace,
}): MarketNarratorCoordinator {
  let workspaceId: string | null = null

  const findWorkspace = async (): Promise<string | null> => {
    if (workspaceId && service.registry.get(workspaceId)) return workspaceId
    for (const workspace of service.registry.list()) {
      if (await service.issueDetail(workspace.id, MARKET_DAILY_NARRATION_ISSUE_ID)) {
        workspaceId = workspace.id
        return workspaceId
      }
    }
    return null
  }

  const resolveWorkspace = async () => {
    const existing = await findWorkspace()
    if (existing) return service.registry.get(existing)!
    const preference = await deps.readQuickChatPreferences().catch(() => ({ recentChatWorkspaceId: null }))
    const resolution = await service.resolveOrCreateChatWorkspace(preference.recentChatWorkspaceId)
    if (!resolution.ok) throw new Error(`Chat workspace unavailable: ${resolution.message}`)
    workspaceId = resolution.workspace.id
    await deps.rememberRecentChatWorkspace(workspaceId).catch(() => undefined)
    return resolution.workspace
  }

  const project = async (enabled: boolean): Promise<MarketNarratorStatus> => {
    const id = await findWorkspace()
    if (!id) return { ...base(enabled), state: enabled ? 'blocked' : 'disabled', message: enabled ? '等待创建 Codex 每日解读任务。' : 'Codex 每日解读已关闭。' }
    const workspace = service.registry.get(id)
    const detail = await service.issueDetail(id, MARKET_DAILY_NARRATION_ISSUE_ID)
    if (!workspace || !detail) return { ...base(enabled), state: 'failed', message: '每日解读任务不存在。' }
    const latest = detail.runs[0]
    const automation = detail.issue.automationHealth
    const runtimeMissing = automation?.blocker?.kind === 'agent_runtime_missing'
    const state = !enabled || detail.issue.status === 'canceled'
      ? 'disabled'
      : runtimeMissing ? 'blocked'
      : automation?.state === 'failed' || automation?.state === 'interrupted' ? 'failed'
      : 'ready'
    return {
      ...base(enabled), state, workspaceId: id, workspaceLabel: workspace.tag,
      message: state === 'ready' ? 'Codex 每日解读已启用。' : state === 'disabled' ? 'Codex 每日解读已关闭。' : automation?.message ?? 'Codex 每日解读需要处理。',
      nextRunAt: detail.issue.nextDueAtMs == null ? null : new Date(detail.issue.nextDueAtMs).toISOString(),
      ...(latest ? { lastRun: {
        taskId: latest.taskId, status: latest.status, startedAt: new Date(latest.startedAt).toISOString(),
        ...(latest.finishedAt ? { finishedAt: new Date(latest.finishedAt).toISOString() } : {}),
        ...(latest.model ? { model: latest.model } : {}), ...(latest.effort ? { effort: latest.effort } : {}),
        ...(latest.error ? { error: latest.error } : {}),
      } } : {}),
    }
  }

  return {
    async reconcile(enabled) {
      try {
        if (!enabled) {
          const id = await findWorkspace()
          if (id) {
            const workspace = service.registry.get(id)!
            await updateIssueFields(workspace.dir, MARKET_DAILY_NARRATION_ISSUE_ID, { status: 'canceled' })
          }
          return project(false)
        }
        const workspace = await resolveWorkspace()
        const patch = {
          status: 'in_progress' as const,
          priority: 'medium' as const,
          assignee: '@new-each-run',
          when: { kind: 'cron', cron: MARKET_NARRATION_CRON, timezone: MARKET_NARRATION_TIMEZONE, catchUp: true },
          what: ISSUE_WHAT,
          agent: 'codex',
          credential: null,
          credentialSource: 'native' as const,
          model: null,
          effort: 'medium' as const,
          timeout: '15m' as const,
        }
        const existing = await service.issueDetail(workspace.id, MARKET_DAILY_NARRATION_ISSUE_ID)
        if (existing) {
          const updated = await updateIssueFields(workspace.dir, MARKET_DAILY_NARRATION_ISSUE_ID, patch)
          if (!updated.ok) throw new Error(updated.reason === 'invalid' ? updated.error : 'Daily narration Issue not found')
        } else {
          const created = await createIssue(workspace.dir, {
            id: MARKET_DAILY_NARRATION_ISSUE_ID, title: ISSUE_TITLE,
            status: patch.status, priority: patch.priority, assignee: patch.assignee, when: patch.when,
            what: patch.what, agent: patch.agent, credentialSource: patch.credentialSource,
            effort: patch.effort, timeout: patch.timeout,
          })
          if (!created.ok) throw new Error(created.reason === 'conflict' ? 'Daily narration Issue id is already occupied' : created.error)
        }
        return project(true)
      } catch (error) {
        return { ...base(enabled), state: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
    },
    status: project,
    async runNow() {
      const id = await findWorkspace()
      if (!id) throw new Error('Codex daily narration is not configured')
      await service.runIssueNow(id, MARKET_DAILY_NARRATION_ISSUE_ID)
      return project(true)
    },
  }
}
