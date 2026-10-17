'use client'

import React from 'react'
import {
  Award,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileEdit,
  HelpCircle,
  RefreshCw,
  Lock,
  ExternalLink,
  Clock,
  User,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
import type { TrizDecisionTimelineEvent } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrizDecisionTimelineEventProps {
  /** Timeline 事件数据。 */
  event: TrizDecisionTimelineEvent
  /** 点击导航到详情时的回调（仅在有权限时可用）。 */
  onNavigateToDetail?: (eventId: number) => void
  /** 是否以紧凑模式展示（用于 Timeline 列表项）。 */
  compact?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const decisionTypeMeta: Record<
  string,
  {
    label: string
    icon: LucideIcon
    badgeVariant: 'success' | 'danger' | 'warning' | 'info' | 'neutral'
  }
> = {
  adopt: { label: '采纳', icon: CheckCircle2, badgeVariant: 'success' },
  reject: { label: '驳回', icon: XCircle, badgeVariant: 'danger' },
  partial_accept: { label: '部分采纳', icon: AlertCircle, badgeVariant: 'warning' },
  modified_accept: { label: '修改后采纳', icon: FileEdit, badgeVariant: 'info' },
  clarification_requested: { label: '请求补充说明', icon: HelpCircle, badgeVariant: 'neutral' },
  supersede: { label: '废止', icon: RefreshCw, badgeVariant: 'danger' },
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
// Skeleton
// ---------------------------------------------------------------------------

/**
 * Timeline 事件的骨架屏占位。
 */
export function TrizTimelineEventSkeleton() {
  return (
    <div className="flex items-start gap-3 py-3" role="status" aria-label="加载时间线事件中">
      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

/**
 * (P1) Timeline 渲染支持 —— TRIZ 决策时间线事件。
 *
 * 安全导航：
 * - 有权限时（event.hasAccess === true）允许点击导航到详情。
 * - 无权限时隐藏详情链接，仅显示低敏摘要。
 *
 * Unavailable-target 状态：
 * - 当用户访问目标对象无权限时，不暴露目标具体信息。
 */
export function TrizDecisionTimelineEvent({
  event,
  onNavigateToDetail,
  compact = false,
}: TrizDecisionTimelineEventProps) {
  const meta = decisionTypeMeta[event.decisionType] ?? {
    label: event.decisionType,
    icon: HelpCircle,
    badgeVariant: 'neutral' as const,
  }
  const Icon = meta.icon

  return (
    <div
      className={cn('flex items-start gap-3 py-2', compact ? 'py-1.5' : 'py-3')}
      role="listitem"
      aria-label={`TRIZ 决策事件: ${meta.label}`}
    >
      {/* Icon circle */}
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300',
        )}
      >
        <Award className="h-4 w-4" />
      </span>

      <div className="flex-1 min-w-0 space-y-1">
        {/* Header: decision type badge + timestamp */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={meta.badgeVariant} className="gap-1">
            <Icon className="w-3 h-3" />
            {meta.label}
          </Badge>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {formatTimestamp(event.createdAt)}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <User className="w-3 h-3" />#{event.createdBy}
          </span>
        </div>

        {/* Subject summary — safe to display (low-sensitivity) */}
        {event.hasAccess && event.subjectSummary ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">{event.subjectSummary}</p>
        ) : event.hasAccess ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">{event.reasonSummary}</p>
        ) : (
          /* Unavailable-target: hide details when user lacks access */
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="w-3 h-3" />
            <span>无法访问目标详情</span>
          </div>
        )}

        {/* Action: navigate to detail (only when user has access) */}
        {event.hasAccess && onNavigateToDetail && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigateToDetail(event.id)}
            className="text-xs text-muted-foreground h-auto px-0 py-0 hover:bg-transparent hover:text-primary-500"
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            查看详情
          </Button>
        )}
      </div>
    </div>
  )
}

export default TrizDecisionTimelineEvent
