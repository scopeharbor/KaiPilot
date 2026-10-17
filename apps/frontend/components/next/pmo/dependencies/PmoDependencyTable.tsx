'use client'

import * as React from 'react'
import {
  AlertTriangle,
  Archive,
  ChevronLeft,
  ChevronRight,
  Eye,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useMpdList } from '@/hooks/use-multi-project-dependencies'
import type { DepListFilters } from '@aiproj/types'
import {
  DEPENDENCY_CATEGORIES,
  DEPENDENCY_RISK_LEVELS,
  DEPENDENCY_STATUSES,
  DEPENDENCY_TYPES,
  ENDPOINT_TYPES,
  SOURCE_MODES,
} from '@aiproj/types'
import { cn } from '@/lib/utils'
import {
  categoryLabel,
  dependencyTypeLabel,
  endpointTypeLabel,
  formatMpdDateTime,
  normalizeMpdListPayload,
  sourceModeLabel,
  type MpdRowView,
} from './mpd-adapter'
import { MpdFreshnessChip, MpdRiskBadge, MpdStatusBadge } from './MpdBadges'

/**
 * 依赖底册表格与过滤工具栏（v3-ui-next-pmo-domain W7 · tasks 7.2）。
 *
 * - 工具栏维度：endpointType / category / type / status / riskLevel / sourceMode /
 *   freshness / dateFrom / dateTo / search（镜像后端 list 验证器真实参数集）；
 * - 过滤值为单选（高密度操作面），服务端真实语义裁决；筛选变更重置页码；
 * - 行：DepLifecycleStatus / DepRiskLevel 双通道徽标 + 新鲜度 + 更新时间；
 * - 操作列：详情（行点击同语义）恒有；编辑/归档/恢复/删除仅 `portfolio:manage`
 *   代理的写用户可见（Design D5；服务端 isOrgAdmin 终裁）；
 * - 三态：骨架（aria-busy）/ 错误重试卡 / 语义化空态（无数据 vs 筛选无匹配）。
 */

export interface MpdToolbarFilterValues {
  search: string
  endpointType: string
  category: string
  type: string
  status: string
  riskLevel: string
  sourceMode: string
  freshness: string
  dateFrom: string
  dateTo: string
}

export interface MpdListControlValues {
  page: number
  perPage: number
  /** 排序：'-createdAt' 形态（负号 = 降序），与后端 sort 契约一致。 */
  sort: string
}

export type MpdListFilters = MpdToolbarFilterValues & MpdListControlValues

export const MPD_EMPTY_FILTERS: MpdToolbarFilterValues = {
  search: '',
  endpointType: '',
  category: '',
  type: '',
  status: '',
  riskLevel: '',
  sourceMode: '',
  freshness: '',
  dateFrom: '',
  dateTo: '',
}

export type MpdRowAction = 'archive' | 'restore' | 'delete'

export interface PmoDependencyTableProps {
  organizationId: number
  filters: MpdListFilters
  onPatchFilters: (patch: Partial<MpdToolbarFilterValues>) => void
  onPageChange: (page: number) => void
  onSortFieldChange: (field: string) => void
  onSortOrderToggle: () => void
  canManage: boolean
  onRowOpen: (row: MpdRowView) => void
  onEditRow: (row: MpdRowView) => void
  onLifecycleAction: (action: MpdRowAction, row: MpdRowView) => void
}

const STATUS_ACTIVE_LIKE = new Set(['active', 'draft', 'at_risk', 'blocked', 'resolved'])

export function lifecycleActionsFor(status: string): MpdRowAction[] {
  if (status === 'archived') return ['restore', 'delete']
  if (STATUS_ACTIVE_LIKE.has(status)) return ['archive']
  return []
}

const SORT_OPTIONS = [
  { value: 'createdAt', label: '创建时间' },
  { value: 'updatedAt', label: '更新时间' },
  { value: 'status', label: '状态' },
  { value: 'riskLevel', label: '风险等级' },
  { value: 'category', label: '分类' },
  { value: 'freshnessCheckedAt', label: '新鲜度检查' },
]

export function serializeMpdListParams(filters: MpdListFilters): DepListFilters {
  const params: Record<string, unknown> = {
    page: filters.page,
    perPage: filters.perPage,
    sort: filters.sort || '-createdAt',
  }
  if (filters.search.trim() !== '') params.search = filters.search.trim()
  if (filters.endpointType) params.endpointType = filters.endpointType
  if (filters.category) params.category = filters.category
  if (filters.type) params.type = filters.type
  if (filters.status) params.status = [filters.status]
  if (filters.riskLevel) params.riskLevel = filters.riskLevel
  if (filters.sourceMode) params.sourceMode = filters.sourceMode
  if (filters.freshness) params.freshness = filters.freshness
  if (filters.dateFrom) params.dateFrom = filters.dateFrom
  if (filters.dateTo) params.dateTo = filters.dateTo
  return params as unknown as DepListFilters
}

