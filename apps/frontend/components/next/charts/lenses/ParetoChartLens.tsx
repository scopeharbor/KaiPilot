/**
 * 柏拉图 (Pareto) 镜头（v3-chart-gallery-tier2-pareto-lob W2 · task 2.1）。
 *
 * 数据：`GET /projects/:id/metrics/pareto`（只读 GET，RL-01），支持
 * 4 维统计口径（issue_type/issue_severity/risk_category/change_type）参数化切换。
 * 顶部渲染 4 维切换 Tab 与关键少数归因概览，主体渲染双 Y 轴直方图（频数降序）+
 * 累计百分比平滑折线 + 80% 二八分界线。参数切换仅驱动 TanStack Query 重新发起
 * 只读 GET，零写操作。
 *
 * 纯只读：无任何写入口（RL-01/RL-06）；精确档（precise）ECharts animation 关闭。
 */
'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Percent } from 'lucide-react'
import {
  projectMetricsApi,
  projectMetricsKeys,
  type ParetoDimension,
} from '@/lib/api/project-metrics'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useEChartsInstance } from '@/lib/next/charts/use-echarts-instance'
import { buildParetoOption, buildParetoViewModel } from '@/lib/next/charts/pareto-adapter'
import { cn } from '@/lib/utils'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface ParetoChartLensProps {
  projectId: number
}

const DIMENSION_TABS: ReadonlyArray<{ id: ParetoDimension; label: string }> = [
  { id: 'issue_type', label: '缺陷类型' },
  { id: 'issue_severity', label: '严重程度' },
  { id: 'risk_category', label: '风险分类' },
  { id: 'change_type', label: '变更类型' },
]

export function ParetoChartLens({ projectId }: ParetoChartLensProps) {
  const tier = useImmersionTier()
  const animation = tier !== 'precise'
  const [dimension, setDimension] = useState<ParetoDimension>('issue_type')
  const chartRef = useRef<HTMLDivElement | null>(null)

  const params = { dimension }
  const query = useQuery({
    queryKey: projectMetricsKeys.pareto(projectId, params),
    queryFn: () => projectMetricsApi.pareto(projectId, params),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const result = query.data
  const model = useMemo(() => (result ? buildParetoViewModel(result) : null), [result])
  const option = useMemo(
    () => (model && model.items.length > 0 ? buildParetoOption(model.items, animation) : null),
    [model, animation],
  )

  useEChartsInstance({ containerRef: chartRef, option, animation })

  const isLoading = query.isLoading
  const isError = query.isError && !model
  const hasData = model !== null
  const isEmpty = hasData && (model.totalCount === 0 || model.items.length === 0)

  const retry = () => {
    void query.refetch()
  }

  return (
    <div data-chart-lens-root="pareto" className="flex min-h-[420px] flex-col gap-3">
      {/* 顶部统计维度切换栏：标示 data-export-ignore 免污染导出图 */}
      <div className="flex flex-wrap items-center justify-between gap-2" data-export-ignore="true">
        <div
          role="tablist"
          aria-label="柏拉图统计维度切换"
          data-lens-dimension-tabs
          className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-0.5"
        >
          {DIMENSION_TABS.map((tab) => {
            const active = dimension === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-lens-dimension-tab={tab.id}
                onClick={() => setDimension(tab.id)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                  active
                    ? 'bg-[var(--nx-workspace-bg)] font-medium text-[var(--nx-text-primary)] shadow-sm'
                    : 'text-[var(--nx-text-secondary)] hover:bg-[var(--nx-workspace-bg)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {model && !isEmpty && (
          <div className="flex items-center gap-2 text-xs text-[var(--nx-text-muted)]">
            <span>总计 {model.totalCount} 项</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span>
              关键少数：
              <strong className="font-mono font-medium text-[var(--nx-accent)]">
                {model.vitalFewCount} 项
              </strong>
              （占 {model.vitalFewPercentage}%）
            </span>
          </div>
        )}
      </div>

      {isLoading && !hasData ? (
        <ChartLensSkeleton label="正在加载柏拉图指标数据" />
      ) : isError && !hasData ? (
        <ChartLensErrorState
          ariaLabel="柏拉图数据加载失败"
          title="柏拉图数据加载失败"
          onRetry={retry}
        />
      ) : !hasData || isEmpty ? (
        <ChartLensEmptyState
          icon={Percent}
          title="当前统计维度暂无数据记录"
          description="当前统计维度暂无数据记录，无法生成柏拉图。"
          ariaLabel="柏拉图数据为空"
        />
      ) : (
        <div className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3">
          <div
            ref={chartRef}
            data-chart-viewport-slot
            role="img"
            aria-label="柏拉图分析图"
            className="h-[360px] w-full"
          />
        </div>
      )}
    </div>
  )
}

export default ParetoChartLens
