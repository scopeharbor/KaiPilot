'use client'

import * as React from 'react'
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Inbox,
  Loader2,
  Search,
  ShieldAlert,
} from 'lucide-react'
import { useMultiProjectImpactSnapshots } from '@/hooks/use-multi-project-impact-analysis'
import { cn } from '@/lib/utils'
import type {
  MultiProjectImpactListQuery,
  MultiProjectImpactSeverity,
  MultiProjectImpactSnapshot,
  MultiProjectImpactSnapshotStatus,
} from '@aiproj/types'
import {
  MULTI_PROJECT_IMPACT_SEVERITIES,
  MULTI_PROJECT_IMPACT_SNAPSHOT_STATUSES,
  MULTI_PROJECT_IMPACT_SOURCE_TYPES,
} from '@aiproj/types'

// ─── URL 过滤契约（复用旧轨 /pmo/impact-analysis 序列化/反序列化口径）──────────

/** URL query 是外部输入，不能直接 as 成字面量联合：非法值丢弃回落「不过滤」。 */
function narrowTo<T extends string>(allowed: readonly T[], raw: string | null): T | undefined {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined
}

export function serializeImpactFilters(query: MultiProjectImpactListQuery): string {
  const p = new URLSearchParams()
  if (query.projectIds?.length) p.set('projectIds', query.projectIds.join(','))
  if (query.sourceType) p.set('sourceType', query.sourceType)
  if (query.severity) p.set('severity', query.severity)
  if (query.isStale !== undefined) p.set('isStale', String(query.isStale))
  if (query.status) p.set('status', query.status)
  if (query.sort) p.set('sort', query.sort)
  if (query.page && query.page > 1) p.set('page', String(query.page))
  return p.toString()
}

export function deserializeImpactFilters(sp: URLSearchParams): MultiProjectImpactListQuery {
  return {
    organizationId: 0,
    projectIds: sp.get('projectIds')?.split(',').map(Number).filter(Boolean) ?? undefined,
    sourceType: narrowTo(MULTI_PROJECT_IMPACT_SOURCE_TYPES, sp.get('sourceType')),
    severity: narrowTo(MULTI_PROJECT_IMPACT_SEVERITIES, sp.get('severity')),
    isStale: sp.has('isStale') ? sp.get('isStale') === 'true' : undefined,
    status: narrowTo(MULTI_PROJECT_IMPACT_SNAPSHOT_STATUSES, sp.get('status')),
    sort: sp.get('sort') ?? undefined,
    page: sp.get('page') ? Number(sp.get('page')) : undefined,
  }
}

/** 过滤条件是否处于「无任何过滤」的默认态（供清除筛选按钮显隐）。 */
export function hasActiveImpactFilters(query: MultiProjectImpactListQuery): boolean {
  return Boolean(
    query.projectIds?.length ||
    query.sourceType ||
    query.severity ||
    query.status ||
    query.isStale !== undefined ||
    query.sort,
  )
}

// ─── 状态/严重度双通道元数据 ─────────────────────────────────────────

export const IMPACT_STATUS_META: Record<
  MultiProjectImpactSnapshotStatus,
  { label: string; tone: string }
> = {
  pending: { label: '等待中', tone: 'text-[var(--nx-text-muted)]' },
  running: { label: '运行中', tone: 'text-[var(--nx-accent)]' },
  completed: { label: '已完成', tone: 'text-[var(--nx-status-success)]' },
  failed: { label: '失败', tone: 'text-[var(--nx-status-danger)]' },
  stale: { label: '已过期', tone: 'text-[var(--nx-status-warning)]' },
}

export const IMPACT_SEVERITY_META: Record<
  MultiProjectImpactSeverity,
  { label: string; tone: string }
> = {
  blocker: { label: '阻断', tone: 'text-[var(--nx-status-danger)]' },
  critical: { label: '危急', tone: 'text-[var(--nx-chart-5)]' },
  high: { label: '高', tone: 'text-[var(--nx-status-warning)]' },
  medium: { label: '中', tone: 'text-[var(--nx-text-secondary)]' },
  low: { label: '低', tone: 'text-[var(--nx-chart-6)]' },
  none: { label: '无', tone: 'text-[var(--nx-text-muted)]' },
}

