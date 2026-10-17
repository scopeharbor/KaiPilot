'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, TrendingUp } from 'lucide-react'
import {
  usePriorityScoringProjects,
  usePriorityScoringSummary,
  usePriorityScoringWeights,
} from '@/hooks/use-priority-scoring'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import type {
  PriorityLevel,
  PriorityScoreItem,
  PriorityScoringListResponse,
  SupportedPrioritySortKey,
} from '@aiproj/types'
import { PmoPrioritySummaryCards } from './PmoPrioritySummaryCards'
import { PmoPriorityWeightsCard } from './PmoPriorityWeightsCard'
import { PmoPriorityScoreTable } from './PmoPriorityScoreTable'
import { PmoPriorityProjectDetailDrawer } from './PmoPriorityProjectDetailDrawer'

/**
 * PMO 优先级评分工作台容器（v3-ui-next-pmo-domain W4 · tasks 4.1，
 * spec「PMO 优先级评分只读工作台」）。
 *
 * - 数据 100% 复用既有 hooks（usePriorityScoringSummary/Projects/Weights，
 *   GET /pmo/priority-scoring/{summary,projects,weights}，只读聚合）；
 * - 状态管理：等级多选过滤（重置分页）、排序键（SUPPORTED_PRIORITY_SORT_KEYS）、
 *   分页与评分明细抽屉；全部交互零写请求（RL-01）；
 * - 三态闭环：几何匹配骨架屏（aria-busy）/ 语义空态（表内）/ 错误卡（5xx 重试、
 *   403/404 中性受限不重试）；权重卡局部加载/错误闭环不阻塞主区；
 * - 精确档降级：precise 下剥离开放空间光晕，纯色仪器面板（useImmersionTier）；
 * - 页头「← 返回角色首页」（/next）统一回退（design D2 组织层动线）。
 */
