'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Gavel, Plus } from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { parseDecisionUrlFilters, serializeDecisionUrlFilters } from '@/lib/api/decision-workbench'
import { cn } from '@/lib/utils'
import type { PmoDecisionCaseListQuery } from '@aiproj/types'
import { PMO_DECISION_CASE_STATUS_META } from './PmoDecisionCaseTable'
import { PmoDecisionCaseTable } from './PmoDecisionCaseTable'
import { PmoDecisionCreateDialog } from './PmoDecisionCreateDialog'

/**
 * PMO 决策工作台队列工作台（v3-ui-next-pmo-domain W6 · tasks 6.1，
 * spec「决策工作台队列与议题建立」）。
 *
 * - URL 过滤契约：状态/分页筛选全部经 `parseDecisionUrlFilters` /
 *   `serializeDecisionUrlFilters` 往返（?status=…&page=…），刷新/回退可还原；
 * - 状态 chips 单选（draft/collecting-evidence/ready-for-review/under-review/
 *   decided/deferred/superseded + 全部）；切筛重置回第 1 页；
 * - 队列列表（含骨架/空态/错误重试/分页）由 PmoDecisionCaseTable 承接；
 *   行点击进入 `/next/pmo/decisions/:decisionId`（携带当前过滤串）；
 * - 「新建议题」入口仅 `pmo_decision:manage` 可见（后端 authorizeManage 裁决为准）；
 * - 页头提供「← 返回角色首页」动线；根节点随精确档剥离开放氛围光晕。
 */
export function PmoDecisionWorkspace() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tier = useImmersionTier()
  const { canAny } = usePermissions()
  const canManage = canAny(['pmo_decision:manage'])

  const filters = React.useMemo(
    () => parseDecisionUrlFilters(Object.fromEntries(searchParams.entries())),
    [searchParams],
  )

  const [createOpen, setCreateOpen] = React.useState(false)

  /** 合并部分查询并写回 URL（serialize 契约：undefined 键自动省略、page=1 省略）。 */
  function applyQueryPatch(patch: PmoDecisionCaseListQuery): void {
    const merged: PmoDecisionCaseListQuery = { ...filters, ...patch }
    const qs = serializeDecisionUrlFilters(merged)
    router.replace('/next/pmo/decisions' + qs, { scroll: false })
  }

  function selectStatus(status: PmoDecisionCaseListQuery['status']): void {
    applyQueryPatch({ status })
    // 状态切换即重置分页（分页键在 patch 中省略 → URL 回到第 1 页）。
  }

  const page = filters.page ?? 1

  return (
    <div
      data-pmo-decisions-workspace
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头：返回角色首页 + 标题 + 新建议题 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            data-pmo-decisions-back-home
            aria-label="返回角色首页"
            onClick={() => router.push('/next')}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回角色首页
          </button>
          <span aria-hidden className="h-6 w-px bg-[var(--nx-border-hairline)]" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
                <Gavel className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
              </span>
              <h2
                data-pmo-decisions-title
                className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
              >
                决策工作台
              </h2>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
              组织决策议题队列 · 决策 ≠ 执行：结论仅生成受控下游交接
            </p>
          </div>
        </div>
        {canManage ? (
          <button
            type="button"
            data-pmo-decisions-create-open
            onClick={() => setCreateOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            新建议题
          </button>
        ) : null}
      </header>

      {/* 状态筛选 chips（单选；写回 URL 契约） */}
      <div
        data-pmo-decisions-filter-bar
        role="tablist"
        aria-label="按状态筛选决策议题"
        className="flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2"
      >
        <button
          type="button"
          role="tab"
          data-case-filter-status="all"
          aria-selected={filters.status === undefined}
          onClick={() => selectStatus(undefined)}
          className={cn(
            'h-7 rounded-sm px-3 text-xs transition-colors',
            filters.status === undefined
              ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
              : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
          )}
        >
          全部
        </button>
        {(
          Object.keys(PMO_DECISION_CASE_STATUS_META) as Array<
            keyof typeof PMO_DECISION_CASE_STATUS_META
          >
        ).map((status) => {
          const active = filters.status === status
          return (
            <button
              key={status}
              type="button"
              role="tab"
              data-case-filter-status={status}
              aria-selected={active}
              onClick={() => selectStatus(active ? undefined : status)}
              className={cn(
                'h-7 rounded-sm px-3 text-xs transition-colors',
                active
                  ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                  : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
              )}
            >
              {PMO_DECISION_CASE_STATUS_META[status].label}
            </button>
          )
        })}
      </div>

      {/* 议题队列（三态 + 分页在表格内闭环） */}
      <PmoDecisionCaseTable
        filters={filters}
        page={page}
        onPageChange={(nextPage) => applyQueryPatch({ page: nextPage > 1 ? nextPage : undefined })}
        onOpenCase={(decisionId) => {
          // 携带当前过滤串：返回详情页「返回队列」可还原上下文。
          const qs = serializeDecisionUrlFilters(filters)
          router.push(`/next/pmo/decisions/${decisionId}${qs}`)
        }}
      />

      {/* 建卡对话框（显式用户动作；pmo_decision:manage） */}
      <PmoDecisionCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

export default PmoDecisionWorkspace