export const IMPACT_STATUS_OPTIONS: ReadonlyArray<{
  value: MultiProjectImpactSnapshotStatus
  label: string
}> = MULTI_PROJECT_IMPACT_SNAPSHOT_STATUSES.map((value) => ({
  value,
  label: IMPACT_STATUS_META[value].label,
}))

export const IMPACT_SEVERITY_OPTIONS: ReadonlyArray<{
  value: MultiProjectImpactSeverity
  label: string
}> = MULTI_PROJECT_IMPACT_SEVERITIES.map((value) => ({
  value,
  label: IMPACT_SEVERITY_META[value].label,
}))

/** 从严重度分布取最高档（无 >0 时回落 none）。 */
export function topSeverityOf(
  distribution: Record<MultiProjectImpactSeverity, number>,
): MultiProjectImpactSeverity {
  for (const level of MULTI_PROJECT_IMPACT_SEVERITIES) {
    if ((distribution[level] ?? 0) > 0) return level
  }
  return 'none'
}

export interface PmoImpactSnapshotListProps {
  organizationId: number
  /** URL 反序列化后的过滤契约（含占位 organizationId: 0）。 */
  filters: MultiProjectImpactListQuery
  selectedSnapshotId: number | null
  onSelectSnapshot: (snapshotId: number) => void
  onFiltersChange: (next: Partial<MultiProjectImpactListQuery>) => void
  onClearFilters: () => void
}

/**
 * 影响分析快照列表与过滤工具栏（v3-ui-next-pmo-domain W8 · tasks 8.2，
 * spec「多项目影响分析工作台」快照生命周期）。
 *
 * - 消费 `useMultiProjectImpactSnapshots`（信封形态 data/meta 直接读取）；
 * - 过滤工具栏：状态 / 严重度（影响维度收敛口径，与旧页等价）/ 仅过期 /
 *   项目范围（Enter 提交），全部经 onFiltersChange 写回 URL；
 * - 状态与严重度一律「色标 + 文字」双通道；脱敏端点不呈现任何猜测值；
 * - 三态闭环：几何骨架（aria-busy）/ 语义化空态与筛选无结果 / 404·403 中性
 *   受限态 vs 5xx 可重试；分页经 URL page 参数。
 */
