'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { Sparkles } from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import {
  useNextAiColleagueStore,
  type ColleagueMessage,
  type ColleagueToolExecution,
} from '@/stores/next-ai-colleague-store'
import { AiColleagueLiveAnswerBubble } from './AiColleagueLiveAnswer'
import { toNextTrackPath } from '@/lib/next/next-track-path'
import { COLLEAGUE_QUICK_ENTRIES } from '@/lib/next/ai-colleague-intent'
import { NavigationResultCard, type NavigationResultData } from './cards/NavigationResultCard'
import { ProjectSummaryCard, type ProjectSummaryData } from './cards/ProjectSummaryCard'
import { TaskListCard, type TaskListCardData } from './cards/TaskListCard'
import { QuestionCard } from './cards/QuestionCard'
import { RiskListCard, type RiskListCardData } from './cards/RiskListCard'
import {
  ActionPreviewCard,
  type ActionPreviewDiff,
  type ActionPreviewPhase,
} from './cards/ActionPreviewCard'
import { AiErrorCard } from './cards/AiErrorCard'
import { ClientActionResultCard } from './cards/ClientActionResultCard'
import { MyWorkCard, type MyWorkCardData } from './cards/MyWorkCard'
import {
  hasMemberAlias,
  resolveMemberAliases,
  useMemberAliasNames,
} from '@/hooks/use-member-alias-names'
import { IntentSourceContext } from './cards/RuleMatchBadge'
import { TaskStatusPreviewCard, type TaskStatusPreviewDiff } from './cards/TaskStatusPreviewCard'
import { FallbackDataCard } from './cards/FallbackDataCard'
import { TrizContradictionCard } from './cards/TrizContradictionCard'
import { AiGlobalSearchResultCard } from './cards/AiGlobalSearchResultCard'
import { AiMorningBriefingCard } from './cards/AiMorningBriefingCard'
import type { MorningBriefingData } from '@/lib/next/ai-morning-briefing'
import type { SearchResultItem } from '@aiproj/types'

/**
 * AI 同事消息时间线容器与空态引导（v3-ui-next-ai-colleague W2 · tasks 2.3）。
 *
 * - 平滑滚动容器 + `aria-live="polite"` / `aria-relevant="additions"` 读屏播报；
 * - 空态：HUD「开项 AI 同事」徽标、能力愿景简述与 4 个预置快捷引导动作
 *   （label 文案 + fill 输入均由 W1 的 `COLLEAGUE_QUICK_ENTRIES` 单一来源提供），
 *   点击即作为一条用户消息发送（经 `onQuickAction` 上抛）；
 * - 时间正序渲染：用户消息右侧天青小标气泡；AI 侧 HUD 发丝线容器按
 *   `toolExecution` 状态分发 —— 初始执行中为发丝线呼吸行，结果到达后进入
 *   W3 卡片族分发（导航/摘要/任务/风险/写预览/错误/兜底键值对），全部经
 *   W1 Store action 接线（确认、取消、409 重新演练）；
 * - `navigate_to_space` 成功即自动 `router.push(data.path)` 直达（design「导航
 *   结果直达跳转与反馈」2），按消息 id 去重防重复跳转；
 * - 精确档（precise）停用全部呼吸/脉动动画，交互与数据 100% 等价。
 */

export interface AiColleagueMessageListProps {
  /** 空态快捷引导点击：label 的 fill 值作为输入发送（父层经 Store submitUserMessage 分发）。 */
  onQuickAction: (text: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 该 AI 消息之前最近的用户消息文本（错误重试时重发同一条指令）。 */
function findPrecedingUserText(
  messages: readonly ColleagueMessage[],
  index: number,
): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = messages[i]
    if (!candidate) continue
    if (
      candidate.sender === 'user' &&
      typeof candidate.content === 'string' &&
      candidate.content.trim() !== ''
    ) {
      return candidate.content
    }
  }
  return null
}

function asPreviewDiff(diff: unknown): ActionPreviewDiff {
  return isRecord(diff) ? (diff as unknown as ActionPreviewDiff) : {}
}

