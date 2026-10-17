'use client'

/**
 * v3-copilot-productized-operating-entry —— 产品化操作入口表面（任务 5.1 / 5.3 / 5.5 / 5.6）。
 *
 * 层级（design D4）：状态与 scope 行 → 一个主输入/打开动作 → 至多一条「继续最近会话」
 * → 一行有界 quick starts。用留白与分隔线组织，**不做**嵌套卡片或等权 icon grid。
 *
 * 红线：
 * - 未就绪时**绝不**呈现 false-ready 主动作；
 * - 所有触发器打开的是**同一个**既有 Copilot 面板（不新建对话面或状态机）；
 * - quick start 只填入草稿 + 结构化选择，绝不提交模型请求或执行业务动作；
 * - 演示态只能由「宿主显式声明 + 用户显式选择」进入，且全程显式标注；
 * - 状态不只用颜色传达（图标 + 文案 + `data-*`），状态变化只播报低敏状态与动作。
 */

import * as React from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  Info,
  Lock,
  MessageSquare,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import type { CopilotEntryQuickStart, CopilotEntryReadinessSnapshot } from '@aiproj/types'
import { classifyCopilotEntryFailure } from '@aiproj/types'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCopilotStore } from '@/stores/copilot-store'
import { setCopilotTriggerElement } from '@/lib/copilot/trigger-focus'
import { useCopilotReadiness, useCopilotEntryProjectId } from '@/hooks/use-copilot-readiness'
import { useCopilotScopeGuard, copilotScopeLabel } from '@/hooks/use-copilot-scope-guard'
import { useAuthStore, selectEffectiveOrganizationId } from '@/stores/auth-store'

/** 入口可观察状态（闭集，供测试与 `data-copilot-entry-state` 断言）。 */
export const COPILOT_ENTRY_SURFACE_STATES = [
  'loading',
  'retrying',
  'ready',
  'empty',
  'degraded',
  'unavailable',
  'permission-denied',
  'stale',
  'demonstration',
] as const
export type CopilotEntrySurfaceState = (typeof COPILOT_ENTRY_SURFACE_STATES)[number]

/** 低敏原因码 → 简体中文说明（不泄露不可访问对象）。 */
const REASON_COPY: Record<string, string> = {
  entry_ready: '可以开始提问',
  recent_session_unavailable: '最近会话暂时读取不到，可以直接开始新对话',
  tool_snapshot_unavailable: '可用工具清单暂时读取不到，核心问答不受影响',
  tool_snapshot_stale: '可用工具清单需要刷新后才能使用',
  quick_starts_unavailable: '快捷建议暂时不可用，可以直接输入问题',
  organization_context_missing: '当前账号还没有可用的组织，请先加入或选择一个组织',
  copilot_permission_denied: '当前账号没有使用 Copilot 的权限',
  project_scope_denied: '当前作用域不可用，请切换到你有权限的范围',
  turn_channel_unavailable: '暂时无法确认 Copilot 是否可用，可稍后重试',
  readiness_evaluation_failed: '状态检查失败，可稍后重试',
}

function reasonCopy(code: string): string {
  return REASON_COPY[code] ?? '状态暂时不可用，可稍后重试'
}

/** 由快照与查询状态推导入口的可观察状态。 */
export function deriveEntrySurfaceState(input: {
  isLoading: boolean
  isFetching: boolean
  error: unknown
  snapshot: CopilotEntryReadinessSnapshot | undefined
  demonstration: boolean
}): CopilotEntrySurfaceState {
  if (input.demonstration) return 'demonstration'
  if (input.isLoading) return 'loading'
  if (input.error) {
    const kind = classifyCopilotEntryFailure(input.error).kind
    if (kind === 'permission' || kind === 'auth') return 'permission-denied'
    if (kind === 'stale') return 'stale'
    return 'unavailable'
  }
  if (!input.snapshot) return 'unavailable'
  if (input.isFetching) return 'retrying'
  if (input.snapshot.state === 'unavailable') {
    const code = input.snapshot.reasons[0]?.code
    return code === 'copilot_permission_denied' || code === 'project_scope_denied'
      ? 'permission-denied'
      : 'unavailable'
  }
  if (input.snapshot.state === 'degraded') {
    return input.snapshot.reasons.some((r) => r.code === 'tool_snapshot_stale')
      ? 'stale'
      : 'degraded'
  }
  if (input.snapshot.recentSession === null && input.snapshot.quickStarts.length === 0) {
    return 'empty'
  }
  return 'ready'
}

