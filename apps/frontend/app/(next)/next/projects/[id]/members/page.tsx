'use client'

import { useParams, useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { ProjectSpaceNotFoundView } from '@/components/next/project-space/ProjectSpaceContainer'
import { ProjectMembersWorkspace } from '@/components/next/members/ProjectMembersWorkspace'

/**
 * 新轨项目成员管理路由（/next/projects/:id/members，
 * v3-ui-next-resource-team-domains W2 · tasks 2.7 / spec「项目成员列表底册与项目角色管理」）。
 *
 * - 准入门禁：PermissionGuard(require=['project:view'])——无权渲染受限横幅并阻断
 *   成员工作台与一切业务请求（RL-06）；写能力（邀请 / 角色调整 / 转让 / 移出）
 *   由工作台按 project:member:manage / project:update 细分门禁；
 * - 路径 id 非正整数 → 前端零发包直接中性 404（RL-05）；
 * - 项目组织归属校验、跨租户中性 404（「项目不存在或已被移除」）、DomainPageHeader
 *   面包屑联动与三态处理由 ProjectMembersWorkspace 统一承担。
 */
export default function ProjectMembersDomainPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const rawId = params?.id
  const projectId = Number(rawId)
  const validId = Number.isInteger(projectId) && projectId > 0

  return (
    <PermissionGuard
      require={['project:view']}
      fallback={
        <div
          data-permission-fallback
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center"
        >
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]" />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看该项目成员与团队的权限
          </h3>
          <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
            请联系组织管理员或项目负责人授予 project:view 权限。
          </p>
        </div>
      }
    >
      {validId ? (
        <ProjectMembersWorkspace projectId={projectId} />
      ) : (
        <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
      )}
    </PermissionGuard>
  )
}
