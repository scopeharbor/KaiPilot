'use client'

import { Building2, ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { PmoReportsLens } from '@/components/next/pmo/reports/PmoReportsLens'

/**
 * PMO 组合报表镜头独立路由（/next/pmo/reports，
 * v3-ui-next-batch4-reports-change-queue W2 · tasks 2.7，
 * spec「PMO 组合报表镜头子导航入口与独立页面」）。
 *
 * - 页面级门禁：`portfolio:view`；无权限渲染受限横幅且工作台不挂载、
 *   全部数据接口零请求（RL-06）；
 * - 组织上下文从会话取 `selectEffectiveOrganizationId`；orgId 未水合渲染
 *   「请先选择组织」引导态且零请求（RL-05）。
 */
export default function PmoReportsPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard
      require="portfolio:view"
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看组合报表的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 portfolio:view 权限方可查看 PMO 组合报表镜头。请联系组织管理员授予权限。
          </p>
        </div>
      }
    >
      {organizationId === null ? (
        <div
          data-org-no-organization
          className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 text-center"
        >
          <Building2 className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            组合报表镜头是组织级组合工作台，需要有效租户上下文。请先切换到组织工作区后重试。
          </p>
        </div>
      ) : (
        <PmoReportsLens />
      )}
    </PermissionGuard>
  )
}
