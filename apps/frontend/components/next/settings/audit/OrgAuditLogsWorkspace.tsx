'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileClock, FilterX, RefreshCw, ShieldAlert } from 'lucide-react'
import {
  auditLogKeys,
  auditLogsApi,
  type AuditLogEntry,
  type AuditLogFilters,
} from '@/lib/api/audit-logs'
import { actionLabel, entityTypeLabel, eventLabel, severityLabel } from '@/lib/audit-labels'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'

/**
 * 组织审计日志工作区（v3-ui-next-settings-admin-domains W2 · tasks 2.7，
 * spec「组织审计日志检索」）。
 *
 * - 数据 100% 复用既有 `auditLogsApi.list`（`/audit-logs`，与旧轨同一端点与查询键，
 *   RL-04）；组织 scope 由服务端 `AuditLogPolicy.scope(user, ctx.tenant.organizationId)`
 *   按会话组织判定，前端**不传也不允许传** organizationId（RL-05 跨租户枚举面为零）；
 * - 高密度暗黑表格：时间 / 事件 / 操作 / 级别 / 操作人 / 对象 / 结果状态；级别与结果
 *   用「颜色 + 文本」双通道传达（`severityLabel` 中文标注，RL-15 不靠颜色单通道）；
 * - 过滤：事件名 / 操作类型 / 级别 / 起止日期，全部写入本地筛选态（无 URL 依赖，
 *   避免设置空间深层路由被查询串污染）；分页按 `meta.total` / `meta.totalPages`
 *   做上一页 / 下一页翻页，页码进入请求参数；
 * - **只读**：本工作区不渲染任何写控件，也不触发任何非 GET 请求（spec「页面不提供
 *   任何写入口」+ RL-01）；RL-12 只展示后端低敏 DTO 字段，不采集/展示 prompt 与
 *   输出全文（`AuditLogEntry` 契约本身即无全文字段）。
 */

export interface OrgAuditLogsWorkspaceProps {
  className?: string
}

const ACTION_OPTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'export',
  'import',
  'login',
  'logout',
  'approve',
  'reject',
  'ai_generate',
  'apply',
  'rollback',
] as const

const SEVERITY_OPTIONS = ['info', 'warning', 'error', 'critical'] as const

const PER_PAGE = 20

const SEVERITY_BADGE: Record<string, string> = {
  info: 'border-[rgba(148,163,184,0.4)] text-[var(--nx-text-secondary)]',
  warning: 'border-[rgba(245,158,11,0.4)] text-[var(--nx-status-warning)]',
  error: 'border-[rgba(239,68,68,0.4)] text-[var(--nx-status-danger)]',
  critical: 'border-[rgba(239,68,68,0.6)] text-[var(--nx-status-danger)]',
}

/** 操作人显示：实名 → 「用户 #id」→ 「系统」（后端已去代号化，回退不崩）。 */
export function auditActorText(entry: AuditLogEntry): string {
  if (entry.userName) return entry.userName
  if (entry.userId !== null) return `用户 #${entry.userId}`
  return '系统'
}

/** 对象显示：实体实名 → 「中文类型 #id」→ 空占位。 */
export function auditEntityText(entry: AuditLogEntry): string {
  if (entry.entityName) return entry.entityName
  if (!entry.entityType) return '—'
  const label = entityTypeLabel(entry.entityType) || entry.entityType
  return entry.entityId !== null ? `${label} #${entry.entityId}` : label
}

/** 事件/操作合并展示：事件中文优先，回退操作中文，再回退原码（与旧轨一致取径）。 */
export function auditEventText(entry: AuditLogEntry): string {
  return eventLabel(entry.event) || actionLabel(entry.action)
}

