/**
 * 利害关系人登记与四象限镜头（v3-chart-gallery-tier2-governance-matrices W2 · task 2.5）。
 *
 * 契约与硬边界：
 * 1. Props 严格限定为 `{ projectId: number }`（对齐 `ChartLensComponentProps`）；
 * 2. 消费 `stakeholdersApi.quadrant` 与 `stakeholdersApi.list`（只读 GET，RL-01 零写库）；
 * 3. 严格收敛复用 `lens-state-cards.tsx` 三态；
 * 4. 呈现形式适配数据本质（硬边界 8）：提供「2×2 权力-利益四象限矩阵」与「结构化登记底册」双重视图无缝切换；
 * 5. 视图切换控件标示 `data-export-ignore="true"` 免污染汇出画面；
 * 6. 视口插槽解耦：根标记 `data-chart-lens-root="stakeholder"`，主呈现区域挂载 `data-chart-viewport-slot`；
 * 7. 外部统一注入工具条与导出菜单，镜头内部绝不重复实现汇出按钮。
 */
'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, Table, Users } from 'lucide-react'
import { stakeholdersApi, stakeholderKeys } from '@/lib/api/stakeholders'
import {
  buildStakeholderViewModel,
  type QuadrantBucketKey,
  type StakeholderCardViewModel,
} from '@/lib/next/charts/stakeholder-adapter'
import { cn } from '@/lib/utils'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface StakeholderChartLensProps {
  projectId: number
}

type ViewMode = 'quadrant' | 'table'

function StakeholderCard({ item }: { item: StakeholderCardViewModel }) {
  return (
    <div
      data-stakeholder-card={item.id}
      className="flex flex-col gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-2.5 text-xs shadow-sm transition-colors hover:border-[var(--nx-border-focus)]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5 truncate">
          <span className="font-medium text-[var(--nx-text-primary)]" title={item.name}>
            {item.name}
          </span>
          <span className="text-[11px] text-[var(--nx-text-muted)] truncate" title={item.roleTitle}>
            {item.roleTitle}
          </span>
        </div>
        <span
          className={cn(
            'inline-flex flex-shrink-0 rounded px-1.5 py-0.2 text-[10px] font-medium',
            item.attitudeClassName,
          )}
        >
          {item.attitudeLabel}
        </span>
      </div>

      <div className="flex items-center justify-between text-[11px] text-[var(--nx-text-muted)]">
        <span className="truncate" title={item.organizationName}>
          {item.organizationName}
        </span>
        <span className="rounded bg-[var(--nx-workspace-surface)] px-1 py-0.2 text-[10px] border border-[var(--nx-border-hairline)]">
          {item.stakeholderTypeLabel}
        </span>
      </div>

      {item.expectations && (
        <div
          className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
          title={item.expectations}
        >
          诉求：{item.expectations}
        </div>
      )}
    </div>
  )
}

