'use client'

import * as React from 'react'
import { AlertTriangle, ChevronRight, KeyRound, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OkrObjectiveTree, OkrWarning } from '@aiproj/types'
import {
  OKR_SCOPE_LABELS,
  OKR_STALE_DATA_NOTICE,
  flattenOkrTreeRows,
  formatOkrProgressText,
  hasOkrStaleWarning,
  okrKeyResultProgress,
  okrProgressBandOf,
  okrScopeChipClass,
  okrStatusMetaOf,
  okrWarningMetaOf,
  summarizeOkrTreeRows,
  type OkrTreeRowModel,
} from '@/lib/next/org-okr/org-okr-adapter'

/**
 * OKR 目标树高密度表格（v3-ui-next-org-portfolio-domains W2 · tasks 2.3，
 * spec「OKR 层级管理与达成仪表盘（幽灵守卫修复）」）。
 *
 * - 纯展示层：接收森林（O→KR→子 O）与 meta 警告，内部维护展开态（默认全展开，
 *   折叠只影响子树内容可见性，零网络）；
 * - 行模型经 `flattenOkrTreeRows` 扁平化：O 行（缩进层级 + scope/状态徽标 + KR
 *   计数 + 进度条带 + 信心标记）与 KR 行（缩进 + 当前/目标 + 折算进度条带）；
 * - 进度条带 0-100 分段色阶 + 数值文本双通道（okrProgressBandOf）；
 * - warning/freshness：meta 警告徽标栏（码→中文标签，title 附后端原文）与
 *   「数据陈旧」中性提示条（不泄露具体值）；meta 行回显节点总数/最大深度/截断；
 * - 加载骨架（aria-busy）/ 语义空态 / 错误重试（5xx 可重试）三态闭环。
 */

const CHIP_CLASS =
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap'

const CONFIDENCE_GLYPH: Record<string, { glyph: string; title: string; colorClass: string }> = {
  high: { glyph: '●', title: '信心：高', colorClass: 'text-[var(--nx-status-success)]' },
  medium: { glyph: '◐', title: '信心：中', colorClass: 'text-[var(--nx-status-warning)]' },
  low: { glyph: '○', title: '信心：低', colorClass: 'text-[var(--nx-status-danger)]' },
}

export interface OkrTreeMetaView {
  totalNodes: number
  maxDepth: number
  truncated: boolean
}

export interface OkrTreeTableProps {
  /** 目标树森林（后端 GET /okrs/tree 的 data）。 */
  nodes: readonly OkrObjectiveTree[]
  /** 树 meta 警告（meta.warnings）。 */
  warnings: readonly OkrWarning[]
  meta?: OkrTreeMetaView
  isLoading: boolean
  isError: boolean
  errorMessage?: string | null
  onRetry: () => void
}

/** 递归收集森林全部 objective id（默认全展开的依据）。 */
function collectObjectiveIds(
  nodes: readonly OkrObjectiveTree[],
  out: Set<number> = new Set(),
): Set<number> {
  for (const node of nodes) {
    out.add(node.objective.id)
    collectObjectiveIds(node.children, out)
  }
  return out
}

