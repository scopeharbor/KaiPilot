'use client'

import { ShieldAlert, Target } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { PmoPortfolioOverviewWorkspace } from '@/components/next/pmo/PmoPortfolioOverviewWorkspace'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

/**
 * PMO 组合仪表盘路由（/next/pmo，v3-ui-next-pmo-domain W1 · tasks 1.1，
 * spec「PMO 组合仪表盘新轨主页与组织层信息架构」）。
 *
 * - 准入门禁：`PermissionGuard(require=['portfolio:view'])`——与后端
 *   PortfolioDashboardPolicy 视图口径一致（roles.ts 全 5 规范角色授予）；
 *   无权限渲染受限横幅（data-permission-fallback）且工作台不挂载、组合摘要
 *   接口零请求（RL-06）；
 * - 组织 ID 取自 JWT 有效租户上下文（selectEffectiveOrganizationId，与
 *   org 批页面同范式）；未选择组织渲染「请先选择组织」中性引导态且零请求
 *   （RL-05）；PMO 为组织层页面，无 projectId、不进入项目空间命名空间
 *   （Decision 2：组织层与单项目空间正交）。
 */
export default function PmoPortfolioOverviewPage() {
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
            你没有查看 PMO 组合总览的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 portfolio:view 权限方可查看组织项目组合仪表盘。请联系组织管理员授予权限。
          </p>
        </div>
      }
    >
      {organizationId === null ? (
        <div
          data-org-no-organization
          className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 text-center"
        >
          <Target className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            PMO 组合仪表盘需要有效租户上下文。请先切换到组织工作区后重试。
          </p>
        </div>
      ) : (
        <PmoPortfolioOverviewWorkspace />
      )}
    </PermissionGuard>
  )
}
