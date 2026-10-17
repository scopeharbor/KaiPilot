'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Bell,
  CheckCheck,
  EyeOff,
  MailOpen,
  Loader2,
  AlertCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Plug,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuthStore } from '@/stores/auth-store'
import {
  useNotifications,
  useMarkNotificationRead,
  useBatchNotifications,
  useNotificationClick,
} from '@/hooks/use-notifications'
import { useRealtimeNotifications } from '@/hooks/use-realtime-notifications'
import type {
  Notification,
  NotificationTypeGroup,
  NotificationListFilters,
} from '@/lib/api/notifications'

// ============================================================
// 常量
// ============================================================

/** 视图切换配置。 */
const VIEWS: Array<{ key: NotificationTypeGroup | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unread', label: '未读' },
  { key: 'mentions', label: '@提及' },
  { key: 'assignments', label: '指派' },
  { key: 'approvals', label: '审批' },
  { key: 'system', label: '系统' },
]

/** 通知类型 → 简体中文标签。 */
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

/** 严重级别 → 徽章颜色。 */
const SEVERITY_BADGE: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
  critical: 'bg-red-200 text-red-800',
}

const PER_PAGE = 20

// ============================================================
// 工具函数
// ============================================================

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

// ============================================================
// 通知项组件
// ============================================================

interface NotificationItemProps {
  notification: Notification
  selected: boolean
  onToggleSelect: (id: number) => void
  onClick: (n: Notification) => void
}

function NotificationItem({
  notification,
  selected,
  onToggleSelect,
  onClick,
}: NotificationItemProps) {
  const isUnread = !notification.readAt
  const isInaccessible = notification.accessStatus === 'inaccessible'

  return (
    <div
      className={cn(
        'group flex items-start gap-3 border-b border-border px-4 py-3 transition-colors',
        'hover:bg-gray-50',
        isUnread && 'bg-blue-50/30',
        selected && 'bg-blue-100/40 ring-1 ring-inset ring-blue-200',
      )}
    >
      {/* 复选框 */}
      <div className="mt-1 flex-shrink-0">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(notification.id)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          aria-label={`选择通知 #${notification.id}`}
        />
      </div>

      {/* 未读指示器 */}
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
        {/* 标题 */}
        <button
          type="button"
          onClick={() => onClick(notification)}
          className={cn(
            'w-full text-left text-sm leading-snug',
            isUnread ? 'font-medium text-gray-900' : 'text-gray-600',
            SEVERITY_STYLES[notification.severity] ?? 'text-gray-900',
          )}
        >
          {notification.title}
        </button>

        {/* 正文摘要 */}
        {notification.body && (
          <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{notification.body}</p>
        )}

        {/* 不可访问提示 */}
        {isInaccessible && (
          <p className="mt-0.5 text-xs text-amber-600 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            目标不可访问
          </p>
        )}

        {/* 底部元数据 */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Badge className={SEVERITY_BADGE[notification.severity] ?? 'bg-gray-100 text-gray-600'}>
            {TYPE_LABELS[notification.type] ?? notification.type}
          </Badge>
          <span className="text-[10px] text-gray-400">{formatTime(notification.createdAt)}</span>
          {isUnread && <span className="text-[10px] font-medium text-blue-500">未读</span>}
        </div>
      </div>
    </div>
  )
}

function NotificationItemSkeleton() {
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-3">
      <Skeleton className="mt-1 h-4 w-4 rounded" />
      <Skeleton className="mt-1.5 h-2 w-2 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-2 w-1/3" />
      </div>
    </div>
  )
}

// ============================================================
// 通知中心主体
// ============================================================

