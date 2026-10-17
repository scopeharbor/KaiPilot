'use client'

import * as React from 'react'
import { Building2, RefreshCw, ShieldAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { PermissionGuard } from '@/components/PermissionGuard'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import {
  fetchCrossProjectChangeQueue,
  pmoChangeQueueKeys,
  type ChangeQueueStatusFacet,
  type CrossProjectChangeRequestItem,
} from '@/lib/next/pmo-change-queue-composer'
import {
  DEFAULT_FILTER_STATE,
  PmoChangeQueueFilterToolbar,
  filterChangeQueueItems,
  type ChangeQueueFilterState,
} from '@/components/next/pmo/change-queue/PmoChangeQueueFilterToolbar'
import { PmoChangeQueueLens } from '@/components/next/pmo/change-queue/PmoChangeQueueLens'
import { PmoChangeApprovalDrawer } from '@/components/next/pmo/change-queue/PmoChangeApprovalDrawer'

/**
 * PMO 全局变更审批队列独立路由（/next/pmo/change-queue，
 * v3-ui-next-batch4-reports-change-queue W3 · tasks 3.7，
 * spec「跨项目变更审批队列高密度工作台」）。
 *
 * - 页面级门禁：`portfolio:view`；无权限渲染受限横幅且工作台不挂载、
 *   全部数据接口零请求（RL-06）；
 * - 组织上下文从会话取 `selectEffectiveOrganizationId`；orgId 未水合渲染
 *   「请先选择组织」引导态且零请求（RL-05）；
 * - 装配：多项目并发合成器（W3 tasks 3.1）→ 多维筛选工具栏（3.5）→ 高密度表格
 *   镜头（3.3）→ 审批抽屉（W4 tasks 4.1）；审批成功后由抽屉内部触发集中失效网
 *   联动（W4 tasks 4.7），本页队列查询共享 `pmoChangeQueueKeys` 缓存前缀自动刷新。
 */
export default function PmoChangeQueuePage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard
      require="portfolio:view"
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看全局变更审批队列的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 portfolio:view 权限方可查看 PMO 全局变更审批队列。请联系组织管理员授予权限。
          </p>
        </div>
      }
    >
      {organizationId === null ? (
        <div
          data-org-no-organization
          className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 text-center"
        >
          <Building2 className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            变更审批队列是组织级组合工作台，需要有效租户上下文。请先切换到组织工作区后重试。
          </p>
        </div>
      ) : (
        <PmoChangeQueueWorkspace organizationId={organizationId} />
      )}
    </PermissionGuard>
  )
}

function PmoChangeQueueWorkspace({ organizationId }: { organizationId: number }) {
  const tier = useImmersionTier()
  const [filters, setFilters] = React.useState<ChangeQueueFilterState>(DEFAULT_FILTER_STATE)
  const [page, setPage] = React.useState(1)
  const [selectedItem, setSelectedItem] = React.useState<CrossProjectChangeRequestItem | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  const queueQuery = useQuery({
    queryKey: pmoChangeQueueKeys.list(organizationId, {}),
    queryFn: () => fetchCrossProjectChangeQueue(),
    staleTime: 30_000,
  })

  const items = queueQuery.data?.items ?? []

  const filteredItems = React.useMemo(
    () => filterChangeQueueItems(items, filters),
    [items, filters],
  )

  const facetCounts = React.useMemo(() => {
    const facets: ChangeQueueStatusFacet[] = [
      'all',
      'pending',
      'approved',
      'returned',
      'rejected',
      'implemented',
    ]
    const counts: Partial<Record<ChangeQueueStatusFacet, number>> = {}
    for (const facet of facets) {
      counts[facet] = filterChangeQueueItems(items, { ...filters, statusFacet: facet }).length
    }
    return counts
  }, [items, filters])

  const projectOptions = React.useMemo(() => {
    const map = new Map<number, { id: number; name: string; code?: string | null }>()
    for (const item of items) {
      if (!map.has(item.projectId)) {
        map.set(item.projectId, {
          id: item.projectId,
          name: item.projectName,
          code: item.projectCode,
        })
      }
    }
    return Array.from(map.values())
  }, [items])

  function handleResetPage() {
    setPage(1)
  }

  function handleRowClick(item: CrossProjectChangeRequestItem) {
    setSelectedItem(item)
    setDrawerOpen(true)
  }

  if (queueQuery.isLoading || queueQuery.isPending) {
    return (
      <div
        data-pmo-change-queue-page
        role="status"
        aria-busy="true"
        aria-label="正在加载全局变更审批队列"
        className="flex min-h-[60vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5"
      >
        <div className="h-9 w-64 animate-pulse rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
        <div className="h-24 w-full animate-pulse rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
        <div className="h-64 w-full animate-pulse rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
      </div>
    )
  }

  if (queueQuery.isError) {
    return (
      <div
        data-pmo-change-queue-error
        role="alert"
        className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-8 text-center"
      >
        <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
          全局变更审批队列加载失败
        </h3>
        <button
          type="button"
          data-action="retry-change-queue"
          onClick={() => void queueQuery.refetch()}
          className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          重新载入
        </button>
      </div>
    )
  }

  return (
    <div
      data-pmo-change-queue-page
      data-immersion={tier}
      className="flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">全局变更审批队列</h1>
          <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
            共 {items.length} 条跨项目变更请求 · 第 {page} 页
          </p>
        </div>
      </header>

      <PmoChangeQueueFilterToolbar
        projects={projectOptions}
        filters={filters}
        onFilterChange={setFilters}
        onResetPage={handleResetPage}
        facetCounts={facetCounts}
      />

      <PmoChangeQueueLens items={filteredItems} onRowClick={handleRowClick} tier={tier} />

      <PmoChangeApprovalDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        changeRequest={selectedItem}
        onSuccess={() => void queueQuery.refetch()}
      />
    </div>
  )
}
