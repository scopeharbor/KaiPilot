'use client'

import * as React from 'react'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'
import { useDecisionCases } from '@/hooks/use-decision-workbench'
import { cn } from '@/lib/utils'
import type {
  PmoDecisionCaseListQuery,
  PmoDecisionCaseStatus,
  PmoDecisionCaseDTO,
} from '@aiproj/types'

/**
 * PMO 决策议题队列表格（v3-ui-next-pmo-domain W6 · tasks 6.2，
 * spec「决策工作台队列与议题建立」）。
 *
 * - 数据直接消费 `useDecisionCases(activeFilters)`（与旧页同键，RL-04 缓存同源）；
 *   加载骨架（aria-busy）/ 空态 / 错误重试三态在本组件闭环；
 * - 列：议题编号（#id · rN）/ 标题与决策问题 / 状态徽标（颜色+文字双通道）/
 *   截止 / 更新时间；状态徽标 data-case-status 双编码（非 color-only）；
 * - 行点击 → `/next/pmo/decisions/:decisionId`（由上层注入跳转）；
 * - 分页沿用服务端 meta（total/totalPages），上一页/下一页经上层写回 URL。
 */

/** 议题状态元信息（颜色 + 文字双通道；颜色取自 --nx-* 令牌通道值）。 */
export const PMO_DECISION_CASE_STATUS_META: Record<
  PmoDecisionCaseStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  draft: {
    label: '草稿',
    color: 'var(--nx-text-secondary)',
    bg: 'rgba(148,163,184,0.12)',
    border: 'rgba(148,163,184,0.35)',
  },
  'collecting-evidence': {
    label: '收集证据',
    color: 'var(--nx-chart-1)',
    bg: 'rgba(56,189,248,0.12)',
    border: 'rgba(56,189,248,0.35)',
  },
  'ready-for-review': {
    label: '待审查',
    color: 'var(--nx-chart-7)',
    bg: 'rgba(192,132,252,0.12)',
    border: 'rgba(192,132,252,0.35)',
  },
  'under-review': {
    label: '审查中',
    color: 'var(--nx-chart-4)',
    bg: 'rgba(251,191,36,0.12)',
    border: 'rgba(251,191,36,0.35)',
  },
  decided: {
    label: '已决定',
    color: 'var(--nx-status-success)',
    bg: 'rgba(16,185,129,0.12)',
    border: 'rgba(16,185,129,0.35)',
  },
  deferred: {
    label: '已延后',
    color: 'var(--nx-status-warning)',
    bg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.35)',
  },
  superseded: {
    label: '已被取代',
    color: 'var(--nx-text-muted)',
    bg: 'rgba(122,139,161,0.12)',
    border: 'rgba(122,139,161,0.35)',
  },
}

export function formatDecisionDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '—'
}

export function PmoDecisionCaseStatusBadge({ status }: { status: PmoDecisionCaseStatus }) {
  const meta = PMO_DECISION_CASE_STATUS_META[status]
  return (
    <span
      data-case-status={status}
      className="inline-flex h-6 shrink-0 items-center rounded-[4px] border px-2 text-xs font-medium"
      style={{ color: meta.color, backgroundColor: meta.bg, borderColor: meta.border }}
    >
      {meta.label}
    </span>
  )
}

export interface PmoDecisionCaseTableProps {
  filters: PmoDecisionCaseListQuery
  page: number
  onPageChange: (page: number) => void
  onOpenCase: (decisionId: number) => void
}

export function PmoDecisionCaseTable({
  filters,
  page,
  onPageChange,
  onOpenCase,
}: PmoDecisionCaseTableProps) {
  const query = useDecisionCases(filters)

  if (query.isLoading || query.isPending) {
    return (
      <div
        data-pmo-decisions-skeleton
        role="status"
        aria-label="决策议题加载中"
        aria-busy="true"
        className="flex flex-col gap-2"
      >
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="h-14 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
          />
        ))}
      </div>
    )
  }

  if (query.isError) {
    return (
      <div
        data-pmo-decisions-error
        role="alert"
        className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
        <p className="text-xs text-[var(--nx-text-secondary)]">决策议题加载失败，请稍后重试。</p>
        <button
          type="button"
          data-pmo-decisions-retry
          onClick={() => void query.refetch()}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          重新载入
        </button>
      </div>
    )
  }

  const rows = query.data?.data ?? []
  const meta = query.data?.meta
  const totalPages = meta?.totalPages ?? 1

  if (rows.length === 0) {
    return (
      <div
        data-pmo-decisions-empty
        className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
      >
        <Inbox className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="text-xs font-medium text-[var(--nx-text-primary)]">当前筛选下没有决策议题</p>
        <p className="text-[11px] text-[var(--nx-text-muted)]">
          尝试切换状态筛选，或由具备 pmo_decision:manage 权限的成员「新建议题」。
        </p>
      </div>
    )
  }

  return (
    <section data-pmo-decisions-table className="flex flex-col gap-2">
      {/* 表头 */}
      <div className="grid grid-cols-[96px_minmax(0,1fr)_112px_96px_96px] items-center gap-3 rounded-t-md border border-b-0 border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)] max-lg:hidden">
        <span>编号</span>
        <span>议题</span>
        <span>状态</span>
        <span>截止</span>
        <span>更新时间</span>
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((decision) => (
          <DecisionQueueRow
            key={decision.id}
            decision={decision}
            onOpen={() => onOpenCase(decision.id)}
          />
        ))}
      </div>

      {/* 分页（服务端 meta 驱动） */}
      {totalPages > 1 ? (
        <nav
          data-pmo-decisions-pagination
          aria-label="决策议题分页"
          className="flex items-center justify-between rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-[11px] text-[var(--nx-text-muted)]"
        >
          <span>
            第 {page} / {totalPages} 页 · 共 {meta?.total ?? 0} 条
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-pmo-decisions-prev-page
              disabled={page <= 1}
              onClick={() => onPageChange(Math.max(1, page - 1))}
              className="h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:opacity-40"
            >
              上一页
            </button>
            <button
              type="button"
              data-pmo-decisions-next-page
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </nav>
      ) : null}
    </section>
  )
}

function DecisionQueueRow({
  decision,
  onOpen,
}: {
  decision: PmoDecisionCaseDTO
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      data-pmo-decision-row
      onClick={onOpen}
      className={cn(
        'grid w-full grid-cols-1 items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3 text-left transition-colors hover:border-[var(--nx-border-focus)] max-lg:flex max-lg:flex-wrap',
        'lg:grid-cols-[96px_minmax(0,1fr)_112px_96px_96px]',
      )}
    >
      <span className="font-mono text-xs text-[var(--nx-text-muted)]">
        #{decision.id}
        <span className="ml-1 text-[10px]">r{decision.revision}</span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-[var(--nx-text-primary)]">
          {decision.title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-[var(--nx-text-muted)]">
          {decision.decisionQuestion}
        </span>
      </span>
      <PmoDecisionCaseStatusBadge status={decision.status} />
      <span className="text-xs text-[var(--nx-text-secondary)]">
        {formatDecisionDate(decision.dueDate)}
      </span>
      <span className="text-xs text-[var(--nx-text-muted)]">
        {formatDecisionDate(decision.updatedAt)}
      </span>
    </button>
  )
}

export default PmoDecisionCaseTable
