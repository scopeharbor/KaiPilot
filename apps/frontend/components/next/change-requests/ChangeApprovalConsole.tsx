'use client'

import * as React from 'react'
import { CheckCircle2, CircleX, ClipboardCheck, RotateCcw, ShieldCheck } from 'lucide-react'
import type { ChangeRequest } from '@/lib/api/change-requests'
import {
  useApproveChangeRequest,
  useCancelChangeRequest,
  useCloseChangeRequest,
  useMarkImplementedChangeRequest,
  useRejectChangeRequest,
  useReturnChangeRequest,
  useSubmitChangeRequest,
} from '@/hooks/use-change-requests'
import { useListImpactAnalyses, useImpactAnalysis } from '@/lib/api/use-change-impact'
import { usePermissions } from '@/hooks/use-permissions'
import { useAuthStore } from '@/stores/auth-store'
import { CHANGE_REQUEST_APPROVE, CHANGE_REQUEST_CREATE } from './cr-permissions'
import { CR_ALLOWED_ACTIONS } from './cr-meta'
import { cn } from '@/lib/utils'

/**
 * 变更审批决策控制台（v3-ui-next-risk-change-domains W2 · tasks 2.9，
 * design Decision 5 / spec「变更请求受控审批流与全生命周期闭环」）。
 *
 * - 依据状态机镜像 CR_ALLOWED_ACTIONS（后端 VALID_TRANSITIONS）只呈现合法动作：
 *   - submitted/under_review：批准 / 拒绝（+ 审核中可退回）；
 *   - approved：标记已实施（+ 取消）；implemented：关闭；草稿/退回：提交审批 +
 *     取消（提交入口在详情只读态；本控制台在草稿/退回态展示提交与取消）；
 * - 审批区权限：change_request:approve（请求人不得自批——服务端强制，界面同步
 *   呈现只读提示）；无审批权限成员仅见「审批处理中」只读指示，控件物理隐藏；
 * - 决策字段：决策理由 decisionReason + 附加生效条件 conditions；
 * - 影响分析快照引用：勾选后携带 currentAnalysisId；若快照过期（isStale），
 *   必须填写 confirmStaleReason 书面确认理由才解锁批准/拒绝按钮（Stale Defence）；
 * - 全中文文案 + --nx-* 令牌；控件携带 data-cr-console-* 供测试定位。
 */

export interface ChangeApprovalConsoleProps {
  projectId: number
  cr: ChangeRequest
  onMutated?: () => void
}