export function PmoImpactSnapshotList({
  organizationId,
  filters,
  selectedSnapshotId,
  onSelectSnapshot,
  onFiltersChange,
  onClearFilters,
}: PmoImpactSnapshotListProps) {
  const { data, isLoading, isError, error, refetch } = useMultiProjectImpactSnapshots(
    organizationId,
    filters,
  )

  // 项目范围（自由输入，Enter/失焦提交，避免每键写 URL）
  const scopeDraftKey = filters.projectIds?.join(',') ?? ''
  const [scopeDraft, setScopeDraft] = React.useState(scopeDraftKey)
  React.useEffect(() => {
    setScopeDraft(scopeDraftKey)
  }, [scopeDraftKey])

  const snapshots = data?.data ?? []
  const meta = data?.meta ?? null
  const hasFilters = hasActiveImpactFilters(filters)
  const totalPages = meta?.totalPages ?? 0
  const currentPage = meta?.page ?? filters.page ?? 1
  const showNoResults = snapshots.length === 0 && hasFilters

  const commitScope = () => {
    const ids = scopeDraft
      .split(',')
      .map((token) => Number(token.trim()))
      .filter((id) => Number.isInteger(id) && id > 0)
    onFiltersChange(ids.length > 0 ? { projectIds: ids } : { projectIds: undefined })
  }

  const selectClass =
    'h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none'

  const shellClass = 'flex flex-col gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-4'

  if (isLoading) {
    return (
      <section
        data-imp-list
        data-imp-list-loading
        role="status"
        aria-busy="true"
        aria-label="影响分析快照列表加载中"
        className={shellClass}
      >
        <div className="h-5 w-72 rounded bg-[var(--nx-bg-1)]" />
        <div className="h-8 rounded bg-[var(--nx-bg-1)]" />
        {[1, 2, 3].map((index) => (
          <div key={index} className="h-14 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
        ))}
      </section>
    )
  }

  if (isError) {
    const status = (error as { status?: number } | undefined)?.status
    const restricted = status === 403 || status === 404
    return (
      <section data-imp-list data-imp-list-error className={shellClass}>
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-8 py-12 text-center"
        >
          <ShieldAlert
            className={cn(
              'h-7 w-7',
              restricted ? 'text-[var(--nx-text-muted)]' : 'text-[var(--nx-status-warning)]',
            )}
            aria-hidden
          />
          <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">
            {restricted ? '影响分析数据不可用' : '快照列表加载失败'}
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            {restricted
              ? '当前组织上下文不可用或会话无权访问该数据。'
              : '影响分析快照暂时无法加载，请稍后重试。'}
          </p>
          {!restricted ? (
            <button
              type="button"
              data-imp-list-retry
              onClick={() => void refetch()}
              className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <Loader2 className="h-3.5 w-3.5" aria-hidden />
              重新载入
            </button>
          ) : null}
        </div>
      </section>
    )
  }

  return (
    <section data-imp-list className={shellClass}>
      {/* 过滤工具栏 */}
      <div
        data-imp-filter-bar
        className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--nx-text-muted)]">状态</span>
          <select
            data-imp-status-filter
            aria-label="按状态筛选快照"
            className={selectClass}
            value={filters.status ?? ''}
            onChange={(event) => {
              const raw = event.target.value
              onFiltersChange({
                status: (raw === '' ? undefined : raw) as
                  MultiProjectImpactSnapshotStatus | undefined,
              })
            }}
          >
            <option value="">全部状态</option>
            {IMPACT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--nx-text-muted)]">影响程度</span>
          <select
            data-imp-severity-filter
            aria-label="按影响程度筛选快照"
            className={selectClass}
            value={filters.severity ?? ''}
            onChange={(event) => {
              const raw = event.target.value
              onFiltersChange({
                severity: (raw === '' ? undefined : raw) as MultiProjectImpactSeverity | undefined,
              })
            }}
          >
            <option value="">全部程度</option>
            {IMPACT_SEVERITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-[var(--nx-text-secondary)]">
          <input
            data-imp-stale-filter
            type="checkbox"
            checked={filters.isStale === true}
            onChange={(event) =>
              onFiltersChange({ isStale: event.target.checked ? true : undefined })
            }
            className="h-3.5 w-3.5 accent-[var(--nx-accent)]"
          />
          仅看已过期
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--nx-text-muted)]">项目范围（ID，逗号分隔）</span>
          <div className="flex items-center gap-1">
            <Search className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
            <input
              data-imp-project-scope-input
              type="text"
              placeholder="如 1,2,3（Enter 应用）"
              value={scopeDraft}
              onChange={(event) => setScopeDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitScope()
              }}
              onBlur={commitScope}
              className={cn(selectClass, 'w-44 font-mono')}
            />
          </div>
        </label>
        {hasFilters ? (
          <button
            type="button"
            data-imp-clear-filters
            onClick={onClearFilters}
            className="mb-0.5 flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            清除筛选
          </button>
        ) : null}
      </div>

      {/* 空态 */}
      {snapshots.length === 0 && !showNoResults ? (
        <div
          data-imp-list-empty
          role="status"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] px-8 py-12 text-center"
        >
          <Inbox className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm font-medium text-[var(--nx-text-primary)]">暂无影响分析快照</p>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            请在上方「创建分析计划」中选定项目范围并运行分析，生成的首个快照会出现在这里。
          </p>
        </div>
      ) : null}

      {/* 筛选无匹配 */}
      {showNoResults ? (
        <div
          data-imp-no-results
          role="status"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] px-8 py-10 text-center"
        >
          <p className="text-sm font-medium text-[var(--nx-text-primary)]">
            没有符合当前筛选的快照记录
          </p>
          <button
            type="button"
            data-imp-no-results-clear
            onClick={onClearFilters}
            className="flex h-9 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            清除筛选
          </button>
        </div>
      ) : null}

      {/* 表格 */}
      {snapshots.length > 0 ? (
        <div data-imp-table-wrap className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)] text-left text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
                <th scope="col" className="py-2 pr-3 font-medium">
                  快照
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  状态
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  受影响端点
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  最高影响
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  阻断
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  范围
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  生成时间
                </th>
                <th scope="col" className="py-2 font-medium">
                  操作
                </th>
              </tr>
            </thead>
            <tbody data-imp-list-rows>
              {snapshots.map((snapshot) => (
                <SnapshotRow
                  key={snapshot.id}
                  snapshot={snapshot}
                  selected={selectedSnapshotId === snapshot.id}
                  onSelect={onSelectSnapshot}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* 分页（meta 不存在/单页不渲染） */}
      {meta !== null && totalPages > 1 ? (
        <nav
          className="flex items-center justify-between border-t border-[var(--nx-border-hairline)] pt-3"
          aria-label="快照分页"
          data-imp-pagination
        >
          <span className="text-[11px] text-[var(--nx-text-muted)]">
            共 {meta.total} 条 · 第 {currentPage}/{totalPages} 页
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              data-imp-prev-page
              disabled={currentPage <= 1}
              onClick={() => onFiltersChange({ page: currentPage - 1 })}
              className="flex h-8 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              上一页
            </button>
            <button
              type="button"
              data-imp-next-page
              disabled={currentPage >= totalPages}
              onClick={() => onFiltersChange({ page: currentPage + 1 })}
              className="flex h-8 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一页
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </nav>
      ) : null}
    </section>
  )
}

