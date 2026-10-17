'use client'

import { Building2, ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { useAuthStore, selectEffectiveOrganizationId } from '@/stores/auth-store'
import { DemandForecastWorkspace } from '@/components/next/org-demand/DemandForecastWorkspace'

/**
 * 资源需求预测页面入口（/next/organization/resource-demand-forecasting，
 * v3-ui-next-org-portfolio-domains W5 · tasks 5.10，spec「资源争用检测与需求预测」）。
 *
 * - 页守卫口径 = 后端 ResourceDemandForecastingPolicy 视图权限并集（design 锚点
 *   §1：PORTFOLIO_VIEW 或 RESOURCE_VIEW）——页面取 `org:view`/`portfolio:view`/
 *   `resource:view` 任一即可（前端取并集防误拒，数据仍由后端 policy 收口）；
 *   无权限渲染受限横幅且工作台不挂载，底层预测接口零请求（RL-06）；
 * - 组织 ID 一律取自 auth store 有效租户上下文（selectEffectiveOrganizationId，
 *   URL 不含 organizationId，RL-05）；未选择组织时渲染「请先选择组织」引导态且零请求；
 * - AI 咨询卡零自动触发、显式点击才请求（RL-01），本页为组织级/全域页面
 *   （无 projectId 上下文），面包屑坐标由顶栏按静态坐标回显。
 */
export default function OrganizationResourceDemandForecastingPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard
      require={['org:view', 'portfolio:view', 'resource:view']}
      mode="any"
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看资源需求预测的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 org:view、portfolio:view 或 resource:view 中任一权限方可查看组织级
            资源需求预测。请联系组织管理员授予权限。
          </p>
        </div>
      }
    >
      {organizationId === null ? (
        <div
          data-no-organization-guide
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <Building2 className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            资源需求预测需要组织上下文。请先在右上角组织选择器中切换到目标组织后再试。
          </p>
        </div>
      ) : (
        <DemandForecastWorkspace organizationId={organizationId} />
      )}
    </PermissionGuard>
  )
}
