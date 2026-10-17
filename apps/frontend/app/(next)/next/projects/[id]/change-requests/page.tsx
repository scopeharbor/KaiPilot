'use client'

import { useParams, useRouter } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { ProjectSpaceNotFoundView } from '@/components/next/project-space/ProjectSpaceContainer'
import { ChangeRequestsWorkspacePage } from '@/components/next/change-requests/ChangeRequestsWorkspacePage'
import { CHANGE_REQUEST_VIEW_PERMISSIONS } from '@/components/next/change-requests/cr-permissions'

/**
 * 新轨项目变更请求主页路由（/next/projects/:id/change-requests，
 * v3-ui-next-risk-change-domains W2 · tasks 2.1 / spec「变更请求新轨列表与多维检索过滤」）。
 *
 * - 准入门禁：PermissionGuard 要求 `change_request:view`；后端 RBAC 目录（start/rbac/
 *   permissions.ts）中变更域查看能力实际由 `change_request:create` 声明承载（policy
 *   view = create），故以「view 或 create 任一」放行——已核实权限系列（见
 *   cr-permissions.ts），无权访问时渲染受限横幅且零数据请求（RL-06）；
 * - 路径 id 非正整数 → 前端零发包直接中性 404（RL-05）；
 * - 项目组织归属校验与跨租户中性 404 由 WorkspacePage 统一承担。
 */
export default function NextProjectChangeRequestsPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const rawId = params?.id
  const projectId = Number(rawId)
  const validId = Number.isInteger(projectId) && projectId > 0

  return (
    <PermissionGuard
      require={CHANGE_REQUEST_VIEW_PERMISSIONS}
      mode="any"
      fallback={
        <div
          data-permission-fallback
          data-change-requests-permission-fallback
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
        >
          <ClipboardList
            className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            暂无变更请求访问权限
          </h3>
          <p className="mx-auto mt-1.5 max-w-sm text-xs text-[var(--nx-text-muted)]">
            请联系组织管理员或项目负责人开通变更域权限（change_request:create /
            change_request:approve），获得后即可查看与处理项目变更请求。
          </p>
        </div>
      }
    >
      {validId ? (
        <ChangeRequestsWorkspacePage projectId={projectId} />
      ) : (
        <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
      )}
    </PermissionGuard>
  )
}