export default function NotificationsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  // 当前视图
  const activeView = (searchParams.get('view') as NotificationTypeGroup | null) ?? 'all'

  // 分页
  const currentPage = Number(searchParams.get('page') ?? '1')

  // 选中通知 ID 集合
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set())

  // 构建筛选条件
  const filters = React.useMemo<NotificationListFilters>(() => {
    const f: NotificationListFilters = { page: currentPage, perPage: PER_PAGE }
    if (activeView === 'unread') f.status = 'unread'
    else if (activeView !== 'all') f.typeGroup = activeView
    return f
  }, [activeView, currentPage])

  // 查询
  const { data, isLoading, isError, refetch } = useNotifications(filters)
  const markRead = useMarkNotificationRead()
  const batchMutation = useBatchNotifications()
  const handleClick = useNotificationClick()

  // 实时通知监听（WebSocket 可用时自动失效缓存）
  useRealtimeNotifications()

  const notifications = data?.data ?? []
  const meta = data?.meta
  const totalPages = meta?.totalPages ?? 0

  // 处理视图切换
  const switchView = React.useCallback(
    (view: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (view === 'all') params.delete('view')
      else params.set('view', view)
      params.delete('page')
      setSelectedIds(new Set())
      router.push(`/notifications?${params.toString()}`)
    },
    [router, searchParams],
  )

  // 处理分页
  const goToPage = React.useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (page <= 1) params.delete('page')
      else params.set('page', String(page))
      setSelectedIds(new Set())
      router.push(`/notifications?${params.toString()}`)
    },
    [router, searchParams],
  )

  // 切换选中
  const toggleSelect = React.useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 全选/取消全选
  const toggleSelectAll = React.useCallback(() => {
    if (selectedIds.size === notifications.length && notifications.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(notifications.map((n) => n.id)))
    }
  }, [selectedIds, notifications])

  // 批量操作
  const handleBatchAction = React.useCallback(
    (action: 'mark_read' | 'mark_unread' | 'hide') => {
      if (selectedIds.size === 0) return
      batchMutation.mutate(
        { action, notificationIds: Array.from(selectedIds) },
        { onSuccess: () => setSelectedIds(new Set()) },
      )
    },
    [selectedIds, batchMutation],
  )

  // 单条已读 + 导航
  const handleNotificationClick = React.useCallback(
    (notification: Notification) => {
      if (notification.actionUrl) {
        handleClick(notification)
      }
      if (!notification.readAt) {
        markRead.mutate(notification.id)
      }
    },
    [handleClick, markRead],
  )

  // 未认证处理
  if (!isAuthenticated) {
    return (
      <div className="py-12">
        <EmptyState icon={Bell} title="未登录" description="请登录后查看通知。" />
      </div>
    )
  }

  return (
    <div className="py-6">
      {/* 页面标题 */}
      <div className="mb-6 flex flex-col gap-3 px-4 md:flex-row md:items-start md:justify-between md:px-0">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">通知中心</h1>
          <p className="mt-1 text-sm text-gray-500">查看和处理所有项目通知</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/integrations?category=message">
            <Plug className="h-4 w-4" />
            消息集成
          </Link>
        </Button>
      </div>

      {/* 视图切换 */}
      <div className="mb-4 flex flex-wrap gap-1 px-4 md:px-0">
        {VIEWS.map((view) => (
          <button
            key={view.key}
            type="button"
            onClick={() => switchView(view.key)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              activeView === view.key
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {view.label}
          </button>
        ))}
      </div>

      {/* 批量操作工具栏 */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 mx-4 md:mx-0">
          <span className="text-xs font-medium text-blue-700">已选 {selectedIds.size} 条</span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => handleBatchAction('mark_read')}
              disabled={batchMutation.isPending}
            >
              <CheckCheck className="h-3 w-3" />
              标记已读
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => handleBatchAction('mark_unread')}
              disabled={batchMutation.isPending}
            >
              <MailOpen className="h-3 w-3" />
              标记未读
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-amber-600 hover:text-amber-700"
              onClick={() => handleBatchAction('hide')}
              disabled={batchMutation.isPending}
            >
              <EyeOff className="h-3 w-3" />
              隐藏
            </Button>
          </div>
        </div>
      )}

      {/* 通知列表 */}
      <div className="rounded-lg border border-border bg-white">
        {/* 表头 */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={notifications.length > 0 && selectedIds.size === notifications.length}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              aria-label="全选/取消全选"
            />
            <span className="text-xs text-gray-500">{meta ? `共 ${meta.total} 条` : ''}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={cn('mr-1 h-3 w-3', isLoading && 'animate-spin')} />
              刷新
            </Button>
          </div>
        </div>

        {/* 加载状态 */}
        {isLoading && (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <NotificationItemSkeleton key={i} />
            ))}
          </div>
        )}

        {/* 错误状态 */}
        {isError && !isLoading && (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <AlertCircle className="h-10 w-10 text-red-300" />
            <p className="text-sm font-medium text-gray-700">加载通知失败</p>
            <p className="text-xs text-gray-500">请检查网络后重试</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
              重试
            </Button>
          </div>
        )}

        {/* 无数据状态 */}
        {!isLoading && !isError && notifications.length === 0 && (
          <div className="p-12">
            <EmptyState
              icon={Inbox}
              title={activeView !== 'all' ? '当前视图暂无通知' : '暂无通知'}
              description={
                activeView !== 'all'
                  ? '切换视图或清除筛选查看其他通知'
                  : '你将在此处收到任务、评论等提醒'
              }
            />
          </div>
        )}

        {/* 通知列表 */}
        {!isLoading && !isError && notifications.length > 0 && (
          <div>
            {notifications.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                selected={selectedIds.has(n.id)}
                onToggleSelect={toggleSelect}
                onClick={handleNotificationClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            上一页
          </Button>
          <span className="text-xs text-gray-500">
            第 {currentPage} / {totalPages} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={currentPage >= totalPages}
            onClick={() => goToPage(currentPage + 1)}
          >
            下一页
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* 批量处理中指示 */}
      {batchMutation.isPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="flex items-center gap-3 rounded-lg bg-white px-6 py-4 shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            <span className="text-sm text-gray-700">处理中...</span>
          </div>
        </div>
      )}
    </div>
  )
}
