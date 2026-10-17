/**
 * 议题与变更追踪镜头（v3-chart-gallery-tier2-governance-matrices W2 · task 2.7）。
 *
 * 契约与硬边界：
 * 1. Props 严格限定为 `{ projectId: number }`（对齐 `ChartLensComponentProps`）；
 * 2. 消费 `issuesApi.list`（只读 GET，RL-01 零写库）；
 * 3. 严格收敛复用 `lens-state-cards.tsx` 三态；
 * 4. 呈现形式适配数据本质（硬边界 8）：顶部展示状态分组度量卡，主体展示结构化议题追踪表格；
 * 5. 类型与严重度即时筛选选择器标示 `data-export-ignore="true"` 免污染汇出画面；
 * 6. 视口插槽解耦：根标记 `data-chart-lens-root="issues"`，主表格可视区挂载 `data-chart-viewport-slot`；
 * 7. 外部统一注入工具条与导出菜单，镜头内部绝不重复实现汇出按钮。
 */
'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Filter } from 'lucide-react'
import {
  issuesApi,
  issueKeys,
  type IssueSeverity,
  type IssueType,
  ISSUE_SEVERITY_LABELS,
  ISSUE_TYPE_LABELS,
} from '@/lib/api/issues'
import {
  buildIssuesViewModel,
  filterIssueRows,
  type IssueRowViewModel,
} from '@/lib/next/charts/issues-adapter'
import { cn } from '@/lib/utils'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface IssuesChartLensProps {
  projectId: number
}

