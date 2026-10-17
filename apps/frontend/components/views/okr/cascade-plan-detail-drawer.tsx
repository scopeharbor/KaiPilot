'use client'

// 级联计划详情抽屉（v3-okr-cascade-and-alignment §5.5）。
// 展示选中 diff、警告、冲突状态、确认/驳回操作。

import { useState } from 'react'
import {
  useCascadePlan,
  useConfirmCascadeItems,
  useRejectCascadeItems,
} from '@/hooks/use-okr-cascade-alignment'
import type {
  OkrCascadePlanItemConfirmRequest,
  OkrCascadePlanItemRejectRequest,
} from '@aiproj/types'
import { cn } from '@/lib/utils'

export interface CascadePlanDetailDrawerProps {
  organizationId: number
  planId: number
  open: boolean
  onClose: () => void
}

export function CascadePlanDetailDrawer({
  organizationId,
  planId,
  open,
  onClose,
}: CascadePlanDetailDrawerProps) {
  const { data, isLoading, error } = useCascadePlan(organizationId, planId)
  const confirmMutation = useConfirmCascadeItems(organizationId, planId)
  const rejectMutation = useRejectCascadeItems(organizationId, planId)

  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set())
  const [rejectionReasons, setRejectionReasons] = useState<Record<number, string>>({})
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null)

  if (!open) return null

  const plan = data?.data
  const items = plan?.items ?? []

  // ── 全选/取消 ──
  function toggleAll() {
    if (selectedItemIds.size === items.length) {
      setSelectedItemIds(new Set())
    } else {
      setSelectedItemIds(new Set(items.map((i) => i.id)))
    }
  }

  function toggleItem(id: number) {
    const next = new Set(selectedItemIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedItemIds(next)
  }

  // ── 确认 ──
  async function handleConfirm() {
    setConfirmError(null)
    setConfirmSuccess(null)
    // 契约字段是 acceptedItemIds / rejectedItemIds / rejectionReasons，
    // 没有 itemIds、也不收 revisionHash。
    const input: OkrCascadePlanItemConfirmRequest = {
      acceptedItemIds: Array.from(selectedItemIds),
    }
    try {
      await confirmMutation.mutateAsync(input)
      setConfirmSuccess('已确认所选级联项')
      setSelectedItemIds(new Set())
    } catch (err: unknown) {
      setConfirmError(err instanceof Error ? err.message : '确认失败')
    }
  }

  // ── 驳回 ──
  async function handleReject() {
    setConfirmError(null)
    setConfirmSuccess(null)
    // 契约是 rejectedItemIds + 单个 reason 字符串，不是逐项 reasons 数组。
    const selected = Array.from(selectedItemIds)
    const input: OkrCascadePlanItemRejectRequest = {
      rejectedItemIds: selected,
      reason:
        selected
          .map((id) => rejectionReasons[id])
          .filter((r): r is string => Boolean(r && r.trim()))
          .join('；') || '未填写驳回理由',
    }
    try {
      await rejectMutation.mutateAsync(input)
      setConfirmSuccess('已驳回所选级联项')
      setSelectedItemIds(new Set())
      setRejectionReasons({})
    } catch (err: unknown) {
      setConfirmError(err instanceof Error ? err.message : '驳回失败')
    }
  }

  // ── 加载态 ──
  if (isLoading) {
    return (
      <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-background border-l shadow-xl z-50 overflow-y-auto">
        <div className="p-6 text-muted-foreground">加载中...</div>
      </div>
    )
  }

  // ── 错误态 ──
  if (error || !plan) {
    return (
      <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-background border-l shadow-xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-background border-b p-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">级联计划详情</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="p-6 text-destructive">
          {error ? (error as Error).message : '未找到级联计划'}
        </div>
      </div>
    )
  }

  const statusLabels: Record<string, string> = {
    draft: '草稿',
    confirmed: '已确认',
    rejected: '已驳回',
    partial: '部分确认',
  }

  return (
    <div
      className="fixed inset-y-0 right-0 w-full max-w-xl bg-background border-l shadow-xl z-50 overflow-y-auto"
      data-testid="cascade-plan-detail-drawer"
    >
      {/* Header */}
      <div className="sticky top-0 bg-background border-b p-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{plan.title}</h2>
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded',
              plan.status === 'draft'
                ? 'bg-gray-100 text-gray-700'
                : plan.status === 'confirmed'
                  ? 'bg-green-100 text-green-700'
                  : plan.status === 'rejected'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-700',
            )}
          >
            {statusLabels[plan.status] ?? plan.status}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground p-1"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Meta */}
        <div className="text-sm text-muted-foreground space-y-1">
          <div>
            覆盖: {plan.coverage ?? 0} 项 · 版本: {plan.metricVersion ?? 'v1'}
          </div>
          {plan.warnings && plan.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded p-2 text-amber-800 text-xs">
              {/* OkrWarning 恒为 { code, message } 对象，无需再判字符串 */}
              {plan.warnings.map((w, i) => (
                <div key={i}>⚠ {w.message}</div>
              ))}
            </div>
          )}
        </div>

        {/* Error / Success */}
        {confirmError && (
          <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
            {confirmError}
          </div>
        )}
        {confirmSuccess && (
          <div className="text-sm text-green-700 bg-green-50 p-2 rounded">{confirmSuccess}</div>
        )}

        {/* 全选 */}
        {items.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={selectedItemIds.size === items.length}
                onChange={toggleAll}
              />
              全选
            </label>
            <span className="text-xs text-muted-foreground">
              {selectedItemIds.size}/{items.length} 已选
            </span>
          </div>
        )}

        {/* 空态 */}
        {items.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            该级联计划暂无候选项。
          </div>
        )}

        {/* 级联项列表 */}
        <div className="space-y-2">
          {items.map((item) => {
            const candidate = item.candidateObjective
            const isSelected = selectedItemIds.has(item.id)
            const hasConflict = !!item.conflictWarning

            return (
              <div
                key={item.id}
                className={cn(
                  'border rounded p-3 transition-colors',
                  isSelected ? 'border-primary bg-primary/5' : 'border-border',
                  hasConflict && 'border-amber-300 bg-amber-50',
                )}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleItem(item.id)}
                    disabled={item.status === 'confirmed' || item.status === 'rejected'}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {candidate?.title ?? `候选项 #${item.id}`}
                    </div>
                    {candidate?.scope && (
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {candidate.scope}
                      </span>
                    )}
                    {item.coverageGap && (
                      <div className="text-xs text-amber-600 mt-1">
                        ⚠ 覆盖缺口: {item.coverageGap}
                      </div>
                    )}
                    {item.conflictWarning && (
                      <div className="text-xs text-red-600 mt-1">
                        ⚠ 冲突: {item.conflictWarning}
                      </div>
                    )}
                    {item.status === 'confirmed' && (
                      <div className="text-xs text-green-600 mt-1">✓ 已确认</div>
                    )}
                    {item.status === 'rejected' && (
                      <div className="text-xs text-red-600 mt-1">
                        ✗ 已驳回: {item.rejectionReason ?? '无原因'}
                      </div>
                    )}
                  </div>
                </div>

                {/* 驳回原因输入 */}
                {isSelected && (
                  <div className="mt-2 ml-6">
                    <input
                      type="text"
                      className="border rounded px-2 py-1 text-xs w-full"
                      placeholder="驳回原因（可选）"
                      value={rejectionReasons[item.id] ?? ''}
                      onChange={(e) =>
                        setRejectionReasons((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer 操作栏 */}
      {plan.status === 'draft' && items.length > 0 && (
        <div className="sticky bottom-0 bg-background border-t p-4 flex gap-2">
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50 flex-1"
            onClick={handleConfirm}
            disabled={
              selectedItemIds.size === 0 || confirmMutation.isPending || rejectMutation.isPending
            }
          >
            {confirmMutation.isPending ? '确认中...' : `确认所选 (${selectedItemIds.size})`}
          </button>
          <button
            className="px-4 py-2 bg-destructive/10 text-destructive rounded text-sm disabled:opacity-50"
            onClick={handleReject}
            disabled={
              selectedItemIds.size === 0 || confirmMutation.isPending || rejectMutation.isPending
            }
          >
            {rejectMutation.isPending ? '驳回中...' : '驳回所选'}
          </button>
        </div>
      )}
    </div>
  )
}
