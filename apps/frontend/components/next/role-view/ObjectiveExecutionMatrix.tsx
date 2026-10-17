'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Sparkles,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  resolveCockpitTargetHref,
  cockpitTargetAriaLabel,
} from '@/lib/strategy-execution-cockpit-nav'
import type { CockpitObjectiveRow, CockpitSortKey } from '@aiproj/types'

export interface AiAttributionTarget {
  id?: number | string
  objectiveId?: number
  title: string
  reason?: string
  basis?: string
  severity?: string
  progress?: number
  historyEvolution?: string[]
  bottleneckCause?: string
  riskCorrelation?: string
  forecastAdvice?: string
}

export interface ObjectiveExecutionMatrixProps {
  /** 目标行列表 */
  rows: CockpitObjectiveRow[]
  /** 当前排序键 */
  sortKey?: CockpitSortKey
  /** 当前排序方向 */
  sortOrder?: 'asc' | 'desc'
  /** 排序改变回调 */
  onSortChange?: (key: CockpitSortKey, order: 'asc' | 'desc') => void
  /** 唤起 AI 归因摘要抽屉回调 */
  onOpenAiAttribution?: (target: AiAttributionTarget) => void
  /** 自定义样式类名 */
  className?: string
}

const PRIORITY_RANK: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
}

/** 目标行通用比较器 */
export function sortObjectiveRows(
  rows: CockpitObjectiveRow[],
  key: CockpitSortKey,
  order: 'asc' | 'desc',
): CockpitObjectiveRow[] {
  const getValue = (row: CockpitObjectiveRow): number | string => {
    switch (key) {
      case 'risk':
        // 风险排序：关注原因数越多的行风险越高；若关注数相同，进度较低者风险更高
        return (row.attentionReasons?.length ?? 0) * 1000 + (100 - (row.progress ?? 0))
      case 'progress':
        return row.progress ?? 0
      case 'priority':
        return PRIORITY_RANK[row.priorityBand ?? ''] ?? 0
      case 'mapping_coverage':
        return row.coveragePercent ?? -1
      case 'title':
      default:
        return row.objectiveTitle ?? ''
    }
  }

  return [...rows].sort((a, b) => {
    const av = getValue(a)
    const bv = getValue(b)
    let delta: number
    if (typeof av === 'string' && typeof bv === 'string') {
      delta = av.localeCompare(bv, 'zh-CN')
    } else {
      delta = Number(av) - Number(bv)
    }
    return order === 'asc' ? delta : -delta
  })
}

/** 状态微标映射 */
function renderStatusBadge(status?: string, executionHealth?: string) {
  if (executionHealth === 'at_risk' || status === 'at_risk') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        <AlertCircle className="h-3 w-3" />
        风险
      </span>
    )
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
        <CheckCircle2 className="h-3 w-3" />
        已达成
      </span>
    )
  }
  if (status === 'active' || executionHealth === 'on_track') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">
        <Clock className="h-3 w-3" />
        执行中
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-stone-200 bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
      {status || '未开始'}
    </span>
  )
}

/**
 * 目标至执行对齐矩阵（v3-ui-next-batch1-strategy-launch-tasks §1.5 / spec「目标至执行对齐矩阵与注意力队列」）。
 * 呈现各战略目标（Objective）与业务线任务执行的映射关系、进度条、状态微标与 AI 归因操作点。
 */
