'use client'

import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { GapAnalysisWorkspace } from '@/components/next/org-gaps/GapAnalysisWorkspace'
import { usePermissions } from '@/hooks/use-permissions'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

/**
 * 资源缺口分析新轨路由入口（/next/organization/resource-gaps，
 * v3-ui-next-org-portfolio-domains W4 · tasks 4.9）。
 *
 * - 组织级页面：无 projectId 上下文，组织 ID 取自 JWT 有效租户；未选择组织渲染
 *   「请先选择组织」引导态，工作台不挂载、零数据请求；
 * - 准入守卫 `org:view` / `portfolio:view` / `resource:view` 任一即可
 *   （与 design RBAC 矩阵一致）；无权限渲染受限横幅，底层接口零请求（RL-06）；
 * - 本页为纯只读多维分析工作台（RL-01）。
 */
export default function OrganizationResourceGapsPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const { canAny } = usePermissions()
  const hasAccess = canAny(['org:view', 'portfolio:view', 'resource:view'])

  if (organizationId === null) {
    return (
      <div
        data-org-guide
        className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-16 text-center"
      >
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          资源缺口分析按组织维度聚合需求-供给缺口。请先在右上角选择组织后访问。
        </p>
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div
        data-gaps-permission-fallback
        className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-16 text-center"
      >
        <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
          无权限访问资源缺口分析
        </h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          需要 org:view / portfolio:view / resource:view 任一权限方可查看缺口分析。
          请联系组织管理员授予权限。
        </p>
      </div>
    )
  }

  return <GapAnalysisWorkspace />
}