export function StakeholderChartLens({ projectId }: StakeholderChartLensProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('quadrant')

  const quadrantQuery = useQuery({
    queryKey: stakeholderKeys.quadrant(projectId),
    queryFn: () => stakeholdersApi.quadrant(projectId),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const listQuery = useQuery({
    queryKey: stakeholderKeys.list(projectId),
    queryFn: () => stakeholdersApi.list(projectId),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const rawQuadrant = quadrantQuery.data
  const rawList = listQuery.data?.data

  const model = useMemo(
    () => (rawQuadrant ? buildStakeholderViewModel(rawQuadrant, rawList) : null),
    [rawQuadrant, rawList],
  )

  const isLoading = quadrantQuery.isLoading && !model
  const isError = quadrantQuery.isError && !model
  const hasData = model !== null
  const isEmpty = hasData && model.isEmpty

  const retry = () => {
    void quadrantQuery.refetch()
    void listQuery.refetch()
  }

  // 象限键定义（按标准 2x2 网格排布）：
  // 左上: keepSatisfied (高权低利) | 右上: manageClosely (高权高利)
  // 左下: monitor       (低权低利) | 右下: keepInformed  (低权高利)
  const quadrantLayout: Array<{ key: QuadrantBucketKey; label: string }> = [
    { key: 'keepSatisfied', label: '令其满意 (高权·低利)' },
    { key: 'manageClosely', label: '重点管理 (高权·高利)' },
    { key: 'monitor', label: '监督监测 (低权·低利)' },
    { key: 'keepInformed', label: '随时告知 (低权·高利)' },
  ]

  return (
    <div data-chart-lens-root="stakeholder" className="flex min-h-[460px] flex-col gap-3">
      {/* 顶部控制栏：模式切换与总人数 */}
      <div
        data-export-ignore="true"
        className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-2.5 text-xs text-[var(--nx-text-muted)]"
      >
        <div
          role="tablist"
          aria-label="利害关系人呈现视图切换"
          className="inline-flex items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'quadrant'}
            onClick={() => setViewMode('quadrant')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors',
              viewMode === 'quadrant'
                ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)] font-medium shadow-sm'
                : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-secondary)]',
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>四象限矩阵</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'table'}
            onClick={() => setViewMode('table')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors',
              viewMode === 'table'
                ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)] font-medium shadow-sm'
                : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-secondary)]',
            )}
          >
            <Table className="h-3.5 w-3.5" />
            <span>登记底册</span>
          </button>
        </div>

        {model && !isEmpty && (
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span>登记总数：{model.totalCount} 位</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span className="text-emerald-400">重点管理 {model.summary.manageClosely}</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span className="text-sky-400">令其满意 {model.summary.keepSatisfied}</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span className="text-indigo-400">随时告知 {model.summary.keepInformed}</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span className="text-zinc-400">监督监测 {model.summary.monitor}</span>
          </div>
        )}
      </div>

      {isLoading && !hasData ? (
        <ChartLensSkeleton label="正在加载利害关系人数据" />
      ) : isError && !hasData ? (
        <ChartLensErrorState
          ariaLabel="利害关系人数据加载失败"
          title="利害关系人数据加载失败"
          onRetry={retry}
        />
      ) : !hasData || isEmpty ? (
        <ChartLensEmptyState
          icon={Users}
          title="暂无利害关系人数据"
          description="当前项目尚未登记利害关系人。"
          ariaLabel="利害关系人为空"
        />
      ) : (
        /* 主可视区：挂载 data-chart-viewport-slot */
        <div data-chart-viewport-slot className="w-full">
          {viewMode === 'quadrant' ? (
            /* 2x2 权力-利益四象限网格 */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {quadrantLayout.map(({ key }) => {
                const bucket = model.quadrantBuckets[key]
                if (!bucket) return null
                return (
                  <div
                    key={key}
                    data-quadrant-bucket={key}
                    className="flex min-h-[220px] flex-col rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]/60 p-3.5"
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--nx-border-hairline)]">
                      <div>
                        <div className="font-medium text-xs text-[var(--nx-text-primary)]">
                          {bucket.title}
                        </div>
                        <div className="text-[10px] text-[var(--nx-text-muted)]">
                          {bucket.subtitle}
                        </div>
                      </div>
                      <span className="font-mono text-xs font-semibold rounded bg-[var(--nx-workspace-bg)] px-2 py-0.5 border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]">
                        {bucket.count} 人
                      </span>
                    </div>

                    <div className="mt-3 flex flex-1 flex-col gap-2 overflow-y-auto max-h-[280px]">
                      {bucket.stakeholders.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center text-xs text-[var(--nx-text-muted)] italic">
                          当前象限暂无干系人
                        </div>
                      ) : (
                        bucket.stakeholders.map((item: StakeholderCardViewModel) => (
                          <StakeholderCard key={item.id} item={item} />
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* 结构化登记底册表格 */
            <div className="relative max-h-[620px] overflow-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]">
              <table
                className="w-full border-separate border-spacing-0 text-left text-xs"
                role="table"
                aria-label="利害关系人登记底册表格"
              >
                <thead>
                  <tr className="border-b border-[var(--nx-border-hairline)] text-[var(--nx-text-primary)]">
                    <th
                      scope="col"
                      className="sticky top-0 z-20 min-w-[140px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-3 font-medium backdrop-blur"
                    >
                      姓名 / 头衔
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 z-20 min-w-[140px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium backdrop-blur"
                    >
                      组织机构
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 z-20 min-w-[70px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium backdrop-blur text-center"
                    >
                      类型
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 z-20 min-w-[100px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium backdrop-blur"
                    >
                      权力 / 利益
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 z-20 min-w-[80px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium backdrop-blur text-center"
                    >
                      态度
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 z-20 min-w-[100px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium backdrop-blur"
                    >
                      应对策略
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 z-20 min-w-[200px] border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-3 font-medium backdrop-blur"
                    >
                      核心诉求与期望
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {model.tableRows.map((row, index) => {
                    const isEven = index % 2 === 0
                    return (
                      <tr
                        key={row.id}
                        data-stakeholder-row={row.id}
                        className={cn(
                          'transition-colors hover:bg-[var(--nx-workspace-surface)]/50',
                          isEven ? 'bg-transparent' : 'bg-[var(--nx-workspace-surface)]/20',
                        )}
                      >
                        <td className="border-b border-r border-[var(--nx-border-hairline)] px-3.5 py-2.5 font-medium text-[var(--nx-text-primary)]">
                          <div>{row.name}</div>
                          <div className="text-[11px] text-[var(--nx-text-muted)] font-normal">
                            {row.roleTitle}
                          </div>
                        </td>
                        <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-[var(--nx-text-muted)]">
                          {row.organizationName}
                        </td>
                        <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-center">
                          <span className="rounded bg-[var(--nx-workspace-surface)] px-1.5 py-0.2 border border-[var(--nx-border-hairline)] text-[10px]">
                            {row.stakeholderTypeLabel}
                          </span>
                        </td>
                        <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-[11px] text-[var(--nx-text-secondary)]">
                          <span>
                            权: {row.powerLevelLabel} · 利: {row.interestLevelLabel}
                          </span>
                        </td>
                        <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-center">
                          <span
                            className={cn(
                              'inline-flex rounded px-1.5 py-0.2 text-[10px] font-medium',
                              row.attitudeClassName,
                            )}
                          >
                            {row.attitudeLabel}
                          </span>
                        </td>
                        <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-[11px] text-[var(--nx-text-secondary)]">
                          {row.strategyLabel}
                        </td>
                        <td className="border-b border-[var(--nx-border-hairline)] px-3.5 py-2.5 text-[11px] text-[var(--nx-text-muted)]">
                          {row.expectations}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default StakeholderChartLens
