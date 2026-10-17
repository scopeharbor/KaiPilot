'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import {
  canUseEnterpriseFeatures,
  isEnterpriseRoute,
  personalSafeDestination,
} from '@/lib/workspace-edition'

/**
 * 企业页面的客户端体验边界。后端 RBAC 仍是安全边界；这里确保个人版不会先渲染页面、
 * 再因企业 API 403 露出报错，也处理从收藏夹或历史记录打开的直链。
 */
export function WorkspaceEditionBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/dashboard'
  const router = useRouter()
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const planTier = useAuthStore((state) => state.planTier)
  const isSuperAdmin = useAuthStore((state) => Boolean(state.user?.isSuperAdmin))
  const restricted =
    isEnterpriseRoute(pathname) && !canUseEnterpriseFeatures(planTier, isSuperAdmin)

  React.useEffect(() => {
    if (hasHydrated && restricted) {
      router.replace(personalSafeDestination(pathname))
    }
  }, [hasHydrated, pathname, restricted, router])

  if (isEnterpriseRoute(pathname) && (!hasHydrated || restricted)) {
    return (
      <div className="py-10 text-sm text-gray-500" role="status">
        正在返回个人版可用页面…
      </div>
    )
  }

  return children
}