export function ObjectiveExecutionMatrix({
  rows,
  sortKey: controlledSortKey,
  sortOrder: controlledSortOrder,
  onSortChange,
  onOpenAiAttribution,
  className,
}: ObjectiveExecutionMatrixProps) {
  const [internalSortKey, setInternalSortKey] = React.useState<CockpitSortKey>('risk')
  const [internalSortOrder, setInternalSortOrder] = React.useState<'asc' | 'desc'>('desc')

  const currentKey = controlledSortKey ?? internalSortKey
  const currentOrder = controlledSortOrder ?? internalSortOrder

  const sortedRows = React.useMemo(
    () => sortObjectiveRows(rows, currentKey, currentOrder),
    [rows, currentKey, currentOrder],
  )

  const handleToggleSort = (key: CockpitSortKey) => {
    let nextOrder: 'asc' | 'desc' = 'desc'
    if (currentKey === key) {
      nextOrder = currentOrder === 'asc' ? 'desc' : 'asc'
    }
    if (onSortChange) {
      onSortChange(key, nextOrder)
    } else {
      setInternalSortKey(key)
      setInternalSortOrder(nextOrder)
    }
  }

  const renderSortIcon = (key: CockpitSortKey) => {
    if (currentKey !== key) {
      return <ArrowUpDown className="h-3 w-3 opacity-40" />
    }
    return currentOrder === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-[var(--nx-role-accent,#d97706)]" />
    ) : (
      <ArrowDown className="h-3 w-3 text-[var(--nx-role-accent,#d97706)]" />
    )
  }

  return (
    <section
      aria-label="目标至执行对齐矩阵"
      data-objective-execution-matrix="true"
      className={cn(
        'w-full rounded-xl border p-5 transition-colors',
        'border-[rgba(56,52,44,0.12)] bg-[var(--nx-role-surface,#ebe9e1)]',
        className,
      )}
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-[var(--nx-role-text,#38342c)]">
            目标至执行对齐矩阵
          </h2>
          <p className="text-xs text-[var(--nx-role-text,#38342c)]/60">
            结构化映射组织战略 Objective 与交付落地 Project 进展
          </p>
        </div>

        {/* 排序快捷操作按钮组 */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--nx-role-text,#38342c)]/70">
          <span className="font-medium">排序：</span>
          <button
            type="button"
            data-testid="sort-btn-risk"
            onClick={() => handleToggleSort('risk')}
            className={cn(
              'inline-flex min-h-[32px] items-center gap-1 rounded border px-2 py-1',
              currentKey === 'risk'
                ? 'border-[var(--nx-role-accent,#d97706)] bg-[var(--nx-role-bg,#f5f4ef)] font-medium text-[var(--nx-role-text,#38342c)]'
                : 'border-[rgba(56,52,44,0.1)] hover:bg-[rgba(56,52,44,0.04)]',
            )}
          >
            风险 {renderSortIcon('risk')}
          </button>
          <button
            type="button"
            data-testid="sort-btn-progress"
            onClick={() => handleToggleSort('progress')}
            className={cn(
              'inline-flex min-h-[32px] items-center gap-1 rounded border px-2 py-1',
              currentKey === 'progress'
                ? 'border-[var(--nx-role-accent,#d97706)] bg-[var(--nx-role-bg,#f5f4ef)] font-medium text-[var(--nx-role-text,#38342c)]'
                : 'border-[rgba(56,52,44,0.1)] hover:bg-[rgba(56,52,44,0.04)]',
            )}
          >
            进度 {renderSortIcon('progress')}
          </button>
          <button
            type="button"
            data-testid="sort-btn-priority"
            onClick={() => handleToggleSort('priority')}
            className={cn(
              'inline-flex min-h-[32px] items-center gap-1 rounded border px-2 py-1',
              currentKey === 'priority'
                ? 'border-[var(--nx-role-accent,#d97706)] bg-[var(--nx-role-bg,#f5f4ef)] font-medium text-[var(--nx-role-text,#38342c)]'
                : 'border-[rgba(56,52,44,0.1)] hover:bg-[rgba(56,52,44,0.04)]',
            )}
          >
            优先级 {renderSortIcon('priority')}
          </button>
        </div>
      </div>

      {sortedRows.length === 0 ? (
        <div
          data-testid="matrix-empty"
          className="rounded-lg border border-dashed border-[rgba(56,52,44,0.15)] p-8 text-center text-sm text-[var(--nx-role-text,#38342c)]/60"
        >
          当前组织或筛选条件下无可见战略目标。
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="objective-table">
            <thead>
              <tr className="border-b border-[rgba(56,52,44,0.12)] text-xs text-[var(--nx-role-text,#38342c)]/60">
                <th className="pb-3 pr-4 font-medium">战略目标 (Objective)</th>
                <th className="pb-3 pr-4 font-medium">状态</th>
                <th className="pb-3 pr-4 font-medium">进度</th>
                <th className="pb-3 pr-4 font-medium">KR 达成</th>
                <th className="pb-3 pr-4 font-medium">支撑项目</th>
                <th className="pb-3 pr-4 font-medium">覆盖率</th>
                <th className="pb-3 font-medium">偏离与 AI 归因</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(56,52,44,0.08)]">
              {sortedRows.map((row) => {
                const hasDeviation =
                  (row.attentionReasons && row.attentionReasons.length > 0) ||
                  row.progress < 60 ||
                  row.executionHealth === 'at_risk'

                return (
                  <tr
                    key={row.objectiveId}
                    data-testid={`objective-row-${row.objectiveId}`}
                    className="hover:bg-[rgba(56,52,44,0.03)] transition-colors"
                  >
                    {/* 目标名称与元信息 */}
                    <td className="py-3.5 pr-4 align-top">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Link
                            href={resolveCockpitTargetHref(row.target)}
                            aria-label={cockpitTargetAriaLabel(row.target)}
                            className="font-semibold text-[var(--nx-role-text,#38342c)] hover:underline inline-flex items-center gap-1"
                          >
                            <span>{row.objectiveTitle}</span>
                            {row.target?.authorized && (
                              <ExternalLink className="h-3 w-3 opacity-50" />
                            )}
                          </Link>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--nx-role-text,#38342c)]/60">
                          <span className="rounded bg-[var(--nx-role-bg,#f5f4ef)] px-1.5 py-0.5 border border-[rgba(56,52,44,0.08)]">
                            优先级: {row.priorityBand ?? '—'}
                          </span>
                          <span>范围: {row.scope ?? '—'}</span>
                          {row.investmentAlignment && <span>投入: {row.investmentAlignment}</span>}
                        </div>
                      </div>
                    </td>

                    {/* 状态徽标 */}
                    <td className="py-3.5 pr-4 align-top">
                      <div data-testid={`badge-status-${row.objectiveId}`}>
                        {renderStatusBadge(row.status, row.executionHealth)}
                      </div>
                    </td>

                    {/* 进度 */}
                    <td className="py-3.5 pr-4 align-top min-w-[120px]">
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs font-medium">
                          <span>{row.progress}%</span>
                        </div>
                        <div
                          className="h-1.5 w-full rounded-full bg-[rgba(56,52,44,0.1)] overflow-hidden"
                          role="progressbar"
                          aria-valuenow={row.progress}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full rounded-full bg-[var(--nx-role-accent,#d97706)] transition-all motion-reduce:transition-none"
                            style={{ width: `${Math.min(100, Math.max(0, row.progress))}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* KR 达成 */}
                    <td className="py-3.5 pr-4 align-top text-xs">
                      <span
                        className={cn(
                          row.behindKeyResultCount > 0 ? 'text-amber-700 font-semibold' : '',
                        )}
                      >
                        {row.behindKeyResultCount}/{row.keyResultCount} 滞后
                      </span>
                    </td>

                    {/* 支撑项目 */}
                    <td className="py-3.5 pr-4 align-top text-xs">
                      <span className="font-medium">{row.mappedProjects?.length ?? 0}</span> 个项目
                    </td>

                    {/* 覆盖率 */}
                    <td className="py-3.5 pr-4 align-top text-xs font-medium">
                      {row.coveragePercent !== null && row.coveragePercent !== undefined
                        ? `${row.coveragePercent}%`
                        : '—'}
                    </td>

                    {/* 偏离原因与 AI 归因操作点 */}
                    <td className="py-3.5 align-top">
                      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                        {row.attentionReasons && row.attentionReasons.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {row.attentionReasons.map((reason, idx) => (
                              <span
                                key={idx}
                                className="inline-block rounded bg-amber-100/70 px-1.5 py-0.5 text-xs text-amber-900 border border-amber-200"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--nx-role-text,#38342c)]/40">
                            健康受控
                          </span>
                        )}

                        {/* AI 归因摘要操作点 */}
                        {hasDeviation && onOpenAiAttribution && (
                          <button
                            type="button"
                            data-testid={`ai-attribution-btn-${row.objectiveId}`}
                            onClick={() =>
                              onOpenAiAttribution({
                                id: row.objectiveId,
                                objectiveId: row.objectiveId,
                                title: row.objectiveTitle,
                                reason: row.attentionReasons?.join('； ') || '进度滞后风险',
                                progress: row.progress,
                              })
                            }
                            title="查看 AI 战略归因与推演依据"
                            aria-label="查看 AI 战略归因与推演依据"
                            className={cn(
                              'inline-flex min-h-[30px] items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium shrink-0',
                              'border-amber-600/30 bg-amber-50 text-amber-900 hover:bg-amber-100/80',
                              'focus-visible:outline-2 focus-visible:outline-amber-600',
                              'transition-colors motion-reduce:transition-none',
                            )}
                          >
                            <Sparkles className="h-3 w-3 text-amber-600" />
                            <span>AI 归因摘要</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
