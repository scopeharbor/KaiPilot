'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PenLine,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import type { DraftValidationIssue, DraftValidationReport } from '@aiproj/types'
import { aiDraftApi } from '@/lib/api/ai-draft'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAuthStore } from '@/stores/auth-store'
import { NextDraftPermissionNotice } from './NextDraftPermissionNotice'
import type { DraftConfirmFailure } from './NextDraftConfirmModal'

export interface NextDraftActionBarProps {
  /** 草案会话标识（保存/放弃端点路径参数）。 */
  draftId: string
  /** 服务端权威反幻觉校验报告（阻断判定唯一依据）。 */
  validation: DraftValidationReport
  /** 返回重试生成：store.resetToContext() 之后回调（深链接页可借此导航回剧场）。 */
  onRetry?: () => void
  /** 保存为草稿成功：store.enterSaved() 之后回调。 */
  onSaved?: () => void
  /** 放弃草案成功：store.enterRejected() + 会话清理之后回调。 */
  onDiscarded?: () => void
  /** 转正失败分类结果（stale/blocking/fatal 由本操作栏横幅呈现；autoFix 由弹窗直接接管）。 */
  confirmFailure?: DraftConfirmFailure | null
  /** 清除转正失败横幅（重新发起转正 / 拉取最新版本成功后调用）。 */
  onClearConfirmFailure?: () => void
}

/**
 * Blocking 禁确认阻断判定（RL-02）：
 * `canConfirm === false` 或 `blocking` 数组非空（6 项 Blocking HL 与 3 项 Blocking VE
 * 中任一失败）即强制阻断转正。判定逻辑与 design D6 逐字一致。
 */
export function isConfirmBlocked(validation: DraftValidationReport | null): boolean {
  return Boolean(
    !validation ||
    validation.canConfirm === false ||
    (Array.isArray(validation.blocking) && validation.blocking.length > 0),
  )
}

export interface ConfirmGuardInput {
  /** RBAC `ai:confirm` 权限（RL-06：无权限时按钮整体不渲染，不参与激活判定）。 */
  hasPermission: boolean
  /** Blocking 清零判定（canConfirm !== false 且无阻断违规）。 */
  isBlocked: boolean
  /** 校验报告中的 Warning 条目数。 */
  warningCount: number
  /** 用户是否已显式勾选 Warning 复核（acknowledgedWarnings）。 */
  warningAcknowledged: boolean
  /** 当前选中任务数（selection.taskIds.length）。 */
  selectedTaskCount: number
  /** 是否正处于转正提交中。 */
  isConfirming: boolean
}

/**
 * 转正主按钮 5 项前置守卫矩阵（spec「人工显式确认与单事务转正对接」第 1 条）：
 * 权限 + Blocking 清零 + Warning 显式复核 + 选中任务 ≥1 + 非提交中，全部满足才激活。
 */
export function isConfirmReady(input: ConfirmGuardInput): boolean {
  return (
    input.hasPermission &&
    !input.isBlocked &&
    (input.warningCount === 0 || input.warningAcknowledged) &&
    input.selectedTaskCount >= 1 &&
    !input.isConfirming
  )
}

/**
 * 未激活时悬停的具体禁用原因（design D6 守卫矩阵逐项映射）：
 * Blocking 违规逐条列出规则（RL-02），其余按 Warning 未复核 / 未选任务 / 提交中分档。
 */
export function buildConfirmDisableTooltip(
  input: ConfirmGuardInput,
  blockingRules: DraftValidationIssue[],
): string {
  if (input.isBlocked) {
    const detail =
      blockingRules.length > 0
        ? blockingRules.map((issue) => `[${issue.ruleId}] ${issue.message}`).join('；')
        : '草案未通过服务端最终校验（canConfirm=false）'
    return `存在 ${blockingRules.length} 项阻断级严重违规：${detail}。严禁转正。请返回重试生成或保存为草案。`
  }
  if (input.warningCount > 0 && !input.warningAcknowledged) {
    return `当前草案存在需关注的风险或假设（${input.warningCount} 项告警），请先勾选「我已复核并确认上述警告项」。`
  }
  if (input.selectedTaskCount === 0) {
    return '至少需要选择 1 项任务方可转正。'
  }
  if (input.isConfirming) {
    return '正在写入正式项目库，请稍候。'
  }
  return ''
}

/** 操作失败摘要：优先消费 ApiError 的 code/message，未知错误回退通用文案。 */
function describeActionError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const e = error as { code?: unknown; message?: unknown }
    const code = typeof e.code === 'string' && e.code ? e.code : 'DRAFT_ACTION_FAILED'
    const message =
      typeof e.message === 'string' && e.message ? e.message : '操作失败，请稍后重试。'
    return `[${code}] ${message}`
  }
  return error instanceof Error ? error.message : '[DRAFT_ACTION_FAILED] 操作失败，请稍后重试。'
}

