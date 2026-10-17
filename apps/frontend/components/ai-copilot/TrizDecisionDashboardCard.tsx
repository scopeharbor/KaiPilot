'use client'

import React from 'react'
import {
  Award,
  AlertTriangle,
  HelpCircle,
  CheckCircle2,
  FileEdit,
  XCircle,
  RefreshCw,
  AlertCircle,
  Eye,
  Inbox,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import type { TrizDecisionDashboardSummary } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrizDecisionDashboardCardProps {
  /** 项目 ID。 */
  projectId: number
  /** Dashboard 决策日志摘要（由父组件通过查询获取）。 */
  summary: TrizDecisionDashboardSummary | null | undefined
  /** 是否正在加载。 */
  isLoading?: boolean
  /** 是否有错误。 */
  isError?: boolean
  /** 导航到决策日志页面。 */
  onNavigateToDecisions?: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const decisionTypeIcon: Record<string, LucideIcon> = {
  adopt: CheckCircle2,
  reject: XCircle,
  partial_accept: AlertCircle,
  modified_accept: FileEdit,
  clarification_requested: HelpCircle,
  supersede: RefreshCw,
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ts
  }
}

// ---------------------------------------------------------------------------
// Stat Tile
// ---------------------------------------------------------------------------

function StatTile({
  icon: Icon,
  label,
  value,
  variant,
}: {
  icon: LucideIcon
  label: string
  value: number
  variant: 'danger' | 'warning' | 'info' | 'neutral'
}) {
  const colorMap = {
    danger: 'text-danger',
    warning: 'text-warning',
    info: 'text-info',
    neutral: 'text-gray-500',
  }
  return (
    <div className="flex flex-col items-center gap-1 p-3 rounded-lg border border-border bg-gray-0">
      <Icon className={cn('w-5 h-5', colorMap[variant])} />
      <span className="text-2xl font-bold text-gray-800">{value}</span>
      <span className="text-xs text-muted-foreground text-center">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="加载决策摘要中">
      {/* Stat tiles skeleton */}
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-1 p-3 rounded-lg border border-border"
          >
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-7 w-8" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      {/* List skeleton */}
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

/**
 * (P1) Dashboard TRIZ 决策摘要卡片。
 *
 * 显示待处理决策数、缺失理由数、近期关键决策及过期 ref 警告。
 * 无 `triz_decision:view` 权限时，显示脱敏的 count=0 状态。
 */
export function TrizDecisionDashboardCard({
  projectId: _projectId,
  summary,
  isLoading = false,
  isError = false,
  onNavigateToDecisions,
}: TrizDecisionDashboardCardProps) {
  const { can } = usePermissions()
  const canView = can('triz_decision:view')

  // No-view permission: show non-disclosing empty state
  if (!canView) {
    return (
      <Card variant="outlined" className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <Award className="w-4 h-4" />
            TRIZ 决策
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Eye}
            title="无权限查看"
            description="您没有查看 TRIZ 决策摘要的权限。"
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card variant="outlined" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="w-4 h-4 text-purple-500" />
          TRIZ 决策
        </CardTitle>
        <CardDescription>TRIZ 矛盾决策状态摘要</CardDescription>
      </CardHeader>

      <CardContent>
        {/* Loading */}
        {isLoading && <DashboardSkeleton />}

        {/* Error */}
        {isError && !isLoading && (
          <EmptyState
            icon={AlertCircle}
            title="加载失败"
            description="无法加载 TRIZ 决策摘要，请稍后重试。"
          />
        )}

        {/* Summary data */}
        {!isLoading && !isError && summary && (
          <div className="space-y-4">
            {/* Stat tiles */}
            <div className="grid grid-cols-3 gap-2">
              <StatTile
                icon={HelpCircle}
                label="待处理"
                value={summary.pendingDecisionCount}
                variant={summary.pendingDecisionCount > 0 ? 'warning' : 'neutral'}
              />
              <StatTile
                icon={AlertTriangle}
                label="缺失理由"
                value={summary.missingReasonCount}
                variant={summary.missingReasonCount > 0 ? 'danger' : 'neutral'}
              />
              <StatTile
                icon={RefreshCw}
                label="过期引用"
                value={summary.staleRefCount}
                variant={summary.staleRefCount > 0 ? 'warning' : 'neutral'}
              />
            </div>

            {/* Stale ref warning */}
            {summary.staleRefCount > 0 && (
              <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 rounded-md p-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  有 {summary.staleRefCount} 项决策引用的 artifact 已过期，建议核查并更新。
                </span>
              </div>
            )}

            {/* Recent key decisions */}
            {summary.recentKeyDecisions.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700">近期关键决策</h4>
                <div className="space-y-1.5">
                  {summary.recentKeyDecisions.slice(0, 5).map((entry) => {
                    const Icon = decisionTypeIcon[entry.decisionType] ?? HelpCircle
                    return (
                      <div key={entry.id} className="flex items-start gap-2 text-xs text-gray-600">
                        <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{entry.reasonSummary}</p>
                          <p className="text-muted-foreground">
                            {formatTimestamp(entry.createdAt)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Empty: no decisions at all */}
            {summary.pendingDecisionCount === 0 &&
              summary.recentKeyDecisions.length === 0 &&
              summary.staleRefCount === 0 && (
                <EmptyState
                  icon={Inbox}
                  title="暂无决策"
                  description="尚未记录任何 TRIZ 决策日志。"
                />
              )}
          </div>
        )}

        {/* Fallback for null/undefined summary without loading/error */}
        {!isLoading && !isError && !summary && (
          <EmptyState icon={Inbox} title="暂无数据" description="暂无 TRIZ 决策摘要数据。" />
        )}
      </CardContent>

      {/* Footer navigation */}
      {onNavigateToDecisions && !isLoading && !isError && (
        <CardFooter>
          <Button variant="ghost" size="sm" onClick={onNavigateToDecisions}>
            查看完整决策日志
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

export default TrizDecisionDashboardCard
