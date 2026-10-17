'use client'

import * as React from 'react'
import { Bell } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { notificationKeys, notificationsApi } from '@/lib/api/notifications'
import { useNotificationDrawerStore } from '@/components/next/notifications/use-notification-drawer'
import { cn } from '@/lib/utils'

export interface NextTopbarNotificationTriggerProps {
  open?: boolean
  onClick?: () => void
  unreadCount?: number
  className?: string
}

export function NextTopbarNotificationTrigger({
  open = false,
  onClick,
  unreadCount: forcedUnreadCount,
  className,
}: NextTopbarNotificationTriggerProps) {
  const { data } = useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: () => notificationsApi.unreadCount(),
    enabled: forcedUnreadCount === undefined,
  })

  const count = forcedUnreadCount ?? data?.unreadCount ?? 0
  const toggleDrawer = useNotificationDrawerStore((state) => state.toggleDrawer)

  const handleClick = () => {
    if (onClick) {
      onClick()
    } else {
      toggleDrawer()
    }
  }

  const badgeText = count > 99 ? '99+' : String(count)

  return (
    <button
      type="button"
      data-next-notification-trigger
      aria-label={count > 0 ? `通知中心 (${count} 条未读)` : '通知中心'}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={handleClick}
      className={cn(
        'relative flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)] xl:h-9',
        open && 'border-[var(--nx-border-focus)] text-[var(--nx-text-primary)] bg-[var(--nx-bg-0)]',
        className,
      )}
    >
      <Bell className="h-4 w-4" aria-hidden />

      {count > 0 && (
        <span
          data-next-notification-badge
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 font-mono text-[10px] font-semibold text-black shadow-sm"
        >
          {badgeText}
        </span>
      )}
    </button>
  )
}
