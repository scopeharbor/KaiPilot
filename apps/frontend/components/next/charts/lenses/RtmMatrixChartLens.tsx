/**
 * RTM 需求追踪矩阵镜头（v3-chart-gallery-tier2-governance-matrices W2 · task 2.3）。
 *
 * 契约与硬边界：
 * 1. Props 严格限定为 `{ projectId: number }`（对齐 `ChartLensComponentProps`）；
 * 2. 消费 `requirementsApi.rtmMatrix`（只读 GET，RL-01 零写库）；
 * 3. 严格收敛复用 `lens-state-cards.tsx` 三态；
 * 4. 呈现形式适配数据本质（硬边界 8）：采用结构化 HTML `<table>` 展开「需求 → 关联任务 → 验收准则」三段平铺链路；
 * 5. 未关联任务的断链需求采用「待关联任务」中性高亮（零感性惊恐词汇）；
 * 6. 视口插槽解耦：根标记 `data-chart-lens-root="rtm"`，主表格可视区挂载 `data-chart-viewport-slot`；
 * 7. 外部统一注入工具条与导出菜单，镜头内部绝不重复实现汇出按钮。
 */
'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, CircleDashed, Clock, ListChecks, XCircle } from 'lucide-react'
import { requirementsApi, requirementKeys } from '@/lib/api/requirements'
import {
  buildRtmViewModel,
  CRITERIA_STATUS_LABELS,
  type RtmLinkedTaskViewModel,
} from '@/lib/next/charts/rtm-adapter'
import { cn } from '@/lib/utils'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface RtmMatrixChartLensProps {
  projectId: number
}

function CriteriaStatusIcon({ status }: { status: 'pending' | 'passed' | 'failed' }) {
  if (status === 'passed') {
    return <CheckCircle2 className="h-3 w-3 text-emerald-400 flex-shrink-0" />
  }
  if (status === 'failed') {
    return <XCircle className="h-3 w-3 text-rose-400 flex-shrink-0" />
  }
  return <Clock className="h-3 w-3 text-zinc-400 flex-shrink-0" />
}

