'use client'

import { ShieldAlert, Target } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { PmoImpactAnalysisWorkspace } from '@/components/next/pmo/impact-analysis/PmoImpactAnalysisWorkspace'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

/**
 * 多项目影响分析新轨路由（/next/pmo/impact-analysis，
 * v3-ui-next-pmo-domain W8 · tasks 8.1，spec「多项目影响分析工作台」）。
 *
 * - 准入门禁：`PermissionGuard(require=['multi_project_impact:view',
 *   'multi_project_impact:manage'], mode='any')`——与后端
 *   MultiProjectImpactAnalysisPolicy 同串镜像（design Decision 5 / G2）：
 *   `multi_project_impact:*` 当前未授予任何规范角色（含 ORG_ADMIN），因此受限
 *   横幅即全员常态、零请求（RL-06），与服务端 policy 终裁一致；
 * - 组织 ID 取自有效租户上下文（selectEffectiveOrganizationId）；orgId 未水合
 *   渲染「请先选择组织」引导态且零查询（RL-05）；
 * - 组织级页面：URL 不含 organizationId；跨组织/不存在由后端中性 404 收口，
 *   页面不区分文案（RL-05）。
 */
export default function PmoImpactAnalysisPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard
      require={['multi_project_impact:view', 'multi_project_impact:manage']}
      mode="any"
      fallback={
        <div
          data-imp-permission-fallback
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看多项目影响分析的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            查看多项目影响分析需要 multi_project_impact:view 或 multi_project_impact:manage
            权限。请联系组织管理员为当前角色配置该权限后重试。
          </p>
        </div>
      }
    >
      {organizationId === null ? (
        <div
          data-imp-org-guide
          data-org-no-organization
          className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 text-center"
        >
          <Target className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            多项目影响分析按组织隔离。请先在顶栏选择组织工作区后重试。
          </p>
        </div>
      ) : (
        <PmoImpactAnalysisWorkspace organizationId={organizationId} />
      )}
    </PermissionGuard>
  )
}
