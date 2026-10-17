'use client'

import * as React from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  CalendarRange,
  EyeOff,
  Loader2,
  RotateCcw,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useEChartsInstance, type EChartsCoreOption } from '@/lib/next/charts/use-echarts-instance'
import {
  useForecastDemandCurves,
  useForecastGapAnalysis,
  useForecastProjectDrivers,
  useForecastSkillDrivers,
  useForecastSummary,
} from '@/hooks/use-resource-demand-forecasting'
import { cn } from '@/lib/utils'
import {
  aggregateDemandDimensionRows,
  buildGapWaterfall,
  confidenceMetaOf,
  createDefaultForecastWindow,
  DEMAND_DIMENSION_LABELS,
  DEMAND_DIMENSION_OPTIONS,
  DEMAND_GRANULARITY_OPTIONS,
  demandMethodLabel,
  demandUrlStateToQuery,
  demandWarningChipClass,
  demandWarningLabel,
  formatDemandCount,
  formatDemandHours,
  formatDemandMetric,
  formatDemandPercentRatio,
  formatForecastWindow,
  formatGapAnalysisTotals,
  formatGapEntryBucket,
  formatGapEntryDimension,
  formatProjectDriverLabel,
  formatSignedGapHours,
  formatSkillDriverLabel,
  gapTypeChipClass,
  gapTypeLabel,
  hasActiveDemandFilters,
  isDemandCurveEmpty,
  parseDemandUrlState,
  serializeDemandCurveSeries,
  serializeDemandUrlState,
  type DemandCurveSeriesModel,
  type DemandDimensionRowModel,
  type DemandGapWaterfallBucket,
  type DemandUrlState,
} from '@/lib/next/org-demand/org-demand-adapter'
import type {
  ForecastDemandCurve,
  ForecastGapAnalysis,
  ForecastProjectDriver,
  ForecastSkillDriver,
  ForecastSummary,
} from '@aiproj/types'
import { DemandAiAdvisoryCard } from './DemandAiAdvisoryCard'

/**
 * 资源需求预测工作台（v3-ui-next-org-portfolio-domains W5 · tasks 5.7/5.8，
 * spec「需求预测：summary/曲线/缺口/驱动视图 + AI 只读咨询卡」）。
 *
 * - 数据源 100% 复用既有 use-resource-demand-forecasting hooks（summary/
 *   demand-curves/gap-analysis/project-drivers/skill-drivers；
 *   /resource-demand-forecasting*，组织隔离由 orgId 参数收敛）；
 * - URL query 是筛选唯一事实来源（view/granularity/startDate/endDate restorable）；
 * - 统计系图表（需求曲线 / 缺口瀑布）统一经 lib/next/echarts-core 收敛底座
 *   （nx-dark 主题，SVG 渲染器）；精确档（precise）动画归零；
 * - AI 咨询卡零自动触发：显式点击「生成 AI 洞察」才发请求（RL-01），AIMarker
 *   回显来源/置信度/理由；除该显式点击外一切交互零写请求；
 * - 三态闭环：加载骨架（aria-busy）/ 语义空态 / 错误区分（受限中性 vs 可重试）。
 */

// ── 图表色板（next-tokens.css 令牌数值展开） ──────────────────────────────

const COLOR_DEMAND = '#38bdf8' // --nx-chart-1
const COLOR_ALLOCATION = '#34d399' // --nx-chart-3
const COLOR_GAP = '#f87171' // --nx-chart-5
const COLOR_SHORTAGE = '#ef4444' // --nx-status-danger
const COLOR_SURPLUS = '#10b981' // --nx-status-success

const TOOLTIP_SHELL = {
  backgroundColor: 'rgba(10, 11, 13, 0.96)',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: '#cbd5e1', fontSize: 12 },
  extraCssText: 'border-radius:6px;box-shadow:none;',
} as const

const AXIS_LABEL_MUTED = '#7a8ba1'

/** 类别数 → x 轴标签抽样间隔（防拥挤）。 */
function axisLabelInterval(categoryCount: number): number {
  if (categoryCount <= 8) return 0
  return Math.ceil(categoryCount / 8)
}