/** 普通消息里的成员代号〔成员·编码〕换回真实姓名（模型只看得到代号）。 */
function MemberAliasText({ text }: { text: string }) {
  const hasAliases = hasMemberAlias(text)
  const names = useMemberAliasNames(hasAliases ? text : '')
  return <>{hasAliases ? resolveMemberAliases(text, names) : text}</>
}

/** AI 结果卡片槽位（W3 装配）：按工具名 + 状态分发到对应结果卡片。 */
function ColleagueToolCard({
  execution,
  onConfirm,
  onCancel,
  onRetry,
  onRetryMessage,
  onOpenTask,
}: {
  execution: ColleagueToolExecution
  onConfirm: () => void
  onCancel: () => void
  onRetry: () => void
  /** 执行/确认失败的重试入口（有令牌=重试确认，无令牌=重发原用户消息）。 */
  onRetryMessage: () => void
  /** 任务条目联动（关闭面板 + 导航聚焦）。 */
  onOpenTask: (taskId: number) => void
}) {
  const { toolName, status, data, diff, error, durationMs, cancelNote } = execution

  // 写工具 `update_setting`（用自然语言改设置）：复用状态预览卡，显示改前改后与所属层级
  if (toolName === 'update_setting') {
    if (status === 'error' && error?.status !== 409) {
      return (
        <AiErrorCard
          status={error?.status ?? null}
          code={error?.code ?? null}
          message={error?.message ?? null}
          toolName={toolName}
          onRetry={onRetryMessage}
        />
      )
    }
    const raw = (isRecord(diff) ? diff : isRecord(data) ? data : {}) as {
      label?: string
      layerLabel?: string
      beforeText?: string
      afterText?: string
      noop?: boolean
    }
    const label = raw.label ?? '设置'
    return (
      <div data-setting-preview>
        <TaskStatusPreviewCard
          toolName={toolName}
          title={raw.layerLabel ? `${raw.layerLabel} · ${label}` : label}
          diff={{ fromLabel: raw.beforeText, toLabel: raw.afterText, noop: raw.noop }}
          noopText="这项设置已经是这个值，确认后不会有改动。"
          committedText={`已修改${label}`}
          conflictText="这项设置在预览后已被改过，本次没有写入。请重新预览。"
          note="确认后才会生效，并记入审计日志。"
          phase={
            status === 'error'
              ? 'conflict'
              : status === 'preview_required'
                ? 'preview'
                : status === 'committed' || status === 'success'
                  ? 'committed'
                  : status === 'cancelled'
                    ? 'cancelled'
                    : 'committing'
          }
          cancelNote={cancelNote ?? null}
          onConfirm={onConfirm}
          onCancel={onCancel}
          onRetry={onRetry}
        />
      </div>
    )
  }

  // 写工具 `delete_task`（移入回收站）：复用状态预览卡，说明依赖影响与可恢复期限
  if (toolName === 'delete_task') {
    if (status === 'error' && error?.status !== 409) {
      return (
        <AiErrorCard
          status={error?.status ?? null}
          code={error?.code ?? null}
          message={error?.message ?? null}
          toolName={toolName}
          onRetry={onRetryMessage}
        />
      )
    }
    const raw = (isRecord(diff) ? diff : isRecord(data) ? data : {}) as {
      taskId?: number
      taskCode?: string
      taskName?: string
      statusLabel?: string
      successorCount?: number
      predecessorCount?: number
      restoreWindowDays?: number
    }
    const links = (raw.successorCount ?? 0) + (raw.predecessorCount ?? 0)
    return (
      <TaskStatusPreviewCard
        toolName={toolName}
        diff={{
          taskId: raw.taskId,
          taskCode: raw.taskCode,
          taskName: raw.taskName,
          fromLabel: raw.statusLabel ?? '现有任务',
          toLabel: '移入回收站',
        }}
        note={[
          links > 0 ? `它有 ${links} 条前后置依赖，删除后这些依赖不再生效。` : null,
          `删除后 ${raw.restoreWindowDays ?? 30} 天内可在「回收站」恢复。`,
        ]
          .filter(Boolean)
          .join('')}
        committedText="已删除（移入回收站，可在回收站恢复）"
        phase={
          status === 'error'
            ? 'conflict'
            : status === 'preview_required'
              ? 'preview'
              : status === 'committed' || status === 'success'
                ? 'committed'
                : status === 'cancelled'
                  ? 'cancelled'
                  : 'committing'
        }
        cancelNote={cancelNote ?? null}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onRetry={onRetry}
      />
    )
  }

  // 写工具 `update_task_assignee`（指派给某人 / 取消指派）：复用状态预览卡，显示真实姓名
  if (toolName === 'update_task_assignee') {
    if (status === 'error' && error?.status !== 409) {
      return (
        <AiErrorCard
          status={error?.status ?? null}
          code={error?.code ?? null}
          message={error?.message ?? null}
          toolName={toolName}
          onRetry={onRetryMessage}
        />
      )
    }
    const raw = (isRecord(diff) ? diff : isRecord(data) ? data : {}) as {
      taskId?: number
      taskCode?: string
      taskName?: string
      from?: { name?: string } | null
      to?: { name?: string } | null
      noop?: boolean
    }
    const toLabel = raw.to?.name ?? '未指派'
    return (
      <TaskStatusPreviewCard
        toolName={toolName}
        diff={{
          taskId: raw.taskId,
          taskCode: raw.taskCode,
          taskName: raw.taskName,
          fromLabel: raw.from?.name ?? '未指派',
          toLabel,
          noop: raw.noop,
        }}
        noopText="负责人没有变化，确认后不会有改动。"
        committedText={raw.to ? `已指派给「${toLabel}」` : '已取消指派'}
        phase={
          status === 'error'
            ? 'conflict'
            : status === 'preview_required'
              ? 'preview'
              : status === 'committed' || status === 'success'
                ? 'committed'
                : status === 'cancelled'
                  ? 'cancelled'
                  : 'committing'
        }
        cancelNote={cancelNote ?? null}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onRetry={onRetry}
      />
    )
  }

  // 写工具 `create_task`（新建任务）：复用状态预览卡，列出日期、负责人、父任务与执行步骤
  if (toolName === 'create_task') {
    if (status === 'error') {
      return (
        <AiErrorCard
          status={error?.status ?? null}
          code={error?.code ?? null}
          message={error?.message ?? null}
          toolName={toolName}
          onRetry={onRetryMessage}
        />
      )
    }
    const raw = (isRecord(data) ? data : isRecord(diff) ? diff : {}) as {
      taskId?: number
      taskCode?: string
      projectName?: string
      name?: string
      startDate?: string | null
      endDate?: string | null
      priorityLabel?: string
      assignee?: { name?: string } | null
      parent?: { code?: string; name?: string } | null
      steps?: string[]
    }
    const steps = Array.isArray(raw.steps) ? raw.steps.map(String) : []
    return (
      <TaskStatusPreviewCard
        toolName={toolName}
        diff={{
          taskId: raw.taskId,
          taskCode: raw.taskCode ?? `新任务${raw.projectName ? `（${raw.projectName}）` : ''}`,
          taskName: raw.name,
          fromLabel: '不存在',
          toLabel: '新建任务',
        }}
        note={[
          raw.startDate || raw.endDate
            ? `日期：${raw.startDate ?? '未定'} → ${raw.endDate ?? '未定'}。`
            : '日期：未定。',
          `负责人：${raw.assignee?.name ?? '未指派'}。`,
          raw.priorityLabel ? `优先级：${raw.priorityLabel}。` : null,
          raw.parent ? `父任务：${raw.parent.code ?? ''} ${raw.parent.name ?? ''}。` : null,
        ]
          .filter(Boolean)
          .join('')}
        details={steps.map((step, index) => `${index + 1}. ☐ ${step}`)}
        committedText={`已新建任务${raw.taskCode ? ` ${raw.taskCode}` : ''}`}
        phase={
          status === 'preview_required'
            ? 'preview'
            : status === 'committed' || status === 'success'
              ? 'committed'
              : status === 'cancelled'
                ? 'cancelled'
                : 'committing'
        }
        cancelNote={cancelNote ?? null}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onRetry={onRetry}
      />
    )
  }

  // 写工具 `toggle_task_steps`（执行步骤打勾 / 取消打勾）：列出改动的步骤、进度与状态变化
  if (toolName === 'toggle_task_steps') {
    if (status === 'error' && error?.status !== 409) {
      return (
        <AiErrorCard
          status={error?.status ?? null}
          code={error?.code ?? null}
          message={error?.message ?? null}
          toolName={toolName}
          onRetry={onRetryMessage}
        />
      )
    }
    const raw = (isRecord(data) ? data : isRecord(diff) ? diff : {}) as {
      taskId?: number
      taskCode?: string
      taskName?: string
      changes?: Array<{ n?: number; text?: string; to?: boolean }>
      doneCount?: number
      totalCount?: number
      progressBefore?: number
      progressAfter?: number
      statusFromLabel?: string
      statusToLabel?: string | null
    }
    const changes = Array.isArray(raw.changes) ? raw.changes : []
    return (
      <TaskStatusPreviewCard
        toolName={toolName}
        diff={{
          taskId: raw.taskId,
          taskCode: raw.taskCode,
          taskName: raw.taskName,
          fromLabel: `${raw.progressBefore ?? 0}%`,
          toLabel: `${raw.progressAfter ?? 0}%（${raw.doneCount ?? 0}/${raw.totalCount ?? 0} 步）`,
        }}
        details={changes.map(
          (change) =>
            `${change.to ? '☑ 打勾' : '☐ 取消打勾'} 第 ${change.n ?? '?'} 步：${change.text ?? ''}`,
        )}
        note={
          raw.statusToLabel
            ? `状态会从「${raw.statusFromLabel ?? ''}」改为「${raw.statusToLabel}」。`
            : null
        }
        committedText={`已更新执行步骤（${raw.doneCount ?? 0}/${raw.totalCount ?? 0} 步完成）`}
        phase={
          status === 'error'
            ? 'conflict'
            : status === 'preview_required'
              ? 'preview'
              : status === 'committed' || status === 'success'
                ? 'committed'
                : status === 'cancelled'
                  ? 'cancelled'
                  : 'committing'
        }
        cancelNote={cancelNote ?? null}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onRetry={onRetry}
      />
    )
  }

  // 写工具 `update_task_status`（勾选完成 / 移到进行中…）：状态预览卡承载全生命周期
  if (toolName === 'update_task_status') {
    if (status === 'error' && error?.status !== 409) {
      return (
        <AiErrorCard
          status={error?.status ?? null}
          code={error?.code ?? null}
          message={error?.message ?? null}
          toolName={toolName}
          onRetry={onRetryMessage}
        />
      )
    }
    const statusDiff = (isRecord(diff) ? diff : isRecord(data) ? data : {}) as TaskStatusPreviewDiff
    return (
      <TaskStatusPreviewCard
        toolName={toolName}
        diff={statusDiff}
        phase={
          status === 'error'
            ? 'conflict'
            : status === 'preview_required'
              ? 'preview'
              : status === 'committed' || status === 'success'
                ? 'committed'
                : status === 'cancelled'
                  ? 'cancelled'
                  : 'committing'
        }
        cancelNote={cancelNote ?? null}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onRetry={onRetry}
      />
    )
  }

  // 写工具 `update_task_schedule`：预览卡承载全生命周期
  //（preview → committing → committed / cancelled / conflict），409 冲突留驻现场。
  if (toolName === 'update_task_schedule') {
    if (status === 'error' && error?.status === 409) {
      return (
        <ActionPreviewCard
          toolName={toolName}
          diff={asPreviewDiff(diff)}
          phase="conflict"
          conflictCode={error.code ?? 'SCHEDULE_STALE'}
          cancelNote={cancelNote ?? null}
          onCancel={onCancel}
          onRetry={onRetry}
        />
      )
    }
    if (status === 'error') {
      return (
        <AiErrorCard
          status={error?.status ?? null}
          code={error?.code ?? null}
          message={error?.message ?? null}
          toolName={toolName}
          onRetry={onRetryMessage}
        />
      )
    }
    const phase: ActionPreviewPhase =
      status === 'preview_required'
        ? 'preview'
        : status === 'committed' || status === 'success'
          ? 'committed'
          : status === 'cancelled'
            ? 'cancelled'
            : 'committing'
    return (
      <ActionPreviewCard
        toolName={toolName}
        diff={asPreviewDiff(diff)}
        phase={phase}
        committedMeta={{ durationMs: durationMs ?? null, affectedCount: null }}
        cancelNote={cancelNote ?? null}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onRetry={onRetry}
      />
    )
  }

  // 其余工具错误 → AiErrorCard（403/404/409/超时由 HTTP status 推导，RL-05 中性 404）；
  // 409 走「重新演练」，其余（网络/超时/5xx）走重试入口，杜绝死链。
  if (status === 'error') {
    return (
      <AiErrorCard
        status={error?.status ?? null}
        code={error?.code ?? null}
        message={error?.message ?? null}
        toolName={toolName}
        onRetry={error?.status === 409 ? onRetry : onRetryMessage}
      />
    )
  }

  // 只读工具成功输出 → 强类型卡片；结构不符时回落通用键值对卡，绝不抛错
  switch (toolName) {
    case 'navigate_to_space': {
      if (isRecord(data) && typeof data.path === 'string') {
        return (
          <NavigationResultCard
            data={data as unknown as NavigationResultData}
            toolName={toolName}
          />
        )
      }
      break
    }
    case 'get_project_summary': {
      if (isRecord(data)) {
        return (
          <ProjectSummaryCard data={data as unknown as ProjectSummaryData} toolName={toolName} />
        )
      }
      break
    }
    case 'list_project_tasks': {
      if (isRecord(data)) {
        return (
          <TaskListCard
            data={data as unknown as TaskListCardData}
            toolName={toolName}
            onOpenTask={onOpenTask}
          />
        )
      }
      break
    }
    case 'list_project_risks': {
      if (isRecord(data)) {
        return <RiskListCard data={data as unknown as RiskListCardData} toolName={toolName} />
      }
      break
    }
    case 'search_global_entities': {
      if (isRecord(data) || Array.isArray(data)) {
        return (
          <AiGlobalSearchResultCard
            data={data as unknown as SearchResultItem[]}
            toolName={toolName}
          />
        )
      }
      break
    }
    case 'get_my_work': {
      if (isRecord(data)) {
        return <MyWorkCard data={data as unknown as MyWorkCardData} toolName={toolName} />
      }
      break
    }
    case 'open_app_page': {
      if (isRecord(data) && typeof data.path === 'string') {
        return (
          <ClientActionResultCard
            toolName={toolName}
            title={`已为你打开「${typeof data.title === 'string' && data.title ? data.title : data.path}」`}
            path={data.path}
          />
        )
      }
      break
    }
    case 'capture_page': {
      if (isRecord(data) && typeof data.description === 'string') {
        return (
          <ClientActionResultCard
            toolName={toolName}
            title={`已看过当前页面（${typeof data.model === 'string' ? data.model : '看图模型'}）`}
            detail={data.description}
          />
        )
      }
      break
    }
    case 'sign_out': {
      return <ClientActionResultCard toolName={toolName} title="已退出登录，正在回到登录页" />
    }
    case 'start_project_generation': {
      if (isRecord(data) && typeof data.path === 'string') {
        return (
          <ClientActionResultCard
            toolName={toolName}
            title={`已打开生成剧场并开始生成：${typeof data.idea === 'string' ? data.idea : ''}。AI 若有问题会在剧场里追问；草案生成后由你审查确认才会成为正式项目`}
            path={data.path}
          />
        )
      }
      break
    }
    case 'set_ui_preference': {
      if (isRecord(data) && Array.isArray(data.labels)) {
        return (
          <ClientActionResultCard
            toolName={toolName}
            title={`已切换为${(data.labels as unknown[]).map((label) => `「${String(label)}」`).join('、')}`}
          />
        )
      }
      break
    }
    case 'get_morning_briefing': {
      return (
        <AiMorningBriefingCard
          data={isRecord(data) ? (data as unknown as MorningBriefingData) : undefined}
          toolName={toolName}
        />
      )
    }
    default:
      break
  }
  return <FallbackDataCard data={data} toolName={toolName} />
}

