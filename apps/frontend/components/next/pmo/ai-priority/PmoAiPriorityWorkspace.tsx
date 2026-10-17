'use client'

import { ChevronLeft, Loader2, Sparkles } from 'lucide-react'
import * as React from 'react'
import Link from 'next/link'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import {
  usePmoRecommendationList,
  usePmoRecommendationSummary,
  useRefreshPmoRecommendations,
} from '@/hooks/use-pmo-ai-priority-recommendations'
import { cn } from '@/lib/utils'
import type {
  PmoRecommendationListQuery,
  PmoRecommendationSource,
  PmoRecommendationStatus,
} from '@aiproj/types'
import {
  PMO_RECOMMENDATION_SOURCES,
  PMO_RECOMMENDATION_SOURCE_LABELS,
  RECOMMENDATION_STATUSES,
  RECOMMENDATION_STATUS_LABELS,
} from '@aiproj/types'
import {
  PmoAiQueueEmptyState,
  PmoAiQueueErrorCard,
  PmoAiQueueSkeleton,
  PmoAiRecommendationList,
  useCanReviewPmoRecommendations,
} from './PmoAiRecommendationList'
import { PmoAiRecommendationDetailPanel } from './PmoAiRecommendationDetailPanel'

/**
 * PMO AI 优先级推荐工作台（v3-ui-next-pmo-domain W5 · tasks 5.1，
 * spec「PMO AI 优先级推荐建议-审阅-采纳闭环」）。
 *
 * - 数据复用既有 hooks：`usePmoRecommendationList`（GET /pmo/ai-priority-recommendations，
 *   信封含 data/meta/summary）与 `usePmoRecommendationSummary`（GET …/summary）；
 *   摘要计数卡以独立摘要查询为准、列表信封 summary 兜底；status/source 筛选与翻页
 *   全部只触发 GET 重查（RL-01）；
 * - 主从布局：左侧队列（PmoAiRecommendationList）+ 右侧详情/人工审阅面板
 *   （PmoAiRecommendationDetailPanel）。审阅动作 accept/dismiss/snooze/convert 全部
 *   人工确认后经 POST …/:id/status 提交，零自动采纳（RL-01）；「刷新推荐」与审阅
 *   动作入口按 design D5 降级链 UI 镜像（recommendation:manage 或 PMO 专用管理权限
 *   任一）显隐，服务端 policy 终裁；
 * - G1 诚实降级：后端路由未注册（缺口 G1）时队列端点运行期 404，工作台渲染错误卡 +
 *   重试（data-pmo-ai-error / data-pmo-ai-retry），不伪造队列数据；
 * - 三态完备：骨架屏（role="status" + aria-busy，无空态闪烁）/ 语义空态（可清除筛选）
 *   / 错误重试；精确档剥离空间氛围光晕（useImmersionTier），状态一律颜色 + 文字双通道。
 */

const SUMMARY_CARD_KEYS: Array<{ key: string; label: string }> = [
  { key: 'totalCount', label: '总计' },
  { key: 'newCount', label: '待处理' },
  { key: 'reviewingCount', label: '审查中' },
  { key: 'acceptedCount', label: '已采纳' },
  { key: 'dismissedCount', label: '已忽略' },
  { key: 'convertedCount', label: '已转换' },
  { key: 'criticalCount', label: '严重' },
  { key: 'staleCount', label: '数据过期' },
  { key: 'aiAvailableCount', label: 'AI 理由可用' },
] as const

const fieldClass =
  'h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]'
const labelClass = 'mb-1 block text-[10px] text-[var(--nx-text-muted)]'
const selectClass = 'min-w-32'