export function OrgAuditLogsWorkspace({ className }: OrgAuditLogsWorkspaceProps) {
  const tier = useImmersionTier()
  const [filters, setFilters] = React.useState<AuditLogFilters>({})
  const [page, setPage] = React.useState(1)

  const activeFilters: AuditLogFilters = React.useMemo(
    () => ({ ...filters, page, perPage: PER_PAGE }),
    [filters, page],
  )

  const listQuery = useQuery({
    queryKey: auditLogKeys.list(activeFilters),
    queryFn: () => auditLogsApi.list(activeFilters),
  })

  const patchFilters = (patch: Partial<AuditLogFilters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(1)
  }

  const hasFilters = Object.entries(filters).some(
    ([, value]) =>
      value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0),
  )

  const meta = listQuery.data?.meta
  const rows = listQuery.data?.data ?? []

  const fieldClass =
    'h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none'

  return (
    <div data-org-audit-logs data-immersion={tier} className={cn('flex flex-col gap-4', className)}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <FileClock className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">审计日志</h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              本组织不可篡改的操作流水（仅当前会话组织；只读展示，不采集请求/输出全文）。
            </p>
          </div>
        </div>
        <button
          type="button"
          data-org-audit-refresh
          onClick={() => void listQuery.refetch()}
          disabled={listQuery.isFetching}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5', listQuery.isFetching && 'animate-spin')}
            aria-hidden
          />
          刷新
        </button>
      </header>

      {/* 过滤条：全部为本地筛选态，无 URL 依赖 */}
      <section
        data-org-audit-filters
        aria-label="审计日志过滤"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
      >
        <input
          data-org-audit-filter-event
          aria-label="事件类型"
          placeholder="事件类型（如 ROLE_CHANGED）"
          value={filters.event ?? ''}
          onChange={(event) => patchFilters({ event: event.target.value || undefined })}
          className={cn(fieldClass, 'w-56')}
        />
        <select
          data-org-audit-filter-action
          aria-label="操作类型"
          value={filters.action?.[0] ?? ''}
          onChange={(event) =>
            patchFilters({
              action: event.target.value
                ? [event.target.value as AuditLogEntry['action']]
                : undefined,
            })
          }
          className={fieldClass}
        >
          <option value="">全部操作</option>
          {ACTION_OPTIONS.map((action) => (
            <option key={action} value={action}>
              {actionLabel(action)}
            </option>
          ))}
        </select>
        <select
          data-org-audit-filter-severity
          aria-label="严重级别"
          value={filters.severity?.[0] ?? ''}
          onChange={(event) =>
            patchFilters({
              severity: event.target.value
                ? [event.target.value as AuditLogEntry['severity']]
                : undefined,
            })
          }
          className={fieldClass}
        >
          <option value="">全部级别</option>
          {SEVERITY_OPTIONS.map((severity) => (
            <option key={severity} value={severity}>
              {severityLabel(severity)}
            </option>
          ))}
        </select>
        <input
          data-org-audit-filter-date-from
          aria-label="开始日期"
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={(event) => patchFilters({ dateFrom: event.target.value || undefined })}
          className={fieldClass}
        />
        <span className="text-[11px] text-[var(--nx-text-muted)]">至</span>
        <input
          data-org-audit-filter-date-to
          aria-label="结束日期"
          type="date"
          value={filters.dateTo ?? ''}
          onChange={(event) => patchFilters({ dateTo: event.target.value || undefined })}
          className={fieldClass}
        />
        <input
          data-org-audit-filter-actor
          aria-label="操作人 ID"
          type="number"
          placeholder="操作人 ID"
          value={filters.actorId ?? ''}
          onChange={(event) =>
            patchFilters({ actorId: event.target.value ? Number(event.target.value) : undefined })
          }
          className={cn(fieldClass, 'w-32')}
        />
        {hasFilters ? (
          <button
            type="button"
            data-org-audit-filter-reset
            onClick={() => {
              setFilters({})
              setPage(1)
            }}
            className="flex h-8 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)]"
          >
            <FilterX className="h-3.5 w-3.5" aria-hidden />
            重置
          </button>
        ) : null}
      </section>

      {/* 三态：骨架 / 错误重试 / 空态 / 表格 */}
      {listQuery.isPending ? (
        <AuditTableSkeleton />
      ) : listQuery.isError ? (
        <div
          data-org-audit-error
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-12 text-center"
        >
          <ShieldAlert className="h-7 w-7 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">审计日志加载失败</p>
          <button
            type="button"
            data-org-audit-retry
            onClick={() => void listQuery.refetch()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新载入
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div
          data-org-audit-empty
          className="rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-12 text-center"
        >
          <FileClock className="mx-auto h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="mt-3 text-sm text-[var(--nx-text-secondary)]">
            {hasFilters ? '没有命中的审计记录' : '暂无审计记录'}
          </p>
          <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
            {hasFilters ? '调整或重置过滤条件后重试。' : '组织内的关键操作产生记录后将在此呈现。'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]">
            <table data-org-audit-table className="w-full min-w-[64rem] border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--nx-border-hairline)]">
                  <Th className="w-40">时间</Th>
                  <Th>事件</Th>
                  <Th className="w-24">操作</Th>
                  <Th className="w-24">级别</Th>
                  <Th className="w-36">操作人</Th>
                  <Th className="w-52">对象</Th>
                  <Th className="w-28">结果</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr
                    key={entry.id}
                    data-org-audit-row={entry.id}
                    className="border-b border-[var(--nx-border-hairline)] last:border-b-0"
                  >
                    <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--nx-text-muted)]">
                      {formatAuditTime(entry.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--nx-text-primary)]">
                      {auditEventText(entry)}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--nx-text-secondary)]">
                      {actionLabel(entry.action)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        data-org-audit-severity={entry.id}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px]',
                          SEVERITY_BADGE[entry.severity] ??
                            'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
                        )}
                      >
                        {severityLabel(entry.severity)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--nx-text-secondary)]">
                      {auditActorText(entry)}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--nx-text-secondary)]">
                      {auditEntityText(entry)}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-[var(--nx-text-muted)]">
                      {entry.severity === 'error' || entry.severity === 'critical'
                        ? '失败/异常'
                        : '成功'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 分页：meta.total 展示 + 上一页 / 下一页 */}
          <nav
            data-org-audit-pagination
            aria-label="审计日志分页"
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <p data-org-audit-total className="text-[11px] text-[var(--nx-text-muted)]">
              共 {meta?.total ?? rows.length} 条记录 · 第 {meta?.page ?? page} /{' '}
              {meta?.totalPages ?? 1} 页
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-org-audit-prev
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="h-8 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                上一页
              </button>
              <button
                type="button"
                data-org-audit-next
                disabled={meta ? page >= meta.totalPages : true}
                onClick={() => setPage((current) => current + 1)}
                className="h-8 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-9 px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]',
        className,
      )}
    >
      {children}
    </th>
  )
}

/** UTC 时间戳 → `YYYY-MM-DD HH:mm:ss`（本地时区会让测试与截图漂移）。 */
export function formatAuditTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

/** 高密度表格骨架（与真实表格行几何同构）。 */
export function AuditTableSkeleton() {
  return (
    <div
      data-org-audit-skeleton
      role="status"
      aria-busy="true"
      aria-label="正在加载审计日志"
      className="overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
    >
      {[0, 1, 2, 3, 4, 5, 6].map((row) => (
        <div
          key={row}
          className="flex items-center gap-3 border-b border-[var(--nx-border-hairline)] px-3 py-3 last:border-b-0"
        >
          <div className="h-3 w-32 animate-pulse rounded-sm bg-[var(--nx-bg-0)]" />
          <div className="h-3 flex-1 animate-pulse rounded-sm bg-[var(--nx-bg-0)]" />
          <div className="h-3 w-16 animate-pulse rounded-sm bg-[var(--nx-bg-0)]" />
          <div className="h-5 w-16 animate-pulse rounded-sm bg-[var(--nx-bg-0)]" />
        </div>
      ))}
    </div>
  )
}

export default OrgAuditLogsWorkspace
