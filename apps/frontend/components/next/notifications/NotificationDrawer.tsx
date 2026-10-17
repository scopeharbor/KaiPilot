'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, CheckCheck } from 'lucide-react'
import { notificationKeys, notificationsApi, type Notification } from '@/lib/api/notifications'
import { useNotificationDrawerStore, type NotificationDrawerTab } from './use-notification-drawer'
import { formatRelativeTime } from '@/lib/timeline-state'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'

export interface NotificationDrawerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultTab?: NotificationDrawerTab
  className?: string
}

const TABS: ReadonlyArray<{ key: NotificationDrawerTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'assignments', label: '任务' },
  { key: 'mentions', label: '提及' },
  { key: 'approvals', label: '审批' },
  { key: 'system', label: '系统' },
]

function getSeverityDot(severity: string, precise: boolean) {
  switch (severity) {
    case 'critical':
    case 'error':
      return cn(
        'h-2 w-2 shrink-0 rounded-full bg-rose-500',
        !precise && 'shadow-[0_0_6px_rgba(244,63,94,0.5)]',
      )
    case 'warning':
      return cn(
        'h-2 w-2 shrink-0 rounded-full bg-amber-500',
        !precise && 'shadow-[0_0_6px_rgba(245,158,11,0.5)]',
      )
    case 'info':
    default:
      return cn(
        'h-2 w-2 shrink-0 rounded-full bg-sky-500',
        !precise && 'shadow-[0_0_6px_rgba(14,165,233,0.5)]',
      )
  }
}

function matchTab(item: Notification, tab: NotificationDrawerTab): boolean {
  if (tab === 'all') return true
  if (tab === 'unread') return !item.readAt
  if (tab === 'assignments') {
    return (
      item.type === 'task_assigned' ||
      item.type === 'task_unassigned' ||
      item.type.includes('task') ||
      item.type.includes('assign')
    )
  }
  if (tab === 'mentions') {
    return (
      item.type === 'comment_added' ||
      item.type === 'attachment_added' ||
      item.type.includes('comment') ||
      item.type.includes('mention')
    )
  }
  if (tab === 'approvals') {
    return (
      item.type === 'ai_draft_confirmed' ||
      item.type === 'ai_draft_imported' ||
      item.type === 'report_exported' ||
      item.type === 'report_export_failed' ||
      item.type.includes('approval') ||
      item.type.includes('draft') ||
      item.type.includes('report')
    )
  }
  if (tab === 'system') {
    return (
      item.type === 'project_archived' ||
      item.type === 'project_restored' ||
      item.type === 'general' ||
      item.type.includes('milestone') ||
      item.type.includes('system')
    )
  }
  return true
}

