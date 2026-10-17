'use client'

import * as React from 'react'
import { Lock } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'

export interface PmoChangeRbacGuardProps {
  children: React.ReactNode
  fallback?: React.ReactNode
  requirePermission?: string
  className?: string
}

/**
 * PMO 变更审批 RBAC 权限精准守卫封装组件（W4 · tasks 4.5 / design Decision 3）。
 *
 * 严格绑定 `change_request:approve` 权限：
 * - 有权：渲染 children（审批/驳回/退回操作按钮组）；
 * - 无权：展示「只读审阅模式」灰色小锁文案，所有写操作控件物理隐藏（RL-06 零外发）。
 */
export function PmoChangeRbacGuard({
  children,
  fallback,
  requirePermission = 'change_request:approve',
  className,
}: PmoChangeRbacGuardProps) {
  const { can } = usePermissions()
  const hasApprovePermission = can(requirePermission)

  if (!hasApprovePermission) {
    if (fallback) {
      return <>{fallback}</>
    }
    return (
      <div
        data-testid="pmo-change-rbac-guard"
        data-pmo-rbac-locked="true"
        className={cn(
          'flex items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-xs text-[var(--nx-text-muted)]',
          className,
        )}
      >
        <Lock
          data-testid="read-only-review-lock"
          className="h-3.5 w-3.5 text-[var(--nx-text-muted)] shrink-0"
          aria-hidden="true"
        />
        <span className="font-medium text-[var(--nx-text-secondary)]">只读审阅模式</span>
        <span className="text-[11px] text-[var(--nx-text-muted)]">
          （无变更审批权限 change_request:approve）
        </span>
      </div>
    )
  }

  return (
    <div data-testid="pmo-change-rbac-guard" data-pmo-rbac-allowed="true" className={className}>
      {children}
    </div>
  )
}
