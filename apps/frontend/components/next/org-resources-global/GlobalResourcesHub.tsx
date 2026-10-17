'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { usePermissions } from '@/hooks/use-permissions'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import { Database, FolderKanban, GraduationCap, LayoutGrid, RefreshCw, Users } from 'lucide-react'
import { projectsApi, projectKeys, type Project } from '@/lib/api/projects'
import { resourceKeys, resourcesApi, type ResourceLoadItem } from '@/lib/api/resources'
import {
  buildProjectLoadSummary,
  buildResourceTypeDistribution,
  countActiveResources,
  listOverloadedMembers,
} from '@/lib/next/org-resources-global/global-resources-adapter'
import { ProjectResourceSummaryCard } from './ProjectResourceSummaryCard'

/**
 * 全局资源 Hub（/next/resources，v3-ui-next-org-portfolio-domains W7 · tasks 7.6，
 * spec「全局资源入口、技能矩阵与问题风险入口」）。
 *
 * - **显式项目选择器**（URL `?projectId=` 记忆）：严禁沿用旧轨「默认选中第一个项目」
 *   的隐式语义——未显式选择时渲染引导空态且不替用户选项目（旧缺陷不回迁，回归锁定）；
 * - 项目列表 `projectsApi.list`（服务端按项目可见性过滤）；所选项目资源数据仅当
 *   会话具备资源查看权（resource:view 或 portfolio:view）时加载
 *   （`resourcesApi.load` 团队负荷 + `resourcesApi.list` 类型分布），否则渲染受限态
 *   且零项目资源请求（RL-06）——项目级权限最终由后端逐项目强制；
 * - 摘要卡：团队负荷（成员数/超载数/平均利用率）与类型分布、超载成员 top 列表；
 *   深度链接：项目资源工作台 `/next/projects/:id/resources`（B6d 已迁）、
 *   组织资源池 `/next/organization/resource-pool`、技能矩阵 `/next/resources/skill-matrix`；
 * - 加载骨架 / 空态 / 错误重试闭环；精确档（precise）关闭氛围光晕。
 */

const PROJECTS_PER_PAGE = 200

/** 30 天滑动窗口（今天含，与项目资源工作台负荷面板同源窗口基准：
 *   过去 29 天 → 今天，只读复盘语义）。 */
function defaultLoadWindow(): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 29)
  return { from: toDateOnly(from), to: toDateOnly(to) }
}

