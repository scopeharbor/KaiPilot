'use client'

import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { CapacityLoopList } from '@/components/next/org-loops/CapacityLoopList'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'

/**
 * 资源容量闭环列表新轨路由（/next/organization/resource-capacity-loops，
 * v3-ui-next-org-portfolio-domains W6 · tasks 6.7）。
 *
 * - 组织级页面：无 projectId 上下文，组织 ID 取自 JWT 有效租户（hooks 内部），
 *   URL 不含 organizationId（RL-05）；
 * - 准入门禁：PermissionGuard require=['resource_capacity_loop:view']（与后端
 *   路由级 RBAC 规则一致）——无权限渲染受限横幅且底层接口零请求（RL-06）；
 * - 未选择组织时渲染「请先选择组织」引导态且零查询（不挂载列表工作台）；
 * - 面包屑回显 `/next/organization/resource-capacity-loops · 资源容量闭环`
 *   由空间坐标注册（W10 接线）后在顶栏呈现。
 */
export default function ResourceCapacityLoopsPage() {
  const organizationId = useCurrentOrganizationId()

  return (
    <PermissionGuard
      require={['resource_capacity_loop:view']}
      fallback={
        <div
          data-rccl-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看资源容量闭环的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            查看容量闭环需要 resource_capacity_loop:view 权限。请联系组织管理员授予权限。
          </p>
        </div>
      }
    >
      {organizationId === null ? (
        <div
          data-rccl-org-guide
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            资源容量闭环按组织隔离。请先在顶栏选择组织后再查看容量闭环列表。
          </p>
        </div>
      ) : (
        <CapacityLoopList />
      )}
    </PermissionGuard>
  )
}
