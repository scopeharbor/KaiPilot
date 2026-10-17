/**
 * SPC 控制图镜头纯函数适配层（v3-chart-gallery-tier2-timeseries-metrics W1 · task 1.4）。
 *
 * - 三线控制带：中心线 CL（均值）、控制上下限 UCL/LCL（±3σ）、警戒上下限
 *   UWL/LWL（±2σ，LWL 下限截断为 0），全部以 markLine 呈现（灰阶配色，
 *   不使用红色警戒色，呼应中性文案铁律的视觉延伸）；
 * - Nelson 规则失控点：以菱形符号 + 琥珀色标注，Tooltip 展示中性统计学术语
 *   （如异常波动点、超出控制限样本等客观统计描述）；
 * - 样本量 N < 5（`warning === 'SAMPLE_SIZE_TOO_SMALL'`）时控制限为 null，
 *   Adapter 优雅降级：仅保留散点趋势，不装配 markLine；
 * - 纯函数、零 DOM、零网络（RL-01 只读分析），jsdom 测试直接调用。
 */
import type { SpcMetricKind, SpcResult } from '@/lib/api/project-metrics'
import type { EChartsCoreOption } from '@/lib/next/charts/use-echarts-instance'

export const NX_SAMPLE_COLOR = '#38bdf8'
export const NX_OUTLIER_COLOR = '#f59e0b'
export const NX_CL_COLOR = 'rgba(255, 255, 255, 0.5)'
export const NX_LIMIT_COLOR = 'rgba(148, 163, 184, 0.6)'
export const NX_WARNING_LIMIT_COLOR = 'rgba(148, 163, 184, 0.35)'

export const SAMPLE_SIZE_TOO_SMALL_MESSAGE = '样本量不足（N < 5），控制限暂不计算'

/** Nelson 规则违规码 → 中性统计学术语（异常波动点与超出控制限样本等客观描述）。 */
export function ruleNeutralLabel(rule: string): string {
  switch (rule) {
    case 'rule1_beyond_3sigma':
      return '超出控制限'
    case 'rule2_nine_same_side':
      return '连续多点同侧偏离中心线'
    case 'rule3_six_monotonic_trend':
      return '连续多点单调变化趋势'
    default:
      return '统计异常值'
  }
}

export interface ControlChartPoint {
  taskId: number
  taskName: string
  completedAt: string
  value: number
  isOutlier: boolean
  violatedRules: string[]
  violatedRuleLabels: string[]
}

/** SpcSample[] → 附中性规则文案的展示点。 */
export function buildControlChartPoints(result: SpcResult): ControlChartPoint[] {
  return result.samples.map((sample) => ({
    ...sample,
    violatedRuleLabels: sample.violatedRules.map(ruleNeutralLabel),
  }))
}

export function isSampleSizeTooSmall(result: SpcResult): boolean {
  return result.warning === 'SAMPLE_SIZE_TOO_SMALL'
}

export function controlChartMetricLabel(metric: SpcMetricKind): string {
  return metric === 'lead_time' ? '交付提前期 (天)' : '周期时间 (天)'
}

const TOOLTIP_SHELL = {
  backgroundColor: 'rgba(10, 11, 13, 0.96)',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: '#cbd5e1', fontSize: 12 },
  extraCssText: 'border-radius:6px;box-shadow:none;',
} as const

/** SPC 控制图 Option：样本折线 + 三线控制带（N>=5）+ Nelson 失控点标注。 */
export function buildControlChartOption(result: SpcResult, animation: boolean): EChartsCoreOption {
  const points = buildControlChartPoints(result)
  const summary = result.summary
  const unit = controlChartMetricLabel(summary.metric)
  const hasLimits = summary.mean !== null && summary.sigma !== null

  const seriesData = points.map((point) => ({
    value: point.value,
    symbol: point.isOutlier ? 'diamond' : 'circle',
    symbolSize: point.isOutlier ? 10 : 6,
    itemStyle: { color: point.isOutlier ? NX_OUTLIER_COLOR : NX_SAMPLE_COLOR },
  }))

  const markLine = hasLimits
    ? {
        symbol: 'none' as const,
        silent: true,
        lineStyle: { width: 1 },
        label: { show: true, fontSize: 10, position: 'insideEndTop' as const },
        data: [
          {
            yAxis: summary.mean!,
            name: '中心线 CL',
            lineStyle: { color: NX_CL_COLOR, type: 'solid' as const },
            label: { formatter: '中心线 CL', color: NX_CL_COLOR },
          },
          {
            yAxis: summary.ucl!,
            name: '控制上限 UCL',
            lineStyle: { color: NX_LIMIT_COLOR, type: 'dashed' as const },
            label: { formatter: '控制上限 UCL', color: NX_LIMIT_COLOR },
          },
          {
            yAxis: summary.lcl!,
            name: '控制下限 LCL',
            lineStyle: { color: NX_LIMIT_COLOR, type: 'dashed' as const },
            label: { formatter: '控制下限 LCL', color: NX_LIMIT_COLOR },
          },
          {
            yAxis: summary.uwl!,
            name: '警戒上限 UWL',
            lineStyle: { color: NX_WARNING_LIMIT_COLOR, type: 'dotted' as const },
            label: { formatter: '警戒上限 UWL', color: NX_WARNING_LIMIT_COLOR },
          },
          {
            yAxis: summary.lwl!,
            name: '警戒下限 LWL',
            lineStyle: { color: NX_WARNING_LIMIT_COLOR, type: 'dotted' as const },
            label: { formatter: '警戒下限 LWL', color: NX_WARNING_LIMIT_COLOR },
          },
        ],
      }
    : undefined

  return {
    animation,
    tooltip: {
      ...TOOLTIP_SHELL,
      trigger: 'axis',
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params]
        const first = list[0] as { dataIndex?: number } | undefined
        if (!first || first.dataIndex === undefined) return ''
        const point = points[Number(first.dataIndex)]
        if (!point) return ''
        const rows = [
          `<div style="color:#f1f5f9;font-weight:600;margin-bottom:4px">${point.taskName}</div>`,
          `<div>完工日期：${point.completedAt}</div>`,
          `<div>${unit.replace(/\s*\(.*\)$/, '')}：<b style="color:#f1f5f9">${point.value}</b></div>`,
        ]
        if (point.violatedRuleLabels.length > 0) {
          rows.push(
            `<div style="color:${NX_OUTLIER_COLOR}">${point.violatedRuleLabels.join('、')}</div>`,
          )
        }
        return rows.join('')
      },
    },
    grid: { left: 8, right: 60, top: 20, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.completedAt),
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
        name: '样本序列',
        type: 'line' as const,
        showSymbol: true,
        smooth: false,
        lineStyle: { color: NX_SAMPLE_COLOR, width: 1.5 },
        data: seriesData,
        markLine,
      },
    ],
  }
}
