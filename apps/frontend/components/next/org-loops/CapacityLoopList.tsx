'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Inbox, Loader2, ShieldAlert } from 'lucide-react'
import { useRcclLoops } from '@/hooks/use-resource-capacity-loops'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import {
  parseLoopsUrlFilters,
  RCCL_STATE_OPTIONS,
  resolveRcclListPayload,
  serializeLoopsUrlFilters,
} from '@/lib/next/org-loops/org-loops-adapter'
import { CapacityLoopRowCard } from './CapacityLoopRowCard'

/**
 * 容量闭环列表工作台（v3-ui-next-org-portfolio-domains W6 · tasks 6.2/6.3，
 * spec「资源容量闭环咨询工作台（列表与详情）」）。
 *
 * - 消费 useRcclLoops（GET /organizations/:organizationId/resource-capacity-loops，
 *   org 级 hooks 内部自带租户上下文，未选组织时 enabled=false 由页面引导态承接）；
 * - 状态筛选与分页以 URL query 为唯一事实来源（透传既有
 *   parse/serializeRcclUrlFilters 契约，刷新/分享不丢状态，restorable）；
 * - 三态闭环：几何匹配骨架屏（aria-busy）/ 语义化空态 / 错误态区分受限（中性
 *   文案）与 5xx 可重试；
 * - 空态引导文案「从已授权的资源缺口或需求预测创建第一个闭环计划」并附两个
 *   来源页深链（/next/organization/resource-gaps、/resource-demand-forecasting）；
 * - 沉浸阶梯：precise 下纯色工作面、剥离氛围光晕（useImmersionTier）。
 */
