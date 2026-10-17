/**
 * 沟通管理计划 Communication 镜头组件（v3-chart-gallery-tier2-org-contract-plans W2 · task 2.5）。
 *
 * 契约与硬边界：
 * 1. Props 严格限定为 `{ projectId: number }`（对齐 `ChartLensComponentProps`）；
 * 2. 消费 `communicationPlansApi.list`（只读 GET，RL-01 零写库）；
 * 3. 严格收敛复用 `lens-state-cards.tsx` 三态；
 * 4. 呈现形式适配数据本质（硬边界 8）：多维正交沟通矩阵表格；
 * 5. 顶部提供按类型过滤与汇总统计指标（标示 `data-export-ignore="true"`）；
 * 6. 启停状态以中性胶囊呈现（纯只读，无切换开关）；
 * 7. 视口插槽解耦：根容器挂载 `data-chart-lens-root="communication"`，主矩阵表格挂载 `data-chart-viewport-slot`；
 * 8. 外部统一注入工具条与导出菜单，镜头内部绝不重复实现汇出按钮；
 * 9. 客观中性原则：DOM 零情绪化措辞。
 */
'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Filter, MessagesSquare } from 'lucide-react'
import { communicationPlanKeys, communicationPlansApi } from '@/lib/api/communication-plans'
import {
  buildCommunicationPlanViewModel,
  COMMUNICATION_TYPE_LABELS,
  filterCommunicationPlanRows,
} from '@/lib/next/charts/communication-adapter'
import { cn } from '@/lib/utils'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface CommunicationPlanChartLensProps {
  projectId: number
}

const TYPE_FILTER_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'meeting', label: COMMUNICATION_TYPE_LABELS.meeting },
  { value: 'report', label: COMMUNICATION_TYPE_LABELS.report },
  { value: 'email', label: COMMUNICATION_TYPE_LABELS.email },
  { value: 'instant_message', label: COMMUNICATION_TYPE_LABELS.instant_message },
]