export function PmoAiPriorityWorkspace() {
  const tier = useImmersionTier()
  const canReview = useCanReviewPmoRecommendations()

  const [statusFilter, setStatusFilter] = React.useState<PmoRecommendationStatus | undefined>()
  const [sourceFilter, setSourceFilter] = React.useState<PmoRecommendationSource | undefined>()
  const [page, setPage] = React.useState(1)
  const [selectedId, setSelectedId] = React.useState<number | null>(null)

  const listQuery = React.useMemo<PmoRecommendationListQuery>(
    () => ({
      page,
      perPage: 20,
      status: statusFilter,
      sourceType: sourceFilter,
    }),
    [page, statusFilter, sourceFilter],
  )

  const listResult = usePmoRecommendationList(listQuery)
  const summaryResult = usePmoRecommendationSummary({ includeWarnings: true })
  const refreshMutation = useRefreshPmoRecommendations()

  const [refreshConfirmOpen, setRefreshConfirmOpen] = React.useState(false)
  const [refreshError, setRefreshError] = React.useState<string | null>(null)
  const refreshConfirmRef = React.useRef<HTMLDivElement | null>(null)

  // 刷新确认弹层：在途刷新（POST …/refresh）期间与「取消」按钮同判据，Escape 不关闭。
  useDialogA11y({
    ref: refreshConfirmRef,
    open: refreshConfirmOpen,
    onClose: () => {
      setRefreshError(null)
      setRefreshConfirmOpen(false)
    },
    canClose: () => !refreshMutation.isPending,
  })

  // 首个响应落盘前才整页骨架；筛选/翻页/失效重查期间以最近一次已落盘数据兜底，
  // 保持工具栏与主从布局不闪断（避免「骨架 → 工具栏卸载 → 再挂载」空态闪烁）。
  const lastLoadedRef = React.useRef<typeof listResult.data>(undefined)
  if (listResult.data) lastLoadedRef.current = listResult.data

  const listData = listResult.data
  const items = listResult.data?.data ?? lastLoadedRef.current?.data ?? []
  const meta = listResult.data?.meta ?? lastLoadedRef.current?.meta
  const summary = summaryResult.data ?? listData?.summary ?? lastLoadedRef.current?.summary
  const hasActiveFilters = statusFilter !== undefined || sourceFilter !== undefined

  // 引导期：首个列表响应未落盘且未报错 → 骨架屏（杜绝空态闪烁）。
  const loading =
    !listResult.isError && !lastLoadedRef.current && (listResult.isPending || listResult.isFetching)

  const retry = React.useCallback(() => {
    void listResult.refetch()
    void summaryResult.refetch()
  }, [listResult, summaryResult])

  const changeStatus = (value: string) => {
    setStatusFilter(value === 'all' ? undefined : (value as PmoRecommendationStatus))
    setPage(1)
  }

  const changeSource = (value: string) => {
    setSourceFilter(value === 'all' ? undefined : (value as PmoRecommendationSource))
    setPage(1)
  }

  const clearFilters = () => {
    setStatusFilter(undefined)
    setSourceFilter(undefined)
    setPage(1)
  }

  return (
    <div
      data-pmo-ai-workspace
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头：标题 + 返回角色首页 + 刷新（manage 门禁） */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Sparkles className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1
              data-pmo-ai-title
              className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              AI 优先级推荐
            </h1>
            <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
              建议 → 人工审阅 → 采纳 · 所有采纳与转化均由人工确认触发
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canReview ? (
            <button
              type="button"
              data-pmo-ai-refresh
              onClick={() => setRefreshConfirmOpen(true)}
              disabled={refreshMutation.isPending}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-50"
            >
              <Sparkles
                className={cn('h-3.5 w-3.5', refreshMutation.isPending && 'animate-spin')}
                aria-hidden
              />
              {refreshMutation.isPending ? '刷新中…' : '刷新推荐'}
            </button>
          ) : null}
          <Link
            href="/next"
            data-pmo-ai-home
            className="flex h-8 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-muted)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            返回角色首页
          </Link>
        </div>
      </header>

      {loading ? (
        <PmoAiQueueSkeleton />
      ) : listResult.isError ? (
        <PmoAiQueueErrorCard
          status={(listResult.error as { status?: number } | null)?.status ?? null}
          message={(listResult.error as { message?: string } | null)?.message ?? null}
          onRetry={retry}
        />
      ) : (
        <>
          {/* 摘要计数卡 */}
          {summary ? (
            <section
              data-pmo-ai-summary
              aria-label="推荐摘要计数"
              className="grid grid-cols-3 gap-2 md:grid-cols-5 xl:grid-cols-9"
            >
              {SUMMARY_CARD_KEYS.map(({ key, label }) => (
                <div
                  key={key}
                  data-pmo-ai-summary-card={key}
                  className="flex min-w-0 flex-col gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2.5"
                >
                  <span className="truncate text-[10px] text-[var(--nx-text-muted)]">{label}</span>
                  <span
                    data-pmo-ai-summary-value
                    className="font-mono text-lg font-semibold leading-none text-[var(--nx-text-primary)]"
                  >
                    {String(summary[key as keyof typeof summary] ?? '—')}
                  </span>
                </div>
              ))}
            </section>
          ) : null}

          {/* 摘要独立查询失败的诚实降级提示（列表数据仍可用） */}
          {summaryResult.isError && listData ? (
            <div
              data-pmo-ai-summary-warning
              role="note"
              className="flex items-center justify-between gap-2 rounded-sm border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3 py-2"
            >
              <p className="text-[11px] text-[var(--nx-text-secondary)]">
                摘要计数暂不可用（接口未就绪或网络异常），列表数据不受影响。
              </p>
              <button
                type="button"
                data-pmo-ai-summary-retry
                onClick={() => void summaryResult.refetch()}
                className="h-6 shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-accent)]"
              >
                重试
              </button>
            </div>
          ) : null}

          {/* 摘要 warnings（AI 不可用/评分过期等双通道提示） */}
          {!summaryResult.isError && summary && summary.warnings.length > 0 ? (
            <div
              data-pmo-ai-warnings
              role="note"
              className="rounded-sm border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs text-[var(--nx-text-secondary)]"
            >
              {summary.warnings.map((item) => item.message).join('；')}
            </div>
          ) : null}

          {/* 筛选工具栏（只读重查） */}
          <div
            data-pmo-ai-filter-bar
            className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
          >
            <label className="flex flex-col">
              <span className={labelClass}>状态</span>
              <select
                data-pmo-ai-filter-status
                value={statusFilter ?? 'all'}
                onChange={(event) => changeStatus(event.target.value)}
                className={cn(fieldClass, selectClass)}
                aria-label="按状态筛选"
              >
                <option value="all">全部状态</option>
                {RECOMMENDATION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {RECOMMENDATION_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              <span className={labelClass}>来源</span>
              <select
                data-pmo-ai-filter-source
                value={sourceFilter ?? 'all'}
                onChange={(event) => changeSource(event.target.value)}
                className={cn(fieldClass, selectClass)}
                aria-label="按来源筛选"
              >
                <option value="all">全部来源</option>
                {PMO_RECOMMENDATION_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {PMO_RECOMMENDATION_SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            </label>
            {hasActiveFilters ? (
              <button
                type="button"
                data-pmo-ai-filter-clear
                onClick={clearFilters}
                className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-accent)]"
              >
                清除筛选
              </button>
            ) : null}
            {meta ? (
              <p className="ml-auto self-center text-[11px] text-[var(--nx-text-muted)]">
                共 {meta.total} 条推荐
              </p>
            ) : null}
          </div>

          {/* 主从布局：队列 + 详情 */}
          {items.length === 0 ? (
            <PmoAiQueueEmptyState
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearFilters}
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="flex min-w-0 flex-col gap-2.5">
                <PmoAiRecommendationList
                  items={items}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
                {meta && meta.totalPages > 1 ? (
                  <nav
                    data-pmo-ai-pagination
                    aria-label="推荐列表分页"
                    className="flex items-center justify-center gap-3"
                  >
                    <button
                      type="button"
                      data-pmo-ai-page-prev
                      disabled={meta.page <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      className="h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:opacity-40"
                    >
                      上一页
                    </button>
                    <span className="font-mono text-[11px] text-[var(--nx-text-muted)]">
                      {meta.page} / {meta.totalPages}
                    </span>
                    <button
                      type="button"
                      data-pmo-ai-page-next
                      disabled={meta.page >= meta.totalPages}
                      onClick={() => setPage((current) => current + 1)}
                      className="h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:opacity-40"
                    >
                      下一页
                    </button>
                  </nav>
                ) : null}
              </div>
              {selectedId !== null ? (
                <PmoAiRecommendationDetailPanel
                  id={selectedId}
                  onClose={() => setSelectedId(null)}
                />
              ) : null}
            </div>
          )}
        </>
      )}

      {/* 刷新推荐二次确认（Decision 4：refresh 重算一律二次确认，RL-01） */}
      {refreshConfirmOpen ? (
        <div
          data-pmo-ai-refresh-confirm
          ref={refreshConfirmRef}
          role="dialog"
          tabIndex={-1}
          aria-modal="true"
          aria-label="确认刷新推荐候选"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] p-4">
            <h4 className="text-sm font-semibold text-[var(--nx-text-primary)]">
              确认刷新推荐候选
            </h4>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
              将重新扫描组合数据并生成/合并推荐候选（POST …/refresh）。此操作仅影响推荐
              队列本身，不会修改任何项目事实；可去重合并既有候选。
            </p>
            {refreshError ? (
              <p
                data-pmo-ai-refresh-error
                role="alert"
                className="mt-2 rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
              >
                {refreshError}
              </p>
            ) : null}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                data-pmo-ai-refresh-confirm-cancel
                disabled={refreshMutation.isPending}
                onClick={() => {
                  if (refreshMutation.isPending) return
                  setRefreshError(null)
                  setRefreshConfirmOpen(false)
                }}
                className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-pmo-ai-refresh-confirm-ok
                disabled={refreshMutation.isPending}
                onClick={() => {
                  setRefreshError(null)
                  refreshMutation.mutate(undefined, {
                    onSuccess: () => setRefreshConfirmOpen(false),
                    onError: (error) =>
                      setRefreshError(
                        error instanceof Error ? error.message : '刷新失败，请稍后重试',
                      ),
                  })
                }}
                className="flex h-8 items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
              >
                {refreshMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : null}
                确认刷新
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default PmoAiPriorityWorkspace