export function IssuesChartLens({ projectId }: IssuesChartLensProps) {
  const [typeFilter, setTypeFilter] = useState<IssueType | 'all'>('all')
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | 'all'>('all')

  const query = useQuery({
    queryKey: issueKeys.list(projectId, { perPage: 100 }),
    queryFn: () => issuesApi.list(projectId, { perPage: 100 }),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const rawData = query.data
  const model = useMemo(() => (rawData ? buildIssuesViewModel(rawData) : null), [rawData])

  const filteredRows = useMemo(() => {
    if (!model) return []
    return filterIssueRows(model.rows, {
      type: typeFilter,
      severity: severityFilter,
    })
  }, [model, typeFilter, severityFilter])

  const isLoading = query.isLoading && !model
  const isError = query.isError && !model
  const hasData = model !== null
  const isEmpty = hasData && model.isEmpty

  const retry = () => {
    void query.refetch()
  }

  return (
    <div data-chart-lens-root="issues" className="flex min-h-[460px] flex-col gap-3">
      {/* 顶部状态分组度量卡 */}
      <div
        data-export-ignore="true"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3 text-xs"
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--nx-text-muted)] text-[11px]">议题总数</span>
          <span className="font-mono text-base font-semibold text-[var(--nx-text-primary)]">
            {model?.totalCount ?? 0}
            <span className="ml-1 text-[11px] font-normal text-[var(--nx-text-muted)]">项</span>
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--nx-text-muted)] text-[11px]">待处理 (Open)</span>
          <span className="font-mono text-base font-semibold text-sky-400">
            {model?.statusCounts.open ?? 0}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--nx-text-muted)] text-[11px]">处理中 (In Progress)</span>
          <span className="font-mono text-base font-semibold text-indigo-400">
            {model?.statusCounts.in_progress ?? 0}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--nx-text-muted)] text-[11px]">已解决 (Resolved)</span>
          <span className="font-mono text-base font-semibold text-emerald-400">
            {model?.statusCounts.resolved ?? 0}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--nx-text-muted)] text-[11px]">已关闭 (Closed)</span>
          <span className="font-mono text-base font-semibold text-zinc-400">
            {model?.statusCounts.closed ?? 0}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--nx-text-muted)] text-[11px]">已驳回 (Rejected)</span>
          <span className="font-mono text-base font-semibold text-zinc-500">
            {model?.statusCounts.rejected ?? 0}
          </span>
        </div>
      </div>

      {/* 筛选过滤工具条：标记 data-export-ignore */}
      <div
        data-export-ignore="true"
        className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-2 text-xs text-[var(--nx-text-muted)]"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 text-[var(--nx-text-secondary)] font-medium">
            <Filter className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" />
            <span>筛选过滤：</span>
          </div>

          {/* 类型筛选 */}
          <div className="flex items-center gap-1.5">
            <span>类型:</span>
            <select
              aria-label="议题类型筛选"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as IssueType | 'all')}
              className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-2 py-1 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
            >
              <option value="all">全部类型</option>
              {(Object.keys(ISSUE_TYPE_LABELS) as IssueType[]).map((typeKey) => (
                <option key={typeKey} value={typeKey}>
                  {ISSUE_TYPE_LABELS[typeKey]}
                </option>
              ))}
            </select>
          </div>

          {/* 严重度筛选 */}
          <div className="flex items-center gap-1.5">
            <span>严重度:</span>
            <select
              aria-label="议题严重度筛选"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as IssueSeverity | 'all')}
              className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-2 py-1 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
            >
              <option value="all">全部严重度</option>
              {(Object.keys(ISSUE_SEVERITY_LABELS) as IssueSeverity[]).map((sevKey) => (
                <option key={sevKey} value={sevKey}>
                  {ISSUE_SEVERITY_LABELS[sevKey]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {model && !isEmpty && (
          <div className="font-mono text-[11px]">
            当前显示 {filteredRows.length} / {model.totalCount} 项
          </div>
        )}
      </div>

      {isLoading && !hasData ? (
        <ChartLensSkeleton label="正在加载议题追踪数据" />
      ) : isError && !hasData ? (
        <ChartLensErrorState
          ariaLabel="议题追踪数据加载失败"
          title="议题追踪数据加载失败"
          onRetry={retry}
        />
      ) : !hasData || isEmpty ? (
        <ChartLensEmptyState
          icon={AlertCircle}
          title="暂无议题缺陷记录"
          description="当前项目尚未登记议题缺陷或变更追踪记录。"
          ariaLabel="议题追踪为空"
        />
      ) : (
        /* 主工作面表格：挂载 data-chart-viewport-slot */
        <div
          data-chart-viewport-slot
          className="relative max-h-[640px] overflow-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-inner"
        >
          <table
            className="w-full min-w-[850px] border-separate border-spacing-0 text-left text-xs"
            role="table"
            aria-label="议题与变更追踪明细表"
          >
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)] text-[var(--nx-text-primary)]">
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[100px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-3 font-medium backdrop-blur"
                >
                  业务编号
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[240px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-3 font-medium backdrop-blur"
                >
                  议题标题 / 摘要
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[90px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium backdrop-blur text-center"
                >
                  类型
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[90px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium backdrop-blur text-center"
                >
                  严重度
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[80px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium backdrop-blur text-center"
                >
                  优先级
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[90px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium backdrop-blur text-center"
                >
                  状态
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[110px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium backdrop-blur"
                >
                  登记时间
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[160px] border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-3 font-medium backdrop-blur"
                >
                  解决结论
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[var(--nx-text-muted)] italic">
                    未找到符合当前筛选条件的议题条目
                  </td>
                </tr>
              ) : (
                filteredRows.map((row: IssueRowViewModel, index: number) => {
                  const isEven = index % 2 === 0
                  return (
                    <tr
                      key={row.id}
                      data-issue-row={row.code}
                      className={cn(
                        'transition-colors hover:bg-[var(--nx-workspace-surface)]/50',
                        isEven ? 'bg-transparent' : 'bg-[var(--nx-workspace-surface)]/20',
                      )}
                    >
                      <td className="border-b border-r border-[var(--nx-border-hairline)] px-3.5 py-2.5 font-mono text-[11px] text-[var(--nx-accent)] font-medium">
                        {row.code}
                      </td>

                      <td className="border-b border-r border-[var(--nx-border-hairline)] px-3.5 py-2.5">
                        <div
                          className="font-medium text-[var(--nx-text-primary)]"
                          title={row.title}
                        >
                          {row.title}
                        </div>
                        {row.description && (
                          <div
                            className="mt-0.5 line-clamp-1 text-[11px] text-[var(--nx-text-muted)]"
                            title={row.description}
                          >
                            {row.description}
                          </div>
                        )}
                      </td>

                      <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-center">
                        <span className="rounded bg-[var(--nx-workspace-surface)] px-1.5 py-0.5 border border-[var(--nx-border-hairline)] text-[10px] text-[var(--nx-text-secondary)]">
                          {row.typeLabel}
                        </span>
                      </td>

                      <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-center">
                        <span
                          className={cn(
                            'inline-flex rounded px-1.5 py-0.5 text-[10px]',
                            row.severityClassName,
                          )}
                        >
                          {row.severityLabel}
                        </span>
                      </td>

                      <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-center">
                        <span className={cn('text-[11px]', row.priorityClassName)}>
                          {row.priorityLabel}
                        </span>
                      </td>

                      <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-center">
                        <span
                          className={cn(
                            'inline-flex rounded px-2 py-0.5 text-[10px]',
                            row.statusClassName,
                          )}
                        >
                          {row.statusLabel}
                        </span>
                      </td>

                      <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 font-mono text-[11px] text-[var(--nx-text-muted)]">
                        {row.createdAtFormatted}
                      </td>

                      <td className="border-b border-[var(--nx-border-hairline)] px-3.5 py-2.5 text-[11px] text-[var(--nx-text-muted)]">
                        {row.resolution ||
                          (row.status === 'resolved' || row.status === 'closed'
                            ? '已闭环'
                            : '待处理')}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default IssuesChartLens
