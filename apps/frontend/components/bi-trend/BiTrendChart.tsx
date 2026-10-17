'use client'

import type { BiTrendSeries, BiTrendForecastPoint } from '@aiproj/types'

export interface BiTrendChartProps {
  series: BiTrendSeries
  height?: number
  showAnomalies?: boolean
  showForecast?: boolean
}

/**
 * BI 趋势可视化组件（v3-bi-trend-analysis §4.5）。
 *
 * 使用项目既有的 @visx 栈（SVG）渲染带移动平均、异常标记、预测段与 freshness 状态的趋势图。
 * 同时提供等价表格/列表摘要（accessibility）。
 */
export function BiTrendChart({
  series,
  height = 160,
  showAnomalies = true,
  showForecast = false,
}: BiTrendChartProps) {
  const { points, movingAverage, anomalies, forecast } = series

  const hasData = points.some((p) => !p.missing && p.value !== null)
  if (!hasData) {
    return (
      <div
        className="flex items-center justify-center rounded bg-muted/30 text-xs text-muted-foreground"
        style={{ height }}
        role="img"
        aria-label={`${series.metricKey} 无可用数据`}
      >
        无可用数据
      </div>
    )
  }

  // 简单 SVG 趋势图
  const nonMissing = points.filter((p) => !p.missing && p.value !== null)
  const allValues = nonMissing.map((p) => p.value as number)
  const minVal = Math.min(...allValues, 0)
  const maxVal = Math.max(...allValues, 100)
  const range = maxVal - minVal || 1

  const padding = { top: 8, right: 8, bottom: 20, left: 32 }
  const chartWidth = 320
  const chartHeight = height
  const plotWidth = chartWidth - padding.left - padding.right
  const plotHeight = chartHeight - padding.top - padding.bottom

  const xScale = (i: number) =>
    padding.left + (points.length > 1 ? (i / (points.length - 1)) * plotWidth : plotWidth / 2)
  const yScale = (v: number) => padding.top + plotHeight - ((v - minVal) / range) * plotHeight

  // 主序列路径
  const linePath = points
    .map((p, i) => {
      if (p.missing || p.value === null) return null
      const x = xScale(i)
      const y = yScale(p.value)
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    .filter(Boolean)
    .join(' ')

  // 移动平均路径
  const maPath = movingAverage
    .map((v, i) => {
      if (v === null) return null
      const x = xScale(i)
      const y = yScale(v)
      return `${i === 0 || movingAverage[i - 1] === null ? 'M' : 'L'}${x},${y}`
    })
    .filter(Boolean)
    .join(' ')

  // 异常点
  const anomalyPoints = showAnomalies
    ? (anomalies ?? [])
        .map((a) => {
          const idx = points.findIndex((p) => p.bucketStart === a.bucketStart)
          if (idx < 0) return null
          return { x: xScale(idx), y: yScale(a.value), direction: a.direction }
        })
        .filter(Boolean)
    : []

  // 预测段
  const forecastPoints =
    showForecast && forecast && !forecast.suppressed
      ? (forecast.points as BiTrendForecastPoint[])
          .map((fp, i) => {
            // 预测点放在最后一个真实点之后
            const idx = points.length + i
            const x = xScale(idx)
            const y = yScale(fp.value)
            return { x, y }
          })
          .filter((p) => p.y >= 0)
      : []

  // Y 轴标签
  const yTicks = [minVal, (minVal + maxVal) / 2, maxVal].map((v) => Math.round(v))

  return (
    <div role="figure" aria-label={`${series.metricKey} 趋势图，${points.length} 个数据点`}>
      <svg
        width={chartWidth}
        height={chartHeight}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="overflow-visible"
        aria-hidden="true"
      >
        {/* Y 轴 */}
        {yTicks.map((v) => (
          <text
            key={v}
            x={padding.left - 4}
            y={yScale(v) + 4}
            textAnchor="end"
            className="fill-muted-foreground text-[8px]"
          >
            {v}
          </text>
        ))}

        {/* 主序列 */}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        )}

        {/* 移动平均 */}
        {maPath && (
          <path
            d={maPath}
            fill="none"
            stroke="hsl(var(--muted-foreground) / 0.5)"
            strokeWidth={1}
            strokeDasharray="4,2"
          />
        )}

        {/* 异常点 */}
        {anomalyPoints.map(
          (ap, i) =>
            ap && (
              <circle
                key={i}
                cx={ap.x}
                cy={ap.y}
                r={3}
                fill={ap.direction === 'above' ? '#ef4444' : '#f59e0b'}
                stroke="white"
                strokeWidth={0.5}
              >
                <title>异常 {ap.direction === 'above' ? '偏高' : '偏低'}</title>
              </circle>
            ),
        )}

        {/* 预测段 */}
        {forecastPoints.length > 0 && (
          <path
            d={
              `M${xScale(points.length - 1)},${yScale(allValues[allValues.length - 1]!)}` +
              forecastPoints.map((fp) => `L${fp.x},${fp.y}`).join(' ')
            }
            fill="none"
            stroke="hsl(var(--warning) / 0.6)"
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        )}

        {/* X 轴标签（首尾） */}
        {points.length > 0 && (
          <>
            <text
              x={xScale(0)}
              y={chartHeight - 2}
              textAnchor="start"
              className="fill-muted-foreground text-[8px]"
            >
              {points[0]!.bucketStart}
            </text>
            <text
              x={xScale(points.length - 1)}
              y={chartHeight - 2}
              textAnchor="end"
              className="fill-muted-foreground text-[8px]"
            >
              {points[points.length - 1]!.bucketEnd}
            </text>
          </>
        )}
      </svg>

      {/* 等价表格摘要（sr-only） */}
      <table className="sr-only" aria-label={`${series.metricKey} 趋势数据表格`}>
        <thead>
          <tr>
            <th>日期范围</th>
            <th>值</th>
            <th>移动平均</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>
                {p.bucketStart} ~ {p.bucketEnd}
              </td>
              <td>{p.missing ? '缺失' : (p.value ?? 0).toFixed(1)}</td>
              <td>{movingAverage[i] !== null ? (movingAverage[i] ?? 0).toFixed(1) : '-'}</td>
              <td>{p.missing ? '缺失' : '正常'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
