/**
 * 双变量散布图镜头（v3-ui-next-chart-gallery W2 · tasks 2.3/2.4）。
 *
 * 数据（全部只读 GET，RL-01）：
 * - 工时偏差：tasksApi.list（预估/实际工时均已记录的任务，h）；
 * - 成本偏差：tasksApi.list（估算/实际成本均已记录的任务，元）；
 * - 风险敞口：listRisks（概率/影响 1-5 级，散点半径按 score 缩放、颜色按
 *   后端 risk_level_service 同阈值四档：低/中/高/极高）。
 *
 * 统计参考线：工时/成本维度绘制 Y=X 45° 理想基准对角线 + X/Y 均值虚线四象限；
 * 悬停 Tooltip 展示任务/风险详情与偏差百分比（暗黑控制台微标）。
 *
 * 精确档 animation 关闭；纯只读镜头零写入口。
 */
'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChartScatter } from 'lucide-react'
import type { Risk } from '@/lib/api/risks'
import { listRisks } from '@/lib/api/risks'
import type { Task } from '@/lib/api/tasks'
import { tasksApi, taskKeys } from '@/lib/api/tasks'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useEChartsInstance, type EChartsCoreOption } from '@/lib/next/charts/use-echarts-instance'
import { cn } from '@/lib/utils'
import {
  buildRiskPoints,
  buildScatterModel,
  buildTaskPoints,
  formatEstimateTooltipHtml,
  formatRiskTooltipHtml,
  NX_STATUS_DANGER,
  RISK_BAND_COLOR,
  riskBandLabel,
  riskScoreBand,
  SCATTER_DIMENSIONS,
  SCATTER_DIMENSION_ORDER,
  type ScatterDataModel,
  type ScatterDimensionId,
  type ScatterPoint,
} from '@/lib/next/charts/scatter-plot-adapter'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface ScatterPlotChartLensProps {
  projectId: number
}

/** 每页 100、最多 10 页（与甘特任务拉取上限同量级，V1 WBS 上限 ~1000）。 */
const PAGE_SIZE = 100
const MAX_PAGES = 10

async function fetchAllTasks(projectId: number): Promise<Task[]> {
  const firstPage = await tasksApi.list(projectId, { page: 1, perPage: PAGE_SIZE, sort: '+id' })
  const pageCount = Math.min(firstPage.meta.totalPages, MAX_PAGES)
  if (pageCount <= 1) return firstPage.data
  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      tasksApi.list(projectId, { page: index + 2, perPage: PAGE_SIZE, sort: '+id' }),
    ),
  )
  return [firstPage.data, ...remainingPages.map((page) => page.data)].flat()
}

async function fetchAllRisks(projectId: number): Promise<Risk[]> {
  const firstPage = await listRisks(projectId, { page: 1, perPage: PAGE_SIZE, sort: '+id' })
  const pageCount = Math.min(firstPage.meta.totalPages, MAX_PAGES)
  if (pageCount <= 1) return firstPage.data
  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      listRisks(projectId, { page: index + 2, perPage: PAGE_SIZE, sort: '+id' }),
    ),
  )
  return [firstPage.data, ...remainingPages.map((page) => page.data)].flat()
}

const TOOLTIP_SHELL = {
  backgroundColor: 'rgba(10, 11, 13, 0.96)',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: '#cbd5e1', fontSize: 12 },
  extraCssText: 'border-radius:6px;box-shadow:none;',
} as const

function axisItems(points: ScatterPoint[]) {
  return points.map((point) => ({
    value: [point.x, point.y] as [number, number],
    symbolSize: point.radius,
    itemStyle: { color: point.color },
  }))
}