function SnapshotRow({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: MultiProjectImpactSnapshot
  selected: boolean
  onSelect: (snapshotId: number) => void
}) {
  const statusMeta = IMPACT_STATUS_META[snapshot.status]
  const top = topSeverityOf(snapshot.propagationSummary.severityDistribution)
  const severityMeta = IMPACT_SEVERITY_META[top]
  const redactedCount = snapshot.propagationSummary.propagationPaths.reduce(
    (sum, path) =>
      sum + path.affectedEndpoints.filter((endpoint) => endpoint.visibility !== 'visible').length,
    0,
  )
  const scopeLabel =
    snapshot.sourceSummary.projectCount !== undefined && snapshot.sourceSummary.projectCount > 0
      ? `${snapshot.sourceSummary.projectCount} 项目`
      : snapshot.sourceSummary.sourceCount !== undefined && snapshot.sourceSummary.sourceCount > 0
        ? `${snapshot.sourceSummary.sourceCount} 源点`
        : '—'

  return (
    <tr
      data-imp-snapshot-row={snapshot.id}
      data-selected={selected || undefined}
      className={cn(
        'border-b border-[var(--nx-border-hairline)] transition-colors last:border-b-0',
        selected ? 'bg-[var(--nx-space-surface)]' : 'hover:bg-[var(--nx-bg-1)]',
      )}
    >
      <td className="py-2.5 pr-3">
        <span className="font-mono text-[var(--nx-text-primary)]">#{snapshot.id}</span>
        {snapshot.isStale ? (
          <span
            data-imp-stale-chip
            className="ml-2 inline-flex items-center gap-1 rounded-sm border border-[var(--nx-status-warning)]/40 px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)]"
          >
            已过期
          </span>
        ) : null}
      </td>
      <td className="py-2.5 pr-3">
        <span
          data-imp-status-chip
          data-status={snapshot.status}
          className={cn('inline-flex items-center gap-1.5', statusMeta.tone)}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {statusMeta.label}
        </span>
      </td>
      <td className="py-2.5 pr-3 text-right font-mono text-[var(--nx-text-primary)]">
        {snapshot.propagationSummary.totalAffectedEndpoints}
      </td>
      <td className="py-2.5 pr-3">
        <span
          data-imp-severity-chip
          className={cn('inline-flex items-center gap-1.5', severityMeta.tone)}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {severityMeta.label}
        </span>
      </td>
      <td className="py-2.5 pr-3 text-right font-mono text-[var(--nx-text-primary)]">
        {snapshot.propagationSummary.blockedEndpoints}
      </td>
      <td className="py-2.5 pr-3 text-[var(--nx-text-secondary)]">
        {scopeLabel}
        {redactedCount > 0 ? (
          <span
            data-imp-redacted-count
            className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-[var(--nx-text-muted)]"
          >
            <EyeOff className="h-3 w-3" aria-hidden />
            {redactedCount}
          </span>
        ) : null}
      </td>
      <td className="py-2.5 pr-3 font-mono text-[11px] text-[var(--nx-text-secondary)]">
        {new Date(snapshot.generatedAt).toLocaleString('zh-CN')}
      </td>
      <td className="py-2.5">
        <button
          type="button"
          data-imp-row-detail
          aria-label={`查看快照 ${snapshot.id} 详情`}
          onClick={() => onSelect(snapshot.id)}
          className="flex h-7 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          {selected ? '查看中' : '详情'}
        </button>
      </td>
    </tr>
  )
}

export default PmoImpactSnapshotList
