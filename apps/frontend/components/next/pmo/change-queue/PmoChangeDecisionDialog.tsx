'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import {
  approveChangeRequest,
  rejectChangeRequest,
  returnChangeRequest,
  type ChangeImpactAnalysis,
  type ChangeRequest,
} from '@/lib/api/change-requests'
import {
  PmoChangeDecisionReasonForm,
  type PmoDecisionActionType,
} from './PmoChangeDecisionReasonForm'
import { invalidatePmoChangeQueries } from './pmo-change-invalidation'
import { cn } from '@/lib/utils'

export interface PmoChangeDecisionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  changeRequest?: (ChangeRequest & { projectName?: string; projectKey?: string }) | null
  cr?: (ChangeRequest & { projectName?: string; projectKey?: string }) | null
  action?: PmoDecisionActionType | null
  initialReason?: string
  initialConditions?: string
  impactAnalysis?: ChangeImpactAnalysis | null
  onSuccess?: (action: PmoDecisionActionType) => void
}

/**
 * 审批决策操作与两阶段确认弹窗组件（W4 · tasks 4.3 / design Decision 3）。
 *
 * 核心机制：
 * 1. 提供批准（approve）、拒绝（reject）、退回修改（return）三大决策动作；
 * 2. 驳回与退回强制要求填写决策理由（长度 ≥ 5 字符），未达标时提交物理禁用；
 * 3. 二次确认弹窗防误触（RL-01 纯人工显式操作，零 AI 自动落库）；
 * 4. 成功后统一触发 invalidatePmoChangeQueries 集中失效网联动。
 */
