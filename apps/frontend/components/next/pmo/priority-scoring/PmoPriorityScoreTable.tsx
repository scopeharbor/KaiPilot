'use client'

import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  ShieldAlert,
  AlertTriangle,
  CircleCheck,
  ListTree,
} from 'lucide-react'
import { PRIORITY_LEVEL_LABELS, SCORE_DIMENSION_LABELS } from '@aiproj/types'
import type {
  PriorityLevel,
  PriorityPaginationMeta,
  PriorityScoreItem,
  SupportedPrioritySortKey,
} from '@aiproj/types'
import { cn } from '@/lib/utils'
import { priorityLevelVisual } from './pmo-priority-level-meta'

/**
 * PMO 优先级评分项目队列表（v3-ui-next-pmo-domain W4 · tasks 4.2）。
 *
 * 纯展示（数据由工作台容器装配）：
 * - 列：排名/项目/评分/等级（双通道徽标）/主要维度/状态/操作；
 * - 工具栏：排序（SUPPORTED_PRIORITY_SORT_KEYS 中文标签）、生效过滤提示与清除；
 * - 行点击 → 打开评分明细抽屉（onOpenDetail）；「明细」按钮为键盘等价入口；
 * - 空态（数据空 / 过滤无匹配）与分页脚注（仅 totalPages > 1 时展示）；
 * - 零写操作（RL-01）。
 */
export interface PmoPriorityScoreTableProps {
  items: PriorityScoreItem[]
  meta?: PriorityPaginationMeta
  page: number
  sortKey: SupportedPrioritySortKey
  activeLevels: readonly PriorityLevel[]
  onSortChange: (key: SupportedPrioritySortKey) => void
  onPageChange: (page: number) => void
  onClearFilters: () => void
  onOpenDetail: (item: PriorityScoreItem) => void
}

const SORT_OPTIONS: Array<{ key: SupportedPrioritySortKey; label: string }> = [
  { key: 'priority_score', label: '评分' },
  { key: 'priority_level', label: '等级' },
  { key: 'rank', label: '排名' },
  { key: 'project_name', label: '项目名称' },
  { key: 'updated_at', label: '更新时间' },
]

function formatScore(score: number): string {
  return score >= 0 ? score.toFixed(1) : '—'
}

