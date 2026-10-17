'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Activity, Filter, LayoutDashboard, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { usePortfolioSummary, usePortfolioProjects } from '@/hooks/use-portfolio-dashboard'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import { PmoReportsHealthSection } from './PmoReportsHealthSection'
import { PmoReportsVarianceSection } from './PmoReportsVarianceSection'
import { PmoReportsWorkloadSection } from './PmoReportsWorkloadSection'
import { PmoReportsChangeImpactSection } from './PmoReportsChangeImpactSection'

export interface PmoReportsLensProps {
  className?: string
}

/**
 * PMO 组合报表镜头工作台组件（W2 · tasks 2.1 / spec「PMO 组合报表四大态势透视」）。
 *
 * - 暗黑仪器风高密度大盘容器，消费 `usePortfolioSummary` 与 `usePortfolioProjects`；
 * - 组织四大态势透视区块（健康分布 / 工期偏差 / 工时负荷 / 变更冲击）；
 * - 项目筛选器：多选收敛四大区块数据范围；
 * - 深链下钻：点击项目卡片/行跳转 `/next/projects/:id/reports`；
 * - 纯只读零写请求（RL-01）。
 */
export function PmoReportsLens({ className }: PmoReportsLensProps) {
  const router = useRouter()
  const tier = useImmersionTier()
  const [selectedProjectIds, setSelectedProjectIds] = React.useState<number[]>([])

  const summaryQuery = usePortfolioSummary({ includeTrafficLight: true })
  const projectsQuery = usePortfolioProjects({ perPage: 100 })

  const summary = summaryQuery.data
  const allProjects = projectsQuery.data?.data ?? []

  const loading =
    summaryQuery.isLoading ||
    summaryQuery.isPending ||
    projectsQuery.isLoading ||
    projectsQuery.isPending ||
    (summaryQuery.isFetching && !summary)

  const isError = summaryQuery.isError || projectsQuery.isError

  const filteredProjects = React.useMemo(() => {
    if (selectedProjectIds.length === 0) return allProjects
    return allProjects.filter((p) => selectedProjectIds.includes(p.projectId))
  }, [allProjects, selectedProjectIds])

  function toggleProject(projectId: number) {
    setSelectedProjectIds((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId],
    )
  }

  function clearProjectFilter() {
    setSelectedProjectIds([])
  }

  function handleProjectClick(projectId: number) {
    router.push(`/next/projects/${projectId}/reports`)
  }

  if (loading) {
    return (
      <div
        data-pmo-reports-lens
        role="status"
        aria-busy="true"
        aria-label="正在加载 PMO 组合报表镜头"
        className={cn(
          'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
          className,
        )}
      >
        <div className="h-9 w-64 animate-pulse rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
        <div className="h-10 w-full animate-pulse rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            aria-hidden
          />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div
        data-pmo-reports-lens-error
        role="alert"
        className={cn(
          'flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-8 text-center',
          className,
        )}
      >
        <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
          PMO 组合报表镜头加载失败
        </h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          组合报表数据暂时无法加载，请稍后重试。
        </p>
        <button
          type="button"
          data-action="retry-reports-lens"
          onClick={() => {
            void summaryQuery.refetch()
            void projectsQuery.refetch()
          }}
          className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          重新载入
        </button>
      </div>
    )
  }

  return (
    <div
      data-pmo-reports-lens
      data-immersion={tier}
      className={cn(
        'flex flex-col gap-5 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
        className,
      )}
    >
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <LayoutDashboard className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h2
              data-pmo-reports-lens-title
              className="text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              PMO 组合报表镜头
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              共 {allProjects.length} 个纳入项目 · 组织组合层四大态势透视
            </p>
          </div>
        </div>
        {summary?.meta?.calculatedAt ? (
          <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 font-mono text-[10px] text-[var(--nx-text-muted)]">
            计算于 {summary.meta.calculatedAt.replace('T', ' ').slice(0, 16)}
          </span>
        ) : null}
      </header>

      {/* 项目筛选器 */}
      <div
        data-pmo-reports-project-filter
        className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3 text-xs"
      >
        <span className="flex items-center gap-1 font-medium text-[var(--nx-text-secondary)]">
          <Filter className="h-3.5 w-3.5" aria-hidden />
          <span>项目范围:</span>
        </span>
        <div className="flex max-h-16 flex-wrap items-center gap-1.5 overflow-y-auto">
          {allProjects.map((p) => {
            const isChecked = selectedProjectIds.includes(p.projectId)
            return (
              <button
                key={p.projectId}
                type="button"
                data-reports-project-filter-item={p.projectId}
                onClick={() => toggleProject(p.projectId)}
                className={cn(
                  'flex h-6.5 items-center gap-1 rounded border px-2 text-[11px] transition-colors',
                  isChecked
                    ? 'border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] text-[var(--nx-accent)] font-medium'
                    : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-1)]',
                )}
              >
                <span className="max-w-[120px] truncate">{p.projectName}</span>
                {isChecked && <X className="h-3 w-3" />}
              </button>
            )
          })}
        </div>
        {selectedProjectIds.length > 0 && (
          <button
            type="button"
            data-action="clear-reports-project-filter"
            onClick={clearProjectFilter}
            className="text-[11px] text-[var(--nx-accent)] hover:underline"
          >
            重置项目 ({selectedProjectIds.length})
          </button>
        )}
      </div>

      {filteredProjects.length === 0 ? (
        <div
          data-pmo-reports-lens-empty
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <Activity className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">当前筛选范围内没有可见项目</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <PmoReportsHealthSection
            projects={filteredProjects}
            summary={summary}
            onProjectClick={handleProjectClick}
            tier={tier}
          />
          <PmoReportsVarianceSection
            projects={filteredProjects}
            onProjectClick={handleProjectClick}
            tier={tier}
          />
          <PmoReportsWorkloadSection projects={filteredProjects} tier={tier} />
          <PmoReportsChangeImpactSection projects={filteredProjects} tier={tier} />
        </div>
      )}
    </div>
  )
}

export default PmoReportsLens
