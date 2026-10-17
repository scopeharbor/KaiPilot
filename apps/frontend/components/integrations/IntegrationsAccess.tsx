'use client'

import Link from 'next/link'
import { LockKeyhole, ShieldAlert } from 'lucide-react'
import PermissionGuard from '@/components/PermissionGuard'
import { IntegrationsSettings } from '@/components/integrations/IntegrationsSettings'
import { useAuthStore } from '@/stores/auth-store'

export function IntegrationsAccess({ focusCategory }: { focusCategory?: string | null }) {
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  if (!hasHydrated) {
    return <div className="my-8 h-28 animate-pulse rounded-[var(--radius-lg)] bg-gray-100" />
  }

  if (!isAuthenticated) {
    return (
      <div className="my-8 rounded-[var(--radius-lg)] bg-info-bg p-5 text-info">
        <div className="flex items-start gap-3">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <h2 className="font-medium">登录后连接第三方账号</h2>
            <p className="mt-1 text-sm leading-6">
              登录后可查看日历、Slack、飞书和钉钉的 OAuth 预连接入口。
            </p>
            <Link
              href="/login?next=%2Fsettings%2Fintegrations"
              className="mt-4 inline-flex min-h-9 items-center rounded-[var(--radius-md)] bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 focus-visible:shadow-focus"
            >
              前往登录
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <PermissionGuard
      require={['integration:connect']}
      fallback={
        <div className="my-8 flex items-start gap-3 rounded-[var(--radius-lg)] bg-warning-bg p-5 text-warning">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <h2 className="font-medium">没有第三方集成连接权限</h2>
            <p className="mt-1 text-sm leading-6">请切换组织或联系管理员为你授权。</p>
          </div>
        </div>
      }
    >
      <IntegrationsSettings focusCategory={focusCategory} />
    </PermissionGuard>
  )
}