export function OkrTreeTable({
  nodes,
  warnings,
  meta,
  isLoading,
  isError,
  errorMessage,
  onRetry,
}: OkrTreeTableProps) {
  // 折叠集（默认全展开；数据刷新后仅保留仍存在的折叠键，不做猜测性还原）。
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<number>>(() => new Set())

  const allIds = React.useMemo(() => collectObjectiveIds(nodes), [nodes])
  const expandedKeys = React.useMemo(() => {
    const expanded = new Set<number>()
    for (const id of allIds) {
      if (!collapsed.has(id)) expanded.add(id)
    }
    return expanded
  }, [allIds, collapsed])

  const rows = React.useMemo(() => flattenOkrTreeRows(nodes, expandedKeys), [nodes, expandedKeys])
  const stats = React.useMemo(() => summarizeOkrTreeRows(rows), [rows])
  const stale = hasOkrStaleWarning(warnings)

  const toggleRow = (row: OkrTreeRowModel) => {
    if (!row.expandable) return
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(row.objective.id)) next.delete(row.objective.id)
      else next.add(row.objective.id)
      return next
    })
  }

  // ── 三态：加载骨架 ──────────────────────────────────────────────────────
  if (isLoading && rows.length === 0) {
    return (
      <div
        data-okr-tree-skeleton
        role="status"
        aria-label="正在加载 OKR 目标树"
        aria-busy="true"
        className="space-y-1.5"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
        ))}
      </div>
    )
  }

  // ── 三态：错误可重试 ────────────────────────────────────────────────────
  if (isError && rows.length === 0) {
    return (
      <div
        data-okr-tree-error
        role="alert"
        aria-label="OKR 目标树加载错误"
        className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-secondary)]">OKR 目标树加载失败</p>
        {errorMessage ? (
          <p className="max-w-md text-[11px] text-[var(--nx-text-muted)]">{errorMessage}</p>
        ) : null}
        <button
          type="button"
          data-okr-tree-retry
          onClick={onRetry}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          重新加载
        </button>
      </div>
    )
  }

  // ── 三态：语义空态 ──────────────────────────────────────────────────────
  if (!isLoading && !isError && nodes.length === 0) {
    return (
      <div
        data-okr-tree-empty
        className="flex flex-col items-center gap-2.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
      >
        <p className="text-sm text-[var(--nx-text-secondary)]">当前筛选下暂无 OKR 数据</p>
        <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
          可切换周期或放宽范围/状态筛选；新的 OKR
          周期与目标由具备组织管理权限的成员创建后自动出现在此处。
        </p>
      </div>
    )
  }

  return (
    <section
      data-okr-tree-table
      aria-busy={isLoading}
      className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      {/* meta 行：节点总数 / 最大深度 / 截断 / 可见聚合 */}
      <div
        data-okr-tree-meta
        className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--nx-text-muted)]"
      >
        <span data-okr-tree-node-total>共 {meta?.totalNodes ?? stats.objectiveCount} 个节点</span>
        {meta?.maxDepth !== undefined ? <span>最大深度 {meta.maxDepth}</span> : null}
        {meta?.truncated ? (
          <span className="rounded-sm border border-[rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.16)] px-1.5 py-0.5 text-[var(--nx-status-warning)]">
            已截断
          </span>
        ) : null}
        {stats.objectiveCount > 0 || stats.keyResultCount > 0 ? (
          <span>
            可见 O {stats.objectiveCount} · KR {stats.keyResultCount}
            {stats.averageProgress !== null ? ` · 平均进度 ${stats.averageProgress}%` : ''}
          </span>
        ) : null}
      </div>

      {/* warning / freshness 标记 */}
      {warnings.length > 0 ? (
        <div data-okr-warning-rail className="flex flex-wrap items-center gap-1.5">
          {warnings.map((warning, index) => {
            const warningMeta = okrWarningMetaOf(warning.code)
            return (
              <span
                key={`${warning.code}-${index}`}
                data-okr-warning-badge={warning.code}
                title={warning.message}
                className={cn(CHIP_CLASS, warningMeta?.chipClass ?? '')}
              >
                {warningMeta?.label ?? warning.message}
              </span>
            )
          })}
        </div>
      ) : null}

      {stale ? (
        <p
          data-okr-stale-notice
          className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
        >
          {OKR_STALE_DATA_NOTICE}
        </p>
      ) : null}

      {/* 高密度表格 */}
      <div className="overflow-x-auto">
        <table data-okr-tree className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--nx-border-hairline)]">
              {['目标 / 关键结果', '范围', '负责人', '状态', '进度', '信心'].map((header) => (
                <th
                  key={header}
                  scope="col"
                  className="whitespace-nowrap px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <OkrTreeRowView
                key={row.key}
                row={row}
                collapsedSet={collapsed}
                onToggle={toggleRow}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── 行视图 ─────────────────────────────────────────────────────────────────

interface OkrTreeRowViewProps {
  row: OkrTreeRowModel
  /** 折叠键集（含本行 objective id = 已折叠）。 */
  collapsedSet: ReadonlySet<number>
  onToggle: (row: OkrTreeRowModel) => void
}

function OkrTreeRowView({ row, collapsedSet, onToggle }: OkrTreeRowViewProps) {
  const isObjective = row.kind === 'objective'
  const collapsed = collapsedSet.has(row.objective.id)
  const progressValue = isObjective
    ? row.objective.progress
    : row.keyResult
      ? okrKeyResultProgress(row.keyResult)
      : null
  const band = okrProgressBandOf(progressValue)
  const statusSource = isObjective ? row.objective.status : row.keyResult?.status
  const statusMeta = okrStatusMetaOf(statusSource)
  const scopeChip = isObjective ? okrScopeChipClass(row.objective.scope) : ''
  const ownerId = isObjective ? row.objective.ownerId : null
  const confidence = isObjective ? row.objective.confidence : (row.keyResult?.confidence ?? null)
  const confidenceMeta = confidence ? CONFIDENCE_GLYPH[confidence] : null
  const keyResult = row.keyResult

  return (
    <tr
      data-okr-row={row.key}
      data-okr-row-kind={row.kind}
      data-okr-row-depth={row.depth}
      className={cn(
        'border-b border-[var(--nx-border-hairline)]/60 transition-colors',
        isObjective ? 'h-10' : 'h-8 hover:bg-[var(--nx-bg-1)]/40',
      )}
    >
      {/* 目标 / KR 标题（层级缩进 + 展开控制） */}
      <td className="max-w-80 px-2">
        <div
          className="flex min-w-0 items-center gap-1.5"
          style={{ paddingLeft: Math.min(row.depth, 8) * 22 }}
        >
          {isObjective ? (
            <>
              <button
                type="button"
                data-okr-row-toggle
                aria-label={
                  collapsed ? `展开 ${row.objective.title}` : `折叠 ${row.objective.title}`
                }
                aria-expanded={!collapsed}
                disabled={!row.expandable}
                onClick={() => onToggle(row)}
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-colors',
                  row.expandable
                    ? 'text-[var(--nx-text-muted)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]'
                    : 'invisible',
                )}
              >
                <ChevronRight
                  className={cn('h-3.5 w-3.5 transition-transform', collapsed ? '' : 'rotate-90')}
                  aria-hidden
                />
              </button>
              <p
                data-okr-objective-title
                className="truncate text-[13px] font-medium text-[var(--nx-text-primary)]"
                title={row.objective.title}
              >
                {row.objective.title}
              </p>
            </>
          ) : (
            <>
              <span
                data-okr-kr-marker
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border border-[rgba(56,189,248,0.4)] bg-[rgba(56,189,248,0.1)]"
                title="关键结果"
              >
                <KeyRound className="h-2.5 w-2.5 text-[var(--nx-accent)]" aria-hidden />
              </span>
              <p
                data-okr-kr-title
                className="truncate text-xs text-[var(--nx-text-secondary)]"
                title={keyResult?.title ?? ''}
              >
                {keyResult?.title ?? ''}
              </p>
            </>
          )}
        </div>
      </td>

      {/* 范围 */}
      <td className="whitespace-nowrap px-2">
        {isObjective ? (
          <span className={cn(CHIP_CLASS, scopeChip)} data-okr-objective-scope>
            {OKR_SCOPE_LABELS[row.objective.scope] ?? row.objective.scope}
          </span>
        ) : (
          <span aria-hidden className="text-[10px] text-[var(--nx-text-muted)]">
            —
          </span>
        )}
      </td>

      {/* 负责人（仅展示后端给出的 id，不猜测姓名） */}
      <td className="whitespace-nowrap px-2">
        {isObjective ? (
          <span
            data-okr-objective-owner
            className="font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            {ownerId !== null ? `成员 #${ownerId}` : '未分配'}
          </span>
        ) : (
          <span aria-hidden className="text-[10px] text-[var(--nx-text-muted)]">
            —
          </span>
        )}
      </td>

      {/* 状态徽标 */}
      <td className="whitespace-nowrap px-2">
        <span data-okr-row-status className={cn(CHIP_CLASS, statusMeta?.chipClass ?? '')}>
          {statusMeta?.label ?? statusSource}
        </span>
      </td>

      {/* 进度条带（分段色阶 + 数值双通道） */}
      <td className="whitespace-nowrap px-2">
        {progressValue === null ? (
          <span aria-hidden className="text-[10px] text-[var(--nx-text-muted)]">
            —
          </span>
        ) : (
          <span
            data-okr-progress
            role="img"
            aria-label={`进度 ${formatOkrProgressText(progressValue)}`}
            className="inline-flex min-w-28 items-center gap-1.5"
          >
            <span className="h-1.5 w-16 overflow-hidden rounded-sm bg-[var(--nx-bg-1)]">
              <span
                className={cn('block h-full rounded-sm', band?.fillClass ?? '')}
                style={{ width: `${Math.max(0, Math.min(100, progressValue))}%` }}
              />
            </span>
            <span
              data-okr-progress-text
              className="font-mono text-[10px] text-[var(--nx-text-secondary)]"
            >
              {formatOkrProgressText(progressValue)}
              {!isObjective && keyResult
                ? ` · ${keyResult.currentValue}/${keyResult.targetValue}${keyResult.unitLabel ?? ''}`
                : ''}
            </span>
          </span>
        )}
      </td>

      {/* 信心 */}
      <td className="whitespace-nowrap px-2">
        {confidenceMeta ? (
          <span
            data-okr-confidence
            title={confidenceMeta.title}
            aria-label={confidenceMeta.title}
            className={cn('text-xs leading-none', confidenceMeta.colorClass)}
          >
            {confidenceMeta.glyph}
          </span>
        ) : (
          <span aria-hidden className="text-[10px] text-[var(--nx-text-muted)]">
            —
          </span>
        )}
      </td>
    </tr>
  )
}
