'use client'

import * as React from 'react'
import { AlertTriangle, ArrowUpDown, CircleDot, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTrafficLightList } from '@/hooks/use-pmo-traffic-light'
import type {
  PortfolioTrafficLightItem,
  PortfolioTrafficLightSortKey,
  TrafficLightSeverity,
  TrafficLightStatus,
} from '@aiproj/types'
import {
  PORTFOLIO_TRAFFIC_LIGHT_DEFAULT_PER_PAGE,
  TRAFFIC_LIGHT_REVIEW_STATE_LABELS,
  TRAFFIC_LIGHT_STATUSES,
  TRAFFIC_LIGHT_STATUS_LABELS,
} from '@aiproj/types'

/**
 * PMO 红绿灯高密度表格（v3-ui-next-pmo-domain W2 · tasks 2.2）。
 *
 * - 消费 `useTrafficLightList({page,perPage,sort,order,filterStatus})`，
 *   受控于工作台（筛选/排序/分页状态自工作台提升）；
 * - 列：灯色（双通道）、项目名称（+数据过期/警告提示）、触发规则 ID
 *   （`TRAFFIC_LIGHT_RULE_IDS` 语义：evidence.contributing 规则 + 严重度色带）、
 *   严重度计数、更新时间、复核状态、操作；
 * - 行点击下钻 `/next/projects/:id`（RL-05 目标项目空间自身做组织校验）；
 *   复核入口仅 `portfolio:manage` 且服务端 allowedActions.canReview 时呈现；
 * - 三态：几何骨架屏（aria-busy）/ 语义空态（可清除筛选）/ 错误卡
 *   （重新加载 + 返回角色首页）。
 */

/** 灯色 → --nx-* 令牌实色。 */
const STATUS_COLOR: Record<TrafficLightStatus, string> = {
  red: 'var(--nx-status-danger)',
  yellow: 'var(--nx-status-warning)',
  green: 'var(--nx-status-success)',
  gray: 'var(--nx-text-muted)',
}

/** 严重度 → 中文标签 + 令牌色（双通道徽标）。 */
const SEVERITY_META: Record<TrafficLightSeverity, { label: string; color: string }> = {
  critical: { label: '严重', color: 'var(--nx-status-danger)' },
  high: { label: '高', color: 'var(--nx-chart-5)' },
  medium: { label: '中', color: 'var(--nx-chart-4)' },
  low: { label: '低', color: 'var(--nx-text-muted)' },
}

const SORT_OPTIONS: Array<{ value: PortfolioTrafficLightSortKey; label: string }> = [
  { value: 'traffic_light', label: '交通灯' },
  { value: 'project_name', label: '项目名' },
  { value: 'severity_critical', label: '严重度' },
  { value: 'severity_high', label: '高严重度' },
  { value: 'updated_at', label: '更新时间' },
]

const fieldClass =
  'h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]'
const labelClass = 'mb-1 block text-[10px] text-[var(--nx-text-muted)]'

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export interface PmoTrafficLightTableProps {
  /** 当前状态筛选（null = 全部）。 */
  filterStatus: TrafficLightStatus | null
  onFilterStatusChange: (status: TrafficLightStatus | null) => void
  sort: PortfolioTrafficLightSortKey
  onSortChange: (sort: PortfolioTrafficLightSortKey) => void
  order: 'asc' | 'desc'
  onOrderToggle: () => void
  page: number
  onPageChange: (page: number) => void
  /** 复核按钮显隐（工作台按 portfolio:manage 判定传入）。 */
  canReview: boolean
  onReview: (item: PortfolioTrafficLightItem) => void
  onOpenProject: (projectId: number) => void
  onBackHome: () => void
}

