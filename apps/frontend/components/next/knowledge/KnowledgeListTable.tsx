'use client'

import * as React from 'react'
import { AlertTriangle, ChevronDown, FilterX, Loader2, RefreshCw, Search, X } from 'lucide-react'
import type { KnowledgeItemLowSensitiveProjection, KnowledgeLayer } from '@aiproj/types'
import { useConfirmKnowledge, useTransitionKnowledgeLifecycle } from '@/hooks/use-knowledge'
import { cn } from '@/lib/utils'
import {
  KNOWLEDGE_LAYER_META,
  KNOWLEDGE_LAYER_OPTIONS,
  KNOWLEDGE_STATUS_META,
  KNOWLEDGE_STATUS_OPTIONS,
  SYNTHETIC_BADGE_CLASS,
  SYNTHETIC_BADGE_TEXT,
  SYNTHETIC_TOOLTIP_TEXT,
  filterKnowledgeItems,
  formatKnowledgeDate,
  hasActiveKnowledgeFilters,
  layerMetaOf,
  nextKnowledgeStatuses,
  requiresSyntheticBadge,
  statusMetaOf,
  type KnowledgeItemFilters,
} from '@/lib/next/knowledge/knowledge-adapter'
import { KnowledgeConfirmModal, resolveErrorMessage } from './KnowledgeManageDrawers'

/**
 * 四层知识底册高密度表格（v3-ui-next-help-knowledge-domain W2 · tasks 2.3，
 * spec「四层知识库底册表格浏览与多维过滤」）。
 *
 * - 冷黑曜石 + 1px 发丝线高密度 36px 行（h-9），列：层级（L1-L4 语义色徽标）/
 *   SYNTHETIC 警示标识 / 知识标题 / 业务领域 / 复杂度 / 生命周期状态 / 更新时间 / 操作；
 * - 多维组合检索：关键词模糊 + 层级多选 + 状态多选 + 领域精确收敛，全部走
 *   `filterKnowledgeItems` 纯函数本地收敛（底册为工作台按状态并集拉取的全量）——
 *   重置即清空本地筛选态，绝不向后端发送空串查询参数；
 * - 点击行呼出审查治理抽屉（onOpenReview）；行内快速操作（确认转正 / 状态推进）
 *   仅在 knowledge:manage 时渲染，且一律先弹二次确认模态（RL-06 阻断）；
 * - pending → active 唯一走「确认转正」（POST /knowledge/:id/confirm），推进下拉
 *   只含 KNOWLEDGE_TRANSITION_TARGETS 白名单且剔除转正通道；
 * - 加载骨架（5 行 aria-busy）/ 语义空态 / 错误重试三态闭环。
 */
export interface KnowledgeListTableProps {
  /** 底册全量条目（工作台已按生命周期状态并集拉取）。 */
  items: readonly KnowledgeItemLowSensitiveProjection[]
  isLoading: boolean
  isError: boolean
  errorMessage?: string | null
  onRetry: () => void
  /** knowledge:manage（行内确认/推进出口）。 */
  canManage: boolean
  /** knowledge:author（空态「新建第一条规范」CTA）。 */
  canAuthor: boolean
  /** 点击行呼出审查抽屉。 */
  onOpenReview: (knowledgeId: number) => void
  /** 空态 CTA 请求打开新建抽屉。 */
  onRequestCreate: () => void
}

interface QuickTarget {
  item: KnowledgeItemLowSensitiveProjection
  target: import('@aiproj/types').KnowledgeLifecycleStatus
}