export function NotificationDrawer({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultTab,
  className,
}: NotificationDrawerProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const immersionTier = useImmersionTier()
  const isPrecise = immersionTier === 'precise'

  const storeIsOpen = useNotificationDrawerStore((state) => state.isOpen)
  const storeActiveTab = useNotificationDrawerStore((state) => state.activeTab)
  const setStoreActiveTab = useNotificationDrawerStore((state) => state.setActiveTab)
  const closeDrawer = useNotificationDrawerStore((state) => state.closeDrawer)

  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : storeIsOpen

  const [localTab, setLocalTab] = React.useState<NotificationDrawerTab>(
    defaultTab ?? storeActiveTab ?? 'all',
  )
  const activeTab = defaultTab ?? localTab

  React.useEffect(() => {
    if (defaultTab) {
      setLocalTab(defaultTab)
    }
  }, [defaultTab])

  const handleOpenChange = (nextOpen: boolean) => {
    if (controlledOnOpenChange) {
      controlledOnOpenChange(nextOpen)
    }
    if (!nextOpen) {
      closeDrawer()
    }
  }

  const handleTabChange = (tab: NotificationDrawerTab) => {
    setLocalTab(tab)
    setStoreActiveTab(tab)
  }

  // 列表查询
  const listFilters = React.useMemo(
    () => (activeTab === 'all' ? {} : { typeGroup: activeTab }),
    [activeTab],
  )
  const { data: listData, isLoading } = useQuery({
    queryKey: notificationKeys.list(listFilters),
    queryFn: () => notificationsApi.list(listFilters),
    enabled: isOpen,
  })

  // 未读数查询
  const { data: unreadData } = useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: () => notificationsApi.unreadCount(),
    enabled: isOpen,
  })

  const unreadCount = unreadData?.unreadCount ?? 0

  // 归一化与前台二次过滤（兼顾服务端过滤与测试纯客户端 mock 兜底）
  const allNotifications: Notification[] = React.useMemo(() => {
    if (!listData) return []
    if (Array.isArray(listData)) return listData as unknown as Notification[]
    return (listData as { data?: Notification[] }).data ?? []
  }, [listData])

  const displayNotifications = React.useMemo(() => {
    return allNotifications.filter((item) => matchTab(item, activeTab))
  }, [allNotifications, activeTab])

  // 单条标记已读与跳转
  const handleItemClick = async (item: Notification) => {
    if (!item.readAt) {
      try {
        await notificationsApi.markRead(item.id)
        void queryClient.invalidateQueries({ queryKey: notificationKeys.all })
      } catch {
        // 静默失败
      }
    }

    const isTask =
      item.target?.type === 'task' ||
      item.type === 'task_assigned' ||
      item.type === 'task_unassigned'
    const taskId = item.target?.id ?? (item.target?.type === 'task' ? item.target.id : null)
    const projectId = item.projectId

    if (isTask && taskId) {
      const targetUrl = projectId
        ? `/next/projects/${projectId}?focusTask=${taskId}`
        : `/next/tasks?focusTask=${taskId}`
      router.push(targetUrl)
      handleOpenChange(false)
    } else if (item.actionUrl) {
      router.push(item.actionUrl)
      handleOpenChange(false)
    }
  }

  // 一键全部已读
  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead()
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all })
    } catch {
      // 静默失败
    }
  }

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-notification-drawer-overlay
          className={cn(
            'fixed inset-0 z-[var(--z-modal-backdrop,50)] bg-black/30 transition-opacity',
            isPrecise ? 'backdrop-blur-none' : 'backdrop-blur-sm',
          )}
        />
        <DialogPrimitive.Content
          data-notification-drawer
          data-immersion={immersionTier}
          // Portal 逃逸 `[data-next-track]` 令牌作用域：不重挂则 --nx-* 全部失效，只剩写死的深色兜底，浅色主题下错色。
          data-next-track
          aria-describedby="notification-drawer-description"
          className={cn(
            'fixed right-0 top-0 bottom-0 z-[var(--z-modal,51)] flex h-full w-full max-w-md flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface,#121418)] text-[var(--nx-text-primary)] shadow-2xl transition-transform duration-200 outline-none',
            isPrecise && 'shadow-none transition-none',
            className,
          )}
        >
          {/* 顶栏标题与全部已读 */}
          <div className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] px-5 py-3.5">
            <div className="flex items-center gap-2">
              <DialogPrimitive.Title className="text-sm font-semibold tracking-wide text-[var(--nx-text-primary)]">
                通知中心
              </DialogPrimitive.Title>
              {unreadCount > 0 && (
                <span
                  data-notification-unread-count
                  className="rounded-[4px] border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-400"
                >
                  {unreadCount} 条未读
                </span>
              )}
            </div>
            <DialogPrimitive.Description id="notification-drawer-description" className="sr-only">
              暗黑仪器风侧滑通知抽屉，支持分类过滤、单条已读与一键全部已读
            </DialogPrimitive.Description>
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-mark-all-read
                onClick={handleMarkAllRead}
                className="flex items-center gap-1 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-accent)] focus-visible:outline-none"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                全部已读
              </button>
              <DialogPrimitive.Close
                aria-label="关闭通知抽屉"
                className="rounded-md p-1 text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* 分类标签栏 */}
          <div
            role="tablist"
            aria-label="通知分类过滤"
            className="flex items-center gap-1 border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-2"
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  role="tab"
                  data-tab={tab.key}
                  aria-selected={isActive}
                  onClick={() => handleTabChange(tab.key)}
                  className={cn(
                    'rounded-[4px] px-2.5 py-1 text-xs transition-colors',
                    isActive
                      ? 'bg-[var(--nx-bg-2)] text-[var(--nx-text-primary)] font-medium shadow-sm'
                      : 'text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-2)] hover:text-[var(--nx-text-primary)]',
                  )}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* 通知列表区 */}
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--nx-border-hairline)]">
            {isLoading ? (
              <div className="flex h-32 items-center justify-center text-xs text-[var(--nx-text-muted)]">
                正在载入通知...
              </div>
            ) : displayNotifications.length === 0 ? (
              <div
                data-notification-empty
                className="flex h-48 flex-col items-center justify-center gap-1 text-xs text-[var(--nx-text-muted)]"
              >
                <span>暂无相关通知</span>
                <span className="text-[10px] text-[var(--nx-text-muted)]/70">
                  所有事项均已处理完毕
                </span>
              </div>
            ) : (
              displayNotifications.map((item) => {
                const isUnread = !item.readAt
                return (
                  <div
                    key={item.id}
                    data-notification-item
                    data-notification-id={item.id}
                    data-unread={isUnread}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleItemClick(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void handleItemClick(item)
                      }
                    }}
                    className={cn(
                      'group relative flex min-h-[48px] cursor-pointer items-start gap-3 px-5 py-3 transition-colors hover:bg-[var(--nx-bg-2)] focus-visible:outline-none focus-visible:bg-[var(--nx-bg-2)]',
                      isUnread ? 'bg-[var(--nx-bg-0)]/60' : 'text-[var(--nx-text-secondary)]',
                    )}
                  >
                    <div className="pt-1">
                      <span className={getSeverityDot(item.severity, isPrecise)} />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            'truncate text-xs tracking-tight',
                            isUnread
                              ? 'font-medium text-[var(--nx-text-primary)]'
                              : 'text-[var(--nx-text-secondary)]',
                          )}
                        >
                          {item.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]">
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>

                      {item.body && (
                        <p className="line-clamp-2 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                          {item.body}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
