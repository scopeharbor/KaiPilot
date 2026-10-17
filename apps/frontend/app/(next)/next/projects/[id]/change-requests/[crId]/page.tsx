'use client'

import { useParams, useRouter } from 'next/navigation'
import { ClipboardList } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { ProjectSpaceNotFoundView } from '@/components/next/project-space/ProjectSpaceContainer'
import { ChangeRequestDetailPage } from '@/components/next/change-requests/ChangeRequestDetailPage'
import { CHANGE_REQUEST_VIEW_PERMISSIONS } from '@/components/next/change-requests/cr-permissions'

/**
 * 变更请求详情与审批路由（/next/projects/:id/change-requests/:crId，
 * v3-ui-next-risk-change-domains W2 · tasks 2.5 / spec「变更请求受控审批流」）。
 *
 * - 准入门禁：change_request:view（或承载该能力的 change_request:create）；
 * - 项目 id / 变更 id 任一非正整数 → 前端零发包直接中性 404（RL-05）；
 * - 组织归属校验（跨租户中性 404）与变更实体 404 中性空态由 DetailPage 承担。
 */
export default function NextProjectChangeRequestDetailPage() {
  const params = useParams<{ id: string; crId: string }>()
  const router = useRouter()
  const projectId = Number(params?.id)
  const changeRequestId = Number(params?.crId)
  const validProjectId = Number.isInteger(projectId) && projectId > 0
  const validCrId = Number.isInteger(changeRequestId) && changeRequestId > 0

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
            请联系组织管理员或项目负责人开通变更域权限，获得后即可查看变更详情与审批决策台。
          </p>
        </div>
      }
    >
      {validProjectId && validCrId ? (
        <ChangeRequestDetailPage projectId={projectId} changeRequestId={changeRequestId} />
      ) : (
        <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
      )}
    </PermissionGuard>
  )
}
