'use client'

import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type PmoDecisionActionType = 'approve' | 'reject' | 'return'

export interface PmoChangeDecisionReasonFormProps {
  action: PmoDecisionActionType | null
  decisionReason: string
  onReasonChange: (val: string) => void
  conditions?: string
  onConditionsChange?: (val: string) => void
  disabled?: boolean
  className?: string
}

/**
 * PMO 审批决策原因与生效条件表单组件（W4 · tasks 4.1, 4.3）。
 *
 * 规范约束：
 * - 驳回（reject）与退回修改（return）强制要求填写决策理由（长度 ≥ 5）；
 * - 批准（approve）支持录入可选决策说明与附加生效条件（conditions）；
 * - 实时显示字数统计与校验错误提示。
 */
export function PmoChangeDecisionReasonForm({
  action,
  decisionReason,
  onReasonChange,
  conditions = '',
  onConditionsChange,
  disabled = false,
  className,
}: PmoChangeDecisionReasonFormProps) {
  const isMandatory = action === 'reject' || action === 'return'
  const trimmedLength = decisionReason.trim().length
  const isInvalid = isMandatory && trimmedLength < 5
  const showReasonError = isMandatory && trimmedLength > 0 && trimmedLength < 5

  const reasonLabel =
    action === 'reject'
      ? '驳回原因'
      : action === 'return'
        ? '退回修改指导意见'
        : '决策理由 / 审批说明'

  const reasonPlaceholder =
    action === 'reject'
      ? '请详细填写驳回原因（至少 5 个字符，必填）…'
      : action === 'return'
        ? '请明确指出需补充或调整的材料与内容（至少 5 个字符，必填）…'
        : '填写批准说明或合规性核准意见（选填）…'

  const errorMessage =
    action === 'reject'
      ? '驳回变更必须提供决策理由（至少 5 个字符）'
      : action === 'return'
        ? '退回修改必须提供指导意见（至少 5 个字符）'
        : '决策理由长度不足'

  return (
    <div className={cn('flex flex-col gap-4 text-xs', className)}>
      {/* 附加生效条件（批准动作可用） */}
      {(action === 'approve' || onConditionsChange) && (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="pmo-decision-conditions"
            className="font-medium text-[var(--nx-text-secondary)]"
          >
            附加批准条件 <span className="text-[var(--nx-text-muted)] font-normal">（选填）</span>
          </label>
          <input
            id="pmo-decision-conditions"
            type="text"
            data-testid="decision-conditions-input"
            value={conditions}
            disabled={disabled}
            onChange={(e) => onConditionsChange?.(e.target.value)}
            placeholder="例如：需在实施前完成测试环境沙箱演练及代码复审…"
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-primary)] placeholder-[var(--nx-text-muted)] transition-colors focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50"
          />
        </div>
      )}

      {/* 决策理由文本域 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="pmo-decision-reason"
            className="font-medium text-[var(--nx-text-secondary)]"
          >
            {reasonLabel}{' '}
            {isMandatory ? (
              <span className="text-[var(--nx-status-danger)]" aria-hidden="true">
                *
              </span>
            ) : (
              <span className="text-[var(--nx-text-muted)] font-normal">（选填）</span>
            )}
          </label>
          <span
            className={cn(
              'font-mono text-[10px]',
              isInvalid && trimmedLength > 0
                ? 'text-[var(--nx-status-danger)]'
                : 'text-[var(--nx-text-muted)]',
            )}
          >
            {trimmedLength} / 5 字符
          </span>
        </div>
        <textarea
          id="pmo-decision-reason"
          rows={3}
          data-testid="decision-reason-input"
          value={decisionReason}
          disabled={disabled}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder={reasonPlaceholder}
          className={cn(
            'resize-y rounded-md border bg-[var(--nx-bg-1)] px-2.5 py-2 text-xs text-[var(--nx-text-primary)] placeholder-[var(--nx-text-muted)] transition-colors focus:outline-none disabled:opacity-50',
            showReasonError
              ? 'border-[var(--nx-status-danger)] focus:border-[var(--nx-status-danger)]'
              : 'border-[var(--nx-border-hairline)] focus:border-[var(--nx-border-focus)]',
          )}
        />
        {showReasonError && (
          <p
            role="alert"
            data-testid="decision-reason-error"
            className="flex items-center gap-1 text-[11px] text-[var(--nx-status-danger)]"
          >
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </p>
        )}
      </div>
    </div>
  )
}
