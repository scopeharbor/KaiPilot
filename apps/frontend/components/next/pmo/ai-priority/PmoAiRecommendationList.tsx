'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronRight, FilterX, RefreshCw, ServerCrash } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import type {
  PmoAiStatus,
  PmoFullSource,
  PmoRecommendationQueueItem,
  PmoRecommendationSource,
  PmoRecommendationStatus,
  RecommendationSeverity,
} from '@aiproj/types'
import {
  PMO_AI_STATUS_LABELS,
  PMO_RECOMMENDATION_SOURCE_LABELS,
  RECOMMENDATION_SEVERITY_LABELS,
  RECOMMENDATION_SOURCE_LABELS,
  RECOMMENDATION_STATUS_LABELS,
} from '@aiproj/types'

/**
 * PMO AI 优先级推荐队列（v3-ui-next-pmo-domain W5 · tasks 5.2，
 * spec「PMO AI 优先级推荐建议-审阅-采纳闭环」）。
 *
 * - 高密度队列行：来源标签（PMO_RECOMMENDATION_SOURCE_LABELS）、标题/描述、
 *   目标项目引用（TargetRef 语义：项目实体 projectId/projectName）、状态徽标
 *   （RECOMMENDATION_STATUS_LABELS）、AI 状态（PMO_AI_STATUS_LABELS）；stale 行
 *   降透明并带「数据过期」双通道徽标；
 * - 状态/来源筛选与分页状态由工作台容器持有，本组件为受控队列（选择回执 onSelect）；
 * - 徽标一律「颜色 + 文字」双通道（RL-15），颜色只经 --nx-* 令牌或固定透明度展开。
 */

// ─── 双通道徽标色表（供列表/详情/浮层域内复用）────────────────────────────────

export const REC_STATUS_CHIP: Record<PmoRecommendationStatus, string> = {
  new: 'border-[rgba(56,189,248,0.45)] bg-[rgba(56,189,248,0.08)] text-[var(--nx-accent)]',
  reviewing: 'border-[rgba(192,132,252,0.45)] bg-[rgba(192,132,252,0.08)] text-[var(--nx-chart-7)]',
  accepted:
    'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.08)] text-[var(--nx-status-success)]',
  dismissed:
    'border-[rgba(122,139,161,0.35)] bg-[rgba(122,139,161,0.08)] text-[var(--nx-text-secondary)]',
  snoozed:
    'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.08)] text-[var(--nx-status-warning)]',
  converted: 'border-[rgba(52,211,153,0.45)] bg-[rgba(52,211,153,0.08)] text-[var(--nx-chart-3)]',
  expired: 'border-[rgba(122,139,161,0.25)] bg-transparent text-[var(--nx-text-muted)]',
}

export const REC_SEVERITY_CHIP: Record<RecommendationSeverity, string> = {
  critical:
    'border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.08)] text-[var(--nx-status-danger)]',
  high: 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.08)] text-[var(--nx-status-warning)]',
  medium: 'border-[rgba(56,189,248,0.45)] bg-[rgba(56,189,248,0.08)] text-[var(--nx-accent)]',
  low: 'border-[rgba(34,211,238,0.45)] bg-[rgba(34,211,238,0.08)] text-[var(--nx-chart-6)]',
  info: 'border-[rgba(122,139,161,0.35)] bg-transparent text-[var(--nx-text-muted)]',
}

export const AI_STATUS_CHIP: Record<PmoAiStatus, string> = {
  none: 'border-[rgba(122,139,161,0.35)] bg-transparent text-[var(--nx-text-muted)]',
  generating: 'border-[rgba(56,189,248,0.45)] bg-[rgba(56,189,248,0.08)] text-[var(--nx-accent)]',
  available:
    'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.08)] text-[var(--nx-status-success)]',
  stale:
    'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.08)] text-[var(--nx-status-warning)]',
  failed: 'border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.08)] text-[var(--nx-status-danger)]',
  unavailable: 'border-[rgba(122,139,161,0.35)] bg-transparent text-[var(--nx-text-muted)]',
}

export function sourceLabelOf(source: PmoFullSource): string {
  return (
    PMO_RECOMMENDATION_SOURCE_LABELS[source as PmoRecommendationSource] ??
    (RECOMMENDATION_SOURCE_LABELS as Record<string, string | undefined>)[source] ??
    source
  )
}

/**
 * 审阅动作可见性（后端 PmoAiPriorityRecommendationPolicy 降级链的 UI 镜像：
 * manage → portfolio:view + recommendation:manage；专用权限注册后同链放行）。
 */
export function useCanReviewPmoRecommendations(): boolean {
  const { canAny } = usePermissions()
  return canAny(['recommendation:manage', 'portfolio:ai-priority-recommendations:manage'])
}

/** 中性时间格式（zh-CN，24h）。 */
export function formatNxDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

// ─── 队列 ────────────────────────────────────────────────────────────────────

export interface PmoAiRecommendationListProps {
  items: PmoRecommendationQueueItem[]
  selectedId: number | null
  onSelect: (id: number) => void
}

