'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck, ExternalLink, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useNotifications,
  useUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useNotificationClick,
} from '@/hooks/use-notifications'
import type { Notification } from '@/lib/api/notifications'

/** 通知类型 → 简体中文标签（用于徽章展示）。 */
const TYPE_LABELS: Record<string, string> = {
  task_assigned: '任务指派',
  task_unassigned: '任务取消指派',
  comment_added: '新评论',
  attachment_added: '附件上传',
  project_archived: '项目归档',
  project_restored: '项目恢复',
  milestone_due: '里程碑临近',
  milestone_overdue: '里程碑逾期',
  ai_draft_confirmed: 'AI 草案确认',
  ai_draft_imported: 'AI 草案导入',
  report_exported: '报表导出',
  report_export_failed: '报表导出失败',
  general: '通知',
}

/** 严重级别 → 图标颜色类。 */
const SEVERITY_STYLES: Record<string, string> = {
  info: 'text-blue-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
  critical: 'text-red-600',
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return '刚刚'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} 小时前`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay} 天前`
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

interface NotificationItemProps {
  notification: Notification
  onRead: (id: number) => void
  onClick: (n: Notification) => void
  isRead: boolean
}

function NotificationItem({ notification, onRead, onClick, isRead }: NotificationItemProps) {
  const isUnread = !isRead

  const handleClick = () => {
    onClick(notification)
    // 无论导航是否成功，都标记已读（幂等）
    onRead(notification.id)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'group flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left',
        'hover:bg-gray-50 transition-colors',
        isUnread && 'bg-blue-50/40 hover:bg-blue-50',
        focusRing,
      )}
    >
      {/* 左侧未读点 */}
      <div className="mt-1.5 flex-shrink-0">
        <div
          className={cn(
            'h-2 w-2 rounded-full transition-opacity',
            isUnread ? 'bg-blue-500' : 'bg-transparent',
          )}
        />
      </div>

      {/* 内容和元数据 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm leading-snug',
              isUnread ? 'font-medium text-gray-900' : 'text-gray-600',
              notification.severity !== 'info' && SEVERITY_STYLES[notification.severity],
            )}
          >
            {notification.title}
          </p>
          {notification.actionUrl && (
            <ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </div>

        {notification.body && (
          <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{notification.body}</p>
        )}

        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] text-gray-400">
            {TYPE_LABELS[notification.type] ?? notification.type}
          </span>
          <span className="text-[10px] text-gray-300">·</span>
          <span className="text-[10px] text-gray-400">{formatTime(notification.createdAt)}</span>
        </div>
      </div>
    </button>
  )
}

function NotificationItemSkeleton() {
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-3">
      <Skeleton className="mt-1.5 h-2 w-2 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-2 w-1/3" />
      </div>
    </div>
  )
}

interface NotificationListProps {
  notifications: Notification[]
  isLoading: boolean
  isError: boolean
  onRead: (id: number) => void
  onClick: (n: Notification) => void
}

function NotificationList({
  notifications,
  isLoading,
  isError,
  onRead,
  onClick,
}: NotificationListProps) {
  if (isLoading) {
    return (
      <div>
        {Array.from({ length: 5 }).map((_, i) => (
          <NotificationItemSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        <Bell className="h-8 w-8 text-gray-300" />
        <p className="text-sm text-gray-500">加载通知失败</p>
        <p className="text-xs text-gray-400">请检查网络后重试</p>
      </div>
    )
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        <Bell className="h-8 w-8 text-gray-200" />
        <p className="text-sm text-gray-500">暂无通知</p>
        <p className="text-xs text-gray-400">你将在此处收到任务、评论等提醒</p>
      </div>
    )
  }

  return (
    <>
      {notifications.map((n) => (
        <NotificationItem
          key={n.id}
          notification={n}
          onRead={onRead}
          onClick={onClick}
          isRead={!!n.readAt}
        />
      ))}
    </>
  )
}

interface NotificationPanelContentProps {
  onReadSuccess?: () => void
}

function NotificationPanelContent({ onReadSuccess }: NotificationPanelContentProps) {
  const router = useRouter()
  const { data, isLoading, isError } = useNotifications({ status: 'all' })
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()
  const handleClick = useNotificationClick()

  const notifications = data?.data ?? []
  const unreadCount = notifications.filter((n) => !n.readAt).length

  const handleRead = (id: number) => {
    markRead.mutate(id, {
      onSuccess: onReadSuccess,
    })
  }

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined, {
      onSuccess: onReadSuccess,
    })
  }

  return (
    <>
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-800">通知</h3>
          {unreadCount > 0 && (
            <span className="rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-gray-500 hover:text-gray-700"
            onClick={handleMarkAllRead}
            disabled={markAllRead.isPending}
          >
            <CheckCheck className="h-3 w-3" />
            全部已读
          </Button>
        )}
      </div>

      {/* 列表（固定高度，内容区 overflow） */}
      <div className="max-h-[420px] overflow-y-auto">
        <NotificationList
          notifications={notifications}
          isLoading={isLoading}
          isError={isError}
          onRead={handleRead}
          onClick={handleClick}
        />
      </div>

      {/* 底部：查看全部通知入口 */}
      {data && data.data.length > 0 && (
        <div className="border-t border-border px-4 py-2 text-center">
          <p className="text-[10px] text-gray-400">
            共 {data.meta.total} 条通知 · 第 {data.meta.page}/{data.meta.totalPages} 页
          </p>
        </div>
      )}
      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => router.push('/notifications')}
          className={cn(
            'flex w-full items-center justify-center gap-1 px-4 py-2 text-xs text-blue-600 transition-colors',
            'hover:bg-blue-50 hover:text-blue-700',
          )}
        >
          查看全部通知
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </>
  )
}

/**
 * 通知面板（tasks 4.3/4.4）：
 * - 加载、空、错误、列表状态
 * - 单条已读、全部已读、跳转
 * - 移除"后续 change 接线"占位文案
 */
export function NotificationPanel({ onReadSuccess }: NotificationPanelContentProps) {
  return <NotificationPanelContent onReadSuccess={onReadSuccess} />
}

export { useUnreadNotificationCount }
