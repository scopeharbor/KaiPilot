'use client'

import { useParams } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { CapacityLoopDetailWorkspace } from '@/components/next/org-loops/CapacityLoopDetailWorkspace'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'

/**
 * 资源容量闭环详情新轨路由
 * （/next/organization/resource-capacity-loops/[loopId]，
 * v3-ui-next-org-portfolio-domains W6 · tasks 6.7）。
 *
 * - 组织级页面：无 projectId 上下文，组织 ID 取自 JWT 有效租户（hooks 内部），
 *   跨组织/非法 loopId 由工作台按后端中性 404 语义呈现「容量环未找到」（RL-05）；
 * - 准入门禁：读 resource_capacity_loop:view（PermissionGuard），写动作按
 *   resource_capacity_loop:manage 在组件内显隐——无查看权限渲染受限横幅且底层
 *   接口零请求（RL-06）；
 * - 路径 id 非正整数（不可能存在的资源）→ 直接渲染中性「未找到」态且零网络请求；
 * - 未选择组织时渲染「请先选择组织」引导态且零查询。
 */
export default function ResourceCapacityLoopDetailPage() {
  const params = useParams<{ loopId: string }>()
  const organizationId = useCurrentOrganizationId()

  const rawId = params?.loopId
  const loopId = Number(rawId)
  const validId = Number.isInteger(loopId) && loopId > 0

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
            资源容量闭环按组织隔离。请先在顶栏选择组织后再查看容量环详情。
          </p>
        </div>
      ) : validId ? (
        <CapacityLoopDetailWorkspace loopId={loopId} />
      ) : (
        <div
          data-rccl-loop-not-found
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">容量环未找到</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            该容量环不存在、已被移除，或当前会话无权访问。未显示任何详情以避免泄露存在性。
          </p>
        </div>
      )}
    </PermissionGuard>
  )
}
