'use client'

import { formatProjectCode } from '@aiproj/types'
import { CopyableCode } from '@/components/next/common/CopyableCode'
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ClipboardList, FileText, Plus, RotateCw, ShieldX } from 'lucide-react'
import { projectKeys, projectsApi } from '@/lib/api/projects'
import type { ChangeRequest, ChangeRequestListFilters } from '@/lib/api/change-requests'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useChangeRequests,
  useProjectMembers,
  buildMemberNameMap,
} from '@/hooks/use-change-requests'
import {
  isNotFoundError,
  ProjectSpaceNotFoundView,
} from '@/components/next/project-space/ProjectSpaceContainer'
import { cn } from '@/lib/utils'
import { ChangeRequestTable } from './ChangeRequestTable'
import {
  ChangeRequestsFilterBar,
  EMPTY_CR_FILTERS,
  hasActiveCrFilters,
  type ChangeRequestsFilterState,
} from './ChangeRequestsFilterBar'

/**
 * 变更请求新轨主页总装容器（v3-ui-next-risk-change-domains W2 · tasks 2.1）。
 *
 * - 项目详情经 projectsApi.get 载入（RL-04 同键）；RL-05 组织隔离与跨租户中性 404
 *   （「项目不存在或已被移除」）复用 ProjectSpaceNotFoundView；
 * - 多维组合筛选（状态 9/类型 7/优先级 4/申请人/日期范围）全部服务端过滤，任一
 *   筛选变更重置页码为 1（spec「多维组合过滤能力」）；
 * - 高密度暗黑表格 + 双通道状态徽标（ChangeRequestStatusMark），整行点击平滑导航
 *   至详情主页；申请人名列由项目成员映射解析（成员接口不可用静默降级 '#id'）；
 * - 骨架屏（aria-busy）/ 空态（区分无数据与筛选无匹配）/ 错误卡（重新载入 +
 *   返回项目空间）完备（spec「友好空状态与规范错误态」）；
 * - 沉浸阶梯：precise 档停用 .nx-space-atmosphere 光晕，纯色仪器背景。
 */

export interface ChangeRequestsWorkspacePageProps {
  projectId: number
}

