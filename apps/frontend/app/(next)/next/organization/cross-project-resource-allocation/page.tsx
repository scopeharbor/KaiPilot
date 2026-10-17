'use client'

import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { useAuthStore } from '@/stores/auth-store'
import { AllocationWorkspace } from '@/components/next/org-allocation/AllocationWorkspace'

/**
 * 跨项目资源调配组织级页面（/next/organization/cross-project-resource-allocation，
 * v3-ui-next-org-portfolio-domains W7 · tasks 7.5）。
 *
 * - 页面准入门禁（design Decision 6 / RBAC 矩阵）：`resource:view` 或
 *   `portfolio:view` 任一即可——无权限渲染受限横幅且底层草案/候选接口零请求
 *   （RL-06 防探测）；写按钮可见性由工作台按后端口径镜像（resource:manage 或
 *   portfolio:view）；
 * - 组织 ID 一律取自 auth store 有效租户上下文；未选择组织时渲染「请先选择组织」
 *   引导态且零数据请求（Decision 1）；
 * - 面包屑由空间坐标白名单（W10 接线）回显：/next/organization/
 *   cross-project-resource-allocation · 跨项目资源调配。
 */
export default function CrossProjectResourceAllocationPage() {
  const organizationId = useAuthStore((state) => state.currentOrganizationId)

  if (organizationId === null) {
    return (
      <div
        data-allocation-org-guide
        className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
      >
        <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          跨项目资源调配按组织隔离——请先切换到目标组织后进入该工作台。
        </p>
      </div>
    )
  }

  return (
    <PermissionGuard
      require={['resource:view', 'portfolio:view']}
      mode="any"
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看跨项目资源调配的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 resource:view 或 portfolio:view 权限。请联系组织管理员或项目组合负责人授予权限。
          </p>
        </div>
      }
    >
      <AllocationWorkspace />
    </PermissionGuard>
  )
}