/** 散布图 option（数据 + 均值线 + Y=X 对角线；纯映射，测试直接断言）。 */
function buildScatterOption(
  dimension: ScatterDimensionId,
  points: ScatterPoint[],
  model: ScatterDataModel,
  animation: boolean,
): EChartsCoreOption {
  const meta = SCATTER_DIMENSIONS[dimension]
  const domain = model.domain ?? { lo: 0, hi: 1 }

  const marks: unknown[] = []
  if (meta.hasIdealLine) {
    // Y=X 45° 理想基准对角线（跨数据域全宽）
    marks.push({
      coord: [domain.lo, domain.lo],
      lineStyle: { color: '#7a8ba1', type: 'dashed', width: 1 },
    })
    marks.push({
      coord: [domain.hi, domain.hi],
      lineStyle: { color: '#7a8ba1', type: 'dashed', width: 1 },
      label: {
        formatter: '理想基准 Y=X',
        color: '#7a8ba1',
        fontSize: 10,
        position: 'insideEndTop',
      },
    })
    if (model.meanX !== null) {
      marks.push({
        xAxis: model.meanX,
        lineStyle: { color: NX_STATUS_DANGER, type: 'dashed', width: 1 },
        label: { formatter: 'X 均值', color: NX_STATUS_DANGER, fontSize: 10, position: 'end' },
      })
    }
    if (model.meanY !== null) {
      marks.push({
        yAxis: model.meanY,
        lineStyle: { color: NX_STATUS_DANGER, type: 'dashed', width: 1 },
        label: { formatter: 'Y 均值', color: NX_STATUS_DANGER, fontSize: 10, position: 'end' },
      })
    }
  }

  const seriesData = axisItems(points)

  return {
    animation,
    tooltip: {
      ...TOOLTIP_SHELL,
      trigger: 'item',
      formatter: (params: unknown) => {
        const item = params as { dataIndex?: number } | undefined
        if (!item || item.dataIndex === undefined) return ''
        const point = points[Number(item.dataIndex)]
        if (!point) return ''
        return point.sourceKind === 'risk'
          ? formatRiskTooltipHtml(point)
          : formatEstimateTooltipHtml(point, meta)
      },
    },
    grid: { left: 8, right: 24, top: 24, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      name: meta.xLabel,
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: { color: '#94a3b8', fontSize: 11 },
      min: domain.lo,
      max: domain.hi,
      axisLabel: { color: '#7a8ba1', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    yAxis: {
      type: 'value',
      name: meta.yLabel,
      nameLocation: 'middle',
      nameGap: 34,
      nameTextStyle: { color: '#94a3b8', fontSize: 11 },
      min: domain.lo,
      max: domain.hi,
      axisLabel: { color: '#7a8ba1', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    series: [
      {
        name: meta.chartTitle,
        type: 'scatter',
        data: seriesData,
        emphasis: { scale: 1.4 },
        markLine: marks.length > 0 ? { symbol: 'none', silent: true, data: marks } : undefined,
      },
    ],
  }
}

const BAND_ORDER = ['low', 'medium', 'high', 'critical'] as const

export function ScatterPlotChartLens({ projectId }: ScatterPlotChartLensProps) {
  const tier = useImmersionTier()
  const animation = tier !== 'precise'
  const [dimension, setDimension] = useState<ScatterDimensionId>('hours')
  const chartRef = useRef<HTMLDivElement | null>(null)
  const needsTasks = dimension !== 'risk'

  const tasksQuery = useQuery({
    queryKey: taskKeys.view(projectId, 'scatter-plot', { page: 1, perPage: PAGE_SIZE }),
    queryFn: () => fetchAllTasks(projectId),
    enabled: projectId > 0 && needsTasks,
    retry: false,
    staleTime: 30_000,
  })
  const risksQuery = useQuery({
    queryKey: ['risks', 'list', projectId, { page: 1, perPage: PAGE_SIZE }],
    queryFn: () => fetchAllRisks(projectId),
    enabled: projectId > 0 && !needsTasks,
    retry: false,
    staleTime: 30_000,
  })

  const points = useMemo(() => {
    if (dimension === 'risk') {
      return risksQuery.data ? buildRiskPoints(risksQuery.data) : []
    }
    return tasksQuery.data ? buildTaskPoints(tasksQuery.data, dimension) : []
  }, [dimension, tasksQuery.data, risksQuery.data])

  const model = useMemo(() => buildScatterModel(points), [points])

  const activeQuery = dimension === 'risk' ? risksQuery : tasksQuery
  const dataReady =
    dimension === 'risk' ? risksQuery.data !== undefined : tasksQuery.data !== undefined

  const option = useMemo(
    () => (points.length > 0 ? buildScatterOption(dimension, points, model, animation) : null),
    [dimension, points, model, animation],
  )
  useEChartsInstance({ containerRef: chartRef, option, animation })

  const meta = SCATTER_DIMENSIONS[dimension]

  // 语义统计徽章：工时/成本偏差分布；风险为敞口分档计数（含文案，色盲可辨）
  const badgeStats = useMemo(() => {
    if (dimension === 'risk') {
      const counts = { low: 0, medium: 0, high: 0, critical: 0 }
      for (const point of points) {
        const score = point.score ?? 0
        counts[riskScoreBand(score)] += 1
      }
      return BAND_ORDER.map((band) => ({
        key: band,
        label: `${riskBandLabel(band)}风险`,
        color: RISK_BAND_COLOR[band],
        count: counts[band],
      }))
    }
    let over = 0
    let under = 0
    let exact = 0
    for (const point of points) {
      if (point.deviationPercent === null) continue
      if (point.deviationPercent === 0) exact += 1
      else if (point.deviationPercent > 0) over += 1
      else under += 1
    }
    return [
      { key: 'over', label: '超支/延期', color: NX_STATUS_DANGER, count: over },
      { key: 'under', label: '结余/提速', color: '#34d399', count: under },
      { key: 'exact', label: '估算精准', color: '#7a8ba1', count: exact },
    ]
  }, [dimension, points])

  const sourceEmpty =
    dataReady &&
    (dimension === 'risk'
      ? (risksQuery.data?.length ?? 0) === 0
      : (tasksQuery.data?.length ?? 0) === 0)
  const pairEmpty = dataReady && !sourceEmpty && points.length === 0

  const emptyTitle =
    dimension === 'risk'
      ? '当前项目尚未登记风险条目'
      : sourceEmpty
        ? '当前项目暂无任务数据'
        : dimension === 'hours'
          ? '暂无同时记录预估与实际工时的任务'
          : '暂无同时记录估算与实际成本的任务'
  const emptyDescription =
    dimension === 'risk'
      ? '风险条目登记后，此处将以散点呈现概率与影响度的分布与敞口分级。'
      : '任务排期并在执行中回填实耗后，此处将呈现估算与实际偏差散点分布。'
  const guideHref = dimension === 'risk' ? undefined : `/next/projects/${projectId}?lens=gantt`
  const guideLabel = dimension === 'risk' ? undefined : '前往甘特图排期'

  return (
    <div data-chart-lens-root="scatter-plot" className="flex min-h-[420px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="散布图分析维度切换"
          data-scatter-dim-tabs
          className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-0.5"
        >
          {SCATTER_DIMENSION_ORDER.map((id) => {
            const active = dimension === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                data-scatter-dim-tab={id}
                onClick={() => setDimension(id)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                  active
                    ? 'bg-[var(--nx-accent)]/10 text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {SCATTER_DIMENSIONS[id].tabLabel}
              </button>
            )
          })}
        </div>
        <span data-scatter-dim-title className="text-xs text-[var(--nx-text-secondary)]">
          {meta.chartTitle} · <b className="font-mono">{points.length}</b> 个样本
        </span>
      </div>

      {activeQuery.isLoading && !dataReady ? (
        <ChartLensSkeleton label="正在加载散布图数据" />
      ) : activeQuery.isError && !dataReady ? (
        <ChartLensErrorState
          ariaLabel={`${meta.tabLabel}数据加载失败`}
          title={`${meta.tabLabel}数据加载失败`}
          onRetry={() => void activeQuery.refetch()}
        />
      ) : sourceEmpty ? (
        <ChartLensEmptyState
          icon={ChartScatter}
          title={emptyTitle}
          description={emptyDescription}
          guideHref={guideHref}
          guideLabel={guideLabel}
          ariaLabel="散布图数据为空"
        />
      ) : (
        <div
          data-scatter-panel
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3"
        >
          {pairEmpty || option === null ? (
            <ChartLensEmptyState
              icon={ChartScatter}
              title={emptyTitle}
              description={emptyDescription}
              guideHref={guideHref}
              guideLabel={guideLabel}
              ariaLabel="散布图数据为空"
            />
          ) : (
            <>
              <div
                data-scatter-stat-badges
                className="mb-2 flex flex-wrap items-center gap-2 text-[11px]"
              >
                {badgeStats.map((stat) => (
                  <span
                    key={stat.key}
                    data-scatter-badge={stat.key}
                    className="inline-flex items-center gap-1.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-[var(--nx-text-secondary)]"
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: stat.color }}
                    />
                    {stat.label}
                    <b className="font-mono text-[var(--nx-text-primary)]">{stat.count}</b>
                  </span>
                ))}
              </div>
              <div
                ref={chartRef}
                data-scatter-chart
                role="img"
                aria-label={`${meta.chartTitle}散布图`}
                className="h-[360px] w-full"
              />
              {dimension === 'risk' ? (
                <p
                  data-scatter-risk-note
                  className="mt-1 text-right font-mono text-[10px] text-[var(--nx-text-muted)]"
                >
                  半径 = 综合得分缩放 · 颜色 = 敞口分档
                </p>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default ScatterPlotChartLens
