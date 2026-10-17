/**
 * 燃尽 / 燃起图镜头（v3-chart-gallery-tier2-timeseries-metrics W2 · task 2.2）。
 *
 * 数据：`GET /projects/:id/metrics/burndown`（只读 GET，RL-01），支持
 * `metric`（task/hour）与 `granularity`（day/week）参数化切换。渲染理想燃尽线、
 * 实际燃尽线、累计完成燃起线、总范围基准线 4 条时序 + 范围蔓延（Scope Creep）
 * 概览卡片。参数切换仅驱动 TanStack Query 重新发起只读 GET，零写操作。
 *
 * 纯只读：无任何写入口（RL-01/RL-06）；精确档（precise）ECharts animation 关闭。
 */
'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Flame } from 'lucide-react'
import {
  projectMetricsApi,
  projectMetricsKeys,
  type BurndownGranularity,
  type BurndownMetric,
} from '@/lib/api/project-metrics'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useEChartsInstance } from '@/lib/next/charts/use-echarts-instance'
import {
  buildBurndownOption,
  buildBurndownOverview,
  buildBurndownSeriesData,
  burndownUnitLabel,
} from '@/lib/next/charts/burndown-adapter'
import { cn } from '@/lib/utils'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface BurndownChartLensProps {
  projectId: number
}

const METRIC_TABS: ReadonlyArray<{ id: BurndownMetric; label: string }> = [
  { id: 'task', label: '按任务数 (task)' },
  { id: 'hour', label: '按工时 (hour)' },
]

const GRANULARITY_TABS: ReadonlyArray<{ id: BurndownGranularity; label: string }> = [
  { id: 'day', label: '按日 (day)' },
  { id: 'week', label: '按周 (week)' },
]

export function BurndownChartLens({ projectId }: BurndownChartLensProps) {
  const tier = useImmersionTier()
  const animation = tier !== 'precise'
  const [metric, setMetric] = useState<BurndownMetric>('task')
  const [granularity, setGranularity] = useState<BurndownGranularity>('day')
  const chartRef = useRef<HTMLDivElement | null>(null)

  const params = { metric, granularity }
  const query = useQuery({
    queryKey: projectMetricsKeys.burndown(projectId, params),
    queryFn: () => projectMetricsApi.burndown(projectId, params),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const result = query.data
  const seriesData = useMemo(() => (result ? buildBurndownSeriesData(result) : null), [result])
  const overview = useMemo(() => (result ? buildBurndownOverview(result) : null), [result])
  const option = useMemo(
    () =>
      seriesData && seriesData.categories.length > 0
        ? buildBurndownOption(seriesData, metric, animation)
        : null,
    [seriesData, metric, animation],
  )

  useEChartsInstance({ containerRef: chartRef, option, animation })

  const hasData = result !== undefined
  const isEmpty = hasData && result.points.length === 0

  return (
    <div data-chart-lens-root="burndown" className="flex min-h-[420px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" data-export-ignore="true">
        <div
          role="tablist"
          aria-label="燃尽口径切换"
          data-lens-metric-tabs
          className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-0.5"
        >
          {METRIC_TABS.map((tab) => {
            const active = metric === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-lens-metric-tab={tab.id}
                onClick={() => setMetric(tab.id)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                  active
                    ? 'bg-[var(--nx-accent)]/10 text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <div
          role="tablist"
          aria-label="燃尽粒度切换"
          data-lens-granularity-tabs
          className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-0.5"
        >
          {GRANULARITY_TABS.map((tab) => {
            const active = granularity === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-lens-granularity-tab={tab.id}
                onClick={() => setGranularity(tab.id)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                  active
                    ? 'bg-[var(--nx-accent)]/10 text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {query.isLoading && !hasData ? (
        <ChartLensSkeleton label="正在加载燃尽/燃起图数据" />
      ) : query.isError && !hasData ? (
        <ChartLensErrorState
          ariaLabel="燃尽/燃起图加载失败"
          title="燃尽/燃起数据加载失败"
          onRetry={() => void query.refetch()}
        />
      ) : isEmpty || !option || !overview ? (
        <ChartLensEmptyState
          icon={Flame}
          title="当前项目暂无燃尽/燃起数据"
          description="项目尚未登记任务或排期区间，燃尽/燃起时序暂无法计算。"
          ariaLabel="燃尽/燃起图数据为空"
        />
      ) : (
        <>
          <div data-burndown-overview className="flex flex-wrap items-center gap-2 text-[11px]">
            <OverviewBadge
              label="当前剩余"
              value={`${overview.remaining} ${burndownUnitLabel(overview.metric)}`}
            />
            <OverviewBadge
              label="累计已完成"
              value={`${overview.completed} ${burndownUnitLabel(overview.metric)}`}
            />
            <OverviewBadge
              label="当前总范围"
              value={`${overview.totalScope} ${burndownUnitLabel(overview.metric)}`}
            />
            <OverviewBadge
              label="范围净变化 (Scope Creep)"
              value={`${overview.scopeCreep >= 0 ? '+' : ''}${overview.scopeCreep} ${burndownUnitLabel(overview.metric)}`}
              tone={overview.scopeCreep > 0 ? 'accent' : 'neutral'}
            />
          </div>

          <div className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3">
            <div
              ref={chartRef}
              data-burndown-chart
              role="img"
              aria-label="燃尽与燃起时序图"
              className="h-[360px] w-full"
            />
          </div>
        </>
      )}
    </div>
  )
}

function OverviewBadge({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'accent'
}) {
  return (
    <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-[var(--nx-text-secondary)]">
      {label}{' '}
      <b
        className={cn(
          'font-mono',
          tone === 'accent' ? 'text-[var(--nx-accent)]' : 'text-[var(--nx-text-primary)]',
        )}
      >
        {value}
      </b>
    </span>
  )
}

export default BurndownChartLens