/** 主动作是否可用：只有真正 ready/degraded/empty/retrying 才允许进入工作区。 */
export function isEntryActionable(state: CopilotEntrySurfaceState): boolean {
  return (
    state === 'ready' ||
    state === 'empty' ||
    state === 'degraded' ||
    state === 'stale' ||
    state === 'retrying' ||
    state === 'demonstration'
  )
}

const STATE_ICON: Record<CopilotEntrySurfaceState, React.ComponentType<{ className?: string }>> = {
  loading: RefreshCw,
  retrying: RefreshCw,
  ready: CircleCheck,
  empty: CircleCheck,
  degraded: AlertTriangle,
  unavailable: AlertTriangle,
  'permission-denied': Lock,
  stale: AlertTriangle,
  demonstration: Info,
}

const STATE_LABEL: Record<CopilotEntrySurfaceState, string> = {
  loading: '正在检查可用性',
  retrying: '正在刷新状态',
  ready: '可用',
  empty: '可用',
  degraded: '部分可用',
  unavailable: '暂不可用',
  'permission-denied': '无权限',
  stale: '需要刷新',
  demonstration: '演示模式',
}

/** 状态色只作辅助：图标与文案已独立传达状态（WCAG 1.4.1）。 */
const STATE_TONE: Record<CopilotEntrySurfaceState, string> = {
  loading: 'text-gray-500',
  retrying: 'text-gray-500',
  ready: 'text-success',
  empty: 'text-success',
  degraded: 'text-warning',
  unavailable: 'text-gray-600',
  'permission-denied': 'text-gray-600',
  stale: 'text-warning',
  demonstration: 'text-ai',
}

export interface CopilotOperatingEntryProps {
  /** 容器额外类名。 */
  className?: string
  /** 标题（Dashboard 用小标题，其它宿主可覆盖）。 */
  heading?: string
}

/**
 * 打开既有全局 Copilot 面板。
 *
 * 记录触发元素以便关闭后精确焦点回归；不创建第二个面板或会话历史。
 */
function openWorkspaceFrom(trigger: HTMLElement | null): void {
  setCopilotTriggerElement(trigger)
  useCopilotStore.getState().setOpen(true)
  useCopilotStore.getState().setForm('drawer')
}

