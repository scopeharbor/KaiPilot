'use client'

import { useMemo, useRef } from 'react'
import { AlertCircle, BarChart3, RotateCw } from 'lucide-react'
import type { EChartsCoreOption } from '@/lib/next/charts/use-echarts-instance'
import { useEChartsInstance } from '@/lib/next/charts/use-echarts-instance'
import type { ResourceGapEntry, ResourceGapDimension } from '@aiproj/types'
import {
  buildGapBarModel,
  formatGapHours,
  GAP_SEVERITY_HEX,
  getGapDimensionTabLabel,
  getGapSeverityHex,
  getGapSeverityLabel,
} from '@/lib/next/org-gaps/org-gaps-adapter'

/**
 * 资源缺口维度柱图（v3-ui-next-org-portfolio-domains W4 · tasks 4.7）。
 *
 * - ECharts 收敛底座（echarts-core，nx-dark 主题）渲染缺口小时柱图，柱体颜色
 *   按严重度取 GAP_SEVERITY_HEX（双通道：tooltip/图例附严重度文字）；
 * - 纯只读：无任何写入口（RL-01）；加载骨架 / 空态 / 错误重试三态闭环；
 * - precise 档关闭动画（animation=false）即时定格。
 */

const TOOLTIP_SHELL = {
  backgroundColor: 'rgba(10, 11, 13, 0.96)',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: '#cbd5e1', fontSize: 12 },
  extraCssText: 'border-radius:6px;box-shadow:none;',
} as const

function buildGapBarOption(
  model: ReturnType<typeof buildGapBarModel>,
  animation: boolean,
): EChartsCoreOption {
  return {
    animation,
    tooltip: {
      ...TOOLTIP_SHELL,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params]
        const first = list[0] as { dataIndex?: number } | undefined
        if (!first || first.dataIndex === undefined) return ''
        const index = Number(first.dataIndex)
        const label = model.categories[index]
        if (!label) return ''
        const severity = model.severities[index]
        const ratio = model.gapRatios[index]
        const ratioText =
          ratio === undefined || Number.isNaN(ratio) ? '—' : `${Math.round(ratio * 100)}%`
        return [
          `<b>${label}</b>`,
          `需求：${formatGapHours(model.demandHours[index] ?? 0)}`,
          `供给：${formatGapHours(model.supplyHours[index] ?? 0)}`,
          `缺口：${formatGapHours(model.gapHours[index] ?? 0)}（缺口率 ${ratioText}）`,
          `严重度：${severity ? getGapSeverityLabel(severity) : '—'}`,
        ].join('<br/>')
      },
    },
    grid: { left: 8, right: 12, top: 32, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: model.categories,
      axisLabel: {
        color: '#7a8ba1',
        fontSize: 10,
        interval: model.categories.length > 12 ? 1 : 0,
        hideOverlap: true,
        rotate: model.categories.length > 12 ? 30 : 0,
      },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '缺口容量 (h)',
      nameTextStyle: { color: '#7a8ba1', fontSize: 10, padding: [0, 0, 4, 0] },
      axisLabel: { color: '#7a8ba1', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    series: [
      {
        name: '缺口容量',
        type: 'bar',
        barMaxWidth: 26,
        emphasis: { focus: 'series' },
        data: model.categories.map((label, index) => ({
          value: model.gapHours[index],
          name: label,
          itemStyle: { color: getGapSeverityHex(model.severities[index] ?? 'none') },
        })),
      },
    ],
  }
}

export interface GapDimensionChartsProps {
  dimension: ResourceGapDimension
  entries?: ResourceGapEntry[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  /** 精确档传 false：动画归零即时定格。 */
  animation: boolean
}

export function GapDimensionCharts({
  dimension,
  entries,
  isLoading,
  isError,
  onRetry,
  animation,
}: GapDimensionChartsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  const model = useMemo(() => buildGapBarModel(entries ?? []), [entries])
  const option = useMemo(
    () => (model.categories.length > 0 ? buildGapBarOption(model, animation) : null),
    [model, animation],
  )
  useEChartsInstance({ containerRef, option, animation })

  if (isLoading) {
    return (
      <div
        data-gap-chart-skeleton
        aria-busy
        className="h-72 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
      />
    )
  }

  if (isError) {
    return (
      <div
        data-gap-chart-error
        className="flex h-56 flex-col items-center justify-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-center"
      >
        <AlertCircle className="h-6 w-6 text-[var(--nx-status-danger)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-primary)]">缺口数据加载失败</p>
        <button
          type="button"
          data-gap-chart-retry
          onClick={onRetry}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          重试
        </button>
      </div>
    )
  }

  if (model.categories.length === 0) {
    return (
      <div
        data-gap-chart-empty
        className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-center"
      >
        <BarChart3 className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-primary)]">当前维度没有可呈现的缺口</p>
        <p className="text-xs text-[var(--nx-text-muted)]">切换维度或放宽筛选条件后再试</p>
      </div>
    )
  }

  return (
    <div
      data-gap-chart
      className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-[11px] text-[var(--nx-text-muted)]">
          {getGapDimensionTabLabel(dimension) ?? dimension} · 缺口容量分布（柱色 = 严重度）
        </p>
        <div className="flex items-center gap-2">
          {(['critical', 'high', 'medium', 'low'] as const).map((severity) => (
            <span
              key={severity}
              className="inline-flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: GAP_SEVERITY_HEX[severity] }}
              />
              {getGapSeverityLabel(severity)}
            </span>
          ))}
        </div>
      </div>
      <div ref={containerRef} data-gap-chart-canvas className="h-64 w-full" />
    </div>
  )
}

export default GapDimensionCharts
