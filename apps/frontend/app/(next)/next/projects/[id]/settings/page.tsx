'use client'

import { useParams, useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { ProjectSpaceNotFoundView } from '@/components/next/project-space/ProjectSpaceContainer'
import { ProjectSettingsWorkspace } from '@/components/next/project-settings/ProjectSettingsWorkspace'

/**
 * 项目设置新轨路由（/next/projects/:id/settings，
 * v3-ui-next-settings-admin-domains W8 · tasks 8.3，design D-PROJ）。
 *
 * - 准入门禁：PermissionGuard(require=['project:view'])——无权渲染受限横幅并阻断
 *   工作区与工作日历数据请求（RL-06 防探测）；编辑能力由工作区按 `project:update`
 *   细分判定，无写权时渲染只读横幅与只读日历视图；
 * - 路径 id 非整数/非正数（不可能存在的资源）→ 前端零发包直接中性 404（RL-05）；
 * - 跨租户 / HTTP 404 统一由工作区渲染中性空态「项目不存在或已被移除」，零 403
 *   存在性泄露；
 * - 页头复用 DomainPageHeader（domainLabel「项目设置」，项目名就绪后注册顶栏
 *   面包屑 `项目名 · 项目设置`，卸载时按 projectId 安全清理）；
 * - 入口挂在项目空间顶栏 ProjectDomainMenu 治理与分析分组（tasks 8.5）。
 */
export default function ProjectSettingsDomainPage() {
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
          <ShieldAlert
            className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看该项目设置的权限
          </h3>
          <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
            请联系组织管理员或项目负责人授予 project:view 权限。
          </p>
        </div>
      }
    >
      {validId ? (
        <ProjectSettingsWorkspace projectId={projectId} />
      ) : (
        <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
      )}
    </PermissionGuard>
  )
}
