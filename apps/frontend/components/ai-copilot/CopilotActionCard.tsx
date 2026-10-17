'use client'

/**
 * v3-copilot-action-and-preview-boundary —— CopilotActionCard 组件（任务 6.1-6.12）。
 *
 * 动作卡片：最多三个主操作 + 其余折叠；按钮 idle→loading→success/failure 明确反馈；
 * 假设/可信度插槽原样渲染归属能力内容（不做假设编辑、不做置信度档位映射）；
 * 「依赖替代默认值但假设插槽未接入」→ 不可确认且有可读中文提示；
 * 无权限动作**不渲染**（非禁用可见，不泄露动作存在）；stale 动作视觉标记 + 刷新入口；
 * 全部可见措辞为审查导向中文（禁止自动执行措辞，按声明清单测试校验）。
 */
import React, { useCallback, useRef, useState } from 'react'
import type {
  CopilotActionButtonState,
  CopilotActionCard,
  CopilotActionCardControl,
  CopilotActionKind,
} from '@aiproj/types'
import { copilotActionCardConfirmBlockReason, copilotActionKindLabel } from '@aiproj/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card'

export interface CopilotActionCardProps {
  card: CopilotActionCard
  /** actor 拥有的权限集；无权限的动作不渲染。 */
  actorPermissions?: readonly string[]
  /** 执行动作；resolve/reject 决定按钮 success/failure 反馈。 */
  onAction?: (kind: CopilotActionKind, card: CopilotActionCard) => Promise<void>
  /** stale 动作的刷新入口。 */
  onRefresh?: (card: CopilotActionCard) => void
}

interface ControlFeedback {
  readonly state: CopilotActionButtonState
  readonly message: string | null
}

function hasPermission(
  control: CopilotActionCardControl,
  actorPermissions: readonly string[],
): boolean {
  if (!control.requiredPermission) return true
  return actorPermissions.includes(control.requiredPermission)
}

export function CopilotActionCard({
  card,
  actorPermissions = [],
  onAction,
  onRefresh,
}: CopilotActionCardProps) {
  const [feedback, setFeedback] = useState<Record<string, ControlFeedback>>({})
  const [moreOpen, setMoreOpen] = useState(false)
  const runningRef = useRef(false)

  const confirmBlockReason = copilotActionCardConfirmBlockReason(card)

  // 权限过滤：无权限的动作不渲染（非禁用可见，不泄露动作存在）
  const visiblePrimary = card.primaryActions.filter((c) => hasPermission(c, actorPermissions))
  const visibleSecondary = card.secondaryActions.filter((c) => hasPermission(c, actorPermissions))

  const handleClick = useCallback(
    async (control: CopilotActionCardControl) => {
      if (!onAction || runningRef.current) return
      if (confirmBlockReason) return
      runningRef.current = true
      setFeedback((prev) => ({ ...prev, [control.kind]: { state: 'loading', message: null } }))
      try {
        await onAction(control.kind, card)
        setFeedback((prev) => ({
          ...prev,
          [control.kind]: { state: 'success', message: '操作已完成' },
        }))
      } catch {
        setFeedback((prev) => ({
          ...prev,
          [control.kind]: { state: 'failure', message: '操作失败，请重试' },
        }))
      } finally {
        runningRef.current = false
      }
    },
    [onAction, card, confirmBlockReason],
  )

  const renderControl = (control: CopilotActionCardControl) => {
    const fb = feedback[control.kind]
    const state = fb?.state ?? control.state
    const disabled = state === 'loading' || !!confirmBlockReason || !!control.disabledReason
    return (
      <Button
        key={control.kind}
        variant={
          control.kind === 'apply_proposal'
            ? 'primary'
            : control.kind === 'discard'
              ? 'ghost'
              : 'secondary'
        }
        size="sm"
        disabled={disabled}
        loading={state === 'loading'}
        data-state={state}
        onClick={() => void handleClick(control)}
        aria-label={control.label}
      >
        {state === 'loading' ? '处理中…' : control.label}
        {state === 'success' ? ' ✓' : ''}
        {state === 'failure' ? ' ✗' : ''}
      </Button>
    )
  }

  return (
    <Card data-testid={`copilot-action-card-${card.actionCardId}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="text-sm">{card.recommendedAction.label}</CardTitle>
          {card.recommendedAction.lowSensitivitySummary ? (
            <p className="mt-1 text-xs text-gray-500">
              {card.recommendedAction.lowSensitivitySummary}
            </p>
          ) : null}
        </div>
        {card.recommendedAction.isStale ? (
          <Badge variant="warning" data-testid="stale-badge">
            来源已过期
          </Badge>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* 假设/可信度插槽：原样渲染归属能力内容，不做转换 */}
        {card.assumptionSlot.supplied ? (
          <ul className="space-y-1 rounded-md border p-2 text-xs" data-testid="assumption-slot">
            {card.assumptionSlot.assumptions.map((assumption) => (
              <li key={assumption.assumptionId} className="flex items-start justify-between gap-2">
                <span className="text-gray-700">{assumption.statement}</span>
                <span className="shrink-0 text-gray-400">可信度 {assumption.confidence}</span>
              </li>
            ))}
          </ul>
        ) : (
          // 插槽未接入：保持布局完整，无空白错位（任务 6.7）
          <div className="hidden" data-testid="assumption-slot-empty" />
        )}

        {confirmBlockReason ? (
          <p className="text-xs text-amber-600" data-testid="confirm-block-reason">
            {confirmBlockReason}
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        {visiblePrimary.map(renderControl)}
        {visibleSecondary.length > 0 ? (
          <div className="relative">
            <Button variant="secondary" size="sm" onClick={() => setMoreOpen((v) => !v)}>
              更多
            </Button>
            {moreOpen ? (
              <div className="absolute right-0 z-10 mt-1 flex flex-col gap-1 rounded border bg-white p-1 shadow">
                {visibleSecondary.map(renderControl)}
              </div>
            ) : null}
          </div>
        ) : null}
        {card.recommendedAction.isStale && onRefresh ? (
          <Button variant="ghost" size="sm" onClick={() => onRefresh(card)}>
            刷新来源后重新审查
          </Button>
        ) : null}
        {/* 按钮结果反馈（success/failure 明确提示，禁止无反馈态） */}
        {Object.entries(feedback).map(([kind, fb]) =>
          fb.state === 'success' || fb.state === 'failure' ? (
            <span
              key={kind}
              data-testid={`feedback-${kind}`}
              className={fb.state === 'success' ? 'text-xs text-green-600' : 'text-xs text-red-600'}
            >
              {fb.message}
            </span>
          ) : null,
        )}
      </CardFooter>
    </Card>
  )
}

export function copilotActionCardTitle(kind: CopilotActionKind): string {
  return copilotActionKindLabel(kind)
}
