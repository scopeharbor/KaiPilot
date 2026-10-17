/**
 * 柏拉图 (Pareto) 纯函数适配层（v3-chart-gallery-tier2-pareto-lob W1 · task 1.2）。
 *
 * - 4 维统计维度标签映射：issue_type / issue_severity / risk_category / change_type；
 * - 频数降序、单项占比与累计百分比；
 * - 超过 10 项归并为「其他（合并）」策略；
 * - 80% 二八分界水平参考线（markLine），标记关键少数（isVitalFew）并赋予高亮色；
 * - 双 Y 轴 ECharts Option：左 Y 轴频数柱状图 + 右 Y 轴累计百分比平滑折线；
 * - 纯函数、零 DOM、零网络（RL-01 只读分析），支持暗色主题与精确档 animation 禁用。
 */
import type { ParetoDimension, ParetoItem, ParetoResult } from '@/lib/api/project-metrics'
import type { EChartsCoreOption } from '@/lib/next/charts/use-echarts-instance'

export const NX_PARETO_VITAL_FEW_COLOR = '#38bdf8'
export const NX_PARETO_TRIVIAL_COLOR = 'rgba(148, 163, 184, 0.4)'
export const NX_PARETO_LINE_COLOR = '#f59e0b'
export const NX_PARETO_MARKLINE_COLOR = 'rgba(255, 255, 255, 0.28)'

export function round2(val: number): number {
  return Number(val.toFixed(2))
}

export const PARETO_DIMENSION_NAMES: Record<ParetoDimension, string> = {
  issue_type: '缺陷类型',
  issue_severity: '严重程度',
  risk_category: '风险分类',
  change_type: '变更类型',
}

export const ISSUE_TYPE_LABELS: Record<string, string> = {
  bug: '功能缺陷',
  blocker: '阻塞障碍',
  technical: '技术问题',
  process: '流程问题',
  other: '其他',
}

export const ISSUE_SEVERITY_LABELS: Record<string, string> = {
  critical: '致命',
  major: '严重',
  minor: '一般',
  trivial: '轻微',
}

export const RISK_CATEGORY_LABELS: Record<string, string> = {
  technical: '技术',
  schedule: '进度',
  cost: '成本',
  operational: '运营',
  external: '外部',
  other: '其他',
}

export const CHANGE_TYPE_LABELS: Record<string, string> = {
  scope: '范围变更',
  schedule: '进度调整',
  budget: '预算调整',
  architecture: '架构设计',
  other: '其他',
}

export function getCategoryFallbackLabel(dimension: ParetoDimension, category: string): string {
  switch (dimension) {
    case 'issue_type':
      return ISSUE_TYPE_LABELS[category] ?? category
    case 'issue_severity':
      return ISSUE_SEVERITY_LABELS[category] ?? category
    case 'risk_category':
      return RISK_CATEGORY_LABELS[category] ?? category
    case 'change_type':
      return CHANGE_TYPE_LABELS[category] ?? category
    default:
      return category
  }
}

/** 归并策略：超过 10 项时保留前 9 项，剩余归并为「其他（合并）」。 */
export function normalizeParetoItems(
  items: ParetoItem[],
  totalCount: number,
  dimension: ParetoDimension,
): ParetoItem[] {
  if (items.length === 0 || totalCount === 0) {
    return []
  }

  // 确保按频数降序排列（同频按类别字典序）
  const sorted = [...items].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.category.localeCompare(b.category)
  })

  // 补齐中文显示名称
  const mapped = sorted.map((item) => ({
    ...item,
    label: item.label || getCategoryFallbackLabel(dimension, item.category),
  }))

  if (mapped.length <= 10) {
    return mapped
  }

  const top9 = mapped.slice(0, 9)
  const remaining = mapped.slice(9)
  const mergedCount = remaining.reduce((acc, cur) => acc + cur.count, 0)
  const mergedPercentage = round2((mergedCount / totalCount) * 100)

  const mergedItem: ParetoItem = {
    category: 'other_merged',
    label: '其他（合并）',
    count: mergedCount,
    percentage: mergedPercentage,
    cumulativePercentage: 100,
    isVitalFew: false,
  }

  return [...top9, mergedItem]
}