export function PmoPriorityScoringWorkspace() {
  const tier = useImmersionTier()
  const [page, setPage] = React.useState(1)
  const [sortKey, setSortKey] = React.useState<SupportedPrioritySortKey>('priority_score')
  const [levelFilter, setLevelFilter] = React.useState<PriorityLevel[]>([])
  const [selectedItem, setSelectedItem] = React.useState<PriorityScoreItem | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  const summaryQuery = usePriorityScoringSummary()
  const projectsQuery = usePriorityScoringProjects({
    page,
    perPage: 50,
    sort: sortKey,
    priorityLevels: levelFilter.length > 0 ? levelFilter : undefined,
  })
  const weightsQuery = usePriorityScoringWeights()

  // 参数切换（翻页/过滤/排序）会换 query key：新 key 解析前 data 短暂为 undefined。
  // 用「最后已知数据」镜像撑住内容区（等效 keepPreviousData 语义），只让表格局部
  // 过渡，避免整页骨架闪烁、过滤 chips 在交互中被卸载；共享 hook 只读不改。
  const [lastProjects, setLastProjects] = React.useState<PriorityScoringListResponse | undefined>(
    undefined,
  )
  React.useEffect(() => {
    if (projectsQuery.data) setLastProjects(projectsQuery.data)
  }, [projectsQuery.data])

  const summary = summaryQuery.data
  const projects = projectsQuery.data ?? lastProjects
  const weights = weightsQuery.data

  const loading =
    (summary === undefined && (summaryQuery.isFetching || summaryQuery.isLoading)) ||
    (projects === undefined && (projectsQuery.isFetching || projectsQuery.isLoading))

  const fatalError =
    (summaryQuery.isError && summary === undefined) ||
    (projectsQuery.isError && projects === undefined)

  const retryAll = React.useCallback(() => {
    void summaryQuery.refetch()
    void projectsQuery.refetch()
  }, [summaryQuery, projectsQuery])

  const handleToggleLevel = React.useCallback((level: PriorityLevel) => {
    setLevelFilter((previous) => {
      const next = previous.includes(level)
        ? previous.filter((item) => item !== level)
        : [...previous, level]
      return next
    })
    setPage(1)
  }, [])

  const handleClearFilters = React.useCallback(() => {
    setLevelFilter([])
    setPage(1)
  }, [])

  const handleSortChange = React.useCallback((key: SupportedPrioritySortKey) => {
    setSortKey(key)
    setPage(1)
  }, [])

  const handleOpenDetail = React.useCallback((item: PriorityScoreItem) => {
    setSelectedItem(item)
    setDrawerOpen(true)
  }, [])

  const handleCloseDetail = React.useCallback(() => {
    setDrawerOpen(false)
    setSelectedItem(null)
  }, [])

  const containerClass = cn(
    'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
    tier === 'precise'
      ? 'bg-[var(--nx-workspace-bg)]'
      : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
  )

  const summaryStatus = (summaryQuery.error as { status?: number } | null)?.status ?? null
  const projectsStatus = (projectsQuery.error as { status?: number } | null)?.status ?? null
  const restricted =
    summaryStatus === 403 ||
    summaryStatus === 404 ||
    projectsStatus === 403 ||
    projectsStatus === 404

  return (
    <div data-pps-workspace className={containerClass}>
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <TrendingUp className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1 data-pps-title className="text-lg font-semibold text-[var(--nx-text-primary)]">
              优先级评分
            </h1>
            <p data-pps-caption className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              组织组合层确定性评分 · 只读工作台
              {summary ? (
                <span className="ml-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-secondary)]">
                  {summary.scoredProjects}/{summary.totalProjects} 已评分
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <Link
          href="/next"
          data-pps-back
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          返回角色首页
        </Link>
      </header>

      {/* 骨架屏 */}
      {loading ? <PpsSkeleton /> : null}

      {/* 错误卡（5xx 可重试 / 403-404 中性受限） */}
      {!loading && fatalError ? (
        <div
          data-pps-error
          role="alert"
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
        >
          {restricted ? (
            <>
              <TrendingUp className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
              <p data-pps-restricted className="text-sm font-medium text-[var(--nx-text-primary)]">
                当前无法查看优先级评分数据
              </p>
              <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                该组合评分数据可能不可用或无权访问。请联系组织管理员。
              </p>
            </>
          ) : (
            <>
              <TrendingUp className="h-7 w-7 text-[var(--nx-status-warning)]" aria-hidden />
              <p className="text-sm font-medium text-[var(--nx-text-primary)]">
                优先级评分加载失败
              </p>
              <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                {summaryQuery.error?.message ?? projectsQuery.error?.message ?? '请稍后重试。'}
              </p>
              <button
                type="button"
                data-pps-retry
                onClick={retryAll}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                重新载入
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* 内容区 */}
      {!loading && !fatalError && summary && projects ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-4">
            <PmoPrioritySummaryCards
              summary={summary}
              activeLevels={levelFilter}
              onToggleLevel={handleToggleLevel}
            />
            <PmoPriorityScoreTable
              items={projects.data}
              meta={projects.meta}
              page={page}
              sortKey={sortKey}
              activeLevels={levelFilter}
              onSortChange={handleSortChange}
              onPageChange={setPage}
              onClearFilters={handleClearFilters}
              onOpenDetail={handleOpenDetail}
            />
          </div>
          <PmoPriorityWeightsCard
            data={weights}
            loading={weightsQuery.isLoading}
            error={weightsQuery.isError}
            onRetry={() => void weightsQuery.refetch()}
          />
        </div>
      ) : null}

      <PmoPriorityProjectDetailDrawer
        item={selectedItem}
        open={drawerOpen}
        onClose={handleCloseDetail}
      />
    </div>
  )
}

/** 几何匹配骨架屏（杜绝空态闪烁）。 */
function PpsSkeleton() {
  return (
    <div
      data-pps-skeleton
      role="status"
      aria-label="优先级评分加载中"
      aria-busy="true"
      className="flex min-h-[40vh] flex-col gap-4"
    >
      <div className="grid grid-cols-3 gap-2.5">
        {[0, 1, 2].map((tile) => (
          <div
            key={tile}
            className="h-16 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
          />
        ))}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {[0, 1, 2, 3, 4].map((chip) => (
          <div
            key={chip}
            className="h-10 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
    </div>
  )
}

export default PmoPriorityScoringWorkspace
