/**
 * RACI 责任分配矩阵镜头（v3-chart-gallery-tier2-governance-matrices W2 · task 2.1）。
 *
 * 契约与硬边界：
 * 1. Props 严格限定为 `{ projectId: number }`（对齐 `ChartLensComponentProps`）；
 * 2. 消费 `projectMetricsApi.raciMatrix`（只读 GET，RL-01 零写库）；
 * 3. 严格收敛复用 `lens-state-cards.tsx` 三态；
 * 4. 呈现形式适配数据本质（硬边界 8）：采用语义化 HTML `<table>` 与 CSS `sticky` 固定滚动；
 * 5. 单 A（Accountable）完整性中性视觉校验（恰 1 个 A 正常，0 个或 >1 个 A 中性高亮，零感性惊恐指责）；
 * 6. 视口插槽解耦：根标记 `data-chart-lens-root="raci"`，主表格可视区挂载 `data-chart-viewport-slot`；
 * 7. 外部统一注入工具条与导出菜单，镜头内部绝不重复实现汇出按钮。
 */
'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Columns3, HelpCircle } from 'lucide-react'
import { projectMetricsApi, projectMetricsKeys } from '@/lib/api/project-metrics'
import {
  buildRaciViewModel,
  RACI_ROLE_DEFINITIONS,
  type AccountableStatus,
} from '@/lib/next/charts/raci-adapter'
import { cn } from '@/lib/utils'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface RaciMatrixChartLensProps {
  projectId: number
}

function AccountableBadge({ status, hint }: { status: AccountableStatus; hint: string }) {
  if (status === 'normal') {
    return (
      <span
        title={hint}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        已设 1 位
      </span>
    )
  }
  if (status === 'missing') {
    return (
      <span
        title={hint}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
        未设置审核人
      </span>
    )
  }
  return (
    <span
      title={hint}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
      多位审核人
    </span>
  )
}