export function RtmMatrixChartLens({ projectId }: RtmMatrixChartLensProps) {
  const query = useQuery({
    queryKey: requirementKeys.rtmMatrix(projectId),
    queryFn: () => requirementsApi.rtmMatrix(projectId),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const rawData = query.data
  const model = useMemo(() => (rawData ? buildRtmViewModel(rawData) : null), [rawData])

  const isLoading = query.isLoading
  const isError = query.isError && !model
  const hasData = model !== null
  const isEmpty = hasData && model.isEmpty

  const retry = () => {
    void query.refetch()
  }

  return (
    <div data-chart-lens-root="rtm" className="flex min-h-[460px] flex-col gap-3">
      {/* 顶部三段度量指标概览卡 */}
      <div
        data-export-ignore="true"
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3 text-xs"
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--nx-text-muted)] text-[11px]">需求总数</span>
          <span className="font-mono text-base font-semibold text-[var(--nx-text-primary)]">
            {model?.metrics.totalRequirements ?? 0}
            <span className="ml-1 text-[11px] font-normal text-[var(--nx-text-muted)]">项</span>
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--nx-text-muted)] text-[11px]">任务承接覆盖率</span>
          <span className="font-mono text-base font-semibold text-emerald-400">
            {model?.metrics.coveragePercent ?? 0}%
            <span className="ml-1 text-[11px] font-normal text-[var(--nx-text-muted)]">
              ({model?.metrics.coveredRequirements ?? 0} 已承接)
            </span>
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--nx-text-muted)] text-[11px]">待关联任务</span>
          <span
            className={cn(
              'font-mono text-base font-semibold',
              (model?.metrics.brokenRequirements ?? 0) > 0 ? 'text-amber-300' : 'text-zinc-400',
            )}
          >
            {model?.metrics.brokenRequirements ?? 0}
            <span className="ml-1 text-[11px] font-normal text-[var(--nx-text-muted)]">项</span>
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--nx-text-muted)] text-[11px]">平均验收通过率</span>
          <span className="font-mono text-base font-semibold text-[var(--nx-accent)]">
            {model?.metrics.avgCriteriaPassRate ?? 0}%
          </span>
        </div>
      </div>

      {isLoading && !hasData ? (
        <ChartLensSkeleton label="正在加载 RTM 需求追踪矩阵" />
      ) : isError && !hasData ? (
        <ChartLensErrorState
          ariaLabel="RTM 需求追踪矩阵加载失败"
          title="RTM 需求追踪矩阵加载失败"
          onRetry={retry}
        />
      ) : !hasData || isEmpty ? (
        <ChartLensEmptyState
          icon={ListChecks}
          title="暂无需求追踪数据"
          description="当前项目尚未录入需求条目，需求追踪矩阵暂无数据。"
          ariaLabel="RTM 需求追踪矩阵为空"
        />
      ) : (
        /* 主工作面平铺链路表格：挂载 data-chart-viewport-slot */
        <div
          data-chart-viewport-slot
          className="relative max-h-[640px] overflow-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-inner"
        >
          <table
            className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-xs"
            role="table"
            aria-label="RTM 需求追踪三段链路矩阵"
          >
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)] text-[var(--nx-text-primary)]">
                {/* 第一段：需求维度 */}
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[200px] max-w-[260px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-3 font-medium backdrop-blur"
                >
                  <div className="text-[11px] text-[var(--nx-text-muted)]">阶段 1 · 业务输入</div>
                  <div>需求条目 (Requirement)</div>
                </th>

                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[100px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium backdrop-blur"
                >
                  优先级 / 状态
                </th>

                {/* 第二段：任务承接维度 */}
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[280px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-3 font-medium backdrop-blur"
                >
                  <div className="text-[11px] text-[var(--nx-text-muted)]">阶段 2 · 交付承接</div>
                  <div>关联任务链路 (Tasks)</div>
                </th>

                {/* 第三段：验收测试维度 */}
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[260px] border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-3 font-medium backdrop-blur"
                >
                  <div className="text-[11px] text-[var(--nx-text-muted)]">阶段 3 · 质量闭环</div>
                  <div>验收准则 (Acceptance Criteria)</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row, index) => {
                const isEven = index % 2 === 0
                return (
                  <tr
                    key={row.requirementId}
                    data-rtm-row={row.code}
                    className={cn(
                      'transition-colors hover:bg-[var(--nx-workspace-surface)]/50',
                      isEven ? 'bg-transparent' : 'bg-[var(--nx-workspace-surface)]/20',
                    )}
                  >
                    {/* 需求编号与标题 */}
                    <td className="border-b border-r border-[var(--nx-border-hairline)] px-3.5 py-3 align-top">
                      <div className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--nx-accent)] font-medium">
                        <span>{row.code}</span>
                        <span className="rounded bg-[var(--nx-workspace-surface)] px-1.5 py-0.2 text-[10px] text-[var(--nx-text-muted)] border border-[var(--nx-border-hairline)]">
                          {row.category}
                        </span>
                      </div>
                      <div
                        className="mt-1 font-medium text-[var(--nx-text-primary)]"
                        title={row.title}
                      >
                        {row.title}
                      </div>
                    </td>

                    {/* 优先级与状态 */}
                    <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-3 align-top text-[11px]">
                      <div className="flex flex-col gap-1.5">
                        <span className="inline-flex w-fit rounded px-1.5 py-0.5 bg-[var(--nx-workspace-surface)] border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]">
                          {row.priorityLabel}
                        </span>
                        <span className="text-[var(--nx-text-muted)]">{row.statusLabel}</span>
                      </div>
                    </td>

                    {/* 关联任务平铺 */}
                    <td className="border-b border-r border-[var(--nx-border-hairline)] px-3.5 py-3 align-top">
                      {row.isBrokenLink ? (
                        <div className="inline-flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300">
                          <CircleDashed className="h-3.5 w-3.5 animate-spin text-amber-400" />
                          <span>待关联任务</span>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {row.linkedTasks.map((task: RtmLinkedTaskViewModel) => (
                            <div
                              key={task.id}
                              className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]/70 p-2 text-xs"
                            >
                              <div className="flex items-center justify-between gap-2 font-medium text-[var(--nx-text-primary)]">
                                <span className="truncate" title={task.name}>
                                  {task.name}
                                </span>
                                <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                                  {task.progressPercent}%
                                </span>
                              </div>
                              <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--nx-text-muted)]">
                                <span>{task.assigneeName || '未指定执行人'}</span>
                                <span className="rounded bg-[var(--nx-workspace-bg)] px-1.5 py-0.2 border border-[var(--nx-border-hairline)] text-[10px]">
                                  {task.statusLabel}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* 验收准则与通过率 */}
                    <td className="border-b border-[var(--nx-border-hairline)] px-3.5 py-3 align-top">
                      {row.acceptanceCriteria.length === 0 ? (
                        <span className="text-[var(--nx-text-muted)] text-[11px]">
                          暂无验收准则
                        </span>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between gap-2 pb-1 border-b border-[var(--nx-border-hairline)]/50 text-[11px]">
                            <span className="text-[var(--nx-text-muted)]">
                              共 {row.criteriaTotalCount} 条准则
                            </span>
                            <span className="font-mono font-medium text-emerald-400">
                              通过率 {row.criteriaPassRate}%
                            </span>
                          </div>
                          {row.acceptanceCriteria.map((criterion) => (
                            <div
                              key={criterion.id}
                              className="flex items-start gap-1.5 text-[11px] text-[var(--nx-text-secondary)]"
                            >
                              <CriteriaStatusIcon status={criterion.status} />
                              <span className="flex-1 leading-snug">{criterion.description}</span>
                              <span className="text-[10px] text-[var(--nx-text-muted)] flex-shrink-0">
                                {CRITERIA_STATUS_LABELS[criterion.status]}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export const RtmChartLens = RtmMatrixChartLens
export default RtmMatrixChartLens
