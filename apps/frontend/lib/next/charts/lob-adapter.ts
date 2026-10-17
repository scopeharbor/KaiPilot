/**
 * 线条平衡图 (LOB) 纯函数适配层（v3-chart-gallery-tier2-pareto-lob W1 · task 1.3）。
 *
 * - 空间单元自然序（compareNatural）：按自然序排列横轴；
 * - 工序斜率折线（Series）：横轴空间单元 × 纵轴时间；
 * - 工序交叉打结的几何视觉呈现：仅依赖连线几何交织直观呈现，绝不做感性评判；
 * - 节拍与工序时窗诊断模型：平均工期、平均节拍、中性术语诊断；
 * - 纯函数、零 DOM、零网络（RL-01 只读分析），支持暗色主题与精确档 animation 禁用。
 */
import type {
  LobActivity,
  LobMetricsResponse,
  LobRhythmSummaryRow,
} from '@/lib/api/project-metrics'
import type { EChartsCoreOption } from '@/lib/next/charts/use-echarts-instance'

/** 数值自然排序：Floor-2 < Floor-10。 */
export function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
}

export const LOB_STAGE_PALETTE: readonly string[] = [
  '#38bdf8', // 天青
  '#10b981', // 翡翠绿
  '#f59e0b', // 琥珀橙
  '#a855f7', // 紫色
  '#ec4899', // 玫红
  '#06b6d4', // 青蓝
  '#84cc16', // 草绿
  '#6366f1', // 靛蓝
]

/** 工序诊断客观中性标签（杜绝任何感性惊恐词汇）。 */
export function lobDiagnosticLabel(diag: 'STAGE_COLLISION' | 'STAGE_GAP'): string {
  switch (diag) {
    case 'STAGE_COLLISION':
      return '工序时窗重叠'
    case 'STAGE_GAP':
      return '工序间隔变动'
    default:
      return diag
  }
}

export interface LobViewModel {
  units: string[]
  stages: string[]
  activities: LobActivity[]
  rhythmSummary: LobRhythmSummaryRow[]
  activityCount: number
  isEmpty: boolean
}

export function buildLobViewModel(response: LobMetricsResponse): LobViewModel {
  const units = [...response.units].sort(compareNatural)
  const stages = [...response.stages]
  const activities = response.activities ?? []
  const rhythmSummary = response.rhythmSummary ?? []
  const isEmpty = units.length === 0 || activities.length === 0

  return {
    units,
    stages,
    activities,
    rhythmSummary,
    activityCount: activities.length,
    isEmpty,
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

export function buildLobOption(
  response: LobMetricsResponse,
  animation: boolean,
): EChartsCoreOption {
  const units = [...response.units].sort(compareNatural)
  const stages = [...response.stages]
  const activities = response.activities ?? []

  // 建立 (stage, unit) -> Activity 快速索引
  const activityMap = new Map<string, LobActivity>()
  for (const act of activities) {
    activityMap.set(`${act.stage}:::${act.unit}`, act)
  }

  const series = stages.map((stage, index) => {
    const color = LOB_STAGE_PALETTE[index % LOB_STAGE_PALETTE.length]
    const data = units.map((unit) => {
      const act = activityMap.get(`${stage}:::${unit}`)
      if (!act) return null
      return act.plannedStart ?? act.actualStart ?? null
    })

    return {
      name: stage,
      type: 'line' as const,
      smooth: false,
      showSymbol: true,
      symbol: 'circle',
      symbolSize: 6,
      connectNulls: true,
      emphasis: { focus: 'series' as const },
      lineStyle: { color, width: 2 },
      itemStyle: { color },
      data,
    }
  })

  return {
    animation,
    tooltip: {
      ...TOOLTIP_SHELL,
      trigger: 'item',
      formatter: (rawParam: unknown) => {
        const param = rawParam as {
          seriesName?: string
          name?: string
          value?: string
          dataIndex?: number
        }
        const stage = param.seriesName
        const unit = param.name
        if (!stage || !unit) return ''
        const act = activityMap.get(`${stage}:::${unit}`)
        if (!act) {
          return `<div style="font-weight:600;">${stage} - ${unit}</div><div style="font-size:11px;color:#94a3b8;">暂无排期</div>`
        }

        const dateRange = [act.plannedStart, act.plannedEnd].filter(Boolean).join(' ~ ') || '未排期'
        const duration = act.durationDays !== null ? `${act.durationDays} 天` : '-'
        const slope = act.slopeRate !== null ? `${act.slopeRate.toFixed(2)} 单元/天` : '-'

        return `
          <div style="font-weight:600;margin-bottom:4px;">${act.taskName}</div>
          <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">
            <span>工序：</span><span style="color:#f1f5f9;">${stage}</span>
            <span style="margin-left:8px;">单元：</span><span style="color:#f1f5f9;">${unit}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#94a3b8;">
            <span>计划窗口：</span><span style="color:#f1f5f9;font-family:monospace;">${dateRange}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#94a3b8;">
            <span>工期：</span><span style="color:#f1f5f9;font-family:monospace;">${duration}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#94a3b8;">
            <span>推进速率：</span><span style="color:#38bdf8;font-family:monospace;">${slope}</span>
          </div>
        `
      },
    },
    legend: {
      data: stages,
      top: 0,
      right: 8,
      itemWidth: 10,
      itemHeight: 8,
      textStyle: { color: '#94a3b8', fontSize: 11 },
    },
    grid: { left: 8, right: 16, top: 32, bottom: 24, containLabel: true },
    xAxis: {
      type: 'category',
      name: '空间单元',
      nameTextStyle: { color: '#7a8ba1', fontSize: 10, padding: [0, 0, 0, 4] },
      data: units,
      axisLabel: {
        color: '#7a8ba1',
        fontSize: 10,
        hideOverlap: true,
      },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'time',
      name: '时间 (进度线)',
      nameTextStyle: { color: '#7a8ba1', fontSize: 10, padding: [0, 0, 4, 0] },
      axisLabel: { color: '#7a8ba1', fontSize: 10, formatter: '{yyyy}-{MM}-{dd}' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    series,
  }
}