export function RaciMatrixChartLens({ projectId }: RaciMatrixChartLensProps) {
  const query = useQuery({
    queryKey: projectMetricsKeys.raciMatrix(projectId),
    queryFn: () => projectMetricsApi.raciMatrix(projectId),
    enabled: projectId > 0,
    retry: false,
    staleTime: 30_000,
  })

  const rawData = query.data
  const model = useMemo(() => (rawData ? buildRaciViewModel(rawData) : null), [rawData])

  const isLoading = query.isLoading
  const isError = query.isError && !model
  const hasData = model !== null
  const isEmpty = hasData && model.isEmpty

  const retry = () => {
    void query.refetch()
  }

  return (
    <div data-chart-lens-root="raci" className="flex min-h-[460px] flex-col gap-3">
      {/* 顶部职责图例与汇总度量卡 */}
      <div
        data-export-ignore="true"
        className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-2.5 text-xs text-[var(--nx-text-muted)]"
      >
        <div className="flex flex-wrap items-center gap-3" aria-label="RACI 角色说明">
          <span className="font-medium text-[var(--nx-text-primary)]">角色图例：</span>
          {(['R', 'A', 'C', 'I'] as const).map((roleKey) => {
            const def = RACI_ROLE_DEFINITIONS[roleKey]
            return (
              <span
                key={roleKey}
                title={def.description}
                className="inline-flex items-center gap-1.5 cursor-help"
              >
                <span
                  className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded text-[11px]',
                    def.className,
                  )}
                >
                  {def.label}
                </span>
                <span className="text-[var(--nx-text-secondary)]">{def.name}</span>
              </span>
            )
          })}
        </div>

        {model && !isEmpty && (
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span>任务 {model.totalTasks} 项</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span>成员 {model.totalMembers} 位</span>
            <span className="text-[var(--nx-border-hairline)]">·</span>
            <span className="text-emerald-400">单审核人 {model.normalAccountableCount}</span>
            {model.deviatedAccountableCount > 0 && (
              <>
                <span className="text-[var(--nx-border-hairline)]">·</span>
                <span className="text-amber-400">职责待明确 {model.deviatedAccountableCount}</span>
              </>
            )}
          </div>
        )}
      </div>

      {isLoading && !hasData ? (
        <ChartLensSkeleton label="正在加载 RACI 责任分配矩阵" />
      ) : isError && !hasData ? (
        <ChartLensErrorState
          ariaLabel="RACI 责任分配矩阵加载失败"
          title="RACI 责任分配矩阵加载失败"
          onRetry={retry}
        />
      ) : !hasData || isEmpty ? (
        <ChartLensEmptyState
          icon={Columns3}
          title="暂无责任分配矩阵数据"
          description="当前项目暂无任务或项目成员，责任分配矩阵暂无法构建。"
          ariaLabel="RACI 责任分配矩阵为空"
        />
      ) : (
        /* 主工作面矩阵表格：挂载 data-chart-viewport-slot */
        <div
          data-chart-viewport-slot
          className="relative max-h-[620px] overflow-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-inner"
        >
          <table
            className="w-full border-separate border-spacing-0 text-left text-xs"
            role="table"
            aria-label="RACI 责任分配二维矩阵"
          >
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)]">
                {/* 冻结首列表头：任务名称 */}
                <th
                  scope="col"
                  className="sticky left-0 top-0 z-30 min-w-[220px] max-w-[280px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3.5 py-3 font-medium text-[var(--nx-text-primary)] backdrop-blur"
                >
                  交付任务
                </th>
                {/* 状态与单 A 审核校验列头 */}
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[100px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium text-[var(--nx-text-primary)] backdrop-blur"
                >
                  任务状态
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-20 min-w-[130px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-3 font-medium text-[var(--nx-text-primary)] backdrop-blur"
                >
                  <span className="inline-flex items-center gap-1">
                    审核职责 (A)
                    <span
                      title="原则上每项任务应有且仅有 1 位最终审核人（Accountable）"
                      className="cursor-help inline-flex items-center"
                    >
                      <HelpCircle className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" />
                    </span>
                  </span>
                </th>
                {/* 成员列头 */}
                {model.members.map((member) => (
                  <th
                    key={member.id}
                    scope="col"
                    className="sticky top-0 z-10 min-w-[110px] max-w-[150px] border-b border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2.5 text-center font-medium text-[var(--nx-text-primary)] backdrop-blur last:border-r-0"
                  >
                    <div className="truncate font-medium" title={member.displayName}>
                      {member.displayName}
                    </div>
                    <div
                      className="truncate text-[10px] text-[var(--nx-text-muted)] font-normal"
                      title={member.role}
                    >
                      {member.role}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row, index) => {
                const isEven = index % 2 === 0
                return (
                  <tr
                    key={row.taskId}
                    data-raci-row={row.taskId}
                    className={cn(
                      'transition-colors hover:bg-[var(--nx-workspace-surface)]/60',
                      isEven ? 'bg-transparent' : 'bg-[var(--nx-workspace-surface)]/20',
                    )}
                  >
                    {/* 冻结首列：任务名 */}
                    <td
                      className={cn(
                        'sticky left-0 z-20 border-b border-r border-[var(--nx-border-hairline)] px-3.5 py-2.5 font-medium text-[var(--nx-text-primary)] backdrop-blur',
                        isEven
                          ? 'bg-[var(--nx-workspace-bg)]'
                          : 'bg-[var(--nx-workspace-surface)]/40',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {row.hasAccountableDeviation && (
                          <span
                            className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400"
                            title={row.accountableHint}
                          />
                        )}
                        <span className="truncate" title={row.taskName}>
                          {row.taskName}
                        </span>
                      </div>
                    </td>

                    {/* 任务状态 */}
                    <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5 text-[var(--nx-text-muted)]">
                      <span className="inline-flex rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-0.5 text-[11px]">
                        {row.taskStatusLabel}
                      </span>
                    </td>

                    {/* 审核人校验 */}
                    <td className="border-b border-r border-[var(--nx-border-hairline)] px-3 py-2.5">
                      <AccountableBadge status={row.accountableStatus} hint={row.accountableHint} />
                    </td>

                    {/* 成员交叉单元格 */}
                    {model.members.map((member) => {
                      const roles = row.cells[member.id] || []
                      return (
                        <td
                          key={member.id}
                          className="border-b border-r border-[var(--nx-border-hairline)] px-2 py-2 text-center last:border-r-0"
                        >
                          {roles.length > 0 ? (
                            <div className="flex items-center justify-center gap-1">
                              {roles.map((r) => {
                                const def = RACI_ROLE_DEFINITIONS[r]
                                return (
                                  <span
                                    key={r}
                                    title={`${member.displayName}: ${def.name}`}
                                    className={cn(
                                      'inline-flex h-5 w-5 items-center justify-center rounded text-[11px]',
                                      def.className,
                                    )}
                                  >
                                    {r}
                                  </span>
                                )
                              })}
                            </div>
                          ) : (
                            <span className="text-[var(--nx-border-hairline)] text-xs select-none">
                              -
                            </span>
                          )}
                        </td>
                      )
                    })}
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

export const RaciChartLens = RaciMatrixChartLens
export default RaciMatrixChartLens
