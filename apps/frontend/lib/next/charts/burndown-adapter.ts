/**
 * 燃尽 / 燃起图镜头纯函数适配层（v3-chart-gallery-tier2-timeseries-metrics W1 · task 1.3）。
 *
 * - 任务数（task）与工时（hour）双口径切换：后端按请求 `metric` 参数直接返回对应
 *   单位的 `idealRemaining`，Adapter 仅按 `metric` 选取剩余/完成/总范围字段；
 * - 4 条数据线：理想燃尽（虚线基准）、实际燃尽（剩余，向下收敛）、累计完成燃起
 *   （单调不减）、总范围基准线（范围蔓延显形）；
 * - 范围蔓延（Scope Creep）= 末点总范围 − 初始总范围，正数展示蔓延增量；
 * - 纯函数、零 DOM、零网络（RL-01 只读分析），jsdom 测试直接调用。
 */
import type { BurndownMetric, BurndownResult } from '@/lib/api/project-metrics'
import type { EChartsCoreOption } from '@/lib/next/charts/use-echarts-instance'

export const NX_IDEAL_COLOR = 'rgba(148, 163, 184, 0.75)'
export const NX_REMAINING_COLOR = '#38bdf8'
export const NX_COMPLETED_COLOR = '#10b981'
export const NX_SCOPE_COLOR = '#f59e0b'

export interface BurndownSeriesData {
  categories: string[]
  ideal: number[]
  remaining: number[]
  completed: number[]
  totalScope: number[]
}

/** 按 metric 口径从 BurndownResult 抽取 4 条序列（单位随 result.metric 已固定）。 */
export function buildBurndownSeriesData(result: BurndownResult): BurndownSeriesData {
  const useHours = result.metric === 'hour'
  return {
    categories: result.points.map((point) => point.date),
    ideal: result.points.map((point) => point.idealRemaining),
    remaining: result.points.map((point) =>
      useHours ? point.remainingHours : point.remainingTasks,
    ),
    completed: result.points.map((point) =>
      useHours ? point.completedHours : point.completedTasks,
    ),
    totalScope: result.points.map((point) =>
      useHours ? point.totalScopeHours : point.totalScopeTasks,
    ),
  }
}

export interface BurndownOverview {
  metric: BurndownMetric
  remaining: number
  completed: number
  totalScope: number
  initialScope: number
  /** 范围净变化：末点总范围 − 初始总范围（正数=蔓延，负数=收缩）。 */
  scopeCreep: number
}

/** 概览指标卡数据：当前剩余/累计完成/当前总范围/范围净变化。 */
export function buildBurndownOverview(result: BurndownResult): BurndownOverview {
  const useHours = result.metric === 'hour'
  const lastPoint = result.points[result.points.length - 1]
  const initialScope = useHours ? result.initialScopeHours : result.initialScopeTasks
  const totalScope = lastPoint
    ? useHours
      ? lastPoint.totalScopeHours
      : lastPoint.totalScopeTasks
    : initialScope
  const remaining = lastPoint ? (useHours ? lastPoint.remainingHours : lastPoint.remainingTasks) : 0
  const completed = lastPoint ? (useHours ? lastPoint.completedHours : lastPoint.completedTasks) : 0
  return {
    metric: result.metric,
    remaining,
    completed,
    totalScope,
    initialScope,
    scopeCreep: Number((totalScope - initialScope).toFixed(2)),
  }
}

const TOOLTIP_SHELL = {
  backgroundColor: 'rgba(10, 11, 13, 0.96)',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: '#cbd5e1', fontSize: 12 },
  extraCssText: 'border-radius:6px;box-shadow:none;',
} as const

export function burndownUnitLabel(metric: BurndownMetric): string {
  return metric === 'hour' ? '小时 (h)' : '任务 (个)'
}

/** 燃尽/燃起双重视角 Option（理想线/实际燃尽/累计燃起/总范围基准 4 条折线）。 */
export function buildBurndownOption(
  data: BurndownSeriesData,
  metric: BurndownMetric,
  animation: boolean,
): EChartsCoreOption {
  const unit = burndownUnitLabel(metric)
  return {
    animation,
    tooltip: { ...TOOLTIP_SHELL, trigger: 'axis' },
    legend: {
      data: ['理想燃尽线', '实际燃尽线', '累计完成燃起线', '总范围基准线'],
      top: 0,
      right: 8,
      itemWidth: 10,
      itemHeight: 8,
      textStyle: { color: '#94a3b8', fontSize: 11 },
    },
    grid: { left: 8, right: 12, top: 32, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: data.categories,
      axisLabel: { color: '#7a8ba1', fontSize: 10, hideOverlap: true },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: unit,
      nameTextStyle: { color: '#7a8ba1', fontSize: 10, padding: [0, 0, 4, 0] },
      axisLabel: { color: '#7a8ba1', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    series: [
      {
        name: '理想燃尽线',
        type: 'line' as const,
        smooth: false,
        showSymbol: false,
        lineStyle: { color: NX_IDEAL_COLOR, type: 'dashed' as const, width: 1.5 },
        itemStyle: { color: NX_IDEAL_COLOR },
        data: data.ideal,
      },
      {
        name: '实际燃尽线',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: NX_REMAINING_COLOR, width: 2 },
        itemStyle: { color: NX_REMAINING_COLOR },
        data: data.remaining,
      },
      {
        name: '累计完成燃起线',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: NX_COMPLETED_COLOR, width: 2 },
        itemStyle: { color: NX_COMPLETED_COLOR },
        areaStyle: { color: 'rgba(16, 185, 129, 0.08)' },
        data: data.completed,
      },
      {
        name: '总范围基准线',
        type: 'line' as const,
        smooth: false,
        showSymbol: false,
        lineStyle: { color: NX_SCOPE_COLOR, type: 'dashed' as const, width: 1.5 },
        itemStyle: { color: NX_SCOPE_COLOR },
        data: data.totalScope,
      },
    ],
  }
}