export function ChangeApprovalConsole({ projectId, cr, onMutated }: ChangeApprovalConsoleProps) {
  const { can } = usePermissions()
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)
  const canApprove = can(CHANGE_REQUEST_APPROVE)
  const canCreate = can(CHANGE_REQUEST_CREATE)

  const [decisionReason, setDecisionReason] = React.useState('')
  const [conditions, setConditions] = React.useState('')
  const [referenceSnapshot, setReferenceSnapshot] = React.useState(
    () => cr.currentImpactAnalysisId != null,
  )
  const [staleReason, setStaleReason] = React.useState('')
  const [actionError, setActionError] = React.useState<string | null>(null)

  const requesterIsSelf =
    cr.requesterId !== null && cr.requesterId !== undefined && cr.requesterId === currentUserId
  const isDecisionState = cr.status === 'submitted' || cr.status === 'under_review'
  const actions = CR_ALLOWED_ACTIONS[cr.status]
  const canSubmit = requesterIsSelf && canCreate

  // ---- 快照引用与过期检测 ----
  const { data: analysesData } = useListImpactAnalyses(projectId, cr.id)
  const snapshotAnalysisId = cr.currentImpactAnalysisId ?? analysesData?.data?.[0]?.id ?? 0
  const { data: snapshotData } = useImpactAnalysis(snapshotAnalysisId, projectId)
  const snapshotStale = snapshotData?.data?.isStale === true && referenceSnapshot

  // ---- 变更操作 ----
  const approveMutation = useApproveChangeRequest(cr.id)
  const rejectMutation = useRejectChangeRequest(cr.id)
  const returnMutation = useReturnChangeRequest(cr.id)
  const implementMutation = useMarkImplementedChangeRequest(cr.id)
  const closeMutation = useCloseChangeRequest(cr.id)
  const cancelMutation = useCancelChangeRequest(cr.id)
  const submitMutation = useSubmitChangeRequest(cr.id)

  const busy = [
    approveMutation,
    rejectMutation,
    returnMutation,
    implementMutation,
    closeMutation,
    cancelMutation,
    submitMutation,
  ].some((mutation) => mutation.isPending)

  const snapshotPayload = () => {
    if (!referenceSnapshot || snapshotAnalysisId === 0) {
      return { impactAnalysisId: null as number | null, confirmStaleReason: null as string | null }
    }
    return {
      impactAnalysisId: snapshotAnalysisId,
      confirmStaleReason: snapshotStale ? staleReason.trim() || null : null,
    }
  }

  const clearError = () => setActionError(null)
  const failWith = (error: unknown) => {
    setActionError(error instanceof Error ? error.message : '操作失败，请检查权限与状态后重试')
  }
  const success = () => onMutated?.()

  const handleSubmit = () => {
    clearError()
    submitMutation.mutate(undefined, { onSuccess: success, onError: failWith })
  }
  const handleApprove = () => {
    clearError()
    approveMutation.mutate(
      { decisionReason, conditions, ...snapshotPayload() },
      { onSuccess: success, onError: failWith },
    )
  }
  const handleReject = () => {
    clearError()
    rejectMutation.mutate(
      { decisionReason, ...snapshotPayload() },
      { onSuccess: success, onError: failWith },
    )
  }
  const handleReturn = () => {
    clearError()
    returnMutation.mutate({ decisionReason }, { onSuccess: success, onError: failWith })
  }
  const handleImplement = () => {
    clearError()
    implementMutation.mutate(undefined, { onSuccess: success, onError: failWith })
  }
  const handleClose = () => {
    clearError()
    closeMutation.mutate(undefined, { onSuccess: success, onError: failWith })
  }
  const handleCancel = () => {
    clearError()
    cancelMutation.mutate(undefined, { onSuccess: success, onError: failWith })
  }

  // 过期快照防御：勾选引用且快照过期时，批准/拒绝必须先填写书面确认理由
  const decisionLocked = snapshotStale && staleReason.trim() === ''
  const approveDisabled = busy || decisionLocked
  const rejectDisabled = busy || decisionLocked
  const showDecisionFields = isDecisionState && canApprove && !requesterIsSelf

  const consoleError =
    actionError ?? approveMutation.error?.message ?? rejectMutation.error?.message

  return (
    <section
      data-cr-console
      data-cr-console-status={cr.status}
      aria-label="变更审批决策控制台"
      className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">审批决策控制台</h3>
          {isDecisionState && !showDecisionFields ? (
            <span
              data-cr-console-readonly
              className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]"
            >
              审批处理中
            </span>
          ) : null}
        </div>
        {snapshotAnalysisId > 0 ? (
          <span
            data-cr-console-snapshot
            data-cr-console-snapshot-id={snapshotAnalysisId}
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            快照 #{snapshotAnalysisId}
            {snapshotData?.data?.isStale ? ' · 已过期' : ''}
          </span>
        ) : null}
      </header>

      {/* 请求人自批守卫提示 */}
      {isDecisionState && requesterIsSelf ? (
        <p
          data-cr-console-self-block
          className="rounded-sm border border-[var(--nx-status-warning)] bg-[rgba(245,158,11,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-warning)]"
        >
          变更申请人不能自行审批本请求，请等待具备审批权限的同事处理。
        </p>
      ) : null}

      {consoleError ? (
        <p
          role="alert"
          data-cr-console-error
          className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
        >
          {consoleError}
        </p>
      ) : null}

      {/* 决策字段（submitted/under_review + 审批权限 + 非自批） */}
      {showDecisionFields ? (
        <div className="flex flex-col gap-2.5">
          <div>
            <label
              htmlFor="cr-console-reason"
              className="mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]"
            >
              决策理由 <span className="text-[var(--nx-text-muted)]">（审计留痕，建议填写）</span>
            </label>
            <textarea
              id="cr-console-reason"
              data-cr-console-reason
              rows={3}
              maxLength={2000}
              value={decisionReason}
              onChange={(event) => setDecisionReason(event.target.value)}
              placeholder="例如：评估后资源可协调，同意实施…"
              className="w-full resize-y rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs leading-relaxed text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]"
            />
          </div>
          <div>
            <label
              htmlFor="cr-console-conditions"
              className="mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]"
            >
              附加生效条件 <span className="text-[var(--nx-text-muted)]">（可选）</span>
            </label>
            <input
              id="cr-console-conditions"
              data-cr-console-conditions
              type="text"
              maxLength={2000}
              value={conditions}
              onChange={(event) => setConditions(event.target.value)}
              placeholder="例如：批准后 3 个工作日内补充备份回滚演练记录…"
              className="h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]"
            />
          </div>

          {/* 影响分析快照引用（impactAnalysisId 快照关联） */}
          {snapshotAnalysisId > 0 ? (
            <div className="flex flex-col gap-2 rounded-sm border border-dashed border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] p-2.5">
              <label className="flex items-center gap-2 text-xs text-[var(--nx-text-secondary)]">
                <input
                  type="checkbox"
                  data-cr-console-snapshot-check
                  checked={referenceSnapshot}
                  onChange={(event) => {
                    setReferenceSnapshot(event.target.checked)
                    if (!event.target.checked) setStaleReason('')
                  }}
                  className="h-3.5 w-3.5 accent-[var(--nx-accent)]"
                />
                引用当前六维影响分析快照（#{snapshotAnalysisId}）作为决策证据
              </label>
              {snapshotData?.data?.isStale ? (
                <div className="flex flex-col gap-1.5 rounded-sm border border-[var(--nx-status-warning)] bg-[rgba(245,158,11,0.08)] p-2">
                  <p
                    data-cr-console-stale
                    className="text-[11px] leading-relaxed text-[var(--nx-status-warning)]"
                  >
                    该快照已过期（{snapshotData.data.staleReason ?? '项目数据已变更'}）。
                    若仍需引用，必须填写书面确认理由方可执行批准/拒绝。
                  </p>
                  {referenceSnapshot ? (
                    <textarea
                      data-cr-console-stale-reason
                      rows={2}
                      maxLength={500}
                      value={staleReason}
                      onChange={(event) => setStaleReason(event.target.value)}
                      placeholder="确认继续引用过期快照的书面理由…"
                      className="w-full resize-y rounded-sm border border-[var(--nx-status-warning)] bg-[var(--nx-bg-1)] px-2 py-1.5 text-xs text-[var(--nx-text-primary)] focus:outline-none"
                    />
                  ) : null}
                </div>
              ) : null}
              <p className="text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
                引用仅作为审批证据留存（impactAnalysisId），不会自动修改任务、依赖、资源或基线。
              </p>
            </div>
          ) : (
            <p className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-[10px] text-[var(--nx-text-muted)]">
              当前变更尚无影响分析快照，可在上方「六维影响分析」面板生成后引用。
            </p>
          )}
        </div>
      ) : null}

      {/* 动作区：按状态机镜像呈现合法推进动作 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 草稿/退回：提交审批 */}
        {actions.includes('submit') && canSubmit ? (
          <button
            type="button"
            data-cr-console-submit
            disabled={busy}
            onClick={handleSubmit}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3.5 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            {submitMutation.isPending ? '提交中…' : '提交审批'}
          </button>
        ) : null}
        {actions.includes('submit') && !canSubmit ? (
          <p
            data-cr-console-submit-hint
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-[11px] text-[var(--nx-text-muted)]"
          >
            {canCreate ? '仅变更申请人可提交审批。' : '提交审批需要 change_request:create 权限。'}
          </p>
        ) : null}

        {/* 待审批决策：批准 / 拒绝 / 退回 */}
        {actions.includes('approve') && showDecisionFields ? (
          <>
            <button
              type="button"
              data-cr-console-approve
              disabled={approveDisabled}
              onClick={handleApprove}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md border px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40',
                'border-[var(--nx-status-success)] text-[var(--nx-status-success)] hover:brightness-110',
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              {approveMutation.isPending ? '批准中…' : '批准'}
            </button>
            <button
              type="button"
              data-cr-console-reject
              disabled={rejectDisabled}
              onClick={handleReject}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] px-3.5 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CircleX className="h-3.5 w-3.5" aria-hidden />
              {rejectMutation.isPending ? '拒绝中…' : '拒绝'}
            </button>
          </>
        ) : null}
        {actions.includes('return') && showDecisionFields ? (
          <button
            type="button"
            data-cr-console-return
            disabled={busy}
            onClick={handleReturn}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {returnMutation.isPending ? '退回中…' : '退回修改'}
          </button>
        ) : null}

        {/* 已批准：标记已实施 */}
        {actions.includes('implement') && canApprove ? (
          <button
            type="button"
            data-cr-console-implement
            disabled={busy}
            onClick={handleImplement}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3.5 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            {implementMutation.isPending ? '标记中…' : '标记已实施'}
          </button>
        ) : null}

        {/* 已实施：关闭 */}
        {actions.includes('close') && canApprove ? (
          <button
            type="button"
            data-cr-console-close
            disabled={busy}
            onClick={handleClose}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
            {closeMutation.isPending ? '关闭中…' : '关闭变更'}
          </button>
        ) : null}

        {/* 取消（草稿/已提交/已批准/退回：请求人或审批权限） */}
        {actions.includes('cancel') && (requesterIsSelf || canApprove) ? (
          <button
            type="button"
            data-cr-console-cancel
            disabled={busy}
            onClick={handleCancel}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-status-danger)] hover:text-[var(--nx-status-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CircleX className="h-3.5 w-3.5" aria-hidden />
            {cancelMutation.isPending ? '取消中…' : '取消变更'}
          </button>
        ) : null}
      </div>
    </section>
  )
}

export default ChangeApprovalConsole
