'use client'

import { useParams, useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { ChartGalleryCatalog } from '@/components/next/charts/ChartGalleryCatalog'
import { ProjectChartsContainer } from '@/components/next/charts/ProjectChartsContainer'
import { ProjectSpaceNotFoundView } from '@/components/next/project-space/ProjectSpaceContainer'

/**
 * 项目级图表馆主页（/next/projects/:id/charts，v3-ui-next-chart-gallery tasks 1.7 /
 * spec「项目级图表馆路由」）。
 *
 * - 准入门禁：PermissionGuard(require=['project:view'])——无权限渲染受限横幅并阻断
 *   容器与数据请求加载（RL-06 防探测）；
 * - 路径 id 非数字 → 直接中性 404 空态，零网络请求（RL-05）；
 * - 项目数据加载与租户隔离判定全部由 ProjectChartsContainer 承担（跨组织/不存在
 *   统一中性空态「项目不存在或已被移除」）；
 * - 成功态渲染 20 项全景卡片目录（8 已就绪可点 + 12 置灰预告抽屉）。
 */
export default function ProjectChartsGalleryPage() {
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
            你没有查看该项目图表馆的权限
          </h3>
          <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
            请联系组织管理员或项目负责人授予 project:view 权限。
          </p>
        </div>
      }
    >
      {validId ? (
        <ProjectChartsContainer projectId={projectId}>
          {(project) => (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <h2
                    data-project-charts-title
                    className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
                  >
                    {project.name} · 图表馆
                  </h2>
                  <span className="shrink-0 rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-xs text-[var(--nx-text-muted)]">
                    #{project.code ?? `PROJ-${project.id}`}
                  </span>
                </div>
              </header>
              <ChartGalleryCatalog projectId={project.id} />
            </>
          )}
        </ProjectChartsContainer>
      ) : (
        <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
      )}
    </PermissionGuard>
  )
}