/** 需求曲线折线 option（纯映射，测试直接断言）。 */
export function buildCurveChartOption(
  model: DemandCurveSeriesModel,
  animation: boolean,
): EChartsCoreOption {
  return {
    animation,
    tooltip: {
      ...TOOLTIP_SHELL,
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    legend: {
      data: ['预测需求', '当前分配', '缺口'],
      top: 0,
      right: 8,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: '#94a3b8', fontSize: 11 },
    },
    grid: { left: 8, right: 16, top: 32, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: model.categories,
      boundaryGap: false,
      axisLabel: {
        color: AXIS_LABEL_MUTED,
        fontSize: 10,
        interval: axisLabelInterval(model.categories.length),
        hideOverlap: true,
      },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '工时 (h)',
      nameTextStyle: { color: AXIS_LABEL_MUTED, fontSize: 10, padding: [0, 0, 4, 0] },
      axisLabel: { color: AXIS_LABEL_MUTED, fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    series: [
      {
        name: '预测需求',
        type: 'line',
        smooth: true,
        symbolSize: 5,
        itemStyle: { color: COLOR_DEMAND },
        lineStyle: { width: 2 },
        data: model.forecastDemand,
      },
      {
        name: '当前分配',
        type: 'line',
        smooth: true,
        symbolSize: 5,
        itemStyle: { color: COLOR_ALLOCATION },
        lineStyle: { width: 2 },
        data: model.actualAllocation,
      },
      {
        name: '缺口',
        type: 'line',
        smooth: true,
        symbolSize: 5,
        itemStyle: { color: COLOR_GAP },
        lineStyle: { width: 2, type: 'dashed' },
        data: model.gap,
      },
    ],
  }
}

/** 缺口瀑布（短缺/盈余对冲条）option——聚合桶级别的供需缺口冲积图。 */
export function buildGapWaterfallChartOption(
  buckets: DemandGapWaterfallBucket[],
  animation: boolean,
): EChartsCoreOption {
  return {
    animation,
    tooltip: {
      ...TOOLTIP_SHELL,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    legend: {
      data: ['短缺小时', '盈余小时'],
      top: 0,
      right: 8,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: '#94a3b8', fontSize: 11 },
    },
    grid: { left: 8, right: 16, top: 32, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: buckets.map((bucket) => bucket.bucketStart),
      axisLabel: {
        color: AXIS_LABEL_MUTED,
        fontSize: 10,
        interval: axisLabelInterval(buckets.length),
        hideOverlap: true,
      },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '工时 (h)',
      nameTextStyle: { color: AXIS_LABEL_MUTED, fontSize: 10 },
      axisLabel: { color: AXIS_LABEL_MUTED, fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    series: [
      {
        name: '短缺小时',
        type: 'bar',
        barMaxWidth: 22,
        itemStyle: { color: COLOR_SHORTAGE },
        data: buckets.map((bucket) => -bucket.shortageHours),
      },
      {
        name: '盈余小时',
        type: 'bar',
        barMaxWidth: 22,
        itemStyle: { color: COLOR_SURPLUS },
        data: buckets.map((bucket) => bucket.surplusHours),
      },
    ],
  }
}

// ── 需求曲线图表（含维度切换 + 高密度聚合表） ─────────────────────────────

export interface DemandCurveChartsProps {
  curve: ForecastDemandCurve
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

/** 曲线视图：维度切换 + 折线图 + 维度聚合表（全部只读）。 */
export function DemandCurveCharts({ curve, isLoading, isError, onRetry }: DemandCurveChartsProps) {
  const tier = useImmersionTier()
  const animation = tier !== 'precise'
  const [dimension, setDimension] = React.useState<'role' | 'skill' | 'project'>('role')
  const chartRef = React.useRef<HTMLDivElement | null>(null)

  const model = React.useMemo(
    () => serializeDemandCurveSeries(curve, dimension),
    [curve, dimension],
  )
  const dimensionRows = React.useMemo<DemandDimensionRowModel[]>(() => {
    const buckets =
      dimension === 'role'
        ? curve.roleBuckets
        : dimension === 'skill'
          ? curve.skillBuckets
          : curve.projectBuckets
    return aggregateDemandDimensionRows(buckets)
  }, [curve, dimension])

  const option = React.useMemo(
    () => (model.categories.length > 0 ? buildCurveChartOption(model, animation) : null),
    [model, animation],
  )

  useEChartsInstance({ containerRef: chartRef, option, animation })

  if (isLoading && model.bucketRows === 0) {
    return (
      <div
        data-demand-curves-loading
        role="status"
        aria-busy="true"
        aria-label="正在加载需求曲线"
        className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3"
      >
        <div className="h-8 w-56 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
        <div className="h-72 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
      </div>
    )
  }

  if (isError && model.bucketRows === 0) {
    return (
      <div
        data-demand-curves-error
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-secondary)]">需求曲线加载失败</p>
        <button
          type="button"
          data-demand-curves-retry
          onClick={onRetry}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          重试
        </button>
      </div>
    )
  }

  const empty = isDemandCurveEmpty(curve)

  return (
    <div
      data-demand-curves-view
      className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="需求曲线维度"
          className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-0.5"
        >
          {DEMAND_DIMENSION_OPTIONS.map((optionItem) => {
            const active = dimension === optionItem.value
            return (
              <button
                key={optionItem.value}
                type="button"
                role="tab"
                aria-selected={active}
                data-demand-dimension-tab={optionItem.value}
                onClick={() => setDimension(optionItem.value)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors',
                  active
                    ? 'bg-[var(--nx-accent)]/10 text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {optionItem.label}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-[var(--nx-text-muted)]">
          {DEMAND_DIMENSION_LABELS[dimension]}维度 · {model.bucketRows} 桶行 · 覆盖窗口{' '}
          {model.categories.length} 期
        </p>
      </div>

      {empty ? (
        <div
          data-demand-curves-empty
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
        >
          <TrendingUp className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">暂无可见的需求曲线数据</p>
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            当前预测窗口内没有可见角色/技能/项目的需求桶数据。
          </p>
        </div>
      ) : (
        <>
          {option !== null ? (
            <div
              ref={chartRef}
              data-demand-curves-chart
              role="img"
              aria-label={`${DEMAND_DIMENSION_LABELS[dimension]}需求曲线`}
              className="h-[320px] w-full"
            />
          ) : null}

          {/* 维度聚合表（只读高密度） */}
          {dimensionRows.length > 0 ? (
            <div
              data-demand-dimension-table
              className="overflow-auto rounded-md border border-[var(--nx-border-hairline)]"
            >
              <table className="w-full min-w-[680px] border-collapse text-left text-[11px]">
                <thead>
                  <tr className="bg-[var(--nx-workspace-surface)] text-[var(--nx-text-muted)]">
                    <th className="px-3 py-2 font-medium">{DEMAND_DIMENSION_LABELS[dimension]}</th>
                    <th className="px-3 py-2 text-right font-medium">预测需求</th>
                    <th className="px-3 py-2 text-right font-medium">当前分配</th>
                    <th className="px-3 py-2 text-right font-medium">缺口（含符号）</th>
                    <th className="px-3 py-2 text-right font-medium">峰值缺口桶</th>
                    <th className="px-3 py-2 text-center font-medium">桶数</th>
                    <th className="px-3 py-2 text-center font-medium">置信度</th>
                  </tr>
                </thead>
                <tbody>
                  {dimensionRows.map((row) => (
                    <tr
                      key={row.key}
                      data-demand-dimension-row
                      className="border-t border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]"
                    >
                      <td className="px-3 py-2">
                        {row.redacted ? (
                          <span className="flex items-center gap-1 text-[var(--nx-text-muted)]">
                            <EyeOff className="h-3 w-3" aria-hidden />
                            {row.display}
                          </span>
                        ) : (
                          <span className="text-[var(--nx-text-primary)]">{row.display}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatDemandHours(row.totalDemand)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatDemandHours(row.totalAllocation)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right font-mono',
                          row.gap > 0
                            ? 'text-[var(--nx-status-danger)]'
                            : row.gap < 0
                              ? 'text-[var(--nx-status-success)]'
                              : 'text-[var(--nx-text-muted)]',
                        )}
                      >
                        {row.gap === 0
                          ? '0h'
                          : formatSignedGapHours(
                              Math.abs(row.gap),
                              row.gap > 0 ? 'shortage' : 'surplus',
                            )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{row.peakGapBucket ?? '—'}</td>
                      <td className="px-3 py-2 text-center font-mono">{row.bucketCount}</td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
                            confidenceMetaOf(row.confidence).chipClass,
                          )}
                        >
                          {confidenceMetaOf(row.confidence).label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

// ── 工作台骨架/空态/视图子件 ─────────────────────────────────────────────

function WorkspaceSkeleton() {
  return (
    <div
      data-demand-skeleton
      role="status"
      aria-busy="true"
      aria-label="正在加载需求预测数据"
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
          />
        ))}
      </div>
      <div className="h-9 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
      <div className="h-72 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
    </div>
  )
}

function KpiCard({
  label,
  formatted,
  icon: Icon,
  tone,
  hint,
}: {
  label: string
  formatted: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'danger' | 'success' | 'default'
  hint?: string
}) {
  return (
    <div
      data-demand-kpi
      className={cn(
        'rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3.5 py-3',
        tone === 'danger' && 'border-[rgba(239,68,68,0.35)]',
        tone === 'success' && 'border-[rgba(16,185,129,0.35)]',
      )}
    >
      <div className="flex items-center gap-2 text-[var(--nx-text-muted)]">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="text-[11px]">{label}</span>
      </div>
      <p
        data-demand-kpi-value
        className={cn(
          'mt-1.5 font-mono text-xl font-semibold tabular-nums text-[var(--nx-text-primary)]',
          tone === 'danger' && 'text-[var(--nx-status-danger)]',
          tone === 'success' && 'text-[var(--nx-status-success)]',
        )}
      >
        {formatted}
      </p>
      {hint ? <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">{hint}</p> : null}
    </div>
  )
}

function SummarySection({
  summary,
  isError,
  onRetry,
}: {
  summary: ForecastSummary | undefined
  isError: boolean
  onRetry: () => void
}) {
  if (isError && !summary) {
    return (
      <div
        data-demand-summary-error
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-secondary)]">预测摘要加载失败</p>
        <button
          type="button"
          data-demand-summary-retry
          onClick={onRetry}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          重试
        </button>
      </div>
    )
  }
  if (!summary) {
    return (
      <div data-demand-summary-loading className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
          />
        ))}
      </div>
    )
  }

  const metrics = summary.metrics
  const projectedGap = metrics.forecast_projected_gap_hours ?? 0
  return (
    <section data-demand-summary aria-label="需求预测摘要" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="预测总需求"
          formatted={formatDemandMetric(
            'forecast_total_demand_hours',
            metrics.forecast_total_demand_hours ?? 0,
          )}
          icon={BarChart3}
        />
        <KpiCard
          label="当前分配"
          formatted={formatDemandMetric(
            'forecast_total_allocated_hours',
            metrics.forecast_total_allocated_hours ?? 0,
          )}
          icon={Users}
        />
        <KpiCard
          label="可用容量"
          formatted={formatDemandMetric(
            'forecast_total_available_hours',
            metrics.forecast_total_available_hours ?? 0,
          )}
          icon={Zap}
        />
        <KpiCard
          label="预测缺口"
          formatted={formatDemandMetric('forecast_projected_gap_hours', projectedGap)}
          icon={AlertTriangle}
          tone={projectedGap > 0 ? 'danger' : projectedGap < 0 ? 'success' : 'default'}
          hint={
            projectedGap > 0
              ? '缺口为正：需求超过可用容量'
              : projectedGap < 0
                ? '缺口为负：容量富余'
                : '供需基本平衡'
          }
        />
      </div>

      {/* 窗口/方法/置信度/覆盖率元信息 + 新鲜度/告警徽标 */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2">
        <span className="flex items-center gap-1 font-mono text-[10px] text-[var(--nx-text-muted)]">
          <CalendarRange className="h-3 w-3" aria-hidden />
          {formatForecastWindow(summary.window.startDate, summary.window.endDate)}
        </span>
        <span className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
          {summary.window.bucketCount} 桶 · {demandMethodLabel(summary.method)}
        </span>
        <span
          className={cn(
            'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
            confidenceMetaOf(summary.overallConfidence).chipClass,
          )}
        >
          整体置信度 {confidenceMetaOf(summary.overallConfidence).label}
        </span>
        <span className="text-[10px] text-[var(--nx-text-muted)]">
          项目覆盖率 {formatDemandPercentRatio(summary.projectCoverage)} · 资源覆盖率{' '}
          {formatDemandPercentRatio(summary.resourceCoverage)}
        </span>
        {summary.freshness.isStale ? (
          <span className="inline-flex items-center rounded-sm border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)]">
            数据已过期（{summary.freshness.staleSources.length} 个来源）
          </span>
        ) : null}
        {summary.warnings.map((warning) => (
          <span
            key={warning}
            className={cn(
              'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
              demandWarningChipClass(warning),
            )}
          >
            {demandWarningLabel(warning)}
          </span>
        ))}
      </div>
    </section>
  )
}

function GapAnalysisView({
  analysis,
  isLoading,
  isError,
  onRetry,
}: {
  analysis: ForecastGapAnalysis | undefined
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}) {
  const tier = useImmersionTier()
  const animation = tier !== 'precise'
  const chartRef = React.useRef<HTMLDivElement | null>(null)

  const waterfallBuckets = React.useMemo(
    () => (analysis ? buildGapWaterfall(analysis.gaps) : []),
    [analysis],
  )
  const totals = analysis ? formatGapAnalysisTotals(analysis) : null
  const option = React.useMemo(
    () =>
      waterfallBuckets.length > 0
        ? buildGapWaterfallChartOption(waterfallBuckets, animation)
        : null,
    [waterfallBuckets, animation],
  )
  useEChartsInstance({ containerRef: chartRef, option, animation })

  if (isLoading && !analysis) {
    return (
      <div
        data-demand-gaps-loading
        role="status"
        aria-busy="true"
        className="space-y-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3"
      >
        <div className="h-72 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
      </div>
    )
  }
  if (isError && !analysis) {
    return (
      <div
        data-demand-gaps-error
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-secondary)]">缺口分析加载失败</p>
        <button
          type="button"
          data-demand-gaps-retry
          onClick={onRetry}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          重试
        </button>
      </div>
    )
  }
  if (!analysis || analysis.gaps.length === 0) {
    return (
      <div
        data-demand-gaps-empty
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-14 text-center"
      >
        <TrendingUp className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-secondary)]">
          当前预测窗口内未发现明显的资源缺口
        </p>
        <p className="text-[11px] text-[var(--nx-text-muted)]">
          缺口分析随预测窗口与筛选参数变化自动刷新。
        </p>
      </div>
    )
  }

  return (
    <div
      data-demand-gaps-view
      className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] px-2 py-1 text-[11px] text-[var(--nx-status-danger)]">
          短缺 {totals?.totalShortage}
        </span>
        <span className="rounded border border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.1)] px-2 py-1 text-[11px] text-[var(--nx-status-success)]">
          盈余 {totals?.totalSurplus}
        </span>
        <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)]">
          净缺口 {totals?.netGap}
        </span>
        <p className="ml-auto text-[10px] text-[var(--nx-text-muted)]">
          短缺为负向冲积条 · 盈余为正向（双通道）
        </p>
      </div>
      {option !== null ? (
        <div
          ref={chartRef}
          data-demand-gaps-chart
          role="img"
          aria-label="资源缺口瀑布图"
          className="h-[280px] w-full"
        />
      ) : null}
      <div className="overflow-auto rounded-md border border-[var(--nx-border-hairline)]">
        <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="bg-[var(--nx-workspace-surface)] text-[var(--nx-text-muted)]">
              <th className="px-3 py-2 font-medium">类型</th>
              <th className="px-3 py-2 font-medium">描述</th>
              <th className="px-3 py-2 text-right font-medium">缺口</th>
              <th className="px-3 py-2 font-medium">角色/技能/项目</th>
              <th className="px-3 py-2 font-medium">时间段</th>
              <th className="px-3 py-2 text-center font-medium">置信度</th>
            </tr>
          </thead>
          <tbody>
            {analysis.gaps.map((gap, index) => (
              <tr
                key={`${gap.bucketStart ?? 'x'}-${index}`}
                data-demand-gap-row
                className="border-t border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]"
              >
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
                      gapTypeChipClass(gap.gapType),
                    )}
                  >
                    {gapTypeLabel(gap.gapType)}
                  </span>
                </td>
                <td className="px-3 py-2">{gap.description}</td>
                <td
                  className={cn(
                    'px-3 py-2 text-right font-mono',
                    gap.direction === 'shortage'
                      ? 'text-[var(--nx-status-danger)]'
                      : 'text-[var(--nx-status-success)]',
                  )}
                >
                  {formatSignedGapHours(gap.gapHours, gap.direction)}
                </td>
                <td className="px-3 py-2">{formatGapEntryDimension(gap)}</td>
                <td className="px-3 py-2 font-mono text-[10px]">{formatGapEntryBucket(gap)}</td>
                <td className="px-3 py-2 text-center">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
                      confidenceMetaOf(gap.confidence).chipClass,
                    )}
                  >
                    {confidenceMetaOf(gap.confidence).label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DriverTable({
  type,
  drivers,
  meta,
  isLoading,
}: {
  type: 'project' | 'skill'
  drivers: ForecastProjectDriver[] | ForecastSkillDriver[] | undefined
  meta: { total?: number } | undefined
  isLoading: boolean
}) {
  void isLoading
  if (isLoading && !drivers) {
    return (
      <div role="status" aria-busy="true" className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-9 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
          />
        ))}
      </div>
    )
  }
  if (!drivers || drivers.length === 0) {
    return (
      <p
        data-demand-drivers-empty
        className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center text-[11px] text-[var(--nx-text-muted)]"
      >
        {type === 'project' ? '暂无可见项目驱动数据' : '暂无可见技能驱动数据'}
      </p>
    )
  }
  return (
    <div className="overflow-auto rounded-md border border-[var(--nx-border-hairline)]">
      <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
        <thead>
          <tr className="bg-[var(--nx-workspace-surface)] text-[var(--nx-text-muted)]">
            {type === 'project' ? (
              <>
                <th className="px-3 py-2 font-medium">项目</th>
                <th className="px-3 py-2 text-right font-medium">总需求</th>
                <th className="px-3 py-2 text-right font-medium">已分配</th>
                <th className="px-3 py-2 text-right font-medium">需求占比</th>
                <th className="px-3 py-2 text-right font-medium">峰值缺口</th>
                <th className="px-3 py-2 text-center font-medium">置信度</th>
              </>
            ) : (
              <>
                <th className="px-3 py-2 font-medium">技能</th>
                <th className="px-3 py-2 text-right font-medium">总需求</th>
                <th className="px-3 py-2 text-right font-medium">需求占比</th>
                <th className="px-3 py-2 text-right font-medium">已覆盖</th>
                <th className="px-3 py-2 text-right font-medium">缺口</th>
                <th className="px-3 py-2 text-right font-medium">覆盖项目</th>
                <th className="px-3 py-2 text-center font-medium">置信度</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {(type === 'project' ? drivers : drivers).map((driver) => {
            const label =
              type === 'project'
                ? formatProjectDriverLabel(driver as ForecastProjectDriver)
                : formatSkillDriverLabel(driver as ForecastSkillDriver)
            const confidence = confidenceMetaOf(driver.confidence)
            return (
              <tr
                key={
                  type === 'project'
                    ? `p-${(driver as ForecastProjectDriver).projectId}`
                    : `s-${(driver as ForecastSkillDriver).skill}`
                }
                data-demand-driver-row
                className="border-t border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]"
              >
                <td className="px-3 py-2">
                  {label.redacted ? (
                    <span className="flex items-center gap-1 text-[var(--nx-text-muted)]">
                      <EyeOff className="h-3 w-3" aria-hidden />
                      {label.display}
                    </span>
                  ) : (
                    <span className="text-[var(--nx-text-primary)]">{label.display}</span>
                  )}
                </td>
                {type === 'project' ? (
                  <>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatDemandHours((driver as ForecastProjectDriver).totalDemand)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatDemandHours((driver as ForecastProjectDriver).totalAllocated)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatDemandPercentRatio((driver as ForecastProjectDriver).demandShare)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-mono',
                        (driver as ForecastProjectDriver).peakGap > 0
                          ? 'text-[var(--nx-status-danger)]'
                          : 'text-[var(--nx-status-success)]',
                      )}
                    >
                      {formatDemandHours((driver as ForecastProjectDriver).peakGap)}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatDemandHours((driver as ForecastSkillDriver).totalDemand)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatDemandPercentRatio((driver as ForecastSkillDriver).demandShare)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatDemandHours((driver as ForecastSkillDriver).coveredHours)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-mono',
                        (driver as ForecastSkillDriver).gapHours > 0
                          ? 'text-[var(--nx-status-danger)]'
                          : 'text-[var(--nx-status-success)]',
                      )}
                    >
                      {formatDemandHours((driver as ForecastSkillDriver).gapHours)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatDemandCount((driver as ForecastSkillDriver).projectCount)}
                    </td>
                  </>
                )}
                <td className="px-3 py-2 text-center">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
                      confidence.chipClass,
                    )}
                  >
                    {confidence.label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="border-t border-[var(--nx-border-hairline)] px-3 py-1.5 text-[10px] text-[var(--nx-text-muted)]">
        共 {meta?.total ?? drivers.length} 项
      </p>
    </div>
  )
}

// ── 工作台主组件 ─────────────────────────────────────────────────────────

export interface DemandForecastWorkspaceProps {
  /** 组织 ID（页面层已就绪门禁；hooks 以 orgId 参数收敛组织隔离）。 */
  organizationId: number
}

export function DemandForecastWorkspace({ organizationId }: DemandForecastWorkspaceProps) {
  const router = useRouter()
  const pathname = usePathname() ?? '/next/organization/resource-demand-forecasting'
  const searchParams = useSearchParams()

  const [urlState, setUrlState] = React.useState<DemandUrlState>(() =>
    parseDemandUrlState(searchParams),
  )

  // 浏览器前进/后退或外部导航落回本页时，URL 再次成为事实源（restorable）。
  React.useEffect(() => {
    const fromUrl = parseDemandUrlState(searchParams)
    if (
      serializeDemandUrlState(fromUrl).toString() !== serializeDemandUrlState(urlState).toString()
    ) {
      setUrlState(fromUrl)
    }
  }, [searchParams])

  const updateUrlState = (patch: Partial<DemandUrlState>) => {
    setUrlState((current) => {
      const next: DemandUrlState = { ...current, ...patch }
      const qs = serializeDemandUrlState(next).toString()
      const target = qs === '' ? pathname : `${pathname}?${qs}`
      if (searchParams.toString() !== qs) {
        router.push(target)
      }
      return next
    })
  }

  const query = React.useMemo(() => demandUrlStateToQuery(urlState), [urlState])

  const summaryQuery = useForecastSummary(organizationId, query)
  const curvesQuery = useForecastDemandCurves(organizationId, query)
  const gapsQuery = useForecastGapAnalysis(organizationId, query)
  const projectDriversQuery = useForecastProjectDrivers(organizationId, query)
  const skillDriversQuery = useForecastSkillDrivers(organizationId, query)

  const view = urlState.view
  const viewQuery = view === 'curves' ? curvesQuery : view === 'gaps' ? gapsQuery : null

  const retryView = () => {
    if (summaryQuery.isError) void summaryQuery.refetch()
    if (curvesQuery.isError) void curvesQuery.refetch()
    if (gapsQuery.isError) void gapsQuery.refetch()
    if (projectDriversQuery.isError) void projectDriversQuery.refetch()
    if (skillDriversQuery.isError) void skillDriversQuery.refetch()
  }

  const initialLoading =
    view === 'curves'
      ? curvesQuery.isLoading && curvesQuery.data === undefined
      : view === 'gaps'
        ? gapsQuery.isLoading && gapsQuery.data === undefined
        : false

  return (
    <div
      data-demand-workspace
      aria-busy={initialLoading || undefined}
      className="flex flex-col gap-4"
    >
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <TrendingUp className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1 data-demand-title className="text-lg font-semibold text-[var(--nx-text-primary)]">
              资源需求预测
            </h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              基于项目计划与资源需求预测未来供需趋势 · AI 洞察仅咨询（RL-01）
            </p>
          </div>
        </div>
        {hasActiveDemandFilters(urlState) ? (
          <button
            type="button"
            data-demand-filters-reset
            onClick={() =>
              updateUrlState({
                ...createDefaultForecastWindow(),
                view: 'curves',
                granularity: 'week',
              })
            }
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            重置
          </button>
        ) : null}
      </header>

      {/* 筛选条：视图 tabs + 粒度 + 窗口（URL 写回） */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5">
        <div
          role="radiogroup"
          aria-label="预测视图切换"
          className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-0.5"
        >
          {(
            [
              ['curves', '需求曲线'],
              ['gaps', '缺口分析'],
              ['drivers', '驱动因素'],
            ] as const
          ).map(([key, label]) => {
            const active = view === key
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={active}
                data-demand-view-tab={key}
                onClick={() => updateUrlState({ view: key })}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors',
                  active
                    ? 'bg-[var(--nx-accent)]/10 text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {key === 'curves' ? (
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                ) : key === 'gaps' ? (
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Users className="h-3.5 w-3.5" aria-hidden />
                )}
                {label}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label
              htmlFor="demand-granularity"
              className="mb-1 block text-[10px] font-medium text-[var(--nx-text-muted)]"
            >
              粒度
            </label>
            <select
              id="demand-granularity"
              data-demand-granularity
              value={urlState.granularity}
              onChange={(event) =>
                updateUrlState({ granularity: event.target.value as DemandUrlState['granularity'] })
              }
              className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]"
            >
              {DEMAND_GRANULARITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="demand-start-date"
              className="mb-1 block text-[10px] font-medium text-[var(--nx-text-muted)]"
            >
              起始
            </label>
            <input
              id="demand-start-date"
              data-demand-start-date
              type="date"
              value={urlState.startDate}
              onChange={(event) => {
                if (event.target.value) updateUrlState({ startDate: event.target.value })
              }}
              className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 font-mono text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]"
            />
          </div>
          <div>
            <label
              htmlFor="demand-end-date"
              className="mb-1 block text-[10px] font-medium text-[var(--nx-text-muted)]"
            >
              结束
            </label>
            <input
              id="demand-end-date"
              data-demand-end-date
              type="date"
              value={urlState.endDate}
              onChange={(event) => {
                if (event.target.value) updateUrlState({ endDate: event.target.value })
              }}
              className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 font-mono text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]"
            />
          </div>
        </div>
      </div>

      {/* AI 咨询只读卡（显式点击触发，零自动请求） */}
      <DemandAiAdvisoryCard organizationId={organizationId} />

      {initialLoading ? (
        <WorkspaceSkeleton />
      ) : (
        <>
          {/* KPI 摘要 */}
          <SummarySection
            summary={summaryQuery.data}
            isError={summaryQuery.isError}
            onRetry={retryView}
          />

          {/* 视图内容 */}
          {view === 'curves' ? (
            <DemandCurveCharts
              curve={
                curvesQuery.data ?? {
                  roleBuckets: [],
                  skillBuckets: [],
                  projectBuckets: [],
                  warnings: [],
                }
              }
              isLoading={curvesQuery.isLoading}
              isError={curvesQuery.isError}
              onRetry={() => void curvesQuery.refetch()}
            />
          ) : null}
          {view === 'gaps' ? (
            <GapAnalysisView
              analysis={gapsQuery.data}
              isLoading={gapsQuery.isLoading}
              isError={gapsQuery.isError}
              onRetry={() => void gapsQuery.refetch()}
            />
          ) : null}
          {view === 'drivers' ? (
            <div data-demand-drivers-view className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--nx-text-primary)]">
                  <BarChart3 className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
                  项目驱动因素
                </h3>
                {projectDriversQuery.isError && !projectDriversQuery.data ? (
                  <DriverErrorBlock onRetry={() => void projectDriversQuery.refetch()} />
                ) : (
                  <DriverTable
                    type="project"
                    drivers={projectDriversQuery.data?.data}
                    meta={projectDriversQuery.data?.meta}
                    isLoading={projectDriversQuery.isLoading}
                  />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--nx-text-primary)]">
                  <BrainCircuit className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
                  技能驱动因素
                </h3>
                {skillDriversQuery.isError && !skillDriversQuery.data ? (
                  <DriverErrorBlock onRetry={() => void skillDriversQuery.refetch()} />
                ) : (
                  <DriverTable
                    type="skill"
                    drivers={skillDriversQuery.data?.data}
                    meta={skillDriversQuery.data?.meta}
                    isLoading={skillDriversQuery.isLoading}
                  />
                )}
              </div>
            </div>
          ) : null}

          {/* 非致命残余错误提示（数据可用但次要查询失败） */}
          {viewQuery?.isError && viewQuery.data !== undefined ? (
            <div
              data-demand-partial-error
              className="flex items-center justify-between gap-2 rounded-sm border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.08)] px-3 py-2"
            >
              <p className="text-[11px] text-[var(--nx-status-danger)]">
                部分预测数据加载失败，可重试。
              </p>
              <button
                type="button"
                data-demand-partial-retry
                onClick={retryView}
                className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-accent)]"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                重试
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function DriverErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-6">
      <p className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]">
        <Loader2 className="h-3.5 w-3.5 text-[var(--nx-status-warning)]" aria-hidden />
        驱动数据加载失败
      </p>
      <button
        type="button"
        data-demand-drivers-retry
        onClick={onRetry}
        className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-accent)]"
      >
        <RotateCcw className="h-3 w-3" aria-hidden />
        重试
      </button>
    </div>
  )
}

export default DemandForecastWorkspace