export function PmoPriorityScoreTable({
  items,
  meta,
  page,
  sortKey,
  activeLevels,
  onSortChange,
  onPageChange,
  onClearFilters,
  onOpenDetail,
}: PmoPriorityScoreTableProps) {
  const total = meta?.total ?? items.length
  const totalPages = meta?.totalPages ?? 1

  return (
    <section
      data-pps-table
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]"
    >
      {/* 工具栏：排序 / 过滤摘要 */}
      <div
        data-pps-toolbar
        className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2.5"
      >
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] text-[var(--nx-text-muted)]">
            <ArrowUpDown className="h-3.5 w-3.5" aria-hidden />
            排序
          </span>
          <select
            data-pps-sort
            value={sortKey}
            onChange={(event) => onSortChange(event.target.value as SupportedPrioritySortKey)}
            aria-label="评分队列排序"
            className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {activeLevels.length > 0 ? (
          <button
            type="button"
            data-pps-clear-filters
            onClick={onClearFilters}
            className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            清除过滤（{activeLevels.length}）
          </button>
        ) : null}
      </div>

      {/* 内容 */}
      {items.length === 0 ? (
        <div data-pps-empty className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <ListTree className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs font-medium text-[var(--nx-text-primary)]">
            {activeLevels.length > 0 ? '当前过滤条件下没有匹配项目' : '暂无项目评分数据'}
          </p>
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            {activeLevels.length > 0
              ? '可清除等级过滤查看完整队列，或稍后刷新重试。'
              : '组合内尚无已评分的项目，评分在项目数据齐备后自动解算。'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--nx-border-hairline)] text-left text-[10px] text-[var(--nx-text-muted)]">
                  <th className="px-3 py-2 font-normal">排名</th>
                  <th className="px-3 py-2 font-normal">项目</th>
                  <th className="px-3 py-2 text-right font-normal">评分</th>
                  <th className="px-3 py-2 font-normal">等级</th>
                  <th className="px-3 py-2 font-normal">主要维度</th>
                  <th className="px-3 py-2 font-normal">状态</th>
                  <th className="px-3 py-2 font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const visual = priorityLevelVisual(item.priorityLevel)
                  const unranked = item.priorityLevel === 'unranked'
                  const hasStale = item.warnings.some((warning) => warning.code === 'SOURCE_STALE')
                  const hasForbidden = item.warnings.some(
                    (warning) => warning.code === 'DIMENSION_FORBIDDEN',
                  )
                  const hasUnavailable = item.warnings.some((warning) =>
                    ['DIMENSION_UNAVAILABLE', 'SOURCE_UNAVAILABLE'].includes(warning.code),
                  )
                  return (
                    <tr
                      key={item.projectId}
                      data-pps-row={item.projectId}
                      data-priority-level={item.priorityLevel}
                      onClick={() => onOpenDetail(item)}
                      title="查看评分明细"
                      className={cn(
                        'cursor-pointer border-b border-[var(--nx-border-hairline)] transition-colors last:border-0 hover:bg-[var(--nx-bg-1)]',
                        unranked && 'opacity-60',
                      )}
                    >
                      <td className="px-3 py-2 font-mono text-[11px] text-[var(--nx-text-muted)]">
                        {item.rank > 0 ? `#${item.rank}` : '—'}
                      </td>
                      <td className="px-3 py-2 font-medium text-[var(--nx-text-primary)]">
                        {item.projectName}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          data-pps-score={item.projectId}
                          className="font-mono text-[11px] text-[var(--nx-text-secondary)]"
                        >
                          {formatScore(item.priorityScore)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          data-pps-badge={item.priorityLevel}
                          className="inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[10px] font-medium"
                          style={{
                            color: visual.token,
                            backgroundColor: visual.bg,
                            borderColor: visual.border,
                          }}
                        >
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: visual.dot }}
                          />
                          {PRIORITY_LEVEL_LABELS[item.priorityLevel]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {item.topReasons.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {item.topReasons.map((reason) => (
                              <span
                                key={reason.dimension}
                                data-pps-top-reason={reason.dimension}
                                className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
                              >
                                {SCORE_DIMENSION_LABELS[reason.dimension] ?? reason.dimension}
                                <span className="text-[var(--nx-text-secondary)]">
                                  {reason.weightedContribution.toFixed(1)}
                                </span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[11px] text-[var(--nx-text-muted)]">
                            {item.warnings.length > 0 ? '数据不足' : '无'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5" data-pps-status={item.projectId}>
                          {hasStale ? (
                            <span
                              data-pps-status-stale
                              title="数据可能过期"
                              className="inline-flex items-center gap-1 text-[10px] text-[var(--nx-status-warning)]"
                            >
                              <Clock className="h-3 w-3" aria-hidden />
                              过期
                            </span>
                          ) : null}
                          {hasForbidden ? (
                            <span
                              data-pps-status-forbidden
                              title="部分维度受限"
                              className="inline-flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]"
                            >
                              <ShieldAlert className="h-3 w-3" aria-hidden />
                              受限
                            </span>
                          ) : null}
                          {hasUnavailable ? (
                            <span
                              data-pps-status-unavailable
                              title="部分数据不可用"
                              className="inline-flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]"
                            >
                              <Info className="h-3 w-3" aria-hidden />
                              不可用
                            </span>
                          ) : null}
                          {item.warnings.some(
                            (warning) =>
                              ![
                                'SOURCE_STALE',
                                'DIMENSION_FORBIDDEN',
                                'DIMENSION_UNAVAILABLE',
                                'SOURCE_UNAVAILABLE',
                              ].includes(warning.code),
                          ) ? (
                            <span
                              data-pps-status-other
                              title="存在其他数据提示"
                              className="inline-flex items-center text-[10px] text-[var(--nx-text-muted)]"
                            >
                              <AlertTriangle className="h-3 w-3" aria-hidden />
                            </span>
                          ) : null}
                          {item.warnings.length === 0 ? (
                            <span
                              data-pps-status-ok
                              className="inline-flex items-center gap-1 text-[10px] text-[var(--nx-status-success)]"
                            >
                              <CircleCheck className="h-3 w-3" aria-hidden />
                              正常
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          data-pps-open-detail={item.projectId}
                          aria-label={`查看「${item.projectName}」评分明细`}
                          onClick={(event) => {
                            event.stopPropagation()
                            onOpenDetail(item)
                          }}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
                        >
                          明细
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 分页脚注 */}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[11px] text-[var(--nx-text-muted)]">共 {total} 个项目</span>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-pps-page-prev
                  aria-label="上一页"
                  disabled={page <= 1}
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                  className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                  上一页
                </button>
                <span
                  data-pps-page-info
                  className="font-mono text-[11px] text-[var(--nx-text-muted)]"
                >
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  data-pps-page-next
                  aria-label="下一页"
                  disabled={page >= totalPages}
                  onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                  className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:opacity-40"
                >
                  下一页
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}

export default PmoPriorityScoreTable