export function CapacityLoopList() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tier = useImmersionTier()

  const filters = React.useMemo(
    () => parseLoopsUrlFilters(Object.fromEntries(searchParams.entries())),
    [searchParams],
  )
  const { data, isLoading, isError, error, refetch } = useRcclLoops(filters)

  const { rows, meta } = React.useMemo(() => resolveRcclListPayload(data), [data])
  const hasStateFilter = Boolean(filters.state)

  function applyFilters(next: { state?: string; page?: number }) {
    const qs = serializeLoopsUrlFilters({
      state: next.state === undefined ? filters.state : next.state,
      page: next.page,
    })
    router.push(pathname + qs)
  }

  function selectState(state: string) {
    // 状态切换同时回到第一页（旧页语义）。
    router.push(pathname + serializeLoopsUrlFilters({ state: state || undefined }))
  }

  // ── 三态：加载骨架屏 ──
  if (isLoading) {
    return (
      <div
        data-rccl-list
        data-rccl-loading
        aria-busy="true"
        className={cn(
          'flex flex-col gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
          tier === 'precise'
            ? 'bg-[var(--nx-workspace-bg)]'
            : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
        )}
      >
        <div className="h-5 w-56 rounded bg-[var(--nx-bg-1)]" />
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-20 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
          />
        ))}
      </div>
    )
  }

  // ── 三态：错误（受限中性态 vs 可重试态）──
  if (isError) {
    const status = (error as { status?: number } | undefined)?.status
    const restricted = status === 403 || status === 404
    return (
      <div
        data-rccl-list
        data-rccl-error
        role="alert"
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] px-8 py-14 text-center',
          tier === 'precise'
            ? 'bg-[var(--nx-workspace-bg)]'
            : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
        )}
      >
        <ShieldAlert
          className={cn(
            'h-8 w-8',
            restricted ? 'text-[var(--nx-text-muted)]' : 'text-[var(--nx-status-warning)]',
          )}
          aria-hidden
        />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
          {restricted ? '容量闭环数据不可用' : '加载失败'}
        </h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          {restricted
            ? '当前组织上下文不可用或会话无权访问容量闭环数据。请联系组织管理员，或返回角色首页重新选择组织。'
            : '容量闭环列表暂时无法加载，请稍后重试。'}
        </p>
        {restricted ? (
          <button
            type="button"
            data-rccl-restricted-back-home
            onClick={() => router.push('/next')}
            className="flex h-9 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            返回角色首页
          </button>
        ) : (
          <button
            type="button"
            data-rccl-retry
            onClick={() => void refetch()}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <Loader2 className="h-3.5 w-3.5" aria-hidden />
            重试
          </button>
        )}
      </div>
    )
  }

  const totalPages = meta?.totalPages ?? 0
  const currentPage = meta?.page ?? filters.page ?? 1
  const showNoResults = rows.length === 0 && (hasStateFilter || (meta !== null && meta.total > 0))

  return (
    <div
      data-rccl-list
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头：标题 + 状态筛选（URL query 为唯一事实来源） */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">资源容量预测闭环</h1>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            基线预测 → 情景与调配建议 → 人工选择 → 受控移交 → 同口径复测 → 人工复核
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--nx-text-secondary)]">
          <span>状态筛选</span>
          <select
            value={filters.state ?? ''}
            onChange={(event) => selectState(event.target.value)}
            aria-label="按状态筛选闭环"
            data-rccl-state-filter
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <option value="">全部</option>
            {RCCL_STATE_OPTIONS.map((option) => (
              <option key={option.state} value={option.state}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {/* 空态：引导创建第一个闭环（深链来源页） */}
      {rows.length === 0 && !showNoResults ? (
        <div
          data-rccl-empty
          role="status"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] px-8 py-12 text-center"
        >
          <Inbox className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm font-medium text-[var(--nx-text-primary)]">尚无容量闭环计划</p>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            从已授权的资源缺口或需求预测创建第一个闭环计划。创建后即可在本页跟踪
            模拟、选择、移交与复核全流程。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/next/organization/resource-gaps"
              data-rccl-empty-gaps-link
              className="flex h-9 items-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3.5 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              去资源缺口分析
            </Link>
            <Link
              href="/next/organization/resource-demand-forecasting"
              data-rccl-empty-demand-link
              className="flex h-9 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
            >
              去资源需求预测
            </Link>
          </div>
        </div>
      ) : null}

      {/* 无匹配结果（状态筛选/越界页）：清除筛选回列表 */}
      {showNoResults ? (
        <div
          data-rccl-no-results
          role="status"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] px-8 py-10 text-center"
        >
          <p className="text-sm font-medium text-[var(--nx-text-primary)]">
            没有符合当前筛选的闭环记录
          </p>
          <p className="max-w-md text-xs text-[var(--nx-text-muted)]">
            {hasStateFilter
              ? '该状态下尚无容量闭环，可清除筛选查看全部记录。'
              : '当前页没有记录，可能已被移除。'}
          </p>
          <button
            type="button"
            data-rccl-clear-filters
            onClick={() => router.push(pathname)}
            className="flex h-9 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            清除筛选
          </button>
        </div>
      ) : null}

      {/* 列表行 */}
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="容量闭环列表" data-rccl-list-rows>
          {rows.map((loop) => (
            <li key={loop.id}>
              <Link
                href={`${pathname}/${loop.id}`}
                data-rccl-list-row={loop.id}
                aria-label={`查看容量闭环 ${loop.title}`}
                className="block rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3 transition-colors hover:border-[var(--nx-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
              >
                <CapacityLoopRowCard loop={loop} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {/* 分页（envelope 无 meta 时不渲染，避免假控件） */}
      {meta !== null && totalPages > 1 ? (
        <nav className="flex items-center justify-between" aria-label="分页" data-rccl-pagination>
          <button
            type="button"
            data-rccl-prev-page
            disabled={currentPage <= 1}
            onClick={() => applyFilters({ page: currentPage - 1 })}
            className="flex h-8 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            上一页
          </button>
          <span className="text-xs text-[var(--nx-text-muted)]">
            第 {currentPage} / {totalPages} 页，共 {meta?.total ?? rows.length} 条
          </span>
          <button
            type="button"
            data-rccl-next-page
            disabled={currentPage >= totalPages}
            onClick={() => applyFilters({ page: currentPage + 1 })}
            className="flex h-8 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一页
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </nav>
      ) : null}
    </div>
  )
}

export default CapacityLoopList