function toDateOnly(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export interface GlobalResourcesHubProps {
  /** 显式默认项目 ID（来自 URL）；null = 未选择（引导态）。 */
  initialProjectId?: number | null
}

export function GlobalResourcesHub({ initialProjectId = null }: GlobalResourcesHubProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tier = useImmersionTier()
  const { canAny } = usePermissions()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)

  const [mirrorProjectId, setMirrorProjectId] = React.useState<number | null>(initialProjectId)
  React.useEffect(() => {
    setMirrorProjectId(readProjectIdParam(searchParams.get('projectId')))
  }, [searchParams])
  const projectId = mirrorProjectId

  const canViewResourceData = canAny(['resource:view', 'portfolio:view'])

  const projectsQuery = useQuery({
    queryKey: projectKeys.list(currentOrganizationId ?? 0, { perPage: PROJECTS_PER_PAGE }),
    queryFn: () => projectsApi.list({ perPage: PROJECTS_PER_PAGE }),
    enabled: currentOrganizationId !== null,
  })
  const projects = projectsQuery.data?.data ?? []
  const selectedProject: Project | undefined = projects.find((project) => project.id === projectId)

  const loadWindowRef = React.useRef(defaultLoadWindow())

  const resourceSummaryQuery = useQuery({
    queryKey: resourceKeys.load(projectId ?? 0, {
      from: loadWindowRef.current.from,
      to: loadWindowRef.current.to,
      view: 'team',
    }),
    queryFn: () =>
      resourcesApi.load(projectId as number, {
        from: loadWindowRef.current.from,
        to: loadWindowRef.current.to,
        view: 'team',
      }),
    // 所选项目必须真实存在于可见项目列表（URL 引用可能失效——RL-05 中性态，
    // 失效引用零资源请求防探测）。
    enabled: projectId !== null && canViewResourceData && selectedProject !== undefined,
  })
  const resourceListQuery = useQuery({
    queryKey: resourceKeys.list(projectId ?? 0, { perPage: PROJECTS_PER_PAGE, status: 'active' }),
    queryFn: () =>
      resourcesApi.list(projectId as number, { perPage: PROJECTS_PER_PAGE, status: 'active' }),
    enabled: projectId !== null && canViewResourceData && selectedProject !== undefined,
  })

  const isTeamLoad = (
    data: unknown,
  ): data is { resources: ResourceLoadItem[]; teamAverageUtilizationPercent?: number | null } =>
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { resources?: unknown }).resources)
  const teamData = isTeamLoad(resourceSummaryQuery.data) ? resourceSummaryQuery.data : null
  const loadRows = teamData?.resources ?? []
  const loadSummary = React.useMemo(
    () => buildProjectLoadSummary(loadRows, teamData?.teamAverageUtilizationPercent),
    [loadRows, teamData],
  )
  const overloadedMembers = React.useMemo(() => listOverloadedMembers(loadRows), [loadRows])
  const typeDistribution = React.useMemo(
    () => buildResourceTypeDistribution(resourceListQuery.data?.data ?? []),
    [resourceListQuery.data],
  )
  const activeResourceCount = React.useMemo(
    () => countActiveResources(resourceListQuery.data?.data ?? []),
    [resourceListQuery.data],
  )

  function selectProject(id: number | null) {
    setMirrorProjectId(id)
    const url = new URL(window.location.href)
    if (id === null) {
      url.searchParams.delete('projectId')
    } else {
      url.searchParams.set('projectId', String(id))
    }
    router.push(`${url.pathname}${url.search}`)
  }

  const hasError = resourceSummaryQuery.isError || resourceListQuery.isError
  const loadingSummary =
    (projectId !== null &&
      canViewResourceData &&
      (resourceSummaryQuery.isPending || resourceListQuery.isPending)) ||
    projectsQuery.isPending

  return (
    <div
      data-global-resources-hub
      aria-busy={projectsQuery.isPending}
      data-immersion={tier}
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Users className="h-5 w-5 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">全局资源</h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              跨项目资源入口：显式选择项目查看负荷摘要；项目级数据由后端逐项目授权（RL-05）
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-global-resources-link-pool
            onClick={() => router.push('/next/organization/resource-pool')}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <FolderKanban className="h-3.5 w-3.5" aria-hidden />
            组织资源池
          </button>
          <button
            type="button"
            data-global-resources-link-skills
            onClick={() => router.push('/next/resources/skill-matrix')}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <GraduationCap className="h-3.5 w-3.5" aria-hidden />
            技能矩阵
          </button>
        </div>
      </header>

      {/* 项目选择器（显式记忆，绝不默认首个项目） */}
      <section data-global-resources-picker className="flex flex-col gap-1.5">
        <label
          htmlFor="global-resources-project-select"
          className="text-[11px] text-[var(--nx-text-muted)]"
        >
          选择项目
        </label>
        <select
          id="global-resources-project-select"
          data-global-resources-project-select
          value={projectId ?? ''}
          onChange={(event) =>
            selectProject(event.target.value === '' ? null : Number(event.target.value))
          }
          className="h-9 w-full max-w-md rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        >
          <option value="">选择项目查看资源摘要…</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
              {project.code ? `（${project.code}）` : ''}
            </option>
          ))}
        </select>
      </section>

      {projectsQuery.isPending ? (
        <div data-global-resources-skeleton aria-busy="true" className="flex flex-col gap-2">
          {[0, 1, 2].map((line) => (
            <div key={line} className="h-20 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
          ))}
        </div>
      ) : projectsQuery.isError ? (
        <div
          data-global-resources-error
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-3 py-3"
        >
          <p className="text-xs text-[var(--nx-text-secondary)]">
            项目列表加载失败，请检查网络后重试。
          </p>
          <button
            type="button"
            data-global-resources-retry
            onClick={() => void projectsQuery.refetch()}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            重试
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div
          data-global-resources-no-projects
          className="flex flex-col items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-4 py-12 text-center"
        >
          <LayoutGrid className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-primary)]">暂无可访问项目</p>
          <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            仅有你可见的项目会出现在选择器中；创建项目或获得项目权限后可在此查看资源负荷摘要。
          </p>
        </div>
      ) : projectId === null ? (
        <div
          data-global-resources-guide
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] px-4 py-14 text-center"
        >
          <Database className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-primary)]">尚未选择项目</p>
          <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            请从上方选择器显式选择项目——系统不会替您默认选中第一个项目。选择后此处将加载该项目的团队负荷
            与资源类型分布摘要，并可直接进入项目资源工作台。
          </p>
        </div>
      ) : selectedProject === undefined ? (
        <div
          data-global-resources-project-missing
          role="status"
          aria-label="项目不存在或已被移除"
          className="flex flex-col items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-4 py-12 text-center"
        >
          <Database className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-primary)]">项目不存在或已被移除</p>
          <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            URL 中的项目引用可能已失效，或该项目不在当前组织可见范围内。请从选择器重新选择。
          </p>
        </div>
      ) : !canViewResourceData ? (
        <ProjectResourceSummaryCard
          project={selectedProject}
          restricted
          onEnterWorkbench={() => router.push(`/next/projects/${projectId}/resources`)}
        />
      ) : hasError ? (
        <div
          data-global-resources-summary-error
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-3 py-3"
        >
          <p className="text-xs text-[var(--nx-text-secondary)]">项目资源摘要加载失败。</p>
          <button
            type="button"
            data-global-resources-summary-retry
            onClick={() => {
              void resourceSummaryQuery.refetch()
              void resourceListQuery.refetch()
            }}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            重试
          </button>
        </div>
      ) : loadingSummary ? (
        <div
          data-global-resources-summary-skeleton
          aria-busy="true"
          className="flex flex-col gap-2"
        >
          {[0, 1, 2].map((line) => (
            <div key={line} className="h-24 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
          ))}
        </div>
      ) : (
        <ProjectResourceSummaryCard
          project={selectedProject}
          loadRows={loadRows}
          loadSummary={loadSummary}
          overloadedMembers={overloadedMembers}
          typeDistribution={typeDistribution}
          activeResourceCount={activeResourceCount}
          onEnterWorkbench={() => router.push(`/next/projects/${projectId}/resources`)}
        />
      )}
    </div>
  )
}

export default GlobalResourcesHub

function readProjectIdParam(raw: string | null | undefined): number | null {
  if (!raw) return null
  const value = Number(raw.trim())
  return Number.isInteger(value) && value > 0 ? value : null
}
