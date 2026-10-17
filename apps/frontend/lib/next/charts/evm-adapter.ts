/**
 * EVM 实值管理镜头纯函数适配层（v3-chart-gallery-tier2-timeseries-metrics W1 · task 1.2）。
 *
 * - 金额换算：后端以「分」存储，Adapter 统一 `/100` 换算为「元」（2 位小数）；
 *   比率指标（CPI/SPI/TCPI）后端已保留 3 位小数，前端不再重复舍入；
 * - S 曲线 Option：PV 计划值基线（虚线）、EV 挣值、AC 实际成本、EAC 完工预测
 *   （评估日之后虚线延伸）四条折线 + 评估截点垂直参考线；
 * - 纯函数、零 DOM、零网络（RL-01 只读分析），jsdom 测试直接调用。
 *
 * 颜色令牌：EV=--nx-status-success(#10b981)，AC=--nx-status-warning(#f59e0b，
 * 「琥珀色」)，EAC 预测=--nx-accent(#38bdf8)，PV 为中性冷灰基准虚线。
 */
import type { EvmIndicators, EvmSCurveResult } from '@/lib/api/project-metrics'
import type { EChartsCoreOption } from '@/lib/next/charts/use-echarts-instance'

export const NX_PV_COLOR = 'rgba(148, 163, 184, 0.75)'
export const NX_EV_COLOR = '#10b981'
export const NX_AC_COLOR = '#f59e0b'
export const NX_EAC_FORECAST_COLOR = '#38bdf8'

const ROUND2 = 2

/** 分 → 元（2 位小数）。 */
export function centsToYuan(cents: number): number {
  return Number((cents / 100).toFixed(ROUND2))
}

/** null 安全的分 → 元换算（S 曲线未来点 ev/ac 为 null）。 */
function centsToYuanOrNull(cents: number | null): number | null {
  return cents === null ? null : centsToYuan(cents)
}

export function evmScheduleStatusLabel(status: EvmIndicators['scheduleStatus']): string {
  switch (status) {
    case 'ahead':
      return '进度超前'
    case 'delayed':
      return '进度滞后'
    default:
      return '进度符合预期'
  }
}

export function evmCostStatusLabel(status: EvmIndicators['costStatus']): string {
  switch (status) {
    case 'under_budget':
      return '成本结余'
    case 'over_budget':
      return '成本超支'
    default:
      return '成本符合预期'
  }
}

/** EVM 指标卡视图模型：金额字段换算为元，比率与状态字段透传（后端已定口径）。 */
export interface EvmIndicatorViewModel {
  projectId: number
  asOfDate: string
  hasBaseline: boolean
  bacYuan: number
  pvYuan: number
  evYuan: number
  acYuan: number
  cvYuan: number
  svYuan: number
  etcYuan: number
  eacYuan: number
  vacYuan: number
  cpi: number
  spi: number
  tcpi: number
  scheduleStatus: EvmIndicators['scheduleStatus']
  costStatus: EvmIndicators['costStatus']
  scheduleStatusLabel: string
  costStatusLabel: string
}

export function buildEvmIndicatorViewModel(indicators: EvmIndicators): EvmIndicatorViewModel {
  return {
    projectId: indicators.projectId,
    asOfDate: indicators.asOfDate,
    hasBaseline: indicators.hasBaseline,
    bacYuan: centsToYuan(indicators.bac),
    pvYuan: centsToYuan(indicators.pv),
    evYuan: centsToYuan(indicators.ev),
    acYuan: centsToYuan(indicators.ac),
    cvYuan: centsToYuan(indicators.cv),
    svYuan: centsToYuan(indicators.sv),
    etcYuan: centsToYuan(indicators.etc),
    eacYuan: centsToYuan(indicators.eac),
    vacYuan: centsToYuan(indicators.vac),
    cpi: indicators.cpi,
    spi: indicators.spi,
    tcpi: indicators.tcpi,
    scheduleStatus: indicators.scheduleStatus,
    costStatus: indicators.costStatus,
    scheduleStatusLabel: evmScheduleStatusLabel(indicators.scheduleStatus),
    costStatusLabel: evmCostStatusLabel(indicators.costStatus),
  }
}

/** 金额展示：千分位 + 2 位小数（"¥" 前缀由调用方按需拼接）。 */
export function formatYuan(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const TOOLTIP_SHELL = {
  backgroundColor: 'rgba(10, 11, 13, 0.96)',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: '#cbd5e1', fontSize: 12 },
  extraCssText: 'border-radius:6px;box-shadow:none;',
} as const

/** S 曲线四折线 Option（PV/EV/AC + EAC 预测虚线 + 评估截点参考线）。 */
export function buildEvmSCurveOption(
  curve: EvmSCurveResult,
  animation: boolean,
): EChartsCoreOption {
  const categories = curve.points.map((point) => point.date)
  const pvData = curve.points.map((point) => centsToYuan(point.pv))
  const evData = curve.points.map((point) => centsToYuanOrNull(point.ev))
  const acData = curve.points.map((point) => centsToYuanOrNull(point.ac))
  const forecastData = curve.points.map((point) => centsToYuanOrNull(point.eacForecast))

  const asOfIndex = categories.indexOf(curve.asOfDate)
  const markLine =
    asOfIndex === -1
      ? undefined
      : {
          symbol: 'none' as const,
          silent: true,
          label: {
            show: true,
            formatter: '评估截点',
            color: '#94a3b8',
            fontSize: 10,
            position: 'insideEndTop' as const,
          },
          lineStyle: { color: 'rgba(255,255,255,0.28)', type: 'dashed' as const, width: 1 },
          data: [{ xAxis: curve.asOfDate }],
        }

  return {
    animation,
    tooltip: { ...TOOLTIP_SHELL, trigger: 'axis' },
    legend: {
      data: ['PV 计划值', 'EV 挣值', 'AC 实际成本', 'EAC 完工预测'],
      top: 0,
      right: 8,
      itemWidth: 10,
      itemHeight: 8,
      textStyle: { color: '#94a3b8', fontSize: 11 },
    },
    grid: { left: 8, right: 12, top: 32, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { color: '#7a8ba1', fontSize: 10, hideOverlap: true },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '金额 (元)',
      nameTextStyle: { color: '#7a8ba1', fontSize: 10, padding: [0, 0, 4, 0] },
      axisLabel: { color: '#7a8ba1', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    series: [
      {
        name: 'PV 计划值',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: NX_PV_COLOR, type: 'dashed' as const, width: 1.5 },
        itemStyle: { color: NX_PV_COLOR },
        data: pvData,
        markLine,
      },
      {
        name: 'EV 挣值',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: NX_EV_COLOR, width: 2 },
        itemStyle: { color: NX_EV_COLOR },
        data: evData,
      },
      {
        name: 'AC 实际成本',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: NX_AC_COLOR, width: 2 },
        itemStyle: { color: NX_AC_COLOR },
        data: acData,
      },
      {
        name: 'EAC 完工预测',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: NX_EAC_FORECAST_COLOR, type: 'dotted' as const, width: 1.5 },
        itemStyle: { color: NX_EAC_FORECAST_COLOR },
        data: forecastData,
      },
    ],
  }
}
