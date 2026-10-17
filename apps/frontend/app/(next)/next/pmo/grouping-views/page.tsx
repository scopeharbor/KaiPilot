'use client'

import { Building2, ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { PmoGroupingViewsWorkspace } from '@/components/next/pmo/grouping-views/PmoGroupingViewsWorkspace'

/**
 * PMO 分组视图路由（/next/pmo/grouping-views，
 * v3-ui-next-pmo-domain W3 · tasks 3.1）。
 *
 * - 准入门禁：PermissionGuard(require=['portfolio:view'])——无权渲染受限横幅
 *   （data-permission-fallback）且工作台不挂载、底层接口零请求（RL-06）；
 * - 组织上下文取自 auth store 有效租户（selectEffectiveOrganizationId）；未选择
 *   组织渲染引导态（data-org-guide-state）且零请求；
 * - 组织级/全域页面：URL 无 organizationId，跨租户引用由后端中性 404 收口。
 */
export default function PmoGroupingViewsPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard
      require={['portfolio:view']}
      fallback={
        <div
          data-permission-fallback
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center"
        >
          <ShieldAlert
            className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看 PMO 组合分组视图的权限
          </h3>
          <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
            请联系组织管理员授予 portfolio:view 权限。
          </p>
        </div>
      }
    >
      {organizationId === null ? (
        <div
          data-org-guide-state
          className="flex flex-col items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <Building2 className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm font-medium text-[var(--nx-text-primary)]">请先选择组织</p>
          <p className="max-w-sm text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            组织级分组视图数据来自当前租户上下文。请先从右上角切换或选择组织后再访问本页。
          </p>
        </div>
      ) : (
        <PmoGroupingViewsWorkspace organizationId={organizationId} />
      )}
    </PermissionGuard>
  )
}