/**
 * 底部安全操作栏（v3-ui-next-draft-confirm tasks 3.1/3.5/3.6 / design D6·D8·D9）。
 *
 * - 「确认并转正项目」从阻断哨兵升级为受控确认动作入口：5 项前置守卫
 *   （`ai:confirm` 权限 / Blocking 清零 / Warning 显式勾选 / 选中任务 ≥1 / 非提交中）
 *   全部满足方可点击，未激活时悬停 Tooltip 逐条列出禁用原因（RL-02）；
 * - 点击仅唤起二次确认弹窗（`confirmModalOpen`），网络请求 100% 由弹窗「确认落库」显式触发
 *   （RL-01 显式点击才 confirm）；
 * - 存在 Warning 告警且无 Blocking 时，操作栏上方渲染高对比度警告提示条与
 *   「我已复核并确认上述警告项」复选框，未勾选严格禁用转正（spec「Warning 人工确认机制」）；
 * - 提交中（isConfirming）按钮进入 Spinner + 「正在写入正式项目库…」，二次点击被绝对拦截；
 * - 转正失败分类横幅：422 stale → 琥珀冲突条 + 「拉取最新版本重审」；422 blocking →
 *   红色违规卡片（「服务端最终校验拦截：[规则] 描述，禁止落库」）；500/断网 →
 *   红色重试提示 + 「重试转正」（完整保留勾选与就地编辑现场）；
 * - 无 `ai:confirm` 权限（Member/Observer）：DOM 绝对不渲染转正按钮与任何隐藏触发器，
 *   原位呈现 NextDraftPermissionNotice 提示条，客户端零 confirm 请求（RL-06 / spec「RBAC」）；
 * - 「返回重试生成」「保存为草稿」「放弃草案」行为与既有版本保持一致。
 */
