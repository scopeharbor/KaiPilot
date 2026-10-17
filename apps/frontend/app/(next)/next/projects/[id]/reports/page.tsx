'use client'

import { useParams, useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { ProjectSpaceNotFoundView } from '@/components/next/project-space/ProjectSpaceContainer'
import { ReportsWorkspaceContainer } from '@/components/next/reports/ReportsWorkspaceContainer'

/**
 * 新轨项目级报表中心路由（/next/projects/:id/reports，
 * v3-ui-next-reports-domain W1 · tasks 1.5 / spec「路由与空间承载契约」）。
 *
 * - 准入门禁：PermissionGuard(require=['report:view'])——无查看权限时渲染受限
 *   空态（联系管理员开通 report:view），阻断报表容器与全部底层数据请求（零外发，
 *   不探测资源属性）；文案对齐 spec「权限受限占位态」；
 * - 路径 id 非数字（不可能存在的资源）→ 直接中性 404 空态，零网络请求（RL-05）；
 * - 项目数据加载、组织归属校验（orgMismatch）与跨租户中性 404 统一由
 *   ReportsWorkspaceContainer 承担（「项目不存在或已被移除」）；
 * - 模式状态机（?tab=preset|periodic|versions + ?versionId= 深链）由容器管理。
 */
export default function NextProjectReportsPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const rawId = params?.id
  const projectId = Number(rawId)
  const validId = Number.isInteger(projectId) && projectId > 0

  return (
    <PermissionGuard
      require={['report:view']}
      fallback={
        <div
          data-permission-fallback
          data-reports-permission-fallback
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
        >
          <ShieldAlert
            className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">暂无报表查看权限</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-xs text-[var(--nx-text-muted)]">
            请联系组织管理员或项目负责人开通 report:view 权限，获得后即可进入报表中心。
          </p>
        </div>
      }
    >
      {validId ? (
        <ReportsWorkspaceContainer projectId={projectId} />
      ) : (
        <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
      )}
    </PermissionGuard>
  )
}
