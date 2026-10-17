'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileClock, FilterX, RefreshCw, ScrollText, ShieldAlert } from 'lucide-react'
import { auditLogsApi, type AuditLogEntry, type AuditLogFilters } from '@/lib/api/audit-logs'
import { actionLabel, entityTypeLabel, eventLabel, severityLabel } from '@/lib/audit-labels'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'

/**
 * 全局审计日志工作区（/next/admin/audit-logs，
 * v3-ui-next-settings-admin-domains W6 · tasks 6.7，
 * spec「管理后台门户与平台治理控制台」Requirement 2 + design 迁移台账第 17 行）。
 *
 * - **准入门禁 `system:admin`**（后端已核实：`start/rbac/routes.ts` 的 `audit_logs.index`
 *   在全局无组织口径下要求 `system:admin`）。工作区由页面 `PermissionGuard` 守卫，
 *   工作区内部持 `can('system:admin')` 做双保险（RL-06 无权限时 0 请求）；
 * - 数据复用 `auditLogsApi.list`（`scope='global'` 语义，跨全部组织审计流水）；
 * - 高密度暗黑表格：时间 / 组织 / 事件 / 操作 / 级别 / 操作人 / 对象 / 结果；
 *   双通道（颜色 + 文本，RL-15）传达严重级别与执行结果；
 * - 过滤与分页：本地状态维护过滤条件，上一页/下一页分页导航；
 * - **严格只读**：无任何写按钮、无修改入口、不采集请求/输出全文（RL-01 / RL-12）；
 * - 精确档 `data-immersion="precise"` 静态面板支持与三态（骨架/空态/重试）。
 */

export interface GlobalAuditLogsWorkspaceProps {
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

/** UTC 时间戳 → `YYYY-MM-DD HH:mm:ss`（避免时区导致测试与截图漂移）。 */
export function formatAuditTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

/** 操作人显示：实名 → 「用户 #id」→ 「系统」。 */
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

/** 组织显示：组织名 → 「组织 #id」→ 「全局/系统」。 */
export function auditOrgText(entry: AuditLogEntry): string {
  if (entry.organizationName) return entry.organizationName
  if (entry.organizationId !== null) return `组织 #${entry.organizationId}`
  return '全局/系统'
}

/** 事件/操作合并展示。 */
export function auditEventText(entry: AuditLogEntry): string {
  return eventLabel(entry.event) || actionLabel(entry.action)
}

export function GlobalAuditLogsWorkspace({ className }: GlobalAuditLogsWorkspaceProps) {
  const tier = useImmersionTier()
  const { can } = usePermissions()
  const canView = can('system:admin')

  const [filters, setFilters] = React.useState<AuditLogFilters>({})
  const [page, setPage] = React.useState(1)

  const activeFilters: AuditLogFilters = React.useMemo(
    () => ({ ...filters, page, perPage: PER_PAGE }),
    [filters, page],
  )

  const listQuery = useQuery({
    queryKey: ['audit-logs', 'global', activeFilters],
    queryFn: () => auditLogsApi.list(activeFilters),
    enabled: canView,
  })

  const patchFilters = (patch: Partial<AuditLogFilters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(1)
  }

  const hasFilters = Object.entries(filters).some(
    ([, value]) =>
      value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0),
  )

  const rawData = listQuery.data as unknown
  const rows: AuditLogEntry[] = Array.isArray(rawData)
    ? (rawData as AuditLogEntry[])
    : Array.isArray((rawData as { data?: unknown })?.data)
      ? (rawData as { data: AuditLogEntry[] }).data
      : []

  const meta = (
    rawData as { meta?: { total: number; page: number; perPage: number; totalPages: number } }
  )?.meta

  const fieldClass =
    'h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none'