/** 初始执行中状态行：发丝线呼吸点 + 工具名（精确档停用脉动）。 */
function ColleagueExecutingRow({ toolName, precise }: { toolName: string; precise: boolean }) {
  return (
    <div
      data-tool-executing
      data-tool-name={toolName}
      role="status"
      className="flex items-center gap-2 overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5"
    >
      <span
        aria-hidden
        className={`h-1 w-1 shrink-0 rounded-full bg-[var(--nx-space-cyan)] ${precise ? '' : 'animate-pulse'}`}
      />
      <span className="text-[11px] text-[var(--nx-text-secondary)]">正在执行工具 {toolName} …</span>
    </div>
  )
}

/** 快捷引导动作网格（空态与未识别回退共用；点击以 fill 值作为输入发送）。 */
function ColleagueQuickActions({ onQuickAction }: { onQuickAction: (text: string) => void }) {
  return (
    <div className="grid w-full grid-cols-2 gap-2" aria-label="快捷引导动作">
      {COLLEAGUE_QUICK_ENTRIES.map((entry) => (
        <button
          key={entry.id}
          type="button"
          data-quick-action={entry.id}
          onClick={() => onQuickAction(entry.fill)}
          className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-2 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-space-cyan)]/50 hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <span aria-hidden>⚡</span> {entry.label}
        </button>
      ))}
    </div>
  )
}

