'use client'

import { useParams, useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { WorkspaceRisksPage } from '@/components/next/risks/WorkspaceRisksPage'
import { ProjectSpaceNotFoundView } from '@/components/next/project-space/ProjectSpaceContainer'

/**
 * 项目风险治理工作面路由（/next/projects/:id/risks，
 * v3-ui-next-risk-change-domains W1 · tasks 1.1）。
 *
 * - 准入门禁：PermissionGuard(require=['risk:view'])——无权渲染受限横幅并阻断
 *   容器与一切风险数据请求（RL-06 防探测）；
 * - 路径 id 非数字 → 直接中性 404 空态，零网络请求（RL-05）；
 * - 项目数据加载、租户隔离与 404 判定全部由 WorkspaceRisksPage 承担（跨组织/
 *   不存在统一中性空态「项目不存在或已被移除」）。
 */
export default function ProjectRisksDomainPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const rawId = params?.id
  const projectId = Number(rawId)
  const validId = Number.isInteger(projectId) && projectId > 0

  return (
    <PermissionGuard
      require={['risk:view']}
      fallback={
        <div
          data-permission-fallback
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center"
        >
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]" />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看该项目风险工作台的权限
          </h3>
          <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
            请联系组织管理员或项目负责人授予 risk:view 权限。
          </p>
        </div>
      }
    >
      {validId ? (
        <WorkspaceRisksPage projectId={projectId} />
      ) : (
        <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
      )}
    </PermissionGuard>
  )
}
