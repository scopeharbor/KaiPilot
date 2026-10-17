'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { projectsApi, projectKeys } from '@/lib/api/projects'
import type { Project } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import {
  isNotFoundError,
  ProjectSpaceNotFoundView,
} from '@/components/next/project-space/ProjectSpaceContainer'

/**
 * 项目级图表馆数据加载容器（v3-ui-next-chart-gallery tasks 1.7/1.8，RL-05）。
 *
 * - 项目详情经 `projectsApi.get` 载入（与主工作面同键 projectKeys.detail，RL-04）；
 * - 跨组织 / HTTP 404 统一中性空态「项目不存在或已被移除」（不泄露存在性）；
 * - 加载期渲染仪器感骨架（aria-busy），非 404 错误（500/断网）提供重试与返回；
 * - children 以渲染函数接收加载成功的 Project（子路由 [chartId] 与目录页共用，
 *   避免双份取数/隔离逻辑漂移）。
 */
export interface ProjectChartsContainerProps {
  projectId: number
  children: (project: Project) => React.ReactNode
}

/** 图表馆加载骨架（坐标轴骨架行占位，禁止空态误报）。 */
export function ProjectChartsSkeleton() {
  return (
    <div
      data-chart-space-skeleton
      role="status"
      aria-label="正在加载图表馆"
      aria-busy="true"
      className="flex flex-col gap-4"
    >
      <div className="h-9 w-2/5 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
      <div className="h-10 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((card) => (
          <div
            key={card}
            className="h-40 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
          />
        ))}
      </div>
    </div>
  )
}

/** 非 404 图表馆加载失败（500 / 网络断开）：规范错误卡 + 重试/返回。 */
export function ProjectChartsErrorView({
  onRetry,
  onBackHome,
}: {
  onRetry: () => void
  onBackHome: () => void
}) {
  return (
    <div
      data-chart-space-error
      role="alert"
      aria-label="图表馆加载错误"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
    >
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">图表馆加载失败</h3>
      <p className="text-xs text-[var(--nx-text-muted)]">
        图表馆数据加载失败，请稍后重试或返回角色首页。
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-chart-space-retry
          onClick={onRetry}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          重新载入
        </button>
        <button
          type="button"
          data-chart-space-back-home
          onClick={onBackHome}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          返回角色首页
        </button>
      </div>
    </div>
  )
}

export function ProjectChartsContainer({ projectId, children }: ProjectChartsContainerProps) {
  const router = useRouter()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const tier = useImmersionTier()
  const register = useProjectSpaceEntityStore((state) => state.register)
  const clear = useProjectSpaceEntityStore((state) => state.clear)

  const {
    data: project,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  })

  // RL-05 组织隔离：跨组织项目视同不存在。
  const orgMismatch =
    project !== undefined &&
    currentOrganizationId !== null &&
    project.organizationId !== currentOrganizationId
  const notFound = orgMismatch || (isError && isNotFoundError(error))

  // 顶栏坐标联动（W5 · W1 遗留项）：项目级图表页（目录/镜头共用本容器）加载成功
  // 且组织校验通过后向 entity store 上报项目名，NextAppShell 订阅后经
  // resolveSpaceBreadcrumb 回显 `/next/projects/:id · <名称>`；卸载/失败/越界即清空。
  React.useEffect(() => {
    if (project !== undefined && !orgMismatch) {
      register(projectId, project.name)
    } else {
      clear(projectId)
    }
    return () => clear(projectId)
  }, [project, orgMismatch, projectId, register, clear])

  if (isPending) {
    return <ProjectChartsSkeleton />
  }
  if (notFound) {
    return <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
  }
  if (isError || project === undefined) {
    return (
      <ProjectChartsErrorView
        onRetry={() => void refetch()}
        onBackHome={() => router.push('/next')}
      />
    )
  }

  return (
    <div
      data-project-charts-space
      className={cn(
        'flex min-h-[70dvh] min-w-0 flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {children(project)}
    </div>
  )
}

export default ProjectChartsContainer
