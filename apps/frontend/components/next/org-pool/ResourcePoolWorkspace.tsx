'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, ArrowRight, EyeOff, Users, Wrench, Zap } from 'lucide-react'
import {
  organizationResourcePoolApi,
  organizationResourcePoolKeys,
} from '@/lib/api/organization-resource-pool'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import {
  ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES,
  ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES,
  ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES,
  ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES,
  type OrganizationResourcePoolCapacityMatrix,
  type OrganizationResourcePoolDemandGap,
  type OrganizationResourcePoolQuery,
  type OrganizationResourcePoolResourceRow,
  type OrganizationResourcePoolSkillItem,
  type OrganizationResourcePoolSummary,
} from '@aiproj/types'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import {
  formatPoolHours,
  getPoolConflictSeverityLabel,
  getPoolConflictSeverityTone,
  getPoolLoadLabel,
  getPoolLoadTone,
  POOL_VIEW_LABELS,
} from '@/lib/next/org-pool/org-pool-adapter'
import { PoolSummaryCards } from './PoolSummaryCards'
import { PoolCapacityMatrix, PoolLoadBadge, PoolUtilizationBar } from './PoolCapacityMatrix'
import { PoolConflictPreview, PoolPager } from './PoolConflictPreview'

/**
 * 组织资源池分析工作台（v3-ui-next-org-portfolio-domains W4 · tasks 4.3，
 * spec「组织资源池与资源缺口分析」）。
 *
 * - URL query 为筛选唯一事实来源（restorable）：view / page / loadStatus /
 *   conflictSeverity / search / sort / order 全部经白名单解析回写 URL，
 *   刷新与分享不丢状态；
 * - 只读铁律：Tab 切换与一切筛选交互零写请求（RL-01）；受限行/列/指标消费
 *   后端受限标记做中性脱敏（RL-05）；
 * - 数据层说明：`@aiproj/types` 契约下既有 hooks 的 summary/skills/capacity
 *   在 lib/api 单层解包（apiFetch 已取 body.data）之上又做了一次 `.data` 取值，
 *   运行时恒为 undefined（探针实证，见 W4 收尾报告）；本工作台直接消费
 *   `organizationResourcePoolApi` + 既有 query key 工厂（缓存键与 mutation
 *   失效完全同源），不做任何新 fetch 封装；中央修复 hooks 后本消费方式不变。
 */

type PoolViewMode = (typeof ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES)[number]

// ---------------------------------------------------------------------------
// URL 状态解析 / 序列化（纯函数，白名单收敛）
// ---------------------------------------------------------------------------

export interface PoolUrlState {
  view: PoolViewMode
  page: number
  loadStatus: string | null
  conflictSeverity: string | null
  search: string | null
  sort: string | null
  order: 'asc' | 'desc' | null
}

const POOL_DEFAULT_VIEW = 'matrix'

export function parsePoolUrlState(searchParams: URLSearchParams): PoolUrlState {
  const rawView = searchParams.get('view')
  const view = (
    ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES.includes(rawView as PoolViewMode)
      ? rawView
      : POOL_DEFAULT_VIEW
  ) as PoolViewMode
  const rawPage = Number(searchParams.get('page') ?? '1')
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1
  const rawLoad = searchParams.get('loadStatus')
  const loadStatus = ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES.includes(
    rawLoad as (typeof ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES)[number],
  )
    ? rawLoad
    : null
  const rawSeverity = searchParams.get('conflictSeverity')
  const conflictSeverity = ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES.includes(
    rawSeverity as (typeof ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES)[number],
  )
    ? rawSeverity
    : null
  const rawSort = searchParams.get('sort')
  const sort = ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES.includes(
    rawSort as (typeof ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES)[number],
  )
    ? rawSort
    : null
  const rawOrder = searchParams.get('order')
  const order: 'asc' | 'desc' | null = rawOrder === 'asc' || rawOrder === 'desc' ? rawOrder : null
  const search = searchParams.get('search')?.trim().slice(0, 200) || null
  return { view, page, loadStatus, conflictSeverity, search, sort, order }
}

export function serializePoolUrlState(state: PoolUrlState): Record<string, string> {
  const params: Record<string, string> = { view: state.view }
  if (state.page > 1) params.page = String(state.page)
  if (state.loadStatus) params.loadStatus = state.loadStatus
  if (state.conflictSeverity) params.conflictSeverity = state.conflictSeverity
  if (state.search) params.search = state.search
  if (state.sort) params.sort = state.sort
  if (state.order) params.order = state.order
  return params
}