export function KnowledgeListTable({
  items,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  canManage,
  canAuthor,
  onOpenReview,
  onRequestCreate,
}: KnowledgeListTableProps) {
  const [filters, setFilters] = React.useState<KnowledgeItemFilters>({})
  const [keyword, setKeyword] = React.useState('')
  const [domain, setDomain] = React.useState('')
  const [layerMenuOpen, setLayerMenuOpen] = React.useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = React.useState(false)
  const [confirmItem, setConfirmItem] = React.useState<KnowledgeItemLowSensitiveProjection | null>(
    null,
  )
  const [quickTarget, setQuickTarget] = React.useState<QuickTarget | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const confirmMutation = useConfirmKnowledge()
  const transitionMutation = useTransitionKnowledgeLifecycle()

  const domainOptions = React.useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of items) {
      const d = (item.domain ?? '').trim()
      if (d && !seen.has(d)) {
        seen.add(d)
        out.push(d)
      }
    }
    return out.sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [items])

  const filtered = React.useMemo(() => filterKnowledgeItems(items, filters), [items, filters])

  const hasFilter = hasActiveKnowledgeFilters(filters)

  const writePending = confirmMutation.isPending || transitionMutation.isPending

  const updateFilters = (patch: Partial<KnowledgeItemFilters>) => {
    setActionError(null)
    setFilters((prev) => ({ ...prev, ...patch }))
  }

  const toggleLayer = (layer: KnowledgeLayer) => {
    setLayerMenuOpen(false)
    setActionError(null)
    setFilters((prev) => {
      const current = prev.layers ?? []
      return {
        ...prev,
        layers: current.includes(layer) ? current.filter((l) => l !== layer) : [...current, layer],
      }
    })
  }

  const toggleStatus = (status: QuickTarget['target']) => {
    setStatusMenuOpen(false)
    setActionError(null)
    setFilters((prev) => {
      const current = prev.statuses ?? []
      return {
        ...prev,
        statuses: current.includes(status)
          ? current.filter((s) => s !== status)
          : [...current, status],
      }
    })
  }

  const resetFilters = () => {
    setKeyword('')
    setDomain('')
    setFilters({})
    setActionError(null)
  }

  const openRow = (item: KnowledgeItemLowSensitiveProjection) => {
    if (writePending) return
    setActionError(null)
    onOpenReview(item.id)
  }

  const layerLabel =
    (filters.layers ?? []).length === 0
      ? '全部层级'
      : (filters.layers ?? []).map((l) => KNOWLEDGE_LAYER_META[l].fullName).join('、')
  const statusLabel =
    (filters.statuses ?? []).length === 0
      ? '全部状态'
      : (filters.statuses ?? []).map((s) => KNOWLEDGE_STATUS_META[s].label).join('、')

  const selectClass =
    'h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50'
  const chipClass =
    'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap'

  return (
    <section
      data-knowledge-ledger
      aria-busy={isLoading}
      className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      {/* 区块标题 + 汇总 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">四层知识底册</h3>
          <span
            data-knowledge-register-total
            className="font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            {hasFilter ? `筛选 ${filtered.length} / ` : ''}共 {items.length} 条
          </span>
        </div>
        {actionError ? (
          <p
            role="alert"
            aria-label="知识治理操作失败"
            data-knowledge-action-error
            className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
          >
            {actionError}
          </p>
        ) : null}
      </div>

      {/* 多维组合检索工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="knowledge-filter-keyword">
          搜索知识关键字
        </label>
        <input
          id="knowledge-filter-keyword"
          data-knowledge-filter-keyword
          type="text"
          value={keyword}
          maxLength={255}
          onChange={(event) => {
            const value = event.target.value
            setKeyword(value)
            updateFilters({ keyword: value })
          }}
          placeholder="搜索标题 / 领域 / 来源…"
          className="h-8 w-52 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 pr-7 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        />
        <Search className="-ml-6 h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />

        {/* 层级多选下拉 */}
        <div className="relative">
          <button
            type="button"
            data-knowledge-filter-layer
            aria-label="按层级筛选知识"
            aria-expanded={layerMenuOpen}
            onClick={() => {
              setLayerMenuOpen((open) => !open)
              setStatusMenuOpen(false)
            }}
            className={cn(selectClass, 'flex items-center gap-1 pr-1')}
          >
            <span className="max-w-36 truncate">{layerLabel}</span>
            <ChevronDown className="h-3 w-3 text-[var(--nx-text-muted)]" aria-hidden />
          </button>
          {layerMenuOpen ? (
            <div
              data-knowledge-layer-menu
              className="absolute left-0 top-full z-30 mt-1 w-44 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-1 shadow-[0_0_32px_rgba(0,0,0,0.5)]"
            >
              <button
                type="button"
                data-knowledge-filter-layer-all
                onClick={() => {
                  setLayerMenuOpen(false)
                  updateFilters({ layers: [] })
                }}
                className="flex h-7 w-full items-center rounded-sm px-2 text-left text-xs text-[var(--nx-text-primary)] transition-colors hover:bg-[var(--nx-bg-1)]"
              >
                全部层级
              </button>
              {KNOWLEDGE_LAYER_OPTIONS.map((option) => {
                const checked = (filters.layers ?? []).includes(option.code)
                return (
                  <button
                    key={option.code}
                    type="button"
                    data-knowledge-filter-layer-option={option.code}
                    aria-pressed={checked}
                    onClick={() => toggleLayer(option.code)}
                    className="flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-xs text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)]"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border',
                        checked
                          ? option.chipClass
                          : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]',
                      )}
                    >
                      {checked ? <X className="h-2.5 w-2.5" /> : null}
                    </span>
                    <span className={checked ? option.chipClass : ''}>{option.fullName}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        {/* 状态多选下拉 */}
        <div className="relative">
          <button
            type="button"
            data-knowledge-filter-status
            aria-label="按状态筛选知识"
            aria-expanded={statusMenuOpen}
            onClick={() => {
              setStatusMenuOpen((open) => !open)
              setLayerMenuOpen(false)
            }}
            className={cn(selectClass, 'flex items-center gap-1 pr-1')}
          >
            <span className="max-w-36 truncate">{statusLabel}</span>
            <ChevronDown className="h-3 w-3 text-[var(--nx-text-muted)]" aria-hidden />
          </button>
          {statusMenuOpen ? (
            <div
              data-knowledge-status-menu
              className="absolute left-0 top-full z-30 mt-1 w-40 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-1 shadow-[0_0_32px_rgba(0,0,0,0.5)]"
            >
              <button
                type="button"
                data-knowledge-filter-status-all
                onClick={() => {
                  setStatusMenuOpen(false)
                  updateFilters({ statuses: [] })
                }}
                className="flex h-7 w-full items-center rounded-sm px-2 text-left text-xs text-[var(--nx-text-primary)] transition-colors hover:bg-[var(--nx-bg-1)]"
              >
                全部状态
              </button>
              {KNOWLEDGE_STATUS_OPTIONS.map((option) => {
                const checked = (filters.statuses ?? []).includes(option.status)
                return (
                  <button
                    key={option.status}
                    type="button"
                    data-knowledge-filter-status-option={option.status}
                    aria-pressed={checked}
                    onClick={() => toggleStatus(option.status)}
                    className="flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-xs text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)]"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border',
                        checked
                          ? option.chipClass
                          : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]',
                      )}
                    >
                      {checked ? <X className="h-2.5 w-2.5" /> : null}
                    </span>
                    <span className={checked ? option.chipClass : ''}>{option.label}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        {/* 领域文本过滤（精确收敛，datalist 提示既有领域值） */}
        <label className="sr-only" htmlFor="knowledge-filter-domain">
          按领域精确过滤知识
        </label>
        <input
          id="knowledge-filter-domain"
          data-knowledge-filter-domain
          type="text"
          list="knowledge-domain-options"
          value={domain}
          maxLength={128}
          onChange={(event) => {
            const value = event.target.value
            setDomain(value)
            updateFilters({ domain: value })
          }}
          placeholder="领域精确匹配…"
          className="h-8 w-40 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        />
        <datalist id="knowledge-domain-options">
          {domainOptions.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>

        {hasFilter ? (
          <button
            type="button"
            data-knowledge-filter-reset
            onClick={resetFilters}
            className="flex h-8 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <FilterX className="h-3 w-3" aria-hidden />
            重置筛选
          </button>
        ) : null}
      </div>

      {/* 三态主体 */}
      {isLoading ? (
        <div
          data-knowledge-ledger-skeleton
          role="status"
          aria-label="正在加载四层知识底册"
          aria-busy="true"
          className="space-y-1.5"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
          ))}
        </div>
      ) : isError ? (
        <div
          role="alert"
          aria-label="四层知识底册加载错误"
          data-knowledge-ledger-error
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
        >
          <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">四层知识底册加载失败</p>
          {errorMessage ? (
            <p className="max-w-md text-[11px] text-[var(--nx-text-muted)]">{errorMessage}</p>
          ) : null}
          <button
            type="button"
            data-knowledge-ledger-retry
            onClick={onRetry}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新加载
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div
          data-knowledge-ledger-empty
          className="flex flex-col items-center gap-2.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <p className="text-sm text-[var(--nx-text-secondary)]">
            {hasFilter ? '暂无匹配的四层知识' : '知识库暂无记录'}
          </p>
          {hasFilter ? (
            <button
              type="button"
              data-knowledge-empty-reset
              onClick={resetFilters}
              className="h-8 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              清除筛选条件
            </button>
          ) : canAuthor ? (
            <button
              type="button"
              data-knowledge-empty-create
              onClick={onRequestCreate}
              className="h-8 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              新建第一条规范
            </button>
          ) : (
            <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
              需要具备 knowledge:author 权限的成员录入第一条知识记录。
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            data-knowledge-table
            aria-label="四层知识底册"
            className="w-full border-collapse text-left"
          >
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)]">
                {[
                  '层级',
                  '标识',
                  '知识标题',
                  '业务领域',
                  '复杂度',
                  '生命周期状态',
                  '更新时间',
                  '操作',
                ].map((header) => (
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
              {filtered.map((item) => {
                const layerMeta = layerMetaOf(item.layer)
                const statusMeta = statusMetaOf(item.status)
                const synthetic = requiresSyntheticBadge(item)
                const targets = nextKnowledgeStatuses(item.status)
                const showConfirm = canManage && item.status === 'pending'
                const showTransition = canManage && targets.length > 0
                return (
                  <tr
                    key={item.id}
                    data-knowledge-row={item.id}
                    data-knowledge-layer={item.layer}
                    onClick={() => openRow(item)}
                    className={cn(
                      'h-9 cursor-pointer border-b border-[var(--nx-border-hairline)]/60 transition-colors',
                      writePending ? 'opacity-60' : 'hover:bg-[var(--nx-bg-1)]/60',
                    )}
                  >
                    <td className="whitespace-nowrap px-2">
                      <span
                        data-knowledge-layer-badge={item.layer}
                        title={layerMeta?.description}
                        className={cn(chipClass, layerMeta?.chipClass)}
                      >
                        {layerMeta?.fullName ?? item.layer}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2">
                      {synthetic ? (
                        <span
                          data-knowledge-synthetic-badge
                          title={SYNTHETIC_TOOLTIP_TEXT}
                          className={cn(chipClass, 'font-semibold', SYNTHETIC_BADGE_CLASS)}
                        >
                          {SYNTHETIC_BADGE_TEXT}
                        </span>
                      ) : (
                        <span aria-hidden className="text-[10px] text-[var(--nx-text-muted)]">
                          —
                        </span>
                      )}
                    </td>
                    <td className="max-w-72 px-2">
                      <p
                        data-knowledge-cell-title
                        className="truncate text-[13px] font-medium text-[var(--nx-text-primary)]"
                        title={item.title}
                      >
                        {item.title}
                      </p>
                    </td>
                    <td className="px-2">
                      <span
                        data-knowledge-cell-domain
                        className="inline-block max-w-32 truncate text-[11px] text-[var(--nx-text-secondary)]"
                        title={item.domain ?? ''}
                      >
                        {item.domain ?? '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2">
                      <span
                        data-knowledge-cell-complexity
                        className="font-mono text-[11px] text-[var(--nx-text-secondary)]"
                      >
                        {item.complexity ?? '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2">
                      <span
                        data-knowledge-cell-status
                        className={cn(chipClass, statusMeta?.chipClass)}
                        title={statusMeta?.description}
                      >
                        {statusMeta?.label ?? item.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2">
                      <span
                        data-knowledge-cell-updated
                        className="font-mono text-[10px] text-[var(--nx-text-muted)]"
                      >
                        {formatKnowledgeDate(item.updatedAt)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2">
                      <div
                        className="flex items-center gap-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {showConfirm ? (
                          <button
                            type="button"
                            data-knowledge-row-confirm
                            aria-label={`确认转正 ${item.title}`}
                            disabled={writePending}
                            onClick={() => {
                              setActionError(null)
                              setConfirmItem(item)
                            }}
                            className="flex h-7 items-center rounded-sm border border-[rgba(16,185,129,0.5)] bg-[rgba(16,185,129,0.12)] px-1.5 text-[10px] text-[var(--nx-status-success)] transition-colors hover:bg-[var(--nx-status-success)] hover:text-white disabled:opacity-50"
                          >
                            确认转正
                          </button>
                        ) : null}
                        {showTransition ? (
                          <select
                            data-knowledge-row-status
                            aria-label={`${item.title} 状态推进`}
                            value={item.status}
                            disabled={writePending}
                            onChange={(event) => {
                              const target = event.target.value
                              if (target && target !== item.status) {
                                setActionError(null)
                                setQuickTarget({
                                  item,
                                  target: target as QuickTarget['target'],
                                })
                              }
                            }}
                            title="变更生命周期状态（需二次确认）"
                            className={cn(
                              'h-7 max-w-28 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 text-[10px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none',
                            )}
                          >
                            <option value={item.status} disabled>
                              {statusMeta?.label ?? item.status}
                            </option>
                            {targets.map((target) => (
                              <option key={target} value={target}>
                                {KNOWLEDGE_STATUS_META[target].label}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {showConfirm || showTransition ? null : (
                          <button
                            type="button"
                            data-knowledge-row-review
                            aria-label={`审查 ${item.title}`}
                            disabled={writePending}
                            onClick={() => openRow(item)}
                            className="flex h-7 items-center rounded-sm border border-transparent px-1.5 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-50"
                          >
                            查看 / 审查
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

      {/* 确认转正二次确认（RL-06 阻断） */}
      {confirmItem ? (
        <KnowledgeConfirmModal
          testId="knowledge-row-confirm-modal"
          title="确认转正知识记录"
          description={`「${confirmItem.title}」将转入活跃状态并进入正常检索引用，此操作会写入审核记录。`}
          confirmLabel="确认转正"
          pending={confirmMutation.isPending}
          error={actionError}
          onCancel={() => {
            if (confirmMutation.isPending) return
            setConfirmItem(null)
            setActionError(null)
          }}
          onConfirm={() =>
            confirmMutation.mutate(confirmItem.id, {
              onSuccess: () => {
                setConfirmItem(null)
                setActionError(null)
              },
              onError: (error) => {
                setActionError(resolveErrorMessage(error, '确认转正失败，请重试'))
              },
            })
          }
        />
      ) : null}

      {/* 状态推进二次确认（RL-06 阻断） */}
      {quickTarget ? (
        <KnowledgeConfirmModal
          testId="knowledge-row-transition-modal"
          title="确认变更知识状态"
          description={`「${quickTarget.item.title}」将由「${KNOWLEDGE_STATUS_META[quickTarget.item.status].label}」推进至「${KNOWLEDGE_STATUS_META[quickTarget.target].label}」，并写入审核记录。`}
          confirmLabel={`推进至${KNOWLEDGE_STATUS_META[quickTarget.target].label}`}
          pending={transitionMutation.isPending}
          error={actionError}
          onCancel={() => {
            if (transitionMutation.isPending) return
            setQuickTarget(null)
            setActionError(null)
          }}
          onConfirm={() =>
            transitionMutation.mutate(
              { id: quickTarget.item.id, status: quickTarget.target },
              {
                onSuccess: () => {
                  setQuickTarget(null)
                  setActionError(null)
                },
                onError: (error) => {
                  setActionError(resolveErrorMessage(error, '状态推进失败，请重试'))
                },
              },
            )
          }
        />
      ) : null}

      {confirmMutation.isPending || transitionMutation.isPending ? (
        <span className="sr-only" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          知识治理写入中…
        </span>
      ) : null}
    </section>
  )
}

export default KnowledgeListTable
