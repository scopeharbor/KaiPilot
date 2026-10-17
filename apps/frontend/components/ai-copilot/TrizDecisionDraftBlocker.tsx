'use client'

import React from 'react'
import {
  AlertTriangle,
  Plus,
  Award,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Braces,
  HelpCircle,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Alert } from '@/components/ui/Alert'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { PermissionGuard } from '@/components/PermissionGuard'
import { cn } from '@/lib/utils'
import type { TrizDecisionSubjectRef, TrizDecisionSourceRef } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 表示一个缺失决策的 blocker 项。 */
export interface TrizDecisionBlocker {
  /** Blocker 唯一 ID。 */
  id: string
  /** 决策主题 ref。 */
  subjectRef: TrizDecisionSubjectRef
  /** 可读的 blocker 摘要。 */
  summary: string
  /** 关联的 TRIZ 矛盾类型。 */
  trizCategory?: string
  /** 相关来源 refs。 */
  sourceRefs?: TrizDecisionSourceRef[]
  /** 是否已有对应的决策日志。 */
  hasDecisionLog: boolean
  /** 是否严重（无决策时 Draft Apply 将被阻塞）。 */
  isBlocking: boolean
}

export interface TrizDecisionDraftBlockerProps {
  /** 项目 ID。 */
  projectId: number
  /** 缺失决策的 blocker 列表。 */
  blockers: TrizDecisionBlocker[]
  /** 是否正在加载。 */
  isLoading?: boolean
  /** 创建决策回调（跳转到创建决策页面/面板）。 */
  onCreateDecision: (blocker: TrizDecisionBlocker) => void
  /** 查看已有决策回调。 */
  onViewDecision: (blocker: TrizDecisionBlocker) => void
  /** 刷新 blocker 列表。 */
  onRefresh?: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const trizCategoryLabel: Record<string, string> = {
  trade_off: '取舍',
  priority: '优先级',
  constraint: '约束',
  assumption: '假设',
  solution_preference: '解决偏好',
}

// ---------------------------------------------------------------------------
// Blocker Item
// ---------------------------------------------------------------------------

function BlockerItem({
  blocker,
  onCreateDecision,
  onViewDecision,
}: {
  blocker: TrizDecisionBlocker
  onCreateDecision: () => void
  onViewDecision: () => void
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3 space-y-2',
        blocker.isBlocking && !blocker.hasDecisionLog
          ? 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30'
          : 'border-border',
      )}
      role="listitem"
      aria-label={`Blocker: ${blocker.summary}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {blocker.isBlocking && !blocker.hasDecisionLog ? (
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{blocker.summary}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {blocker.trizCategory && (
                <Badge variant="info" className="text-[10px] px-1.5 py-0">
                  <Award className="w-2.5 h-2.5 mr-0.5" />
                  {trizCategoryLabel[blocker.trizCategory] ?? blocker.trizCategory}
                </Badge>
              )}
              {blocker.hasDecisionLog ? (
                <Badge variant="success" className="text-[10px] px-1.5 py-0">
                  <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                  已有决策
                </Badge>
              ) : (
                <Badge variant="warning" className="text-[10px] px-1.5 py-0">
                  <HelpCircle className="w-2.5 h-2.5 mr-0.5" />
                  待决策
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Source refs summary */}
      {blocker.sourceRefs && blocker.sourceRefs.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors">
            <span className="inline-flex items-center gap-1">
              <Braces className="w-3 h-3" />
              来源引用 ({blocker.sourceRefs.length})
            </span>
          </summary>
          <ul className="mt-1 space-y-1 pl-4 list-disc">
            {blocker.sourceRefs.map((ref, i) => (
              <li key={i}>
                <span className="font-medium">{ref.kind}</span>
                {ref.summary && <span> — {ref.summary}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        {blocker.hasDecisionLog ? (
          <Button variant="outline" size="sm" onClick={onViewDecision}>
            <ExternalLink className="w-3 h-3 mr-1" />
            查看决策
          </Button>
        ) : (
          <PermissionGuard require="triz_decision:manage" fallback={null}>
            <Button variant="primary" size="sm" onClick={onCreateDecision}>
              <Plus className="w-3 h-3 mr-1" />
              创建决策
            </Button>
          </PermissionGuard>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

/**
 * (P1) Draft Review 决策证据 UI。
 *
 * 显示缺失的 TRIZ 决策 blocker，让用户在 Draft Apply 前补充决策理由。
 * 无 manage 权限时隐藏创建按钮，但仍可查看 blocker 状态。
 */
export function TrizDecisionDraftBlocker({
  projectId: _projectId,
  blockers,
  isLoading = false,
  onCreateDecision,
  onViewDecision,
  onRefresh,
}: TrizDecisionDraftBlockerProps) {
  const blockingCount = blockers.filter((b) => b.isBlocking && !b.hasDecisionLog).length
  const resolvedCount = blockers.filter((b) => b.hasDecisionLog).length

  return (
    <Card variant="outlined" className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Award className="w-4 h-4 text-purple-500" />
              TRIZ 决策证据检查
            </CardTitle>
            <CardDescription>在应用 Draft 前需要确认的 TRIZ 决策项</CardDescription>
          </div>
          {onRefresh && (
            <Button variant="ghost" size="sm" onClick={onRefresh}>
              <Loader2 className="w-3 h-3 mr-1" />
              刷新
            </Button>
          )}
        </div>

        {/* Summary badges */}
        <div className="flex items-center gap-2 mt-2">
          {blockingCount > 0 && (
            <Badge variant="danger" className="gap-1">
              <AlertTriangle className="w-3 h-3" />
              {blockingCount} 项阻塞
            </Badge>
          )}
          {resolvedCount > 0 && (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {resolvedCount} 项已决策
            </Badge>
          )}
          {blockers.length === 0 && !isLoading && (
            <Badge variant="neutral" className="gap-1">
              <CheckCircle2 className="w-3 h-3" />
              无需额外决策
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* Loading */}
        {isLoading && (
          <div className="space-y-3" role="status" aria-label="加载 blocker 列表中">
            {[1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-48" />
                </div>
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        )}

        {/* Blocking alert */}
        {!isLoading && blockingCount > 0 && (
          <Alert variant="warning" className="mb-3">
            有 {blockingCount} 项 TRIZ 决策尚未记录。在 Draft Apply 前需要完成这些决策， 否则 Apply
            操作将被阻塞。
          </Alert>
        )}

        {/* Empty state */}
        {!isLoading && blockers.length === 0 && (
          <EmptyState
            icon={CheckCircle2}
            title="所有 TRIZ 决策已完成"
            description="当前 Draft 涉及的 TRIZ 矛盾均已记录决策日志。"
          />
        )}

        {/* Blocker list */}
        {!isLoading && blockers.length > 0 && (
          <div className="space-y-3" role="list" aria-label="TRIZ 决策 blocker 列表">
            {blockers.map((blocker) => (
              <BlockerItem
                key={blocker.id}
                blocker={blocker}
                onCreateDecision={() => onCreateDecision(blocker)}
                onViewDecision={() => onViewDecision(blocker)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default TrizDecisionDraftBlocker