export function poolUrlStateToQuery(state: PoolUrlState): OrganizationResourcePoolQuery {
  return {
    view: state.view as OrganizationResourcePoolQuery['view'],
    page: state.page,
    loadStatus: (state.loadStatus ?? undefined) as OrganizationResourcePoolQuery['loadStatus'],
    conflictSeverity: (state.conflictSeverity ??
      undefined) as OrganizationResourcePoolQuery['conflictSeverity'],
    search: state.search ?? undefined,
    sort: (state.sort ?? undefined) as OrganizationResourcePoolQuery['sort'],
    order: state.order ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// 数据查询（直接消费既有 api client + query key 工厂，见文件头说明）
// ---------------------------------------------------------------------------

function usePoolSummaryQuery(query: OrganizationResourcePoolQuery) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: organizationResourcePoolKeys.summary(organizationId ?? 0, query),
    queryFn: () =>
      organizationResourcePoolApi.summary(
        organizationId as number,
        query,
      ) as unknown as Promise<OrganizationResourcePoolSummary>,
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

function usePoolResourcesQuery(query: OrganizationResourcePoolQuery) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: organizationResourcePoolKeys.resources(organizationId ?? 0, query),
    queryFn: () => organizationResourcePoolApi.resources(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

function usePoolSkillsQuery(query: OrganizationResourcePoolQuery) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: organizationResourcePoolKeys.skills(organizationId ?? 0, query),
    queryFn: () =>
      organizationResourcePoolApi.skills(organizationId as number, query) as unknown as Promise<
        OrganizationResourcePoolSkillItem[]
      >,
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

function usePoolCapacityQuery(query: OrganizationResourcePoolQuery) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: organizationResourcePoolKeys.capacity(organizationId ?? 0, query),
    queryFn: () =>
      organizationResourcePoolApi.capacity(
        organizationId as number,
        query,
      ) as unknown as Promise<OrganizationResourcePoolCapacityMatrix>,
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

function usePoolConflictsQuery(query: OrganizationResourcePoolQuery) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: organizationResourcePoolKeys.conflicts(organizationId ?? 0, query),
    queryFn: () => organizationResourcePoolApi.conflicts(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

function usePoolDemandGapsQuery(query: OrganizationResourcePoolQuery) {
  const organizationId = useCurrentOrganizationId()
  return useQuery({
    queryKey: organizationResourcePoolKeys.demandGaps(organizationId ?? 0, query),
    queryFn: () => organizationResourcePoolApi.demandGaps(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
}

// ---------------------------------------------------------------------------
// 工作台
// ---------------------------------------------------------------------------

const POOL_TABS: ReadonlyArray<{ key: PoolViewMode; label: string }> = [
  { key: 'matrix', label: POOL_VIEW_LABELS.matrix },
  { key: 'list', label: POOL_VIEW_LABELS.list },
  { key: 'skills', label: POOL_VIEW_LABELS.skills },
  { key: 'conflicts', label: POOL_VIEW_LABELS.conflicts },
  { key: 'demand_gaps', label: POOL_VIEW_LABELS.demand_gaps },
]

export function ResourcePoolWorkspace() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tier = useImmersionTier()
  const [draftSearch, setDraftSearch] = React.useState('')

  const urlState = React.useMemo(() => parsePoolUrlState(searchParams), [searchParams])
  const query = React.useMemo(() => poolUrlStateToQuery(urlState), [urlState])
  React.useEffect(() => {
    setDraftSearch(urlState.search ?? '')
  }, [urlState.search])

  const summaryQuery = usePoolSummaryQuery(query)
  const resourcesQuery = usePoolResourcesQuery(query)
  const skillsQuery = usePoolSkillsQuery(query)
  const capacityQuery = usePoolCapacityQuery(query)
  const conflictsQuery = usePoolConflictsQuery(query)
  const demandGapsQuery = usePoolDemandGapsQuery(query)

  // URL 回写（唯一事实来源；null 值删除参数）
  const updateUrl = React.useCallback(
    (patch: Partial<PoolUrlState>) => {
      const next: PoolUrlState = { ...urlState, ...patch }
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(serializePoolUrlState(next))) {
        params.set(key, value)
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, urlState],
  )

  const handleTabChange = (view: PoolViewMode) => updateUrl({ view, page: 1 })

  const summary = summaryQuery.data
  const envelopeRows = resourcesQuery.data
  const rows = envelopeRows?.data
  const skills = skillsQuery.data
  const capacity = capacityQuery.data
  const conflicts = conflictsQuery.data?.data
  const demandGaps = demandGapsQuery.data?.data

  // ── 主态机：加载 / 错误 / 空组织 ──────────────────────────────────────

  if (summaryQuery.isLoading || summaryQuery.isFetching) {
    return (
      <PoolPageShell crumb="…/resource-pool · 组织资源池" title="组织资源池">
        <div
          data-pool-skeleton
          aria-busy
          className="space-y-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4"
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded bg-[var(--nx-bg-0)]" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded bg-[var(--nx-bg-0)]" />
        </div>
      </PoolPageShell>
    )
  }

  if (summaryQuery.isError || !summary) {
    return (
      <PoolPageShell crumb="…/resource-pool · 组织资源池" title="组织资源池">
        <div
          data-pool-error
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-12 text-center"
        >
          <AlertCircle className="h-6 w-6 text-[var(--nx-status-danger)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-primary)]">加载组织资源池失败</p>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            若问题持续，请联系组织管理员确认资源查看权限
          </p>
          <button
            type="button"
            data-pool-retry
            onClick={() => void summaryQuery.refetch()}
            className="flex h-8 items-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            重试
          </button>
        </div>
      </PoolPageShell>
    )
  }

  const isEmptyOrg =
    summary.resourceCount === 0 &&
    summary.capacity.totalHours === 0 &&
    summary.metrics.every((metric) => metric.value === null || metric.value === 0)

  if (isEmptyOrg) {
    return (
      <PoolPageShell crumb="…/resource-pool · 组织资源池" title="组织资源池">
        <div
          data-pool-empty
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-14 text-center"
        >
          <Users className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm font-medium text-[var(--nx-text-primary)]">
            当前组织没有可见项目或资源
          </p>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            创建项目和资源后，可在此查看组织级资源池汇总
          </p>
        </div>
      </PoolPageShell>
    )
  }

  const totalPages = Math.max(1, envelopeRows?.meta.totalPages ?? 1)

  return (
    <PoolPageShell
      crumb="…/resource-pool · 组织资源池"
      title="组织资源池"
      meta={
        summary.meta
          ? `${summary.meta.visibleProjectCount} 个项目 · 更新于 ${new Date(summary.meta.calculatedAt).toLocaleTimeString('zh-CN')}`
          : undefined
      }
    >
      <div
        data-pool-workspace
        className={cn(
          'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
          tier === 'precise'
            ? 'bg-[var(--nx-workspace-bg)]'
            : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
        )}
      >
        <PoolSummaryCards summary={summary} />

        {/* 筛选条（只读重查，写回 URL） */}
        <div
          data-pool-filters
          className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2"
        >
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
            负载
            <select
              data-pool-filter-load
              value={urlState.loadStatus ?? ''}
              onChange={(event) => updateUrl({ loadStatus: event.target.value || null, page: 1 })}
              className="h-7 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] text-[var(--nx-text-secondary)] outline-none focus:border-[var(--nx-border-focus)]"
            >
              <option value="">全部</option>
              {ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES.map((status) => (
                <option key={status} value={status}>
                  {getPoolLoadLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
            冲突级别
            <select
              data-pool-filter-severity
              value={urlState.conflictSeverity ?? ''}
              onChange={(event) =>
                updateUrl({ conflictSeverity: event.target.value || null, page: 1 })
              }
              className="h-7 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] text-[var(--nx-text-secondary)] outline-none focus:border-[var(--nx-border-focus)]"
            >
              <option value="">全部</option>
              {ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES.map((severity) => (
                <option key={severity} value={severity}>
                  {getPoolConflictSeverityLabel(severity)}
                </option>
              ))}
            </select>
          </label>
          <form
            data-pool-search-form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              updateUrl({ search: draftSearch.trim() || null, page: 1 })
            }}
          >
            <input
              data-pool-search-input
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="搜索资源 / 角色 / 技能"
              className="h-7 w-52 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-primary)] outline-none placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)]"
            />
            <button
              type="submit"
              data-pool-search-apply
              className="flex h-7 items-center rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
            >
              检索
            </button>
          </form>
        </div>

        {/* Tab 条 */}
        <div
          role="tablist"
          aria-label="组织资源池分析视图"
          data-pool-tabs
          className="flex w-fit flex-wrap items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1"
        >
          {POOL_TABS.map((tab) => {
            const active = urlState.view === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                data-pool-tab={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={cn(
                  'flex h-8 items-center rounded px-3 text-xs transition-colors',
                  active
                    ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* 视图内容（全部只读） */}
        <div className="min-h-[280px]">
          {urlState.view === 'matrix' ? (
            <PoolCapacityMatrix
              data={capacity}
              isLoading={capacityQuery.isLoading}
              isError={capacityQuery.isError}
              onRetry={() => void capacityQuery.refetch()}
            />
          ) : null}
          {urlState.view === 'list' ? (
            <PoolResourceListSection
              rows={rows}
              totalPages={totalPages}
              page={urlState.page}
              isLoading={resourcesQuery.isLoading}
              isError={resourcesQuery.isError}
              onRetry={() => void resourcesQuery.refetch()}
              onPageChange={(page) => updateUrl({ page })}
            />
          ) : null}
          {urlState.view === 'skills' ? (
            <PoolSkillsSection
              skills={skills}
              isLoading={skillsQuery.isLoading}
              isError={skillsQuery.isError}
              onRetry={() => void skillsQuery.refetch()}
            />
          ) : null}
          {urlState.view === 'conflicts' ? (
            <PoolConflictPreview
              conflicts={conflicts}
              isLoading={conflictsQuery.isLoading}
              isError={conflictsQuery.isError}
              onRetry={() => void conflictsQuery.refetch()}
              page={urlState.page}
              totalPages={Math.max(1, conflictsQuery.data?.meta.totalPages ?? 1)}
              onPageChange={(page) => updateUrl({ page })}
            />
          ) : null}
          {urlState.view === 'demand_gaps' ? (
            <PoolDemandGapsSection
              gaps={demandGaps}
              totalPages={Math.max(1, demandGapsQuery.data?.meta.totalPages ?? 1)}
              page={urlState.page}
              isLoading={demandGapsQuery.isLoading}
              isError={demandGapsQuery.isError}
              onRetry={() => void demandGapsQuery.refetch()}
              onPageChange={(page) => updateUrl({ page })}
            />
          ) : null}
        </div>
      </div>
    </PoolPageShell>
  )
}

// ---------------------------------------------------------------------------
// 页壳（面包屑回显 + 标题）
// ---------------------------------------------------------------------------

export function PoolPageShell({
  crumb,
  title,
  meta,
  children,
}: {
  crumb: string
  title: string
  meta?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Users className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <p
              data-page-breadcrumb
              className="font-mono text-[10px] tracking-wide text-[var(--nx-text-muted)]"
            >
              {crumb}
            </p>
            <div className="flex items-center gap-2">
              <h1
                data-page-title
                className="text-lg font-semibold leading-tight text-[var(--nx-text-primary)]"
              >
                {title}
              </h1>
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              组织级资源底册 · 容量矩阵 · 技能覆盖 · 冲突与需求缺口分析（只读）
            </p>
          </div>
        </div>
        {meta ? <p className="font-mono text-[10px] text-[var(--nx-text-muted)]">{meta}</p> : null}
      </header>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 资源底册（list 视图）
// ---------------------------------------------------------------------------

function PoolResourceListSection({
  rows,
  page,
  totalPages,
  isLoading,
  isError,
  onRetry,
  onPageChange,
}: {
  rows?: OrganizationResourcePoolResourceRow[]
  page: number
  totalPages: number
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  onPageChange: (page: number) => void
}) {
  if (isLoading) {
    return (
      <div
        data-pool-list-skeleton
        aria-busy
        className="space-y-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4"
      >
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-10 animate-pulse rounded bg-[var(--nx-bg-0)]" />
        ))}
      </div>
    )
  }
  if (isError) {
    return <PoolSectionError section="list-error" message="资源底册加载失败" onRetry={onRetry} />
  }
  if (!rows || rows.length === 0) {
    return (
      <PoolSectionEmpty
        section="list-empty"
        title="无资源数据"
        description="没有匹配当前筛选的可见资源"
      />
    )
  }

  return (
    <div data-pool-list-view className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-[var(--nx-border-hairline)]">
        <table className="w-full min-w-max text-xs">
          <thead>
            <tr className="border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]">
              {['名称', '类型', '角色', '技能', '负载', '利用率', '冲突'].map((label) => (
                <th
                  key={label}
                  className="px-2.5 py-2 text-left font-medium text-[var(--nx-text-secondary)]"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const restricted = row.redacted || row.resourceName === null
              const severity = row.conflictFlags[0]
              return (
                <tr
                  key={row.resourceId}
                  data-pool-resource-row={row.resourceId}
                  className="border-b border-[var(--nx-border-hairline)] last:border-b-0 hover:bg-[var(--nx-bg-1)]"
                >
                  <td className="px-2.5 py-2 font-medium text-[var(--nx-text-primary)]">
                    {restricted ? (
                      <span
                        data-restricted
                        className="inline-flex items-center gap-1.5 text-[var(--nx-text-muted)]"
                      >
                        <EyeOff className="h-3 w-3" aria-hidden />
                        已脱敏
                      </span>
                    ) : (
                      row.resourceName
                    )}
                  </td>
                  <td className="px-2.5 py-2 text-[var(--nx-text-muted)]">
                    {restricted ? '—' : (row.resourceType ?? '—')}
                  </td>
                  <td className="px-2.5 py-2 text-[var(--nx-text-muted)]">
                    {restricted ? '—' : (row.role ?? '—')}
                  </td>
                  <td className="px-2.5 py-2">
                    {row.redacted ? (
                      <span className="text-[var(--nx-text-muted)]">不可见</span>
                    ) : row.skillTags && row.skillTags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {row.skillTags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
                          >
                            {tag}
                          </span>
                        ))}
                        {row.skillTags.length > 3 ? (
                          <span className="text-[10px] text-[var(--nx-text-muted)]">
                            +{row.skillTags.length - 3}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-[var(--nx-text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-2.5 py-2">
                    <PoolLoadBadge
                      status={row.loadStatus}
                      label={getPoolLoadLabel(row.loadStatus)}
                      tone={getPoolLoadTone(row.loadStatus)}
                    />
                  </td>
                  <td className="px-2.5 py-2">
                    <PoolUtilizationBar
                      percent={row.utilizationPercent}
                      tone={getPoolLoadTone(row.loadStatus)}
                    />
                  </td>
                  <td className="px-2.5 py-2">
                    {row.conflictFlags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {row.conflictFlags.map((flag) => (
                          <span
                            key={flag}
                            data-conflict-flag={flag}
                            className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ color: `var(${getPoolConflictSeverityTone(flag)})` }}
                          >
                            {getPoolConflictSeverityLabel(flag)}
                          </span>
                        ))}
                      </div>
                    ) : severity === undefined ? (
                      <span className="text-[var(--nx-text-muted)]">—</span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <PoolPager page={page} totalPages={totalPages} onPageChange={onPageChange} />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 技能覆盖（skills 视图）
// ---------------------------------------------------------------------------

function PoolSkillsSection({
  skills,
  isLoading,
  isError,
  onRetry,
}: {
  skills?: OrganizationResourcePoolSkillItem[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}) {
  if (isLoading) {
    return (
      <div
        data-pool-skills-skeleton
        aria-busy
        className="grid gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded bg-[var(--nx-bg-0)]" />
        ))}
      </div>
    )
  }
  if (isError) {
    return <PoolSectionError section="skills-error" message="技能数据加载失败" onRetry={onRetry} />
  }
  if (!skills || skills.length === 0) {
    return (
      <PoolSectionEmpty
        section="skills-empty"
        title="无技能数据"
        description="没有可见的技能覆盖信息"
      />
    )
  }

  return (
    <div data-pool-skills-view className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {skills.map((item, index) =>
        item.redacted ? (
          <div
            key={item.skill ?? `redacted-${index}`}
            data-pool-skill-redacted
            className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3.5 py-3"
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-muted)]">
              <EyeOff className="h-3.5 w-3.5" aria-hidden />
              不可见
            </span>
            <p className="text-[11px] text-[var(--nx-text-muted)]">
              技能明细受权限保护，不显示具体条目
            </p>
          </div>
        ) : (
          <div
            key={item.skill ?? index}
            data-pool-skill={item.skill}
            className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3.5 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-primary)]">
                <Wrench className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
                {item.skill}
              </span>
              {item.gap ? (
                <span
                  data-skill-gap-badge
                  className="rounded border border-[var(--nx-status-danger)]/50 bg-[var(--nx-status-danger)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--nx-status-danger)]"
                >
                  缺口
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <SkillStat
                label="资源数"
                text={item.resourceCount !== null ? String(item.resourceCount) : '—'}
              />
              <SkillStat
                label="容量"
                text={item.capacityHours !== null ? formatPoolHours(item.capacityHours) : '—'}
              />
              <SkillStat
                label="已分配"
                text={item.allocatedHours !== null ? formatPoolHours(item.allocatedHours) : '—'}
              />
              <SkillStat
                label="剩余"
                text={item.remainingHours !== null ? formatPoolHours(item.remainingHours) : '—'}
              />
              <SkillStat
                label="需求数"
                text={item.demandCount !== null ? String(item.demandCount) : '—'}
              />
            </div>
          </div>
        ),
      )}
    </div>
  )
}

function SkillStat({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] pb-1">
      <span className="text-[var(--nx-text-muted)]">{label}</span>
      <span className="tabular-nums text-[var(--nx-text-secondary)]">{text}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 需求缺口（demand_gaps 视图）
// ---------------------------------------------------------------------------

function PoolDemandGapsSection({
  gaps,
  page,
  totalPages,
  isLoading,
  isError,
  onRetry,
  onPageChange,
}: {
  gaps?: OrganizationResourcePoolDemandGap[]
  page: number
  totalPages: number
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  onPageChange: (page: number) => void
}) {
  if (isLoading) {
    return (
      <div
        data-pool-gaps-skeleton
        aria-busy
        className="space-y-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4"
      >
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-16 animate-pulse rounded bg-[var(--nx-bg-0)]" />
        ))}
      </div>
    )
  }
  if (isError) {
    return <PoolSectionError section="gaps-error" message="需求缺口加载失败" onRetry={onRetry} />
  }
  if (!gaps || gaps.length === 0) {
    return (
      <PoolSectionEmpty
        section="gaps-empty"
        title="无需求缺口"
        description="当前没有未满足的资源需求"
      />
    )
  }

  return (
    <div data-pool-demand-gaps-view className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3.5 py-2.5">
        <p className="text-[11px] text-[var(--nx-text-muted)]">
          需要多维透视缺口画像？查看角色、技能、时段、项目、组合等多维度分析
        </p>
        <Link
          href="/next/organization/resource-gaps"
          data-gaps-deep-link
          className="inline-flex h-7 items-center gap-1 rounded border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          打开统一缺口工作台
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      {gaps.map((gap) => (
        <div
          key={gap.gapId}
          data-pool-gap={gap.gapId}
          className="flex items-start gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3.5 py-3"
        >
          <span className="mt-0.5 shrink-0 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--nx-status-warning)]">
            {gap.priority ?? 'medium'}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm text-[var(--nx-text-primary)]">
              {gap.redacted ? (
                <span
                  data-restricted
                  className="inline-flex items-center gap-1.5 text-[var(--nx-text-muted)]"
                >
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                  已脱敏
                </span>
              ) : (
                `${gap.skill ?? gap.role ?? '未知技能'} — 缺口`
              )}
            </p>
            {!gap.redacted ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--nx-text-muted)]">
                {gap.projectName ? <span>项目：{gap.projectName}</span> : null}
                {gap.role ? <span>角色：{gap.role}</span> : null}
                {gap.dateWindow ? (
                  <span>
                    窗口：{gap.dateWindow.from.slice(0, 10)} ~ {gap.dateWindow.to.slice(0, 10)}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ))}
      {totalPages > 1 ? (
        <PoolPager page={page} totalPages={totalPages} onPageChange={onPageChange} />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 分区空态 / 错误态（只读）
// ---------------------------------------------------------------------------

function PoolSectionEmpty({
  section,
  title,
  description,
}: {
  section: string
  title: string
  description: string
}) {
  return (
    <div
      data-pool-section={section}
      className="flex flex-col items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-10 text-center"
    >
      <Zap className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
      <p className="text-sm text-[var(--nx-text-primary)]">{title}</p>
      <p className="text-xs text-[var(--nx-text-muted)]">{description}</p>
    </div>
  )
}

function PoolSectionError({
  section,
  message,
  onRetry,
}: {
  section: string
  message: string
  onRetry: () => void
}) {
  return (
    <div
      data-pool-section={section}
      className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-10 text-center"
    >
      <AlertCircle className="h-6 w-6 text-[var(--nx-status-danger)]" aria-hidden />
      <p className="text-sm text-[var(--nx-text-primary)]">{message}</p>
      <button
        type="button"
        data-section-retry
        onClick={onRetry}
        className="flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
      >
        重试
      </button>
    </div>
  )
}

export default ResourcePoolWorkspace
