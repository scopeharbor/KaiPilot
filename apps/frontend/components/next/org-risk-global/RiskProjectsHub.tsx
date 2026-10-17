'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, FolderOpen, RefreshCw } from 'lucide-react'
import { projectsApi, projectKeys } from '@/lib/api/projects'
import { buildProjectRisksDeepLink } from '@/lib/next/org-risk-global/global-risk-adapter'

/**
 * 项目风险登记册 Hub（v3-ui-next-org-portfolio-domains W8 · tasks 8.6，
 * spec「问题与风险入口」）。
 *
 * - 消费既有 `projectsApi.list`（组织项目底册，projectKeys.list 同键，RL-04）；
 *   本页**零风险数据请求**——单项目风险数据由目标页 `/next/projects/:id/risks`
 *   的 `risk:view` 守卫负责（B6c 已迁），行内深链即为唯一出口；
 * - 无项目渲染引导空态（深链新轨生成剧场创建入口）；
 * - 三态闭环：骨架 / 空态 / 错误重试（5xx 可重试）。
 */
export interface RiskProjectsHubProps {
  organizationId: number
}

export function RiskProjectsHub({ organizationId }: RiskProjectsHubProps) {
  const projectsQuery = useQuery({
    queryKey: projectKeys.list(organizationId, { perPage: 50 }),
    queryFn: () => projectsApi.list({ perPage: 50 }),
  })

  if (projectsQuery.isLoading) {
    return (
      <div data-risk-projects-loading aria-busy="true" className="flex flex-col gap-2">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-14 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-space-surface)]"
          />
        ))}
      </div>
    )
  }

  if (projectsQuery.isError) {
    return (
      <div
        data-risk-projects-error
        className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-10 text-center"
      >
        <p className="text-sm text-[var(--nx-text-primary)]">项目列表加载失败</p>
        <button
          type="button"
          data-risk-projects-error-retry
          onClick={() => void projectsQuery.refetch()}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          重试
        </button>
      </div>
    )
  }

  const projectList = projectsQuery.data?.data ?? []

  if (projectList.length === 0) {
    return (
      <div
        data-risk-projects-empty
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-10 text-center"
      >
        <FolderOpen className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
        <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">还没有项目</h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          创建项目后，即可在项目内维护风险登记册（概率 × 影响、状态、应对策略）。
        </p>
        <Link
          href="/next/create"
          data-risk-projects-create
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          创建项目
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2" data-risk-projects-hub>
      <p className="text-[11px] text-[var(--nx-text-muted)]">
        风险登记册按项目维护，选择项目进入风险工作台（单项目数据由目标页 risk:view 守卫）。
      </p>
      <ul className="flex flex-col gap-1.5">
        {projectList.map((project) => (
          <li
            key={project.id}
            data-risk-project-row={project.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2.5 transition-colors hover:border-[var(--nx-border-focus)]"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-[var(--nx-text-primary)]">
                {project.name}
                {project.code ? (
                  <span className="ml-1.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                    #{project.code}
                  </span>
                ) : null}
              </p>
              {project.description ? (
                <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
                  {project.description}
                </p>
              ) : null}
            </div>
            <Link
              href={buildProjectRisksDeepLink(project.id)}
              data-risk-project-deep-link={project.id}
              className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
            >
              进入风险登记册
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default RiskProjectsHub
