'use client'

import { useMemo, useRef } from 'react'
import type { BiTrendSeries } from '@aiproj/types'
import { useEChartsInstance, type EChartsCoreOption } from '@/lib/next/charts/use-echarts-instance'
import {
  BI_TREND_METRIC_UNITS,
  biTrendMetricLabel,
  buildTrendChartModel,
  formatBiTrendValue,
  type OrgBiTrendChartModel,
} from '@/lib/next/org-bi/org-bi-adapter'

/**
 * BI 趋势线图（v3-ui-next-org-portfolio-domains W3 · tasks 3.9）。
 *
 * - 统一经 `lib/next/echarts-core.ts`（nx-dark 主题 / 确定性注册 Line+Scatter）；
 * - 主序列为冷蓝实线（--nx-chart-1），移动平均为虚线（--nx-chart-2），
 *   外推为紫色虚线（--nx-chart-7，开启时续接主序列末桶），缺失桶保留缺口
 *   （connectNulls=false，绝不伪造为 0）；
 * - 异常点以 Scatter 叠加层红色标注（--nx-status-danger），颜色+数据点双通道；
 * - 精确档 animation=false 即时定格（无残余动效）。
 */

export const NX_TREND_SERIES_COLOR = '#38bdf8' // --nx-chart-1
export const NX_TREND_MA_COLOR = '#818cf8' // --nx-chart-2
export const NX_TREND_FORECAST_COLOR = '#c084fc' // --nx-chart-7
export const NX_TREND_ANOMALY_COLOR = '#ef4444' // --nx-status-danger

const TOOLTIP_SHELL = {
  backgroundColor: 'rgba(10, 11, 13, 0.96)',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: '#cbd5e1', fontSize: 12 },
  extraCssText: 'border-radius:6px;box-shadow:none;',
} as const

/** 单序列趋势 option 构建（纯映射；组件测试直接断言 setOption 内容）。 */
export function buildTrendLineOption(
  model: OrgBiTrendChartModel,
  series: BiTrendSeries,
  options: { showAnomalies: boolean; showForecast: boolean; animation: boolean },
): EChartsCoreOption {
  const { showAnomalies, showForecast, animation } = options
  const unit = BI_TREND_METRIC_UNITS[series.metricKey]
  const tooltipValue = (value: number | null) =>
    value === null ? '—' : formatBiTrendValue(series.metricKey, value)

  const seriesEntries: unknown[] = [
    {
      name: '实际',
      type: 'line',
      data: model.values,
      connectNulls: false,
      showSymbol: false,
      lineStyle: { color: NX_TREND_SERIES_COLOR, width: 1.6 },
      emphasis: { lineStyle: { width: 2 } },
      tooltip: { valueFormatter: (value: number | null) => tooltipValue(value) },
      z: 2,
    },
  ]
  if (model.movingAverage.some((value) => value !== null)) {
    seriesEntries.push({
      name: '移动平均',
      type: 'line',
      data: model.movingAverage,
      connectNulls: false,
      showSymbol: false,
      lineStyle: { color: NX_TREND_MA_COLOR, width: 1, type: 'dashed' },
      tooltip: { valueFormatter: (value: number | null) => tooltipValue(value) },
      z: 1,
    })
  }
  if (showForecast && model.forecast.some((value) => value !== null)) {
    seriesEntries.push({
      name: '外推',
      type: 'line',
      data: model.forecast,
      connectNulls: false,
      showSymbol: false,
      lineStyle: { color: NX_TREND_FORECAST_COLOR, width: 1.4, type: 'dashed' },
      tooltip: { valueFormatter: (value: number | null) => tooltipValue(value) },
      z: 1,
    })
  }
  if (showAnomalies && model.anomalyPoints.length > 0) {
    seriesEntries.push({
      name: '异常点',
      type: 'scatter',
      data: model.anomalyPoints.map((point) => [point.index, point.value]),
      symbol: 'circle',
      symbolSize: 7,
      itemStyle: { color: NX_TREND_ANOMALY_COLOR, borderColor: '#0a0b0d', borderWidth: 1 },
      tooltip: {
        valueFormatter: (value: number) => tooltipValue(value),
      },
      z: 5,
    })
  }

  return {
    animation,
    tooltip: {
      ...TOOLTIP_SHELL,
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(255,255,255,0.2)' } },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params]
        if (list.length === 0) return ''
        const first = list[0] as { axisIndex?: number; dataIndex?: number } | undefined
        if (first?.dataIndex === undefined) return ''
        const bucket = model.categories[Number(first.dataIndex)] ?? ''
        const rows = (list as Array<{ marker?: string; seriesName?: string; value?: unknown }>)
          .filter((item) => item.seriesName && item.seriesName !== '异常点')
          .map((item) => {
            const value = Array.isArray(item.value) ? item.value[1] : item.value
            return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${item.marker ?? ''}${item.seriesName}</span><b style="color:#f1f5f9">${tooltipValue(
              typeof value === 'number' ? value : null,
            )}</b></div>`
          })
          .join('')
        const unitLabel = unit === 'hours' ? 'h' : unit === 'percent' ? '%' : ''
        return `<div style="color:#7a8ba1;margin-bottom:4px">${bucket}${unitLabel ? ` · ${unitLabel}` : ''}</div>${rows}`
      },
    },
    legend: {
      data: seriesEntries.map((entry) => (entry as { name: string }).name),
      top: 0,
      right: 4,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: '#94a3b8', fontSize: 10 },
    },
    grid: { left: 8, right: 10, top: 26, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: model.categories,
      axisLabel: { color: '#7a8ba1', fontSize: 9, hideOverlap: true },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: '#7a8ba1', fontSize: 9 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    series: seriesEntries,
  }
}

export interface TrendLineChartsProps {
  series: BiTrendSeries
  showAnomalies: boolean
  showForecast: boolean
  animation: boolean
  /** 容器高度（px）。 */
  height?: number
}

export function TrendLineCharts({
  series,
  showAnomalies,
  showForecast,
  animation,
  height = 220,
}: TrendLineChartsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  const model = useMemo(() => buildTrendChartModel(series), [series])
  const option = useMemo(
    () =>
      buildTrendLineOption(model, series, {
        showAnomalies,
        showForecast,
        animation,
      }),
    [model, series, showAnomalies, showForecast, animation],
  )

  useEChartsInstance({ containerRef, option, animation })

  const metricLabel = biTrendMetricLabel(series.metricKey)

  return (
    <div data-bi-trend-chart className="relative w-full" aria-label={`${metricLabel}趋势图`}>
      <div data-bi-trend-chart-canvas ref={containerRef} className="w-full" style={{ height }} />
    </div>
  )
}

export default TrendLineCharts