export function PmoAiRecommendationList({
  items,
  selectedId,
  onSelect,
}: PmoAiRecommendationListProps) {
  return (
    <div data-pmo-ai-list className="flex flex-col gap-2" aria-label="AI 优先级推荐队列">
      {items.map((item) => {
        const selected = item.id === selectedId
        const statusLabel = RECOMMENDATION_STATUS_LABELS[item.status] ?? item.status
        const aiLabel = PMO_AI_STATUS_LABELS[item.aiStatus] ?? item.aiStatus
        const score =
          item.priorityContext.scoringAvailable && item.priorityContext.priorityScore !== null
            ? item.priorityContext.priorityScore.toFixed(0)
            : null
        return (
          <article
            key={item.id}
            data-pmo-ai-row
            data-pmo-ai-row-id={item.id}
            aria-pressed={selected}
            role="button"
            tabIndex={0}
            aria-label={`查看推荐：${item.title}`}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(item.id)
              }
            }}
            className={cn(
              'flex cursor-pointer flex-col gap-2 rounded-md border bg-[var(--nx-workspace-surface)] p-3 transition-colors',
              item.stale && 'opacity-60',
              selected
                ? 'border-[var(--nx-border-focus)] ring-1 ring-[var(--nx-border-focus)]'
                : 'border-[var(--nx-border-hairline)] hover:border-[var(--nx-border-focus)]',
            )}
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold text-[var(--nx-text-primary)]">
                  {item.title}
                </span>
                <span
                  data-pmo-ai-row-status
                  className={cn(
                    'shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px]',
                    REC_STATUS_CHIP[item.status] ?? REC_STATUS_CHIP.expired,
                  )}
                >
                  {statusLabel}
                </span>
                {item.stale ? (
                  <span
                    data-pmo-ai-row-stale
                    className="shrink-0 rounded-sm border border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.08)] px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)]"
                  >
                    数据过期
                  </span>
                ) : null}
              </div>
              <ChevronRight
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]"
                aria-hidden
              />
            </div>
            <p className="line-clamp-2 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
              {item.summary}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span
                data-pmo-ai-row-source
                className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[var(--nx-text-secondary)]"
              >
                {sourceLabelOf(item.sourceType)}
              </span>
              <span
                data-pmo-ai-row-ai
                className={cn(
                  'rounded-sm border px-1.5 py-0.5',
                  AI_STATUS_CHIP[item.aiStatus] ?? AI_STATUS_CHIP.none,
                )}
              >
                {aiLabel}
              </span>
              <span
                data-pmo-ai-row-severity
                className={cn(
                  'rounded-sm border px-1.5 py-0.5',
                  REC_SEVERITY_CHIP[item.severity] ?? REC_SEVERITY_CHIP.info,
                )}
              >
                {RECOMMENDATION_SEVERITY_LABELS[item.severity] ?? item.severity}
              </span>
              <span
                data-pmo-ai-row-target
                className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[var(--nx-text-secondary)]"
              >
                目标项目 #{item.projectId}
                {item.projectName ? ` · ${item.projectName}` : ''}
              </span>
              {score !== null ? (
                <span className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 font-mono text-[var(--nx-text-secondary)]">
                  {score}
                </span>
              ) : null}
              <span className="ml-auto text-[var(--nx-text-muted)]">
                {formatNxDateTime(item.createdAt)}
              </span>
            </div>
          </article>
        )
      })}
    </div>
  )
}

// ─── 空态 ────────────────────────────────────────────────────────────────────

export function PmoAiQueueEmptyState({
  hasActiveFilters,
  onClearFilters,
}: {
  hasActiveFilters: boolean
  onClearFilters: () => void
}) {
  return (
    <div
      data-pmo-ai-empty
      className="flex min-h-[40vh] flex-col items-center justify-center gap-2.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
    >
      <FilterX className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
      <p className="text-xs font-medium text-[var(--nx-text-primary)]">当前没有需要关注的推荐</p>
      <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
        {hasActiveFilters
          ? '当前筛选条件下暂无推荐，可清除筛选查看全部队列。'
          : '所有项目状态良好，或尚未生成推荐候选。'}
      </p>
      {hasActiveFilters ? (
        <button
          type="button"
          data-pmo-ai-empty-clear
          onClick={onClearFilters}
          className="mt-1 h-7 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          清除筛选并查看全部
        </button>
      ) : null}
    </div>
  )
}

// ─── 错误卡（诚实降级：G1 路由未注册 → 404 文案不伪造数据）────────────────────

export function PmoAiQueueErrorCard({
  status,
  message,
  onRetry,
}: {
  status: number | null
  message: string | null
  onRetry: () => void
}) {
  const copy =
    status === 404
      ? 'AI 优先级推荐接口尚未开放或不存在（服务端路由注册进行中）。当前页面不会伪造队列数据，请稍后重试。'
      : status === 403
        ? '当前无法查看该数据——数据可能不存在或暂无访问权限。'
        : (message ?? '推荐队列加载失败，请稍后重试。')
  return (
    <div
      data-pmo-ai-error
      role="alert"
      aria-label="推荐队列加载错误"
      className="flex min-h-[45vh] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
    >
      <ServerCrash className="h-7 w-7 text-[var(--nx-status-warning)]" aria-hidden />
      <p className="text-sm font-medium text-[var(--nx-text-primary)]">推荐队列加载失败</p>
      <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">{copy}</p>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          data-pmo-ai-retry
          onClick={onRetry}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          重新加载
        </button>
        <Link
          href="/next"
          data-pmo-ai-error-home
          className="flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)]"
        >
          返回角色首页
        </Link>
      </div>
    </div>
  )
}

// ─── 骨架屏 ──────────────────────────────────────────────────────────────────

export function PmoAiQueueSkeleton() {
  return (
    <div
      data-pmo-ai-skeleton
      role="status"
      aria-label="正在加载 AI 优先级推荐"
      aria-busy="true"
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-3 gap-2 md:grid-cols-5 xl:grid-cols-9">
        {Array.from({ length: 9 }).map((_, index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            aria-hidden
          />
        ))}
      </div>
      <div className="flex gap-2">
        <div className="h-8 w-36 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
        <div className="h-8 w-36 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
      </div>
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-24 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
          aria-hidden
        />
      ))}
    </div>
  )
}

export default PmoAiRecommendationList
