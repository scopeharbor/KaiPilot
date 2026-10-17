'use client'

import * as React from 'react'
import { AlertTriangle, Bell, Calendar, ArrowRight, CheckCircle2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  generateMorningBriefing,
  type MorningBriefingData,
  type BriefingTaskLike,
} from '@/lib/next/ai-morning-briefing'
import type { Notification } from '@/lib/api/notifications'
import { useNotificationDrawerStore } from '@/components/next/notifications/use-notification-drawer'
import { formatRelativeTime } from '@/lib/timeline-state'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'

export interface AiMorningBriefingCardProps {
  data?: MorningBriefingData
  notifications?: readonly Notification[]
  tasks?: readonly BriefingTaskLike[]
  onOpenNotificationDrawer?: () => void
  onNavigateTodayTasks?: () => void
  toolName?: string
  className?: string
}

export function AiMorningBriefingCard({
  data: directData,
  notifications,
  tasks,
  onOpenNotificationDrawer,
  onNavigateTodayTasks,
  toolName = 'get_morning_briefing',
  className,
}: AiMorningBriefingCardProps) {
  const router = useRouter()
  const immersionTier = useImmersionTier()
  const isPrecise = immersionTier === 'precise'
  const openDrawer = useNotificationDrawerStore((state) => state.openDrawer)

  // 优先取直接注入的 data，次之客户端即时合成
  const briefing: MorningBriefingData = React.useMemo(() => {
    if (directData) return directData
    return generateMorningBriefing(notifications ?? [], tasks ?? [])
  }, [directData, notifications, tasks])

  const handleOpenDrawer = () => {
    if (onOpenNotificationDrawer) {
      onOpenNotificationDrawer()
    } else {
      openDrawer()
    }
  }

  const handleNavigateTasks = () => {
    if (onNavigateTodayTasks) {
      onNavigateTodayTasks()
    } else {
      router.push('/next')
    }
  }

  const { urgentNotifications, todayTasksSummary } = briefing

  return (
    <div
      data-ai-morning-briefing-card
      data-immersion={immersionTier}
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface,#121418)] p-4 text-[var(--nx-text-primary)] shadow-md transition-all',
        isPrecise && 'shadow-none transition-none',
        className,
      )}
    >
      {/* 顶部发丝微标 */}
      <div className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] pb-2.5">
        <div className="flex items-center gap-2">
          <span
            data-morning-briefing-badge
            className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-0.5 font-mono text-[10px] text-[var(--nx-accent)]"
          >
            <span aria-hidden>⚡</span>
            态势简报 · Morning Briefing
          </span>
          <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">{toolName}</span>
        </div>
        <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
          {briefing.generatedAt ? `生成于 ${briefing.generatedAt}` : '实时合成'}
        </span>
      </div>

      {/* 板块一：紧急通知关注 */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--nx-text-primary)]">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden />
          <span>紧急通知关注</span>
        </div>

        {urgentNotifications.length === 0 ? (
          <div className="flex items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs text-[var(--nx-text-muted)]">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
            <span>当前暂无高危紧急未读通知，团队运行平稳</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {urgentNotifications.map((n) => (
              <div
                key={n.id}
                data-urgent-notification-item
                className="flex items-start justify-between gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        n.severity === 'critical' || n.severity === 'error'
                          ? 'bg-rose-500'
                          : 'bg-amber-500',
                      )}
                    />
                    <span className="truncate font-medium text-[var(--nx-text-primary)]">
                      {n.title}
                    </span>
                  </div>
                  {n.body && (
                    <p className="line-clamp-1 text-[11px] text-[var(--nx-text-muted)]">{n.body}</p>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]">
                  {formatRelativeTime(n.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 板块二：今日排程焦点 */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--nx-text-primary)]">
          <Calendar className="h-3.5 w-3.5 text-sky-400" aria-hidden />
          <span>今日排程焦点</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2 text-center">
            <span className="text-[10px] text-[var(--nx-text-muted)]">今日截止待办</span>
            <span
              data-metric-due-today
              className="mt-0.5 font-mono text-base font-semibold text-amber-400"
            >
              {todayTasksSummary.dueTodayCount}
            </span>
          </div>

          <div className="flex flex-col rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2 text-center">
            <span className="text-[10px] text-[var(--nx-text-muted)]">已逾期关键项</span>
            <span
              data-metric-overdue
              className="mt-0.5 font-mono text-base font-semibold text-rose-400"
            >
              {todayTasksSummary.overdueCount}
            </span>
          </div>

          <div className="flex flex-col rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2 text-center">
            <span className="text-[10px] text-[var(--nx-text-muted)]">当前需聚焦</span>
            <span
              data-metric-total
              className="mt-0.5 font-mono text-base font-semibold text-[var(--nx-text-primary)]"
            >
              {todayTasksSummary.totalFocusCount}
            </span>
          </div>
        </div>
      </div>

      {/* 板块三：行动建议入口（只读零写操作点） */}
      <div className="flex items-center gap-2 border-t border-[var(--nx-border-hairline)] pt-2.5">
        <button
          type="button"
          data-action="open-notifications"
          onClick={handleOpenDrawer}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-1.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none"
        >
          <Bell className="h-3.5 w-3.5" aria-hidden />
          <span>查看通知抽屉</span>
        </button>

        <button
          type="button"
          data-action="view-today-tasks"
          onClick={handleNavigateTasks}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-1.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none"
        >
          <span>处理今日任务</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}

export default AiMorningBriefingCard
