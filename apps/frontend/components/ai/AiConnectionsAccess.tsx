'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { LockKeyhole, ShieldAlert } from 'lucide-react'
import PermissionGuard from '@/components/PermissionGuard'
import { ConnectionsManager } from '@/components/ai/ConnectionsManager'
import { useAuthStore } from '@/stores/auth-store'

export function AiConnectionsAccess() {
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  // 平台统一 AI 配置（私有 SaaS）：个人版用户无连接管理权时说明「由平台统一配置」；
  // 开源个人版没有平台统一配置，使用者自带 AI Key，只保留普通的权限不足提示。
  const fallbacks: { platformManaged?: ReactNode } = {}

  if (!hasHydrated) {
    return (
      <div className="my-8 h-28 animate-pulse rounded-lg bg-surface" aria-label="正在恢复会话" />
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="my-8 rounded-lg bg-info-bg p-5 text-info">
        <div className="flex items-start gap-3">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <h2 className="font-medium">登录后管理 AI 连接</h2>
            <p className="mt-1 text-sm leading-6">
              当前没有有效的登录会话。登录后会自动返回这里，你填写的 API key 将由本机后端加密保存。
            </p>
            <Link
              href="/login?next=%2Fsettings%2Fai-connections"
              className="mt-4 inline-flex min-h-9 items-center rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 focus-visible:shadow-focus"
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
      require={['ai:connection:manage']}
      fallback={
        fallbacks.platformManaged ?? (
          <div className="my-8 flex items-start gap-3 rounded-lg bg-warning-bg p-5 text-warning">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div>
              <h2 className="font-medium">没有 AI 连接管理权限</h2>
              <p className="mt-1 text-sm leading-6">
                请切换到有权限的组织，或联系组织管理员、项目经理为你授权。
              </p>
            </div>
          </div>
        )
      }
    >
      <ConnectionsManager />
    </PermissionGuard>
  )
}
