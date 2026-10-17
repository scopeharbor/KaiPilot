/**
 * SPC 统计过程控制图镜头（v3-chart-gallery-tier2-timeseries-metrics W2 · task 2.3）。
 *
 * 数据：`GET /projects/:id/metrics/control-chart`（只读 GET，RL-01），支持
 * `metric`（cycle_time/lead_time）与 `limit`（采样上限）参数化切换。渲染样本
 * 时序 + 中心线 CL / 控制限 UCL-LCL（±3σ）/ 警戒限 UWL-LWL（±2σ）三线控制带，
 * Nelson 规则失控点以菱形高亮并附中性统计学术语说明（超出控制限样本与异常波动点等客观描述）。
 *
 * 样本量 N < 5 时优雅降级：控制限不绘制，展示中性说明卡片，散点趋势仍渲染。
 * 纯只读：无任何写入口（RL-01/RL-06）；精确档（precise）ECharts animation 关闭。
 */
'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChartSpline, Info } from 'lucide-react'
import {
  projectMetricsApi,
  projectMetricsKeys,
  type SpcMetricKind,
} from '@/lib/api/project-metrics'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useEChartsInstance } from '@/lib/next/charts/use-echarts-instance'
import {
  buildControlChartOption,
  controlChartMetricLabel,
  isSampleSizeTooSmall,
  SAMPLE_SIZE_TOO_SMALL_MESSAGE,
} from '@/lib/next/charts/control-chart-adapter'
import { cn } from '@/lib/utils'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface ControlChartLensProps {
  projectId: number
}

const METRIC_TABS: ReadonlyArray<{ id: SpcMetricKind; label: string }> = [
  { id: 'cycle_time', label: '周期时间 (cycle time)' },
  { id: 'lead_time', label: '交付提前期 (lead time)' },
]

const LIMIT_OPTIONS = [50, 100, 200] as const

export function ControlChartLens({ projectId }: ControlChartLensProps) {
  const tier = useImmersionTier()
  const animation = tier !== 'precise'
  const [metric, setMetric] = useState<SpcMetricKind>('cycle_time')
  const [limit, setLimit] = useState<number>(100)
  const chartRef = useRef<HTMLDivElement | null>(null)

  const params = { metric, limit }
  const query = useQuery({
    queryKey: projectMetricsKeys.controlChart(projectId, params),
    queryFn: () => projectMetricsApi.controlChart(projectId, params),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const result = query.data
  const option = useMemo(
    () => (result && result.samples.length > 0 ? buildControlChartOption(result, animation) : null),
    [result, animation],
  )

  useEChartsInstance({ containerRef: chartRef, option, animation })

  const hasData = result !== undefined
  const isEmpty = hasData && result.samples.length === 0
  const smallSample = hasData && isSampleSizeTooSmall(result)

  return (
    <div data-chart-lens-root="control-chart" className="flex min-h-[420px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2" data-export-ignore="true">
        <div
          role="tablist"
          aria-label="SPC指标切换"
          data-lens-metric-tabs
          className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-0.5"
        >
          {METRIC_TABS.map((tab) => {
            const active = metric === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-lens-metric-tab={tab.id}
                onClick={() => setMetric(tab.id)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                  active
                    ? 'bg-[var(--nx-accent)]/10 text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]">
          采样上限
          <select
            aria-label="采样上限"
            data-lens-limit-select
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            className="h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            {LIMIT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      {query.isLoading && !hasData ? (
        <ChartLensSkeleton label="正在加载SPC控制图数据" />
      ) : query.isError && !hasData ? (
        <ChartLensErrorState
          ariaLabel="SPC控制图加载失败"
          title="SPC 控制图数据加载失败"
          onRetry={() => void query.refetch()}
        />
      ) : isEmpty || !result ? (
        <ChartLensEmptyState
          icon={ChartSpline}
          title="当前项目暂无可用于统计过程控制的完工样本"
          description="项目尚无满足条件的完工任务，周期时间/交付提前期的过程控制分析暂无法计算。"
          ariaLabel="SPC控制图数据为空"
        />
      ) : (
        <>
          {smallSample && (
            <div
              data-control-chart-small-sample-hint
              role="status"
              className="flex items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2 text-[11px] text-[var(--nx-text-muted)]"
            >
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {SAMPLE_SIZE_TOO_SMALL_MESSAGE}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-[11px]" data-control-chart-summary>
            <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-[var(--nx-text-secondary)]">
              指标{' '}
              <b className="font-mono text-[var(--nx-text-primary)]">
                {controlChartMetricLabel(result.summary.metric)}
              </b>
            </span>
            <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-[var(--nx-text-secondary)]">
              样本量{' '}
              <b className="font-mono text-[var(--nx-text-primary)]">
                {result.summary.sampleCount}
              </b>
            </span>
            {result.summary.mean !== null && (
              <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-[var(--nx-text-secondary)]">
                均值 CL{' '}
                <b className="font-mono text-[var(--nx-text-primary)]">{result.summary.mean}</b>
              </span>
            )}
          </div>

          <div className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3">
            <div
              ref={chartRef}
              data-control-chart
              role="img"
              aria-label="SPC过程控制图"
              className="h-[360px] w-full"
            />
          </div>
        </>
      )}
    </div>
  )
}

export default ControlChartLens