export interface ParetoViewModel {
  dimension: ParetoDimension
  dimensionName: string
  totalCount: number
  items: ParetoItem[]
  vitalFewCount: number
  vitalFewPercentage: number
}

export function buildParetoViewModel(result: ParetoResult): ParetoViewModel {
  const normalizedItems = normalizeParetoItems(result.items, result.totalCount, result.dimension)
  const vitalFewItems = normalizedItems.filter((i) => i.isVitalFew)
  const vitalFewCount = vitalFewItems.length
  const lastVital = vitalFewItems[vitalFewItems.length - 1]
  const vitalFewPercentage = lastVital ? lastVital.cumulativePercentage : 0

  return {
    dimension: result.dimension,
    dimensionName: PARETO_DIMENSION_NAMES[result.dimension] ?? result.dimension,
    totalCount: result.totalCount,
    items: normalizedItems,
    vitalFewCount,
    vitalFewPercentage,
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

export function buildParetoOption(items: ParetoItem[], animation: boolean): EChartsCoreOption {
  const categories = items.map((item) => item.label)
  const barData = items.map((item) => ({
    value: item.count,
    itemStyle: {
      color: item.isVitalFew ? NX_PARETO_VITAL_FEW_COLOR : NX_PARETO_TRIVIAL_COLOR,
      borderRadius: [3, 3, 0, 0] as [number, number, number, number],
    },
  }))
  const lineData = items.map((item) => item.cumulativePercentage)

  return {
    animation,
    tooltip: {
      ...TOOLTIP_SHELL,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (rawParams: unknown) => {
        const params = Array.isArray(rawParams) ? rawParams : [rawParams]
        const first = params[0] as { dataIndex?: number } | undefined
        if (first?.dataIndex === undefined) return ''
        const item = items[first.dataIndex]
        if (!item) return ''
        const vitalTag = item.isVitalFew
          ? `<span style="display:inline-block;padding:1px 5px;font-size:10px;border-radius:3px;background:rgba(56,189,248,0.2);color:#38bdf8;margin-left:6px;">关键少数</span>`
          : ''
        return `
          <div style="font-weight:600;margin-bottom:4px;display:flex;align-items:center;">${item.label}${vitalTag}</div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#94a3b8;">
            <span>频数：</span><span style="color:#f1f5f9;font-family:monospace;">${item.count} 个</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#94a3b8;">
            <span>占比：</span><span style="color:#f1f5f9;font-family:monospace;">${item.percentage}%</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#94a3b8;">
            <span>累计占比：</span><span style="color:#f59e0b;font-family:monospace;">${item.cumulativePercentage}%</span>
          </div>
        `
      },
    },
    legend: {
      data: ['频数', '累计百分比'],
      top: 0,
      right: 8,
      itemWidth: 10,
      itemHeight: 8,
      textStyle: { color: '#94a3b8', fontSize: 11 },
    },
    grid: { left: 8, right: 12, top: 32, bottom: 20, containLabel: true },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: {
        color: '#7a8ba1',
        fontSize: 10,
        interval: 0,
        rotate: categories.length > 6 ? 25 : 0,
        hideOverlap: true,
      },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: '频数 (个)',
        nameTextStyle: { color: '#7a8ba1', fontSize: 10, padding: [0, 0, 4, 0] },
        axisLabel: { color: '#7a8ba1', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        minInterval: 1,
      },
      {
        type: 'value',
        name: '累计百分比 (%)',
        nameTextStyle: { color: '#7a8ba1', fontSize: 10, padding: [0, 0, 4, 0] },
        min: 0,
        max: 100,
        axisLabel: { color: '#7a8ba1', fontSize: 10, formatter: '{value}%' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '频数',
        type: 'bar',
        barMaxWidth: 36,
        data: barData,
      },
      {
        name: '累计百分比',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: NX_PARETO_LINE_COLOR, width: 2 },
        itemStyle: { color: NX_PARETO_LINE_COLOR },
        data: lineData,
        markLine: {
          symbol: 'none',
          silent: true,
          label: {
            show: true,
            formatter: '80% 分界线',
            color: '#94a3b8',
            fontSize: 10,
            position: 'insideEndTop',
          },
          lineStyle: {
            color: NX_PARETO_MARKLINE_COLOR,
            type: 'dashed',
            width: 1,
          },
          data: [{ yAxis: 80 }],
        },
      },
    ],
  }
}