export function hasActiveToolbarFilters(filters: MpdToolbarFilterValues): boolean {
  return Object.values(filters).some((value) => value !== '')
}

export function PmoDependencyTable({
  organizationId,
  filters,
  onPatchFilters,
  onPageChange,
  onSortFieldChange,
  onSortOrderToggle,
  canManage,
  onRowOpen,
  onEditRow,
  onLifecycleAction,
}: PmoDependencyTableProps) {
  const query = useMpdList(organizationId, serializeMpdListParams(filters))
  const view = normalizeMpdListPayload(query.data)
  const rows = view.rows
  const meta = view.meta

  const sortField = filters.sort.startsWith('-') ? filters.sort.slice(1) : filters.sort
  const sortDesc = filters.sort.startsWith('-')
  const filtered = hasActiveToolbarFilters(filters)

  const isLoading = query.isLoading
  const isError = query.isError
  const errorCode = (query.error as { code?: string } | null)?.code ?? null
  const isFeatureDisabled = errorCode === 'FEATURE_DISABLED'
  const errorMessage = (query.error as { message?: string } | null)?.message ?? null

  const toolbarSelectClass =
    'h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] focus:border-[var(--nx-border-focus)] focus:outline-none'
  const toolbarInputClass =
    'h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-secondary)] transition-colors placeholder:text-[var(--nx-text-muted)] hover:border-[var(--nx-border-focus)] focus:border-[var(--nx-border-focus)] focus:outline-none'

  return (
    <section data-mpd-table className="flex flex-col gap-3">
      {/* ── 过滤工具栏 ── */}
      <div
        data-mpd-filterbar
        className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-2.5"
      >
        <label className="relative">
          <span className="sr-only">搜索依赖</span>
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-text-muted)]"
            aria-hidden
          />
          <input
            type="search"
            data-mpd-filter-search
            value={filters.search}
            placeholder="搜索端点/外部标签"
            onChange={(event) => onPatchFilters({ search: event.target.value })}
            className={cn(toolbarInputClass, 'w-52 pl-7')}
          />
        </label>

        <select
          data-mpd-filter-endpoint-type
          aria-label="端点类型筛选"
          value={filters.endpointType}
          onChange={(event) => onPatchFilters({ endpointType: event.target.value })}
          className={toolbarSelectClass}
        >
          <option value="">全部端点</option>
          {ENDPOINT_TYPES.map((value) => (
            <option key={value} value={value}>
              {endpointTypeLabel(value)}
            </option>
          ))}
        </select>

        <select
          data-mpd-filter-category
          aria-label="分类筛选"
          value={filters.category}
          onChange={(event) => onPatchFilters({ category: event.target.value })}
          className={toolbarSelectClass}
        >
          <option value="">全部分类</option>
          {DEPENDENCY_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {categoryLabel(value)}
            </option>
          ))}
        </select>

        <select
          data-mpd-filter-type
          aria-label="依赖类型筛选"
          value={filters.type}
          onChange={(event) => onPatchFilters({ type: event.target.value })}
          className={toolbarSelectClass}
        >
          <option value="">全部类型</option>
          {DEPENDENCY_TYPES.map((value) => (
            <option key={value} value={value}>
              {dependencyTypeLabel(value)}
            </option>
          ))}
        </select>

        <select
          data-mpd-filter-status
          aria-label="状态筛选"
          value={filters.status}
          onChange={(event) => onPatchFilters({ status: event.target.value })}
          className={toolbarSelectClass}
        >
          <option value="">全部状态</option>
          {DEPENDENCY_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        <select
          data-mpd-filter-risk
          aria-label="风险等级筛选"
          value={filters.riskLevel}
          onChange={(event) => onPatchFilters({ riskLevel: event.target.value })}
          className={toolbarSelectClass}
        >
          <option value="">全部风险</option>
          {DEPENDENCY_RISK_LEVELS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        <select
          data-mpd-filter-source-mode
          aria-label="来源模式筛选"
          value={filters.sourceMode}
          onChange={(event) => onPatchFilters({ sourceMode: event.target.value })}
          className={toolbarSelectClass}
        >
          <option value="">全部来源</option>
          {SOURCE_MODES.map((value) => (
            <option key={value} value={value}>
              {sourceModeLabel(value)}
            </option>
          ))}
        </select>

        <select
          data-mpd-filter-freshness
          aria-label="新鲜度筛选"
          value={filters.freshness}
          onChange={(event) => onPatchFilters({ freshness: event.target.value })}
          className={toolbarSelectClass}
        >
          <option value="">全部新鲜度</option>
          <option value="fresh">新鲜</option>
          <option value="stale">过期</option>
        </select>

        <label className="flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]">
          从
          <input
            type="date"
            data-mpd-filter-date-from
            value={filters.dateFrom}
            onChange={(event) => onPatchFilters({ dateFrom: event.target.value })}
            className={cn(toolbarInputClass, 'w-36')}
          />
        </label>
        <label className="flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]">
          至
          <input
            type="date"
            data-mpd-filter-date-to
            value={filters.dateTo}
            onChange={(event) => onPatchFilters({ dateTo: event.target.value })}
            className={cn(toolbarInputClass, 'w-36')}
          />
        </label>

        {filtered ? (
          <button
            type="button"
            data-mpd-filter-clear
            onClick={() => onPatchFilters({ ...MPD_EMPTY_FILTERS })}
            className="flex h-8 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-status-danger)] hover:text-[var(--nx-status-danger)]"
          >
            <X className="h-3 w-3" aria-hidden />
            清除筛选
          </button>
        ) : null}
      </div>

      {/* ── 排序与计数行 ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select
            data-mpd-sort-field
            aria-label="排序字段"
            value={sortField}
            onChange={(event) => onSortFieldChange(event.target.value)}
            className={toolbarSelectClass}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                按{option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-mpd-sort-order
            aria-label={sortDesc ? '切换为升序' : '切换为降序'}
            onClick={onSortOrderToggle}
            className="flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 font-mono text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            {sortDesc ? '降序 ↓' : '升序 ↑'}
          </button>
        </div>
        <p data-mpd-table-total className="text-[11px] text-[var(--nx-text-muted)]">
          {meta ? `共 ${meta.total} 条` : rows.length > 0 ? `本页 ${rows.length} 条` : ''}
          {meta && meta.page > 0 ? ` · 第 ${meta.page} 页` : ''}
        </p>
      </div>

      {/* ── 三态 ── */}
      {isLoading ? (
        <div
          data-mpd-table-skeleton
          role="status"
          aria-busy="true"
          aria-label="依赖底册加载中"
          className="space-y-2"
        >
          {[1, 2, 3, 4, 5].map((item) => (
            <div
              key={item}
              className="h-11 animate-pulse rounded-md"
              style={{ backgroundColor: 'var(--nx-bg-1)' }}
            />
          ))}
        </div>
      ) : isError ? (
        <div
          data-mpd-table-error
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <AlertTriangle
            className={cn(
              'h-6 w-6',
              isFeatureDisabled ? 'text-[var(--nx-text-muted)]' : 'text-[var(--nx-status-warning)]',
            )}
            aria-hidden
          />
          <div>
            <p className="text-xs font-medium text-[var(--nx-text-primary)]">
              {isFeatureDisabled ? '跨项目依赖功能未启用' : '依赖底册加载失败'}
            </p>
            <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
              {isFeatureDisabled
                ? '该功能需后端启用（FEATURE_MPD_CRUD）。数据未加载，不会影响其它组合功能。'
                : (errorMessage ?? '网络异常或服务暂不可用，请稍后重试。')}
            </p>
          </div>
          <button
            type="button"
            data-mpd-table-retry
            onClick={() => void query.refetch()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新加载
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div
          data-mpd-table-empty
          className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
        >
          <p className="text-xs font-medium text-[var(--nx-text-primary)]">
            {filtered ? '未找到匹配的依赖记录' : '暂无跨项目依赖记录'}
          </p>
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            {filtered ? '可清除筛选条件后重试。' : '依赖建立后（含检测/手动录入）会出现在此底册。'}
          </p>
          {filtered ? (
            <button
              type="button"
              data-mpd-table-clear-empty
              onClick={() => onPatchFilters({ ...MPD_EMPTY_FILTERS })}
              className="mt-1 flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-accent)]"
            >
              <X className="h-3 w-3" aria-hidden />
              清除筛选条件
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {/* ── 高密度表格 ── */}
          <div className="overflow-x-auto rounded-lg border border-[var(--nx-border-hairline)]">
            <table className="w-full min-w-[960px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
                    提供方 → 消费方
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
                    端点
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
                    依赖类型
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
                    分类
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
                    风险等级
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
                    状态
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
                    新鲜度
                  </th>
                  <th className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
                    更新时间
                  </th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const lifecycleActions = lifecycleActionsFor(row.status)
                  return (
                    <tr
                      key={row.id}
                      data-mpd-row-id={row.id}
                      data-mpd-row-status={row.status}
                      className="group border-b border-[var(--nx-border-hairline)] transition-colors last:border-b-0 hover:bg-[rgba(56,189,248,0.04)]"
                    >
                      <td className="max-w-[220px] px-3 py-2">
                        <button
                          type="button"
                          data-mpd-row-open
                          onClick={() => onRowOpen(row)}
                          className="flex w-full min-w-0 flex-col text-left"
                          aria-label={`查看依赖 ${row.id} 详情`}
                        >
                          <span className="truncate text-xs text-[var(--nx-text-primary)]">
                            <span data-mpd-provider-label>{row.providerLabel}</span>
                            <span className="mx-1 text-[var(--nx-text-muted)]" aria-hidden>
                              →
                            </span>
                            <span data-mpd-consumer-label>{row.consumerLabel}</span>
                          </span>
                          <span className="truncate font-mono text-[9px] text-[var(--nx-text-muted)]">
                            #{row.id}
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-[var(--nx-text-secondary)]">
                        {row.providerType ? endpointTypeLabel(row.providerType) : '—'}
                        <span className="mx-1 text-[var(--nx-text-muted)]" aria-hidden>
                          →
                        </span>
                        {row.consumerType ? endpointTypeLabel(row.consumerType) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-[10px] text-[var(--nx-text-secondary)]">
                          {row.type.toUpperCase()}
                        </span>
                        <span className="ml-1.5 text-[10px] text-[var(--nx-text-muted)]">
                          {dependencyTypeLabel(row.type)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[10px] text-[var(--nx-text-secondary)]">
                        {categoryLabel(row.category)}
                      </td>
                      <td className="px-3 py-2">
                        <MpdRiskBadge value={row.risk} />
                      </td>
                      <td className="px-3 py-2">
                        <MpdStatusBadge value={row.status} />
                      </td>
                      <td className="px-3 py-2">
                        <MpdFreshnessChip
                          value={row.freshness}
                          checkedAt={row.freshnessCheckedAt}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-[var(--nx-text-muted)]">
                        {formatMpdDateTime(row.updatedAt ?? row.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1" data-mpd-row-actions>
                          <button
                            type="button"
                            data-mpd-row-view
                            aria-label="查看详情"
                            onClick={() => onRowOpen(row)}
                            className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-accent)]"
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          {canManage ? (
                            <>
                              {lifecycleActions.includes('archive') ? (
                                <button
                                  type="button"
                                  data-mpd-row-archive
                                  aria-label={`归档依赖 ${row.id}`}
                                  onClick={() => onLifecycleAction('archive', row)}
                                  className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-status-warning)]"
                                >
                                  <Archive className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              ) : null}
                              {lifecycleActions.includes('restore') ? (
                                <button
                                  type="button"
                                  data-mpd-row-restore
                                  aria-label={`恢复依赖 ${row.id}`}
                                  onClick={() => onLifecycleAction('restore', row)}
                                  className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-status-success)]"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              ) : null}
                              {lifecycleActions.includes('delete') ? (
                                <button
                                  type="button"
                                  data-mpd-row-delete
                                  aria-label={`删除依赖 ${row.id}`}
                                  onClick={() => onLifecycleAction('delete', row)}
                                  className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-status-danger)]"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              ) : null}
                              {row.status !== 'deleted' ? (
                                <button
                                  type="button"
                                  data-mpd-row-edit
                                  aria-label={`编辑依赖 ${row.id}`}
                                  onClick={() => onEditRow(row)}
                                  className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-accent)]"
                                >
                                  <PencilLine className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* ── 分页 ── */}
          {meta && meta.totalPages > 1 ? (
            <nav
              data-mpd-pager
              aria-label="依赖列表分页"
              className="flex items-center justify-end gap-2"
            >
              <button
                type="button"
                data-mpd-page-prev
                aria-label="上一页"
                disabled={meta.page <= 1}
                onClick={() => onPageChange(Math.max(1, meta.page - 1))}
                className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" aria-hidden />
                上一页
              </button>
              <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                {meta.page} / {meta.totalPages}
              </span>
              <button
                type="button"
                data-mpd-page-next
                aria-label="下一页"
                disabled={meta.page >= meta.totalPages}
                onClick={() => onPageChange(Math.min(meta.totalPages, meta.page + 1))}
                className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页
                <ChevronRight className="h-3 w-3" aria-hidden />
              </button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  )
}

export default PmoDependencyTable