export function ChangeRequestsWorkspacePage({ projectId }: ChangeRequestsWorkspacePageProps) {
  const router = useRouter()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const register = useProjectSpaceEntityStore((state) => state.register)
  const clear = useProjectSpaceEntityStore((state) => state.clear)
  const { can } = usePermissions()
  const tier = useImmersionTier()
  const canCreate = can('change_request:create')

  // ---- 项目上下文（RL-05）----
  const {
    data: project,
    isPending: projectPending,
    isError: projectError,
    error: projectErrorInfo,
    refetch: refetchProject,
  } = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  })

  const orgMismatch =
    project !== undefined &&
    currentOrganizationId !== null &&
    project.organizationId !== currentOrganizationId
  const projectNotFound = orgMismatch || (projectError && isNotFoundError(projectErrorInfo))

  // ---- 多维筛选 + 分页 ----
  const [filters, setFilters] = React.useState<ChangeRequestsFilterState>(EMPTY_CR_FILTERS)
  const [page, setPage] = React.useState(1)

  const applyFilter = React.useCallback((patch: Partial<ChangeRequestsFilterState>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(1)
  }, [])

  const resetFilters = React.useCallback(() => {
    setFilters(EMPTY_CR_FILTERS)
    setPage(1)
  }, [])

  const queryFilters: ChangeRequestListFilters = React.useMemo(() => {
    const result: ChangeRequestListFilters = {
      page,
      perPage: 20,
    }
    if (filters.status !== '') result.status = filters.status
    if (filters.changeType !== '') result.changeType = filters.changeType
    if (filters.priority !== '') result.priority = filters.priority
    if (filters.requesterId !== '') result.requesterId = filters.requesterId
    if (filters.startDate !== '') result.startDate = filters.startDate
    if (filters.endDate !== '') result.endDate = filters.endDate
    return result
  }, [filters, page])

  const {
    data: listData,
    isPending: listPending,
    isError: listError,
    refetch: refetchList,
  } = useChangeRequests(projectId, queryFilters)

  // ---- 申请人成员映射（静默降级）----
  const { data: members } = useProjectMembers(projectId)
  const memberMap = React.useMemo(() => buildMemberNameMap(members), [members])
  const memberOptions = React.useMemo(
    () =>
      (members ?? [])
        .filter((member) => member.user?.fullName)
        .map((member) => ({ userId: member.userId, label: member.user!.fullName as string })),
    [members],
  )

  // ---- 顶栏坐标联动（面包屑项目名）----
  React.useEffect(() => {
    if (project !== undefined && !orgMismatch) {
      register(projectId, project.name)
    } else {
      clear(projectId)
    }
    return () => clear(projectId)
  }, [project, orgMismatch, projectId, register, clear])

  const rows = listData?.data ?? []
  const meta = listData?.meta
  const total = meta?.total ?? 0
  const hasFilter = hasActiveCrFilters(filters)
  const filterActive = hasFilter || page > 1

  const openRow = React.useCallback(
    (cr: ChangeRequest) => {
      router.push(`/next/projects/${projectId}/change-requests/${cr.id}`)
    },
    [projectId, router],
  )

  if (projectPending) {
    return <ChangeRequestsWorkspaceSkeleton />
  }
  if (projectNotFound) {
    return <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
  }
  if (projectError || project === undefined) {
    return (
      <ChangeRequestsDomainErrorView
        onRetry={() => void refetchProject()}
        onBackHome={() => router.push('/next')}
      />
    )
  }

  return (
    <div
      data-cr-workspace
      data-cr-project-id={projectId}
      className={cn(
        'flex flex-col gap-4',
        tier === 'precise' ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere',
      )}
    >
      {/* 域头部：返回项目空间 + 项目坐标 + 新建入口 */}
      <header
        data-cr-workspace-header
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2.5 md:px-4"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href={`/next/projects/${projectId}`}
            aria-label="返回项目主空间"
            data-cr-back-to-space
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <ClipboardList className="h-4 w-4 shrink-0 text-[var(--nx-accent)]" aria-hidden />
          <h2
            data-cr-workspace-title
            className="shrink-0 text-sm font-semibold text-[var(--nx-text-primary)]"
          >
            变更请求
          </h2>
          <span className="hidden min-w-0 truncate text-xs text-[var(--nx-text-secondary)] sm:inline-block">
            {project.name}
          </span>
          <span data-cr-workspace-code className="shrink-0">
            <CopyableCode
              code={formatProjectCode({ id: projectId, code: project.code })}
              prefix="#"
              className="bg-[var(--nx-bg-1)] text-[10px]"
            />
          </span>
        </div>

        {canCreate ? (
          <Link
            href={`/next/projects/${projectId}/change-requests/new`}
            data-cr-new
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            新建变更请求
          </Link>
        ) : null}
      </header>

      {/* 多维组合筛选工具栏 */}
      <ChangeRequestsFilterBar
        filters={filters}
        memberOptions={memberOptions}
        membersAvailable={members !== undefined}
        onChange={applyFilter}
        onReset={resetFilters}
      />

      {/* 列表区 */}
      {listError ? (
        <ChangeRequestsListErrorView
          onRetry={() => void refetchList()}
          onReset={() => {
            resetFilters()
            void refetchList()
          }}
          onBackHome={() => router.push(`/next/projects/${projectId}`)}
        />
      ) : listPending && rows.length === 0 ? (
        <ChangeRequestsListSkeleton />
      ) : rows.length === 0 ? (
        <ChangeRequestsEmptyState
          projectId={projectId}
          filterActive={filterActive}
          canCreate={canCreate}
          onReset={resetFilters}
        />
      ) : (
        <>
          <ChangeRequestTable rows={rows} memberNameMap={memberMap} onOpenRow={openRow} />
          <footer
            data-cr-pagination
            className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--nx-text-muted)]"
          >
            <span data-cr-pagination-total>
              共 {total} 条 · 第 {meta?.page ?? 1}/{meta?.totalPages ?? 1} 页
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-cr-pagination-prev
                disabled={(meta?.page ?? 1) <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                上一页
              </button>
              <button
                type="button"
                data-cr-pagination-next
                disabled={(meta?.totalPages ?? 1) <= (meta?.page ?? 1)}
                onClick={() => setPage((current) => current + 1)}
                className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  )
}