export function CopilotOperatingEntry({
  className,
  heading = 'AI Copilot',
}: CopilotOperatingEntryProps) {
  const query = useCopilotReadiness()
  const routeProjectId = useCopilotEntryProjectId()

  const mode = useCopilotStore((s) => s.mode)
  const demoCapabilityDeclared = useCopilotStore((s) => s.demoCapabilityDeclared)
  const draft = useCopilotStore((s) => s.draft)
  const setDraft = useCopilotStore((s) => s.setDraft)
  const scopeNotice = useCopilotStore((s) => s.scopeNotice)
  const acknowledgeScopeNotice = useCopilotStore((s) => s.acknowledgeScopeNotice)
  const setQuickStartSelection = useCopilotStore((s) => s.setQuickStartSelection)

  const setToolSnapshotRevision = useCopilotStore((s) => s.setToolSnapshotRevision)
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const hasOrganization = (organizationId ?? 0) > 0

  const snapshot = query.data
  const scopeLabel = copilotScopeLabel(routeProjectId, snapshot?.scope.label ?? null)
  useCopilotScopeGuard({ projectId: routeProjectId, label: snapshot?.scope.label ?? null })

  // 把当前资格快照 revision 同步进 store：提交时据此复核 quick start 是否 stale（任务 5.6）。
  const snapshotRevision =
    snapshot?.quickStarts.find((quickStart) => quickStart.pluginBinding)?.pluginBinding
      ?.snapshotRevision ?? null
  React.useEffect(() => {
    setToolSnapshotRevision(snapshotRevision)
  }, [snapshotRevision, setToolSnapshotRevision])

  const [resumeNotice, setResumeNotice] = React.useState<string | null>(null)

  const state = deriveEntrySurfaceState({
    isLoading: query.isLoading,
    isFetching: query.isFetching && !query.isLoading,
    error: query.error,
    snapshot,
    demonstration: mode === 'demonstration',
  })

  const actionable = isEntryActionable(state)
  const StateIcon = STATE_ICON[state]

  // ── 主动作：把当前输入交给同一个面板（提交仍在面板内完成）──
  function handleOpen(event: React.MouseEvent<HTMLButtonElement>) {
    openWorkspaceFrom(event.currentTarget)
  }

  function handleDraftSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!actionable || scopeNotice !== null) return
    const trigger = event.currentTarget.querySelector<HTMLElement>('[data-entry-open]')
    openWorkspaceFrom(trigger)
  }

  /**
   * 继续最近会话（任务 5.5）。
   *
   * resume 前先刷新 readiness：授权、保留状态或 scope 在快照之后可能已变。
   * 复核不通过一律 fail closed —— 退回安全的新会话，并且不回显任何 stale 会话信息。
   */
  async function handleContinue(event: React.MouseEvent<HTMLButtonElement>) {
    const trigger = event.currentTarget
    const previousSessionId = snapshot?.recentSession?.sessionId
    setResumeNotice(null)

    const refreshed = await query.refetch()
    const fresh = refreshed.data
    const stillValid =
      fresh !== undefined &&
      fresh.state !== 'unavailable' &&
      fresh.recentSession !== null &&
      fresh.recentSession.sessionId === previousSessionId &&
      fresh.allowedActions.includes('continue-session')

    if (!stillValid) {
      setResumeNotice('原会话已不可继续，已为你准备一个新的对话')
      useCopilotStore.getState().resetSession()
      openWorkspaceFrom(trigger)
      return
    }

    useCopilotStore.setState({ liveSessionId: fresh.recentSession!.sessionId })
    openWorkspaceFrom(trigger)
  }

  function handleStartNew(event: React.MouseEvent<HTMLButtonElement>) {
    setResumeNotice(null)
    useCopilotStore.getState().resetSession()
    openWorkspaceFrom(event.currentTarget)
  }

  /**
   * 选择 quick start（任务 5.6）：只填草稿 + 记录结构化选择并打开面板。
   * 绝不提交模型请求，也不执行任何业务动作。
   */
  function handleQuickStart(
    quickStart: CopilotEntryQuickStart,
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    setDraft(quickStart.draftTemplate)
    setQuickStartSelection(quickStart)
    openWorkspaceFrom(event.currentTarget)
  }

  function handleRetry() {
    void query.refetch()
  }

  return (
    <section
      // 单一表面：只用边框不用大阴影（防 ghost-card，与 Card `outlined` 同规则）；
      // 内边距走 `--card-pad`，随 `[data-density]` 在舒适/紧凑之间切换。
      className={cn(
        'rounded-[var(--radius-lg)] border border-border bg-gray-0 p-[var(--card-pad)]',
        className,
      )}
      aria-labelledby="copilot-entry-heading"
      data-copilot-entry
      data-copilot-entry-state={state}
    >
      {/* ── 状态与 scope 行 ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2
          id="copilot-entry-heading"
          className="flex items-center gap-2 text-md font-semibold text-gray-800"
        >
          <Sparkles className="h-4 w-4 text-ai" aria-hidden />
          {heading}
        </h2>

        <span
          className={cn('inline-flex items-center gap-1.5 text-sm', STATE_TONE[state])}
          data-copilot-entry-status
        >
          <StateIcon
            className={cn(
              'h-3.5 w-3.5',
              (state === 'loading' || state === 'retrying') &&
                'animate-spin motion-reduce:animate-none',
            )}
            aria-hidden
          />
          {STATE_LABEL[state]}
        </span>

        <span className="text-sm text-gray-500" data-copilot-entry-scope>
          作用域：{scopeLabel}
        </span>

        <span className="ml-auto text-xs font-medium text-gray-500" data-copilot-entry-mode={mode}>
          {mode === 'demonstration' ? '演示模式（不写入任何数据）' : '生产通道'}
        </span>
      </div>

      {/* 状态播报：只播状态与动作，不播 prompt、会话正文或不可访问来源 */}
      <p className="sr-only" aria-live="polite" data-copilot-entry-live>
        Copilot {STATE_LABEL[state]}，作用域 {scopeLabel}
      </p>

      {/* ── 原因说明（degraded / unavailable / permission-denied / stale） ── */}
      {snapshot && snapshot.state !== 'ready' && (
        <ul className="mt-3 space-y-1" data-copilot-entry-reasons>
          {snapshot.reasons.map((reason) => (
            <li key={reason.code} className="text-sm text-gray-600">
              {reasonCopy(reason.code)}
            </li>
          ))}
        </ul>
      )}

      {query.error !== null && query.error !== undefined && (
        <p className="mt-3 text-sm text-gray-600" data-copilot-entry-error>
          状态检查失败，请稍后重试。
        </p>
      )}

      {/*
        无有效组织时不发请求（服务端拿不到任何可判定的前置条件），因此没有快照也没有 error。
        此时仍要给出与服务端 `organization_context_missing` 一致的低敏说明，
        否则用户只看到一个没有理由的「暂不可用」。
      */}
      {!hasOrganization && !query.error && (
        <p className="mt-3 text-sm text-gray-600" data-copilot-entry-no-organization>
          {reasonCopy('organization_context_missing')}
        </p>
      )}

      {/* ── scope 变更提示：确认或重选之前禁止提交 ── */}
      {scopeNotice && (
        <div
          className="mt-4 border-l-2 border-warning pl-3 text-sm text-gray-700"
          role="status"
          data-copilot-entry-scope-notice
        >
          <p>
            作用域已从「{scopeNotice.previousLabel}」切换到「{scopeNotice.nextLabel}」，
            你的输入已保留。确认后才能继续提交。
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2 min-h-11 sm:min-h-0"
            onClick={acknowledgeScopeNotice}
            data-entry-scope-ack
          >
            使用「{scopeNotice.nextLabel}」继续
          </Button>
        </div>
      )}

      {resumeNotice && (
        <p className="mt-4 text-sm text-gray-600" role="status" data-copilot-entry-resume-notice>
          {resumeNotice}
        </p>
      )}

      {/* ── 主输入 / 打开动作 ── */}
      {state === 'loading' ? (
        <div className="mt-5 space-y-3" data-copilot-entry-skeleton>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={handleDraftSubmit}>
          <label className="sr-only" htmlFor="copilot-entry-input">
            向 Copilot 提问
          </label>
          <input
            id="copilot-entry-input"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!actionable}
            placeholder={actionable ? '用一句话描述你想做的事…' : '当前不可用，暂时无法提问'}
            className={cn(
              'min-h-11 flex-1 rounded-[var(--radius-md)] border border-border bg-gray-0 px-3 text-sm text-gray-800',
              'placeholder:text-gray-400 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400',
              focusRing,
            )}
            data-copilot-entry-input
          />
          {actionable ? (
            <Button
              type="submit"
              className="min-h-11 sm:min-h-0"
              onClick={handleOpen}
              disabled={scopeNotice !== null}
              data-entry-open
            >
              打开 Copilot
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 sm:min-h-0"
              onClick={handleRetry}
              loading={query.isFetching}
              data-entry-retry
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              重新检查
            </Button>
          )}
        </form>
      )}

      {/* ── 继续最近会话（至多一条） ── */}
      {snapshot?.recentSession && (
        <>
          <hr className="my-4 border-border" />
          <div className="flex flex-wrap items-center gap-3" data-copilot-entry-recent-session>
            <MessageSquare className="h-4 w-4 text-gray-400" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
              {snapshot.recentSession.titleSummary}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11 sm:min-h-0"
              onClick={handleContinue}
              data-entry-continue
            >
              继续对话
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 sm:min-h-0"
              onClick={handleStartNew}
              data-entry-new-session
            >
              新对话
            </Button>
          </div>
        </>
      )}

      {/* ── quick starts（一行，有界） ── */}
      {snapshot && snapshot.quickStarts.length > 0 && (
        <>
          <hr className="my-4 border-border" />
          <div className="flex flex-wrap gap-2" data-copilot-entry-quick-starts>
            {snapshot.quickStarts.map((quickStart) => (
              <button
                key={quickStart.quickStartId}
                type="button"
                onClick={(event) => handleQuickStart(quickStart, event)}
                disabled={!actionable}
                className={cn(
                  'inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-sm text-gray-700 sm:min-h-8',
                  'hover:border-border-strong hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50',
                  focusRing,
                )}
                data-entry-quick-start={quickStart.quickStartId}
                data-entry-quick-start-source={quickStart.source}
              >
                {quickStart.source === 'plugin' && (
                  <Sparkles className="h-3 w-3 text-ai" aria-hidden />
                )}
                {quickStart.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── 空态引导：不暗示项目数据或工具不存在 ── */}
      {state === 'empty' && (
        <p className="mt-4 text-sm text-gray-500" data-copilot-entry-empty>
          还没有可继续的对话。直接描述你想了解或推进的事情，Copilot 会先给出建议，
          任何改动都需要你确认后才会生效。
        </p>
      )}

      {/* ── 演示模式：全程标注 + 返回就绪评估 ── */}
      {state === 'demonstration' && (
        <div className="mt-4 flex flex-wrap items-center gap-3" data-copilot-entry-demo>
          <span className="text-sm text-gray-600">
            当前是本机演示，回答来自固定示例，不会读写任何真实数据。
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11 sm:min-h-0"
            onClick={() => {
              useCopilotStore.getState().exitDemonstration()
              void query.refetch()
            }}
            data-entry-exit-demo
          >
            返回生产通道
          </Button>
        </div>
      )}

      {mode !== 'demonstration' && demoCapabilityDeclared && (
        <button
          type="button"
          className={cn('mt-4 text-xs text-gray-500 underline-offset-4 hover:underline', focusRing)}
          onClick={() => useCopilotStore.getState().enterExplicitDemonstration()}
          data-entry-enter-demo
        >
          查看本机演示（不写入任何数据）
        </button>
      )}
    </section>
  )
}