export function NextDraftActionBar({
  draftId,
  validation,
  onRetry,
  onSaved,
  onDiscarded,
  confirmFailure = null,
  onClearConfirmFailure,
}: NextDraftActionBarProps) {
  const hasConfirmPermission = useAuthStore((state) => state.hasPermission('ai:confirm'))
  const blocked = isConfirmBlocked(validation)
  const selection = useAiDraftConfirmStore((state) => state.selection)
  const acknowledgedWarnings = useAiDraftConfirmStore((state) => state.acknowledgedWarnings)
  const isConfirming = useAiDraftConfirmStore((state) => state.isConfirming)

  const [tipOpen, setTipOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [saveDone, setSaveDone] = React.useState(false)
  const [discardArmed, setDiscardArmed] = React.useState(false)
  const [discarding, setDiscarding] = React.useState(false)
  const [discardError, setDiscardError] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [refreshFailed, setRefreshFailed] = React.useState(false)

  const busy = saving || discarding

  const blockingRules = validation.blocking ?? []
  const warningCount = validation.warning?.length ?? 0
  const selectedTaskCount = selection.taskIds.length
  const guardInput: ConfirmGuardInput = {
    hasPermission: hasConfirmPermission,
    isBlocked: blocked,
    warningCount,
    warningAcknowledged: acknowledgedWarnings,
    selectedTaskCount,
    isConfirming,
  }
  const guardReady = isConfirmReady(guardInput)
  const tooltipText = guardReady
    ? '草案已通过反幻觉与转换校验，具备转正资格'
    : buildConfirmDisableTooltip(guardInput, blockingRules)

  function handleRetry() {
    if (busy) return
    useAiProjectDraftStore.getState().resetToContext()
    onRetry?.()
  }

  function handleStartNew() {
    // 审查页之外没有别的入口能离开这份草案（会话里的草案会把 /next/create 带回这里）。
    if (busy) return
    if (!window.confirm('开始新的起草？当前草案未保存的修改不会保留。')) return
    useAiProjectDraftStore.getState().restart()
    window.history.replaceState(null, '', window.location.pathname)
  }

  async function handleSave() {
    if (busy || saveDone) return
    setSaving(true)
    setSaveError(null)
    try {
      await aiDraftApi.save(draftId)
      setSaveDone(true)
      useAiProjectDraftStore.getState().enterSaved()
      onSaved?.()
    } catch (error) {
      setSaveError(describeActionError(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleDiscard() {
    if (busy) return
    if (!discardArmed) {
      setDiscardArmed(true)
      return
    }
    setDiscarding(true)
    setDiscardError(null)
    try {
      await aiDraftApi.reject(draftId)
      const store = useAiProjectDraftStore.getState()
      store.enterRejected()
      store.clearDraftSession()
      onDiscarded?.()
    } catch (error) {
      setDiscardError(describeActionError(error))
      setDiscardArmed(false)
    } finally {
      setDiscarding(false)
    }
  }

  /** 发起转正：仅守卫通过才唤起二次确认弹窗（RL-01 显式点击入口）。 */
  function handleConfirmClick() {
    if (!guardReady || busy) return
    // 终态防御：已转正落库后禁止再次唤起确认流（服务端 session.projectId 亦会阻断重复导入）。
    if (useAiProjectDraftStore.getState().draftStatus === 'confirmed') return
    onClearConfirmFailure?.()
    useAiDraftConfirmStore.setState({ confirmModalOpen: true })
  }

  /** 版本过期冲突恢复：拉取最新版本草案并重建审查工作面。 */
  async function handleRefreshLatest() {
    if (refreshing) return
    setRefreshing(true)
    setRefreshFailed(false)
    try {
      const detail = await aiDraftApi.get(draftId)
      if (!detail.draft || !detail.meta || !detail.validation) {
        setRefreshFailed(true)
        return
      }
      const store = useAiProjectDraftStore.getState()
      store.setDraftCompleted(detail.draft, detail.meta, detail.validation)
      useAiProjectDraftStore.setState({
        draftId: detail.draftId,
        draftVersion: detail.version,
      })
      store.enterReview()
      const confirmStore = useAiDraftConfirmStore.getState()
      confirmStore.resetConfirmState()
      confirmStore.initSelection(detail.draft)
      onClearConfirmFailure?.()
    } catch {
      setRefreshFailed(true)
    } finally {
      setRefreshing(false)
    }
  }

  /** 500/断网恢复：原地重试 = 重开二次确认弹窗（勾选与就地编辑现场原样保留）。 */
  function handleRetryConfirm() {
    if (isConfirming || busy) return
    onClearConfirmFailure?.()
    useAiDraftConfirmStore.setState({ confirmModalOpen: true })
  }

  return (
    <footer
      data-next-draft-action-bar
      aria-label="草案安全操作栏"
      className="mt-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3"
    >
      {saveDone ? (
        <p
          data-save-success
          role="status"
          className="mb-2 flex items-center gap-1.5 text-xs text-[var(--nx-status-success)]"
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          草案已保存至草稿箱
        </p>
      ) : null}
      {saveError ? (
        <p data-action-error role="alert" className="mb-2 text-xs text-[var(--nx-status-danger)]">
          {saveError}
        </p>
      ) : null}
      {discardError ? (
        <p data-action-error role="alert" className="mb-2 text-xs text-[var(--nx-status-danger)]">
          {discardError}
        </p>
      ) : null}

      {confirmFailure !== null ? (
        <div
          role="alert"
          data-confirm-error-banner
          data-confirm-error-kind={confirmFailure.kind}
          className={`mb-2 rounded border px-3 py-2.5 ${
            confirmFailure.kind === 'stale'
              ? 'border-[var(--nx-status-warning)]/40 bg-[var(--nx-status-warning)]/10'
              : 'border-[var(--nx-status-danger)]/40 bg-[var(--nx-status-danger)]/10'
          }`}
        >
          {confirmFailure.kind === 'stale' ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                <AlertTriangle
                  className="mr-1 inline h-3.5 w-3.5 text-[var(--nx-status-warning)]"
                  aria-hidden
                />
                草案在其他会话或自动微调中已生成新版本（当前 v{confirmFailure.received}，最新 v
                {confirmFailure.expected}），无法基于过期版本转正。
              </p>
              <button
                type="button"
                data-refresh-latest
                onClick={handleRefreshLatest}
                disabled={refreshing}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {refreshing ? (
                  <Loader2 className="nx-review-spin h-3.5 w-3.5" aria-hidden />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                )}
                拉取最新版本重审
              </button>
            </div>
          ) : null}

          {confirmFailure.kind === 'blocking' ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-[var(--nx-status-danger)]">
                服务端最终校验拦截，禁止落库：
              </p>
              {confirmFailure.issues.map((issue, index) => (
                <p
                  key={`${issue.ruleId}-${index}`}
                  data-blocking-violation
                  className="rounded border border-[var(--nx-status-danger)]/40 bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs leading-relaxed text-[var(--nx-status-danger)]"
                >
                  [{issue.ruleId}] {issue.message}
                </p>
              ))}
            </div>
          ) : null}

          {confirmFailure.kind === 'fatal' ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--nx-status-danger)]">
                转正请求失败：网络连接超时或服务繁忙，未写入任何正式数据，请重试。
              </p>
              <button
                type="button"
                data-retry-confirm
                onClick={handleRetryConfirm}
                disabled={isConfirming || busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                重试转正
              </button>
            </div>
          ) : null}

          {refreshFailed ? (
            <p data-refresh-failed className="mt-1.5 text-[11px] text-[var(--nx-status-danger)]">
              拉取最新版本失败，请检查网络后重试。
            </p>
          ) : null}
        </div>
      ) : null}

      {warningCount > 0 && !blocked ? (
        <div
          data-warning-ack-bar
          className="mb-2 flex flex-wrap items-center gap-2 rounded border border-[var(--nx-status-warning)]/40 bg-[var(--nx-status-warning)]/10 px-3 py-2"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--nx-status-warning)]" aria-hidden />
          <div className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
            <p>当前草案存在需关注的风险或假设（{warningCount} 项告警），请核对确认。</p>
            <ul data-warning-ack-list className="mt-1 list-disc pl-4">
              {(validation.warning ?? []).slice(0, 5).map((item, index) => (
                <li key={`${item.ruleId}-${index}`}>{item.message}</li>
              ))}
            </ul>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-[var(--nx-text-secondary)]">
            <input
              type="checkbox"
              data-warning-ack-checkbox
              checked={acknowledgedWarnings}
              onChange={(event) => {
                useAiDraftConfirmStore.setState({ acknowledgedWarnings: event.target.checked })
              }}
              className="h-3.5 w-3.5 accent-[var(--nx-accent)]"
            />
            我已复核并确认上述警告项
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          data-retry-action
          onClick={handleRetry}
          disabled={busy}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-3.5 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          返回重试生成
        </button>

        <button
          type="button"
          data-start-new-action
          onClick={handleStartNew}
          disabled={busy}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-3.5 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PenLine className="h-4 w-4" aria-hidden />
          新起草案
        </button>

        <button
          type="button"
          data-save-draft-action
          onClick={handleSave}
          disabled={busy || saveDone}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-3.5 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? (
            <Loader2 className="nx-review-spin h-4 w-4" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          {saving ? '保存中…' : '保存为草稿'}
        </button>

        <button
          type="button"
          data-discard-action
          onClick={handleDiscard}
          disabled={busy}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-3.5 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-status-danger)]/60 hover:text-[var(--nx-status-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {discarding ? (
            <Loader2 className="nx-review-spin h-4 w-4" aria-hidden />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden />
          )}
          {discardArmed ? '确认放弃草案' : '放弃草案'}
        </button>

        {discardArmed ? (
          <button
            type="button"
            data-discard-cancel
            onClick={() => setDiscardArmed(false)}
            disabled={discarding}
            className="h-9 rounded-md px-2 text-xs text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            取消
          </button>
        ) : null}

        <span className="ml-auto flex items-center">
          {hasConfirmPermission ? (
            <span
              data-confirm-trigger
              tabIndex={0}
              onMouseEnter={() => setTipOpen(true)}
              onMouseLeave={() => setTipOpen(false)}
              onFocus={() => setTipOpen(true)}
              onBlur={() => setTipOpen(false)}
              aria-label="确认并转正项目"
              className="relative inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              <button
                type="button"
                data-confirm-action
                disabled={!guardReady || busy}
                aria-describedby={tipOpen ? 'next-draft-confirm-tooltip' : undefined}
                onClick={handleConfirmClick}
                className={`inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40 ${
                  guardReady
                    ? 'border-[var(--nx-border-focus)] bg-[var(--nx-accent)] text-[var(--nx-space-bg)] hover:bg-[var(--nx-ai)]'
                    : 'border-[var(--nx-border-hairline)] bg-zinc-800 text-zinc-500'
                }`}
              >
                {isConfirming ? (
                  <Loader2 className="nx-review-spin h-4 w-4" aria-hidden />
                ) : (
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                )}
                {isConfirming ? '正在写入正式项目库…' : '确认并转正项目'}
              </button>
              {tipOpen ? (
                <span
                  id="next-draft-confirm-tooltip"
                  role="tooltip"
                  data-confirm-tooltip
                  className="absolute bottom-full left-1/2 z-20 mb-2 w-72 -translate-x-1/2 rounded border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 py-2 text-left text-xs leading-relaxed text-[var(--nx-text-secondary)] shadow-none"
                >
                  {tooltipText}
                </span>
              ) : null}
            </span>
          ) : (
            <NextDraftPermissionNotice />
          )}
        </span>
      </div>
    </footer>
  )
}

export default NextDraftActionBar
