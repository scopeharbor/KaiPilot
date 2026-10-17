'use client'

import Link from 'next/link'
import { Ban, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import type { TimelineEvent } from '@/lib/api/timeline'
import {
  CATEGORY_META,
  formatClockTime,
  formatRelativeTime,
  IMPORTANCE_META,
} from '@/lib/timeline-state'

interface TimelineEventCardProps {
  event: TimelineEvent
}

/**
 * 单条 Timeline 事件卡片。
 *
 * - 目标可访问：整卡为可键盘聚焦的链接，Enter 打开详情（保持项目上下文）。
 * - 目标不可访问 / 已删除：渲染为非交互卡片，展示低敏中文反馈，不泄露名称。
 * - 聚合卡：展示「创建了 N 个任务」摘要与被聚合目标数。
 * - AI 事件只导航到审查/详情页（href 由服务端给出），绝不触发自动执行。
 */
export function TimelineEventCard({ event }: TimelineEventCardProps) {
  const meta = CATEGORY_META[event.category] ?? CATEGORY_META.other
  const Icon = meta.icon
  const importance = IMPORTANCE_META[event.importance]
  const target = event.targetRef
  const canDrill = Boolean(target && target.accessible && target.href)
  const targetInaccessible = Boolean(target && !target.accessible)

  const body = (
    <div className="flex flex-1 items-start gap-3">
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500"
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-gray-800">{event.actor.displayName}</span>
          <span className="min-w-0 break-words text-sm text-gray-600">{event.summary}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={meta.badge}>{meta.label}</Badge>
          {event.isKeyEvent ? <Badge variant="danger">关键</Badge> : null}
          {!event.isKeyEvent && (event.importance === 'high' || event.importance === 'critical') ? (
            <Badge variant={importance.badge}>{importance.label}</Badge>
          ) : null}
          {event.isAggregated && event.aggregatedCount ? (
            <Badge variant="neutral">共 {event.aggregatedCount} 项</Badge>
          ) : null}
          <time
            className="text-xs text-gray-400"
            dateTime={event.occurredAt}
            title={formatClockTime(event.occurredAt)}
          >
            {formatRelativeTime(event.occurredAt)}
          </time>
        </div>
        {event.secondaryText ? (
          <p className="text-xs text-gray-500">{event.secondaryText}</p>
        ) : null}
        {targetInaccessible ? (
          <p className="flex items-center gap-1 text-xs text-gray-400">
            <Ban className="h-3 w-3" aria-hidden />
            目标不可访问或已被移除
          </p>
        ) : null}
      </div>
      {canDrill ? (
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-300" aria-hidden />
      ) : null}
    </div>
  )

  const baseClass =
    'flex items-start rounded-[var(--radius-md)] border border-border bg-surface p-3 transition-colors'

  if (canDrill && target?.href) {
    return (
      <li>
        <Link
          href={target.href}
          className={cn(
            baseClass,
            'hover:border-primary-200 hover:bg-primary-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          )}
          aria-label={`${event.actor.displayName} ${event.summary}，${formatClockTime(event.occurredAt)}`}
        >
          {body}
        </Link>
      </li>
    )
  }

  return (
    <li
      className={cn(baseClass, 'cursor-default')}
      aria-label={`${event.actor.displayName} ${event.summary}，${formatClockTime(event.occurredAt)}`}
    >
      {body}
    </li>
  )
}