export function PmoTrafficLightTable({
  filterStatus,
  onFilterStatusChange,
  sort,
  onSortChange,
  order,
  onOrderToggle,
  page,
  onPageChange,
  canReview,
  onReview,
  onOpenProject,
  onBackHome,
}: PmoTrafficLightTableProps) {
  const query = React.useMemo(
    () => ({
      page,
      perPage: PORTFOLIO_TRAFFIC_LIGHT_DEFAULT_PER_PAGE,
      sort,
      order,
      filterStatus: filterStatus ?? undefined,
    }),
    [page, sort, order, filterStatus],
  )
  const { data, isLoading, isError, error, refetch } = useTrafficLightList(query)

  const items = data?.data ?? []
  const meta = data?.meta
  const totalPages = meta?.totalPages ?? 1

  const clearFilter = React.useCallback(() => onFilterStatusChange(null), [onFilterStatusChange])
  const retry = React.useCallback(() => void refetch(), [refetch])

  return (
    <div
      data-traffic-table
      className="flex flex-col gap-2.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
    >
      {/* 过滤工具栏：状态 / 排序 / 顺序 */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          <span className={labelClass}>状态</span>
          <select
            data-traffic-filter-status
            value={filterStatus ?? 'all'}
            onChange={(event) => {
              const value = event.target.value
              onFilterStatusChange(value === 'all' ? null : (value as TrafficLightStatus))
            }}
            className={fieldClass}
            aria-label="按交通灯状态筛选"
          >
            <option value="all">全部</option>
            {TRAFFIC_LIGHT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TRAFFIC_LIGHT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={labelClass}>排序</span>
          <select
            data-traffic-filter-sort
            value={sort}
            onChange={(event) => onSortChange(event.target.value as PortfolioTrafficLightSortKey)}
            className={fieldClass}
            aria-label="排序字段"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col">
          <span className={labelClass}>方向</span>
          <button
            type="button"
            data-traffic-filter-order
            aria-label={order === 'desc' ? '当前降序，点击切换升序' : '当前升序，点击切换降序'}
            onClick={onOrderToggle}
            className="flex h-8 items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <ArrowUpDown className="h-3.5 w-3.5" aria-hidden />
            {order === 'desc' ? '降序' : '升序'}
          </button>
        </div>
        <div className="ml-auto pb-0.5 text-[11px] text-[var(--nx-text-muted)]">
          {meta && !isLoading ? `第 ${meta.page}/${totalPages} 页 · 共 ${meta.total} 条` : '\u00a0'}
        </div>
      </div>

      {/* 加载骨架（几何匹配，杜绝空态闪烁） */}
      {isLoading ? (
        <div
          data-traffic-skeleton
          role="status"
          aria-label="红绿灯列表加载中"
          aria-busy="true"
          className="space-y-1.5"
        >
          {Array.from({ length: 5 }).map((_, row) => (
            <div
              key={row}
              className="grid grid-cols-[36px_minmax(180px,1.6fr)_repeat(3,minmax(90px,0.9fr))_minmax(110px,0.8fr)_120px] items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2.5"
            >
              {Array.from({ length: 7 }).map((__, col) => (
                <div
                  key={col}
                  className={cn(
                    'h-3 animate-pulse rounded bg-[var(--nx-bg-1)]',
                    col === 0 && 'h-3.5 w-3.5',
                  )}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {/* 错误卡（5xx/网络可重试） */}
      {isError ? (
        <div
          data-traffic-error
          role="alert"
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-xs text-[var(--nx-text-secondary)]">
            红绿灯数据加载失败：{error instanceof Error ? error.message : '未知错误'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-traffic-retry
              onClick={retry}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              重新加载
            </button>
            <button
              type="button"
              data-traffic-back-home
              onClick={onBackHome}
              className="h-8 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)]"
            >
              返回角色首页
            </button>
          </div>
        </div>
      ) : null}

      {/* 语义空态 */}
      {!isLoading && !isError && items.length === 0 ? (
        <div
          data-traffic-empty
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <CircleDot className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs font-medium text-[var(--nx-text-primary)]">
            {filterStatus
              ? `没有「${TRAFFIC_LIGHT_STATUS_LABELS[filterStatus]}」项目`
              : '暂无项目数据'}
          </p>
          {filterStatus ? (
            <button
              type="button"
              data-traffic-empty-clear
              onClick={clearFilter}
              className="rounded-md border border-[var(--nx-border-hairline)] px-3 py-1.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
            >
              清除状态筛选
            </button>
          ) : (
            <p className="text-[11px] text-[var(--nx-text-muted)]">
              当前组织尚未生成组合红绿灯评分，请稍后重试或检查项目数据源。
            </p>
          )}
        </div>
      ) : null}

      {/* 高密度数据表 */}
      {!isLoading && !isError && items.length > 0 ? (
        <div data-traffic-list className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)] text-[10px] uppercase tracking-wide text-[var(--nx-text-muted)]">
                <th className="px-2.5 py-2 font-medium">灯色</th>
                <th className="px-2.5 py-2 font-medium">项目名称</th>
                <th className="px-2.5 py-2 font-medium">触发规则</th>
                <th className="px-2.5 py-2 font-medium">严重度</th>
                <th className="px-2.5 py-2 font-medium">更新时间</th>
                <th className="px-2.5 py-2 font-medium">复核</th>
                <th className="px-2.5 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <TrafficLightRow
                  key={item.projectId}
                  item={item}
                  canReview={canReview}
                  onReview={onReview}
                  onOpenProject={onOpenProject}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* 分页 */}
      {!isLoading && !isError && meta && totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-[11px] text-[var(--nx-text-muted)]">
          <button
            type="button"
            data-traffic-prev-page
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
            className="h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:opacity-40"
          >
            上一页
          </button>
          <span data-traffic-page-indicator>
            {meta.page} / {totalPages}
          </span>
          <button
            type="button"
            data-traffic-next-page
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** 单个红绿灯项目行。 */
function TrafficLightRow({
  item,
  canReview,
  onReview,
  onOpenProject,
}: {
  item: PortfolioTrafficLightItem
  canReview: boolean
  onReview: (item: PortfolioTrafficLightItem) => void
  onOpenProject: (projectId: number) => void
}) {
  const contributingRules = item.evidence.filter((entry) => entry.contributing)
  const shownRules = contributingRules.slice(0, 4)
  const hiddenRuleCount = Math.max(0, contributingRules.length - shownRules.length)
  const reviewVisible = item.reviewState.reviewedAt !== null

  return (
    <tr
      data-traffic-row={item.projectId}
      data-traffic-status={item.trafficLight}
      onClick={() => onOpenProject(item.projectId)}
      className="cursor-pointer border-b border-[var(--nx-border-hairline)] transition-colors last:border-b-0 hover:bg-[rgba(56,189,248,0.05)]"
    >
      {/* 灯色：色块 + 文字双通道 */}
      <td className="px-2.5 py-2.5">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: STATUS_COLOR[item.trafficLight] }}
          />
          <span className="text-xs text-[var(--nx-text-primary)]">
            {TRAFFIC_LIGHT_STATUS_LABELS[item.trafficLight]}
          </span>
        </span>
      </td>

      {/* 项目名称 + 提示徽标 */}
      <td className="px-2.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="max-w-[220px] truncate text-xs font-medium text-[var(--nx-text-primary)]">
            {item.projectName}
          </span>
          {item.sourceFreshness.overallStale ? (
            <span
              data-traffic-stale
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-[rgba(245,158,11,0.4)] px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)]"
            >
              数据过期
            </span>
          ) : null}
          {item.warnings.length > 0 ? (
            <span
              data-traffic-warnings={item.warnings.length}
              title={item.warnings.map((warning) => warning.message).join('；')}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
            >
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {item.warnings.length} 提示
            </span>
          ) : null}
        </div>
      </td>

      {/* 触发规则（contributing evidence，规则 ID + 严重度色带） */}
      <td className="px-2.5 py-2.5">
        <div className="flex max-w-[260px] flex-wrap items-center gap-1">
          {shownRules.map((entry) => {
            const severity = SEVERITY_META[entry.severity]
            return (
              <span
                key={`${entry.ruleId}:${entry.message}`}
                data-traffic-rule={entry.ruleId}
                title={entry.message}
                className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px]"
                style={{
                  color: severity.color,
                  borderColor: severity.color,
                  backgroundColor: 'var(--nx-bg-0)',
                }}
              >
                {entry.ruleId}
                <span className="font-sans text-[9px] opacity-80">{severity.label}</span>
              </span>
            )
          })}
          {hiddenRuleCount > 0 ? (
            <span
              data-traffic-rules-more={hiddenRuleCount}
              className="text-[10px] text-[var(--nx-text-muted)]"
            >
              +{hiddenRuleCount}
            </span>
          ) : null}
        </div>
      </td>

      {/* 严重度计数 */}
      <td className="px-2.5 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {(['critical', 'high', 'medium'] as const).map((level) =>
            item.severityCounts[level] > 0 ? (
              <span
                key={level}
                data-traffic-severity={level}
                className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px]"
                style={{
                  color: SEVERITY_META[level].color,
                  border: `1px solid ${SEVERITY_META[level].color}`,
                  backgroundColor: 'var(--nx-bg-0)',
                }}
              >
                {SEVERITY_META[level].label}
                {item.severityCounts[level]}
              </span>
            ) : null,
          )}
          {item.severityCounts.critical === 0 &&
          item.severityCounts.high === 0 &&
          item.severityCounts.medium === 0 ? (
            <span className="text-[10px] text-[var(--nx-text-muted)]">—</span>
          ) : null}
        </div>
      </td>

      {/* 更新时间 */}
      <td className="px-2.5 py-2.5 font-mono text-[11px] text-[var(--nx-text-secondary)]">
        <span data-traffic-updated>{formatDateTime(item.calculatedAt)}</span>
      </td>

      {/* 复核状态 */}
      <td className="px-2.5 py-2.5">
        {reviewVisible ? (
          <span
            data-traffic-review-state
            className={cn(
              'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px]',
              item.reviewState.stale
                ? 'border-[rgba(245,158,11,0.4)] text-[var(--nx-status-warning)]'
                : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
            )}
          >
            {TRAFFIC_LIGHT_REVIEW_STATE_LABELS[item.reviewState.reviewState]}
            {item.reviewState.stale ? '（已过期）' : ''}
          </span>
        ) : (
          <span className="text-[10px] text-[var(--nx-text-muted)]">未复核</span>
        )}
      </td>

      {/* 操作 */}
      <td className="px-2.5 py-2.5 text-right">
        <div
          className="flex items-center justify-end gap-1.5"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            data-open-project={item.projectId}
            aria-label={`进入项目空间：${item.projectName}`}
            onClick={() => onOpenProject(item.projectId)}
            className="h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            查看
          </button>
          {canReview && item.allowedActions.canReview !== false ? (
            <button
              type="button"
              data-review-button={item.projectId}
              aria-label={`复核项目：${item.projectName}`}
              onClick={() => onReview(item)}
              className="h-7 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              复核
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

export default PmoTrafficLightTable