export function PmoChangeDecisionDialog({
  open,
  onOpenChange,
  changeRequest,
  cr,
  action: propAction,
  initialReason = '',
  initialConditions = '',
  impactAnalysis,
  onSuccess,
}: PmoChangeDecisionDialogProps) {
  const queryClient = useQueryClient()
  const targetCr = changeRequest ?? cr ?? null

  const [currentAction, setCurrentAction] = React.useState<PmoDecisionActionType>(
    propAction || 'approve',
  )
  const [decisionReason, setDecisionReason] = React.useState(initialReason)
  const [conditions, setConditions] = React.useState(initialConditions)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null)

  // 同步外部传入的初始值与动作
  React.useEffect(() => {
    if (open) {
      if (propAction) setCurrentAction(propAction)
      setDecisionReason(initialReason)
      setConditions(initialConditions)
      setSubmitError(null)
      setSuccessMessage(null)
      setIsSubmitting(false)
    }
  }, [open, propAction, initialReason, initialConditions])

  const isMandatoryReason = currentAction === 'reject' || currentAction === 'return'
  const isReasonValid = !isMandatoryReason || decisionReason.trim().length >= 5
  const isSubmitDisabled = isSubmitting || !isReasonValid || !targetCr

  const actionTitle =
    currentAction === 'approve'
      ? '批准变更请求 - 二次确认'
      : currentAction === 'reject'
        ? '驳回变更请求 - 二次确认'
        : '退回修改变更请求 - 二次确认'

  const actionWarning =
    currentAction === 'approve'
      ? '请注意：批准变更为不可逆治理操作。批准后该变更将正式进入实施推进流程，并更新跨项目队列态势。'
      : currentAction === 'reject'
        ? '请注意：驳回变更为终止性操作。必须提供详尽的决策理由，申请人将据此查阅终止原因。'
        : '请注意：退回修改将重置流转状态至申请人修改态。必须明确指出需完善调整的六维评估要点。'

  const confirmBtnLabel =
    currentAction === 'approve'
      ? '确认批准'
      : currentAction === 'reject'
        ? '确认驳回'
        : '确认退回修改'

  const handleSubmit = async () => {
    if (!targetCr || isSubmitDisabled) return
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const trimmedReason = decisionReason.trim()
      const trimmedConditions = conditions.trim()
      const analysisId = impactAnalysis?.id ?? targetCr.currentImpactAnalysisId ?? null
      const staleAckReason = impactAnalysis?.isStale
        ? trimmedReason || '审批人已确认过期快照并准予执行'
        : null

      if (currentAction === 'approve') {
        await approveChangeRequest(targetCr.id, {
          decisionReason: trimmedReason || undefined,
          conditions: trimmedConditions || undefined,
          impactAnalysisId: analysisId,
          confirmStaleReason: staleAckReason,
        })
      } else if (currentAction === 'reject') {
        await rejectChangeRequest(targetCr.id, {
          decisionReason: trimmedReason,
          impactAnalysisId: analysisId,
          confirmStaleReason: staleAckReason,
        })
      } else if (currentAction === 'return') {
        await returnChangeRequest(targetCr.id, {
          decisionReason: trimmedReason,
        })
      }

      // 集中失效网联动
      await invalidatePmoChangeQueries(queryClient, targetCr.projectId)

      const successNotice =
        currentAction === 'approve'
          ? '变更请求已成功批准，进入实施推进'
          : currentAction === 'reject'
            ? '变更请求已成功驳回，已通知申请人'
            : '变更请求已成功退回修改'

      setSuccessMessage(successNotice)
      onSuccess?.(currentAction)

      // 短暂显示成功提示后关闭
      setTimeout(() => {
        onOpenChange(false)
      }, 500)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '审批操作提交失败，请重试'
      setSubmitError(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent
        data-testid="pmo-change-decision-dialog"
        data-pmo-decision-dialog="true"
        className="max-w-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-5 text-[var(--nx-text-primary)]"
      >
        <DialogHeader className="gap-1 border-b border-[var(--nx-border-hairline)] pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden="true" />
            <DialogTitle className="text-sm font-semibold text-[var(--nx-text-primary)]">
              {actionTitle}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-[var(--nx-text-muted)]">
            {targetCr ? (
              <span>
                正在对变更{' '}
                <strong className="font-mono text-[var(--nx-text-primary)]">
                  {targetCr.crCode}
                </strong>
                「{targetCr.title}」执行审批决策。
              </span>
            ) : (
              '请确认审批决策'
            )}
          </DialogDescription>
        </DialogHeader>

        {/* 动作切换器（当外部未锁定指定动作时允许在弹窗内切换） */}
        {!propAction && (
          <div className="flex items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-1">
            <button
              type="button"
              data-testid="decision-action-approve"
              onClick={() => setCurrentAction('approve')}
              className={cn(
                'flex-1 rounded py-1 text-center text-xs font-medium transition-colors',
                currentAction === 'approve'
                  ? 'bg-[var(--nx-status-success)] text-white shadow-sm'
                  : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
              )}
            >
              批准
            </button>
            <button
              type="button"
              data-testid="decision-action-reject"
              onClick={() => setCurrentAction('reject')}
              className={cn(
                'flex-1 rounded py-1 text-center text-xs font-medium transition-colors',
                currentAction === 'reject'
                  ? 'bg-[var(--nx-status-danger)] text-white shadow-sm'
                  : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
              )}
            >
              驳回
            </button>
            <button
              type="button"
              data-testid="decision-action-return"
              onClick={() => setCurrentAction('return')}
              className={cn(
                'flex-1 rounded py-1 text-center text-xs font-medium transition-colors',
                currentAction === 'return'
                  ? 'bg-[var(--nx-status-warning)] text-white shadow-sm'
                  : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
              )}
            >
              退回修改
            </button>
          </div>
        )}

        {/* 两阶段风险提示警示框 */}
        <div className="flex items-start gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5 text-xs text-[var(--nx-text-secondary)]">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-warning)]"
            aria-hidden="true"
          />
          <p className="leading-relaxed">{actionWarning}</p>
        </div>

        {/* 决策理由与生效条件表单 */}
        <PmoChangeDecisionReasonForm
          action={currentAction}
          decisionReason={decisionReason}
          onReasonChange={setDecisionReason}
          conditions={conditions}
          onConditionsChange={currentAction === 'approve' ? setConditions : undefined}
          disabled={isSubmitting}
        />

        {/* 提交错误与成功提示 */}
        {submitError && (
          <p
            role="alert"
            data-testid="decision-error-alert"
            className="rounded border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.08)] px-2.5 py-1.5 text-xs text-[var(--nx-status-danger)]"
          >
            {submitError}
          </p>
        )}

        {successMessage && (
          <div
            role="status"
            data-testid="decision-success-alert"
            className="flex items-center gap-1.5 rounded border border-[var(--nx-status-success)] bg-[rgba(34,197,94,0.08)] px-2.5 py-1.5 text-xs text-[var(--nx-status-success)]"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{successMessage}</span>
          </div>
        )}

        <DialogFooter className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] pt-3">
          <button
            type="button"
            data-testid="decision-cancel-button"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="decision-confirm-button"
            disabled={isSubmitDisabled}
            onClick={handleSubmit}
            className={cn(
              'h-8 rounded-md px-3.5 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50',
              currentAction === 'approve'
                ? 'bg-[var(--nx-status-success)] hover:brightness-110'
                : currentAction === 'reject'
                  ? 'bg-[var(--nx-status-danger)] hover:brightness-110'
                  : 'bg-[var(--nx-status-warning)] hover:brightness-110',
            )}
          >
            {isSubmitting ? '提交中…' : confirmBtnLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
