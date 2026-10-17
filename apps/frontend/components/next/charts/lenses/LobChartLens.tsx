/**
 * 线条平衡图 (LOB) 镜头（v3-chart-gallery-tier2-pareto-lob W2 · task 2.3）。
 *
 * 数据：`GET /projects/:id/metrics/lob`（只读 GET，RL-01）。
 * 顶部渲染各工序平均工期、平均节拍与客观诊断指标卡；主体渲染空间单元 × 工序推进
 * 速率斜率折线；工序交叉打结纯依赖几何连线直观呈现，绝不做事后感性评判；
 * 严格遵循 DOM 中性措辞（禁用任何感性惊恐词汇）。
 *
 * 纯只读：无任何写入口（RL-01/RL-06）；精确档（precise）ECharts animation 关闭。
 */
'use client'

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { projectMetricsApi, projectMetricsKeys } from '@/lib/api/project-metrics'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useEChartsInstance } from '@/lib/next/charts/use-echarts-instance'
import {
  buildLobOption,
  buildLobViewModel,
  lobDiagnosticLabel,
} from '@/lib/next/charts/lob-adapter'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface LobChartLensProps {
  projectId: number
}

export function LobChartLens({ projectId }: LobChartLensProps) {
  const tier = useImmersionTier()
  const animation = tier !== 'precise'
  const chartRef = useRef<HTMLDivElement | null>(null)

  const query = useQuery({
    queryKey: projectMetricsKeys.lob(projectId),
    queryFn: () => projectMetricsApi.lob(projectId),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const result = query.data
  const model = useMemo(() => (result ? buildLobViewModel(result) : null), [result])
  const option = useMemo(
    () => (model && !model.isEmpty && result ? buildLobOption(result, animation) : null),
    [model, result, animation],
  )

  useEChartsInstance({ containerRef: chartRef, option, animation })

  const isLoading = query.isLoading
  const isError = query.isError && !model
  const hasData = model !== null
  const isEmpty = hasData && model.isEmpty

  const retry = () => {
    void query.refetch()
  }

  return (
    <div data-chart-lens-root="lob" className="flex min-h-[420px] flex-col gap-3">
      {isLoading && !hasData ? (
        <ChartLensSkeleton label="正在加载线条平衡图指标数据" />
      ) : isError && !hasData ? (
        <ChartLensErrorState
          ariaLabel="线条平衡图数据加载失败"
          title="线条平衡图数据加载失败"
          onRetry={retry}
        />
      ) : !hasData || isEmpty ? (
        <ChartLensEmptyState
          icon={Activity}
          title="当前项目暂无流水工序数据"
          description="当前项目任务未设置空间单元或工序阶段，线条平衡图暂无法计算。"
          ariaLabel="线条平衡图数据为空"
        />
      ) : (
        <>
          {/* 顶部工序节拍与诊断客观指标卡 */}
          {model.rhythmSummary.length > 0 && (
            <div
              data-lob-rhythm-cards
              data-export-ignore="true"
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
            >
              {model.rhythmSummary.map((row) => (
                <div
                  key={row.stage}
                  data-lob-stage-card={row.stage}
                  className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--nx-text-primary)]">
                      {row.stage}
                    </span>
                    <span className="text-[10px] text-[var(--nx-text-muted)]">
                      {row.activityCount} 项活动
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-[var(--nx-text-muted)]">平均工期</span>
                    <span className="font-mono text-[var(--nx-text-secondary)]">
                      {row.avgDurationDays !== null ? `${row.avgDurationDays} 天` : '-'}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px]">
                    <span className="text-[var(--nx-text-muted)]">平均节拍</span>
                    <span className="font-mono text-[var(--nx-text-secondary)]">
                      {row.avgTaktDays !== null ? `${row.avgTaktDays} 天` : '-'}
                    </span>
                  </div>
                  {row.diagnostics && row.diagnostics.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {row.diagnostics.map((diag) => (
                        <span
                          key={diag}
                          className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]"
                        >
                          {lobDiagnosticLabel(diag)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 主视口空间单元 × 工序推进斜率折线 */}
          <div className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3">
            <div
              ref={chartRef}
              data-chart-viewport-slot
              role="img"
              aria-label="线条平衡图"
              className="h-[380px] w-full"
            />
          </div>
        </>
      )}
    </div>
  )
}

export default LobChartLens
