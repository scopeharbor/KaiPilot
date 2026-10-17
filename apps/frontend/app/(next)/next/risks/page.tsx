'use client'

import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { GlobalRiskHub } from '@/components/next/org-risk-global/GlobalRiskHub'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

/**
 * 问题与风险新轨路由（/next/risks，
 * v3-ui-next-org-portfolio-domains W8 · tasks 8.8）。
 *
 * 组织级/全局视窗（无 projectId 上下文）：
 * - 组织 ID 一律取自 auth 有效租户上下文（selectEffectiveOrganizationId），未选择
 *   组织时渲染引导态且**零查询**；
 * - 页守卫 `org:view`/`risk:view`（任一即可，与 design 权限矩阵一致）：无权限渲染
 *   受限横幅，Hub 与项目列表请求零发出（RL-06）；
 * - 本页呈现 taxonomy 三分语义 + 项目风险登记册 Hub 深链 + 「项目问题」工作台
 *   （IssueWorkbench：项目选择/登记/状态机流转，真实 issues API）；
 *   单项目风险数据由目标页 /next/projects/:id/risks 的 risk:view 守卫
 *   负责，本页零风险数据请求。
 */
export default function GlobalRisksNextPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  if (organizationId === null) {
    return (
      <div
        data-org-guidance
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-8 py-14 text-center"
      >
        <ShieldAlert className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
        <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          问题与风险入口为组织级全局视图，需要有效组织租户上下文。请先在组织切换器中完成选择。
        </p>
      </div>
    )
  }

  return (
    <PermissionGuard
      require={['org:view', 'risk:view']}
      mode="any"
      fallback={
        <div
          data-risk-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有访问问题与风险的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 org:view / risk:view 任一权限。请联系组织管理员授权。
          </p>
        </div>
      }
    >
      <GlobalRiskHub organizationId={organizationId} />
    </PermissionGuard>
  )
}