export function AiColleagueMessageList({ onQuickAction }: AiColleagueMessageListProps) {
  const router = useRouter()
  const tier = useImmersionTier()
  const precise = tier === 'precise'

  const messages = useNextAiColleagueStore((state) => state.messages)
  // 只有最后一条助手消息上的追问卡可回答
  const lastAssistantIndex = React.useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.sender === 'assistant') return index
    }
    return -1
  }, [messages])
  const closePanel = useNextAiColleagueStore((state) => state.closePanel)
  const confirmPendingAction = useNextAiColleagueStore((state) => state.confirmPendingAction)
  const cancelPendingAction = useNextAiColleagueStore((state) => state.cancelPendingAction)
  const redrillPendingAction = useNextAiColleagueStore((state) => state.redrillPendingAction)
  // 矛盾求解卡组（W5）：澄清 / 选定 / 落库两阶段 / 改判全部经 Store 单一入口
  const answerTrizClarification = useNextAiColleagueStore((state) => state.answerTrizClarification)
  const selectTrizSolution = useNextAiColleagueStore((state) => state.selectTrizSolution)
  const previewTrizIntervention = useNextAiColleagueStore((state) => state.previewTrizIntervention)
  const retryTrizPreview = useNextAiColleagueStore((state) => state.retryTrizPreview)
  const confirmTrizIntervention = useNextAiColleagueStore((state) => state.confirmTrizIntervention)
  const cancelTrizIntervention = useNextAiColleagueStore((state) => state.cancelTrizIntervention)
  const overrideTrizParameters = useNextAiColleagueStore((state) => state.overrideTrizParameters)
  const retryTrizSolve = useNextAiColleagueStore((state) => state.retryTrizSolve)

  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const pushedNavIdsRef = React.useRef<Set<string>>(new Set())
  const { setTheme } = useTheme()
  const conversationId = useNextAiColleagueStore((state) => state.conversationId)
  const seenConversationRef = React.useRef<string | null>(null)

  // 新消息追加时平滑滚动到底部（最新位于底部，自底向上阅读流）。
  React.useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // 导航直达：navigate_to_space 成功后立即 router.push(data.path)（按消息 id 去重）。
  React.useEffect(() => {
    // 刚打开面板、切换分页或刷新恢复的对话：里面已有的跳转记录只是历史，不重放
    if (seenConversationRef.current !== conversationId) {
      seenConversationRef.current = conversationId
      for (const message of messages) pushedNavIdsRef.current.add(message.id)
      return
    }
    for (const message of messages) {
      if (pushedNavIdsRef.current.has(message.id)) continue
      // 问答回答指明了唯一目标页面：答完自动打开（「AON 网络图在哪里」→ 说明 + 直接打开）
      const live = message.liveAnswer
      if (live) {
        if (live.status === 'streaming') continue
        pushedNavIdsRef.current.add(message.id)
        if (live.status === 'done' && live.autoOpenPath?.startsWith('/next')) {
          router.push(live.autoOpenPath)
        }
        continue
      }
      const execution = message.toolExecution
      if (!execution || execution.status !== 'success') continue
      const data = execution.data
      // AI 同事本地动作：打开页面 / 搜索唯一命中直达 / 切换主题（next-themes 只能在组件里调用）
      if (
        execution.toolName === 'open_app_page' ||
        execution.toolName === 'start_project_generation' ||
        execution.toolName === 'search_global_entities'
      ) {
        const target = isRecord(data)
          ? execution.toolName === 'search_global_entities'
            ? data.openPath
            : data.path
          : null
        pushedNavIdsRef.current.add(message.id)
        if (typeof target === 'string' && target.startsWith('/next')) router.push(target)
        continue
      }
      if (execution.toolName === 'set_ui_preference') {
        pushedNavIdsRef.current.add(message.id)
        if (isRecord(data) && typeof data.theme === 'string') setTheme(data.theme)
        continue
      }
      if (execution.toolName !== 'navigate_to_space') continue
      if (!isRecord(data) || typeof data.path !== 'string' || !data.path.startsWith('/')) continue
      pushedNavIdsRef.current.add(message.id)
      // 新版入口一律进新版页面（后端对项目视图仍返回旧版地址）
      router.push(toNextTrackPath(data.path))
    }
  }, [messages, router, conversationId, setTheme])

  function renderAssistantBody(execution: ColleagueToolExecution, retryUserMessage: string | null) {
    const { status, previewToken } = execution
    // 初始执行中（尚无预览令牌）：呼吸发丝线行；确认在途（已持令牌）由预览卡 committing 呈现。
    if (status === 'executing' && !previewToken) {
      return <ColleagueExecutingRow toolName={execution.toolName} precise={precise} />
    }
    // RL-01 确认语义：确认按钮必须携带本卡自己的 previewToken（防串场确认）
    const confirmWithToken = () => {
      void confirmPendingAction(previewToken)
    }
    // 任务条目联动：关闭面板并导航到任务聚焦（?focusTask=<id>）
    const openTask = (taskId: number) => {
      closePanel()
      const rawProjectId = execution.parameters?.projectId
      const projectId =
        typeof rawProjectId === 'number' && Number.isFinite(rawProjectId) ? rawProjectId : null
      if (projectId === null) return
      // TODO(后续消费)：项目空间工作面暂未消费 focusTask 参数；URL 契约先期就位，
      // 后续可用于工作面任务高亮/详情抽屉联动。
      router.push(`/next/projects/${projectId}?focusTask=${taskId}`)
    }
    // 失败重试：确认阶段失败（已持令牌）→ 同令牌重试 confirm；
    // 执行阶段失败（无令牌）→ 重发该消息对应的用户原指令。
    const retryAction = () => {
      if (previewToken) {
        void confirmPendingAction(previewToken)
        return
      }
      if (retryUserMessage) onQuickAction(retryUserMessage)
    }
    return (
      <IntentSourceContext.Provider
        value={{ source: execution.intentSource, modelLabel: execution.modelLabel ?? null }}
      >
        {execution.stepLabel ? (
          <p data-colleague-step className="mb-1 text-[11px] text-[var(--nx-text-muted)]">
            {execution.stepLabel}
          </p>
        ) : null}
        <ColleagueToolCard
          execution={execution}
          onConfirm={confirmWithToken}
          onCancel={cancelPendingAction}
          onRetry={() => void redrillPendingAction()}
          onRetryMessage={retryAction}
          onOpenTask={openTask}
        />
      </IntentSourceContext.Provider>
    )
  }

  return (
    <div
      ref={scrollRef}
      data-ai-colleague-timeline
      data-testid="ai-colleague-timeline"
      aria-live="polite"
      aria-relevant="additions"
      className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain break-words px-3 py-4 [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto"
    >
      {messages.length === 0 ? (
        <div
          data-testid="ai-colleague-empty"
          className="flex h-full min-h-48 flex-col items-center justify-center gap-4 px-2 text-center"
        >
          <div className="flex items-center gap-2 rounded-full border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[var(--nx-ai)]" aria-hidden />
            <span className="text-xs font-medium tracking-wider text-[var(--nx-text-primary)]">
              开项 AI 同事
            </span>
          </div>
          <p className="max-w-[16rem] text-xs leading-5 text-[var(--nx-text-secondary)]">
            一句话直达工作镜头、结构化洞察项目数据；所有写操作变更均需人工审查确认后才落库。
          </p>
          <ColleagueQuickActions onQuickAction={onQuickAction} />
        </div>
      ) : (
        <ol className="flex flex-col gap-4">
          {messages.map((message, index) =>
            message.sender === 'user' ? (
              <li
                key={message.id}
                data-message-id={message.id}
                data-msg-sender="user"
                className="flex justify-end"
              >
                <div className="flex max-w-[85%] items-start gap-2">
                  <div className="rounded-lg rounded-tr-sm border border-[var(--nx-space-cyan)]/30 bg-[var(--nx-bg-1)] px-3 py-2 text-sm leading-5 text-[var(--nx-text-primary)]">
                    {message.content}
                  </div>
                  <span
                    aria-hidden
                    className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--nx-space-cyan)]/15 text-[10px] leading-none text-[var(--nx-space-cyan)]"
                  >
                    你
                  </span>
                </div>
              </li>
            ) : (
              <li
                key={message.id}
                data-message-id={message.id}
                data-msg-sender="assistant"
                className="flex justify-start"
              >
                <div className="flex max-w-[95%] flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 text-[var(--nx-ai)]" aria-hidden />
                    <span className="text-[10px] tracking-wider text-[var(--nx-text-muted)]">
                      AI 同事
                    </span>
                  </div>
                  {message.trizRun ? (
                    <TrizContradictionCard
                      run={message.trizRun}
                      precise={precise}
                      onAnswerClarification={(answer) => {
                        void answerTrizClarification(message.id, answer)
                      }}
                      onSelectSolution={(solutionIndex) => {
                        selectTrizSolution(message.id, solutionIndex)
                      }}
                      onChooseTarget={(target) => {
                        void previewTrizIntervention(message.id, target)
                      }}
                      onConfirmIntervention={(previewToken) => {
                        void confirmTrizIntervention(message.id, previewToken)
                      }}
                      onCancelIntervention={() => {
                        cancelTrizIntervention(message.id)
                      }}
                      onRepreview={() => {
                        void retryTrizPreview(message.id)
                      }}
                      onOverride={(input) => {
                        void overrideTrizParameters(message.id, input)
                      }}
                      onRetrySolve={() => {
                        void retryTrizSolve(message.id)
                      }}
                    />
                  ) : message.question ? (
                    <QuestionCard
                      prompt={message.question.prompt}
                      options={message.question.options}
                      status={message.question.status}
                      answer={message.question.answer}
                      active={index === lastAssistantIndex}
                      onAnswer={onQuickAction}
                    />
                  ) : message.liveAnswer ? (
                    <AiColleagueLiveAnswerBubble
                      content={message.content ?? ''}
                      live={message.liveAnswer}
                    />
                  ) : message.toolExecution ? (
                    renderAssistantBody(
                      message.toolExecution,
                      findPrecedingUserText(messages, index),
                    )
                  ) : (
                    <>
                      <div className="whitespace-pre-wrap rounded-lg rounded-tl-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-sm leading-5 text-[var(--nx-text-secondary)]">
                        <MemberAliasText text={message.content ?? ''} />
                      </div>
                      {/* 未识别/引导消息下方平铺快捷入口，供用户直接点击选用（spec 诚实回退） */}
                      <ColleagueQuickActions onQuickAction={onQuickAction} />
                    </>
                  )}
                </div>
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  )
}

export default AiColleagueMessageList
