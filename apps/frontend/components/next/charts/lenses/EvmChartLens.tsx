/**
 * 实值管理 EVM 镜头（v3-chart-gallery-tier2-timeseries-metrics W2 · task 2.1）。
 *
 * 数据：`GET /projects/:id/metrics/evm`（指标卡）+ `GET /projects/:id/metrics/evm/s-curve`
 * （S 曲线），均为只读 GET（RL-01）。顶部渲染 EVM 绩效指标卡组（PV/EV/AC/CV/SV/
 * CPI/SPI/BAC/EAC/VAC/ETC/TCPI），主体渲染 PV/EV/AC + EAC 完工预测虚线的 S 曲线，
 * 评估截点垂直参考线标注。无基线项目安全降级为中性提示 + 任务估算回退渲染。
 *
 * 纯只读：无任何写入口（RL-01/RL-06）；精确档（precise）ECharts animation 关闭。
 */
'use client'

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChartLine } from 'lucide-react'
import { projectMetricsApi, projectMetricsKeys } from '@/lib/api/project-metrics'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useEChartsInstance } from '@/lib/next/charts/use-echarts-instance'
import {
  buildEvmIndicatorViewModel,
  buildEvmSCurveOption,
  formatYuan,
} from '@/lib/next/charts/evm-adapter'
import { cn } from '@/lib/utils'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface EvmChartLensProps {
  projectId: number
}

export function EvmChartLens({ projectId }: EvmChartLensProps) {
  const tier = useImmersionTier()
  const animation = tier !== 'precise'
  const chartRef = useRef<HTMLDivElement | null>(null)

  const indicatorsQuery = useQuery({
    queryKey: projectMetricsKeys.evm(projectId, {}),
    queryFn: () => projectMetricsApi.evm(projectId, {}),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })
  const sCurveQuery = useQuery({
    queryKey: projectMetricsKeys.evmSCurve(projectId, {}),
    queryFn: () => projectMetricsApi.evmSCurve(projectId, {}),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const indicators = indicatorsQuery.data
  const sCurve = sCurveQuery.data

  const model = useMemo(
    () => (indicators ? buildEvmIndicatorViewModel(indicators) : null),
    [indicators],
  )
  const option = useMemo(
    () => (sCurve && sCurve.points.length > 0 ? buildEvmSCurveOption(sCurve, animation) : null),
    [sCurve, animation],
  )

  useEChartsInstance({ containerRef: chartRef, option, animation })

  const isLoading = indicatorsQuery.isLoading || sCurveQuery.isLoading
  const isError = (indicatorsQuery.isError || sCurveQuery.isError) && !model
  const hasData = model !== null && sCurve !== undefined
  const isEmpty = hasData && sCurve.points.length === 0

  const retry = () => {
    void indicatorsQuery.refetch()
    void sCurveQuery.refetch()
  }

  return (
    <div data-chart-lens-root="evm" className="flex min-h-[420px] flex-col gap-3">
      {isLoading && !hasData ? (
        <ChartLensSkeleton label="正在加载实值管理指标数据" />
      ) : isError && !hasData ? (
        <ChartLensErrorState
          ariaLabel="实值管理数据加载失败"
          title="EVM 指标加载失败"
          onRetry={retry}
        />
      ) : !hasData || isEmpty || model === null ? (
        <ChartLensEmptyState
          icon={ChartLine}
          title="当前项目暂无实值管理数据"
          description="项目尚未登记任务成本估算或排期，指标与 S 曲线暂无法计算。"
          ariaLabel="实值管理数据为空"
        />
      ) : (
        <>
          {!model.hasBaseline && (
            <div
              data-evm-baseline-hint
              className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2 text-[11px] text-[var(--nx-text-muted)]"
            >
              当前项目尚未建立排期基线，指标基于当前任务成本估算推导。
            </div>
          )}

          <div data-evm-kpi-cards className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <KpiCard label="PV 计划值" value={`¥${formatYuan(model.pvYuan)}`} />
            <KpiCard label="EV 挣值" value={`¥${formatYuan(model.evYuan)}`} />
            <KpiCard label="AC 实际成本" value={`¥${formatYuan(model.acYuan)}`} />
            <KpiCard
              label="CV 成本偏差"
              value={`¥${formatYuan(model.cvYuan)}`}
              tone={model.cvYuan >= 0 ? 'positive' : 'negative'}
            />
            <KpiCard
              label="SV 进度偏差"
              value={`¥${formatYuan(model.svYuan)}`}
              tone={model.svYuan >= 0 ? 'positive' : 'negative'}
            />
            <KpiCard
              label="CPI 成本绩效指数"
              value={model.cpi.toFixed(3)}
              sub={model.costStatusLabel}
            />
            <KpiCard
              label="SPI 进度绩效指数"
              value={model.spi.toFixed(3)}
              sub={model.scheduleStatusLabel}
            />
            <KpiCard label="BAC 完工总预算" value={`¥${formatYuan(model.bacYuan)}`} />
            <KpiCard label="EAC 完工估算" value={`¥${formatYuan(model.eacYuan)}`} />
            <KpiCard
              label="VAC 完工偏差"
              value={`¥${formatYuan(model.vacYuan)}`}
              tone={model.vacYuan >= 0 ? 'positive' : 'negative'}
            />
            <KpiCard label="ETC 完工尚需成本" value={`¥${formatYuan(model.etcYuan)}`} />
            <KpiCard label="TCPI 完工尚需绩效指数" value={model.tcpi.toFixed(3)} />
          </div>

          <div className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3">
            <div
              ref={chartRef}
              data-evm-scurve-chart
              role="img"
              aria-label="实值管理S曲线图"
              className="h-[360px] w-full"
            />
          </div>
        </>
      )}
    </div>
  )
}

function KpiCard({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'neutral' | 'positive' | 'negative'
}) {
  return (
    <div
      data-evm-kpi-card={label}
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-2.5"
    >
      <div className="text-[10px] text-[var(--nx-text-muted)]">{label}</div>
      <div
        className={cn(
          'mt-1 font-mono text-sm',
          tone === 'positive' && 'text-[var(--nx-status-success)]',
          tone === 'negative' && 'text-[var(--nx-status-warning)]',
          tone === 'neutral' && 'text-[var(--nx-text-primary)]',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-[var(--nx-text-secondary)]">{sub}</div>}
    </div>
  )
}

export default EvmChartLens