export function CommunicationPlanChartLens({ projectId }: CommunicationPlanChartLensProps) {
  const query = useQuery({
    queryKey: communicationPlanKeys.list(projectId),
    queryFn: () => communicationPlansApi.list(projectId, { perPage: 100 }),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const [typeFilter, setTypeFilter] = React.useState('all')

  const rawData = query.data
  const model = React.useMemo(() => buildCommunicationPlanViewModel(rawData), [rawData])

  const displayedRows = React.useMemo(
    () => filterCommunicationPlanRows(model.rows, typeFilter),
    [model.rows, typeFilter],
  )

  const retry = React.useCallback(() => {
    void query.refetch()
  }, [query])

  const isLoading = query.isLoading
  const isError = query.isError && rawData === undefined
  const hasData = !model.isEmpty

  return (
    <div data-chart-lens-root="communication" className="flex min-h-[460px] flex-col gap-3">
      {/* 顶部统计与筛选栏 */}
      <div
        data-export-ignore="true"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-2.5 text-xs text-[var(--nx-text-muted)]"
      >
        {/* 类型快速筛选 */}
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" />
          <div className="flex items-center gap-1">
            {TYPE_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTypeFilter(opt.value)}
                className={cn(
                  'h-7 rounded px-2.5 text-xs transition-colors',
                  typeFilter === opt.value
                    ? 'bg-[var(--nx-accent)] text-white font-medium'
                    : 'border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 度量指标卡片 */}
        {hasData && (
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span>总计 {model.metrics.totalCount} 项</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span className="text-emerald-400">生效中 {model.metrics.activeCount}</span>
            {model.metrics.inactiveCount > 0 && (
              <>
                <span className="text-[var(--nx-border-hairline)]">·</span>
                <span className="text-[var(--nx-text-muted)]">
                  已停用 {model.metrics.inactiveCount}
                </span>
              </>
            )}
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span>会议 {model.metrics.meetingCount}</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span>报告 {model.metrics.reportCount}</span>
          </div>
        )}
      </div>

      {/* 三态与矩阵工作面 */}
      {isLoading && !hasData ? (
        <ChartLensSkeleton label="正在加载沟通管理计划" chartHeight={460} />
      ) : isError && !hasData ? (
        <ChartLensErrorState
          ariaLabel="沟通管理计划加载失败"
          title="沟通管理计划加载失败"
          description="无法获取当前项目的沟通管理计划数据，请稍后重试。"
          onRetry={retry}
        />
      ) : !hasData ? (
        <ChartLensEmptyState
          icon={MessagesSquare}
          title="暂无沟通管理计划数据"
          description="当前项目尚未规划沟通管理计划。"
          ariaLabel="沟通管理计划为空"
        />
      ) : displayedRows.length === 0 ? (
        <div
          data-chart-viewport-slot
          className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center text-xs text-[var(--nx-text-muted)]"
        >
          <FileSpreadsheet className="h-6 w-6" />
          <span>当前筛选类型下暂无沟通计划</span>
        </div>
      ) : (
        /* 主沟通矩阵表格：挂载 data-chart-viewport-slot */
        <div
          data-chart-viewport-slot
          className="relative max-h-[620px] overflow-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-inner"
        >
          <table
            className="w-full border-separate border-spacing-0 text-left text-xs"
            role="table"
            aria-label="沟通管理计划矩阵表格"
          >
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)]">
                <th
                  scope="col"
                  className="sticky left-0 top-0 z-20 min-w-[160px] max-w-[220px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-3 font-medium text-[var(--nx-text-primary)] backdrop-blur"
                >
                  沟通事项
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 min-w-[90px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium text-[var(--nx-text-primary)] backdrop-blur"
                >
                  类型
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 min-w-[180px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium text-[var(--nx-text-primary)] backdrop-blur"
                >
                  沟通目的
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 min-w-[90px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium text-[var(--nx-text-primary)] backdrop-blur"
                >
                  频次
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 min-w-[110px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium text-[var(--nx-text-primary)] backdrop-blur"
                >
                  渠道
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 min-w-[140px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium text-[var(--nx-text-primary)] backdrop-blur"
                >
                  受众对象
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 min-w-[130px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium text-[var(--nx-text-primary)] backdrop-blur"
                >
                  交付物/模板
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 min-w-[80px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium text-[var(--nx-text-primary)] backdrop-blur text-center"
                >
                  责任人
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 min-w-[80px] border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium text-[var(--nx-text-primary)] backdrop-blur text-center"
                >
                  状态
                </th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((row, index) => {
                const isEven = index % 2 === 0
                return (
                  <tr
                    key={row.id}
                    data-communication-row={row.id}
                    className={cn(
                      'transition-colors hover:bg-[var(--nx-workspace-surface)]/60',
                      isEven ? 'bg-transparent' : 'bg-[var(--nx-workspace-surface)]/20',
                    )}
                  >
                    {/* 冻结首列：事项名称 */}
                    <td
                      className={cn(
                        'sticky left-0 z-10 border-b border-r border-[var(--nx-border-hairline)] px-3.5 py-2.5 font-medium text-[var(--nx-text-primary)] backdrop-blur',
                        isEven
                          ? 'bg-[var(--nx-workspace-bg)]'
                          : 'bg-[var(--nx-workspace-surface)]/40',
                      )}
                    >
                      <span className="truncate" title={row.name}>
                        {row.name}
                      </span>
                    </td>

                    {/* 类型 */}
                    <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5">
                      <span className="inline-flex rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-0.5 text-[11px] text-[var(--nx-text-secondary)]">
                        {row.typeLabel}
                      </span>
                    </td>

                    {/* 目的 */}
                    <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-[var(--nx-text-secondary)]">
                      <span className="line-clamp-2" title={row.purpose}>
                        {row.purpose}
                      </span>
                    </td>

                    {/* 频次 */}
                    <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-[var(--nx-text-secondary)]">
                      <span className="inline-flex items-center rounded bg-[var(--nx-bg-1)] px-2 py-0.5 text-[11px]">
                        {row.frequencyLabel}
                      </span>
                    </td>

                    {/* 渠道 */}
                    <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-[var(--nx-text-secondary)]">
                      <span className="inline-flex items-center rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-0.5 text-[11px]">
                        {row.channelLabel}
                      </span>
                    </td>

                    {/* 受众 */}
                    <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-[var(--nx-text-secondary)]">
                      <span className="truncate block" title={row.audience}>
                        {row.audience}
                      </span>
                    </td>

                    {/* 交付物/模板 */}
                    <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-[var(--nx-text-muted)] font-mono text-[11px]">
                      {row.reportTemplateKey ? (
                        <span className="rounded bg-[var(--nx-accent)]/10 px-1.5 py-0.5 text-[var(--nx-accent)]">
                          {row.reportTemplateKey}
                        </span>
                      ) : (
                        <span>{row.deliverable}</span>
                      )}
                    </td>

                    {/* 责任人 */}
                    <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-center font-mono text-[11px] text-[var(--nx-text-muted)]">
                      #{row.ownerId}
                    </td>

                    {/* 启停状态中性胶囊 */}
                    <td className="border-b border-[var(--nx-border-hairline)] px-3 py-2.5 text-center">
                      <span
                        className={cn(
                          'inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium',
                          row.isActive
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)] border-[var(--nx-border-hairline)]',
                        )}
                      >
                        {row.statusLabel}
                      </span>
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

export default CommunicationPlanChartLens
