'use client'

import { useParams, useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import {
  ProjectSpaceContainer,
  ProjectSpaceNotFoundView,
} from '@/components/next/project-space/ProjectSpaceContainer'

/**
 * 新轨单项目空间路由（v3-ui-next-project-space design Decision 1 / spec「项目空间路由与数据加载」）。
 *
 * - 准入门禁：PermissionGuard（require=['project:view', 'task:view']，mode="all"）——
 *   无查看权限时渲染受限横幅并阻断容器渲染（看板/元数据请求零发出，不探测资源属性）；
 * - 路径 id 非数字（不可能存在的资源）→ 直接中性 404 空态，零网络请求（RL-05）；
 * - 项目数据加载与租户隔离判定全部由 ProjectSpaceContainer 承担（404 / 跨组织统一
 *   中性空态「项目不存在或已被移除」，选项「返回角色首页」导航至 /next）。
 */
export default function NextProjectSpacePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const rawId = params?.id
  const projectId = Number(rawId)
  const validId = Number.isInteger(projectId) && projectId > 0

  return (
    <PermissionGuard
      require={['project:view', 'task:view']}
      mode="all"
      fallback={
        <div
          data-permission-fallback
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center"
        >
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]" />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看该项目空间的权限
          </h3>
          <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
            请联系组织管理员或项目负责人授予 project:view 与 task:view 权限。
          </p>
        </div>
      }
    >
      {validId ? (
        <ProjectSpaceContainer projectId={projectId} />
      ) : (
        <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
      )}
    </PermissionGuard>
  )
}
