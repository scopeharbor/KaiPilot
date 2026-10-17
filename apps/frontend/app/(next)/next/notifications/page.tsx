'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  useNotificationDrawerStore,
  type NotificationDrawerTab,
} from '@/components/next/notifications/use-notification-drawer'

function NotificationsAssimilationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const openDrawer = useNotificationDrawerStore((state) => state.openDrawer)

  React.useEffect(() => {
    const rawTab = searchParams.get('tab') || searchParams.get('filter')
    let targetTab: NotificationDrawerTab = 'all'

    if (rawTab === 'unread') {
      targetTab = 'unread'
    } else if (rawTab === 'mentions') {
      targetTab = 'mentions'
    } else if (rawTab === 'assignments') {
      targetTab = 'assignments'
    } else if (rawTab === 'approvals') {
      targetTab = 'approvals'
    } else if (rawTab === 'system') {
      targetTab = 'system'
    }

    openDrawer(targetTab)
    router.replace('/next')
  }, [openDrawer, router, searchParams])

  return (
    <div
      data-notifications-assimilation
      className="flex min-h-[60vh] items-center justify-center text-xs text-[var(--nx-text-muted)] font-mono"
    >
      正在导流至新轨通知中心...
    </div>
  )
}

export default function NotificationsAssimilationPage() {
  return (
    <React.Suspense fallback={null}>
      <NotificationsAssimilationContent />
    </React.Suspense>
  )
}