/** 首屏仪器感骨架（结构 1:1，杜绝空态闪烁误报）。 */
export function ChangeRequestsWorkspaceSkeleton() {
  return (
    <div
      data-cr-skeleton
      role="status"
      aria-label="正在加载变更请求"
      aria-busy="true"
      className="flex flex-col gap-4"
    >
      <div className="h-12 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
      <div className="h-10 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
      <div className="space-y-1.5">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div
            key={index}
            className="h-11 animate-pulse rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
          />
        ))}
      </div>
    </div>
  )
}

/** 列表数据加载骨架（项目已就绪、变更数据在途）。 */
export function ChangeRequestsListSkeleton() {
  return (
    <div
      data-cr-list-skeleton
      role="status"
      aria-label="正在加载变更请求列表"
      aria-busy="true"
      className="space-y-1.5"
    >
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div
          key={index}
          className="h-11 animate-pulse rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
        />
      ))}
    </div>
  )
}

/** 域级加载失败（项目 500/断网）：规范错误卡。 */
export function ChangeRequestsDomainErrorView({
  onRetry,
  onBackHome,
}: {
  onRetry: () => void
  onBackHome: () => void
}) {
  return (
    <div
      data-cr-domain-error
      role="alert"
      aria-label="变更请求域加载失败"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
    >
      <ShieldX className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">变更请求域加载失败</h3>
      <p className="text-xs text-[var(--nx-text-muted)]">
        项目数据加载失败，请稍后重试或返回角色首页。
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-cr-domain-retry
          onClick={onRetry}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          重新载入
        </button>
        <button
          type="button"
          data-cr-domain-back-home
          onClick={onBackHome}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          返回角色首页
        </button>
      </div>
    </div>
  )
}

/** 列表接口失败（500/校验异常）：错误卡 + 重试 + 清除筛选。 */
export function ChangeRequestsListErrorView({
  onRetry,
  onReset,
  onBackHome,
}: {
  onRetry: () => void
  onReset: () => void
  onBackHome: () => void
}) {
  return (
    <div
      data-cr-error
      role="alert"
      aria-label="变更请求列表加载错误"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
    >
      <RotateCw className="h-8 w-8 text-[var(--nx-status-danger)]" aria-hidden />
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">变更请求列表加载失败</h3>
      <p className="text-xs text-[var(--nx-text-muted)]">
        列表数据加载失败。若已启用组合筛选，可先清除筛选条件后重试。
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          data-cr-list-retry
          onClick={onRetry}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          重新载入
        </button>
        <button
          type="button"
          data-cr-list-clear-filters
          onClick={onReset}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          清除筛选条件
        </button>
        <button
          type="button"
          data-cr-list-back-space
          onClick={onBackHome}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          返回项目空间
        </button>
      </div>
    </div>
  )
}

/** 空态：无任何数据 vs 筛选无匹配（两种文案 + 行动引导）。 */
export function ChangeRequestsEmptyState({
  projectId,
  filterActive,
  canCreate,
  onReset,
}: {
  projectId: number
  filterActive: boolean
  canCreate: boolean
  onReset: () => void
}) {
  return (
    <div
      data-cr-empty
      data-cr-empty-filtered={filterActive || undefined}
      className="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-6 py-10 text-center"
    >
      {filterActive ? (
        <>
          <FileText className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">未找到匹配的记录</h3>
          <p className="text-xs text-[var(--nx-text-muted)]">
            当前组合筛选条件下没有变更请求，可清除筛选条件查看全部。
          </p>
          <button
            type="button"
            data-cr-empty-reset
            onClick={onReset}
            className="inline-flex h-8 items-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            清除筛选条件
          </button>
        </>
      ) : (
        <>
          <FileText className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">暂无变更请求</h3>
          <p className="text-xs text-[var(--nx-text-muted)]">
            项目基线变更将通过变更请求受控管理：申请、六维影响分析与审批决策全程留痕。
          </p>
          {canCreate ? (
            <Link
              href={`/next/projects/${projectId}/change-requests/new`}
              data-cr-empty-create
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新建变更请求
            </Link>
          ) : null}
        </>
      )}
    </div>
  )
}

export default ChangeRequestsWorkspacePage