  return (
    <div
      data-admin-audit-logs
      data-immersion={tier}
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-surface)]',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <ScrollText className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1
              data-admin-audit-title
              className="text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              全局审计日志
            </h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              跨全部组织的不可篡改操作流水检索；只读展示，不采集请求/输出全文。
            </p>
          </div>
        </div>
        <button
          type="button"
          data-admin-audit-refresh
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

      {!canView ? (
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看全局审计日志的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 system:admin 权限方可查看跨所有组织的审计流水。请联系平台管理员授予权限。
          </p>
        </div>
      ) : (
        <>
          {/* 过滤条：全部为本地筛选态 */}
          <section
            data-admin-audit-filters
            aria-label="全局审计日志过滤"
            className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
          >
            <input
              data-admin-audit-filter-event
              aria-label="事件类型"
              placeholder="事件类型（如 ROLE_CHANGED）"
              value={filters.event ?? ''}
              onChange={(event) => patchFilters({ event: event.target.value || undefined })}
              className={cn(fieldClass, 'w-52')}
            />
            <select
              data-admin-audit-filter-action
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
              data-admin-audit-filter-severity
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
              data-admin-audit-filter-date-from
              aria-label="开始日期"
              type="date"
              value={filters.dateFrom ?? ''}
              onChange={(event) => patchFilters({ dateFrom: event.target.value || undefined })}
              className={fieldClass}
            />
            <span className="text-[11px] text-[var(--nx-text-muted)]">至</span>
            <input
              data-admin-audit-filter-date-to
              aria-label="结束日期"
              type="date"
              value={filters.dateTo ?? ''}
              onChange={(event) => patchFilters({ dateTo: event.target.value || undefined })}
              className={fieldClass}
            />
            <input
              data-admin-audit-filter-actor
              aria-label="操作人 ID"
              type="number"
              placeholder="操作人 ID"
              value={filters.actorId ?? ''}
              onChange={(event) =>
                patchFilters({
                  actorId: event.target.value ? Number(event.target.value) : undefined,
                })
              }
              className={cn(fieldClass, 'w-28')}
            />
            {hasFilters ? (
              <button
                type="button"
                data-admin-audit-filter-reset
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
            <GlobalAuditTableSkeleton />
          ) : listQuery.isError ? (
            <div
              data-admin-audit-error
              role="alert"
              className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-12 text-center"
            >
              <ShieldAlert className="h-7 w-7 text-[var(--nx-status-warning)]" aria-hidden />
              <p className="text-sm text-[var(--nx-text-secondary)]">全局审计日志加载失败</p>
              <button
                type="button"
                data-admin-audit-retry
                onClick={() => void listQuery.refetch()}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                重新载入
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div
              data-admin-audit-empty
              className="rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-12 text-center"
            >
              <FileClock className="mx-auto h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
              <p className="mt-3 text-sm text-[var(--nx-text-secondary)]">
                {hasFilters ? '没有命中的审计记录' : '暂无审计记录'}
              </p>
              <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
                {hasFilters
                  ? '调整或重置过滤条件后重试。'
                  : '平台内的全局操作产生记录后将在此呈现。'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]">
                <table
                  data-admin-audit-table
                  className="w-full min-w-[64rem] border-collapse text-xs"
                >
                  <thead>
                    <tr className="border-b border-[var(--nx-border-hairline)]">
                      <Th className="w-40">时间</Th>
                      <Th className="w-36">组织</Th>
                      <Th>事件</Th>
                      <Th className="w-24">操作</Th>
                      <Th className="w-24">级别</Th>
                      <Th className="w-36">操作人</Th>
                      <Th className="w-48">对象</Th>
                      <Th className="w-24">结果</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((entry) => (
                      <tr
                        key={entry.id}
                        data-admin-audit-row={entry.id}
                        className="border-b border-[var(--nx-border-hairline)] last:border-b-0 hover:bg-[var(--nx-bg-0)]"
                      >
                        <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--nx-text-muted)]">
                          {formatAuditTime(entry.createdAt)}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-[var(--nx-text-primary)]">
                          {auditOrgText(entry)}
                        </td>
                        <td className="px-3 py-2.5 text-[var(--nx-text-primary)]">
                          {auditEventText(entry)}
                        </td>
                        <td className="px-3 py-2.5 text-[var(--nx-text-secondary)]">
                          {actionLabel(entry.action)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            data-admin-audit-severity={entry.id}
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
                        <td className="px-3 py-2.5 text-[11px]">
                          <span
                            data-admin-audit-result={entry.id}
                            className={
                              entry.severity === 'error' || entry.severity === 'critical'
                                ? 'text-[var(--nx-status-danger)]'
                                : 'text-[var(--nx-status-success)]'
                            }
                          >
                            {entry.severity === 'error' || entry.severity === 'critical'
                              ? '失败/异常'
                              : '成功'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 分页：meta.total 展示 + 上一页 / 下一页 */}
              <nav
                data-admin-audit-pagination
                aria-label="全局审计日志分页"
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <p data-admin-audit-total className="text-[11px] text-[var(--nx-text-muted)]">
                  共 {meta?.total ?? rows.length} 条记录 · 第 {meta?.page ?? page} /{' '}
                  {meta?.totalPages ?? 1} 页
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-admin-audit-prev
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    className="h-8 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <span className="font-mono text-xs text-[var(--nx-text-muted)]">{page}</span>
                  <button
                    type="button"
                    data-admin-audit-next
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

export function GlobalAuditTableSkeleton() {
  return (
    <div
      data-admin-audit-skeleton
      role="status"
      aria-busy="true"
      aria-label="正在加载全局审计日志"
      className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
    >
      {[0, 1, 2, 3, 4].map((index) => (
        <div
          key={index}
          className="h-10 animate-pulse rounded-sm bg-[var(--nx-bg-0)]"
          aria-hidden
        />
      ))}
    </div>
  )
}

export default GlobalAuditLogsWorkspace
