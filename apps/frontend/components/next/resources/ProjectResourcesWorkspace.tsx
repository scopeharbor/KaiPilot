'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Link2, List, Plus, Users } from 'lucide-react'
import { projectsApi, projectKeys } from '@/lib/api/projects'
import { resourceKeys, resourcesApi, type Resource } from '@/lib/api/resources'
import { useAuthStore } from '@/stores/auth-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import { DomainPageHeader } from '@/components/next/common/DomainPageHeader'
import {
  isNotFoundError,
  ProjectSpaceErrorView,
  ProjectSpaceNotFoundView,
  ProjectSpaceSkeleton,
} from '@/components/next/project-space/ProjectSpaceContainer'
import { ResourceAllocationPanel } from './ResourceAllocationPanel'
import { ResourceCreateDrawer } from './ResourceCreateDrawer'
import { ResourceDetailDrawer } from './ResourceDetailDrawer'
import { ResourceListTable } from './ResourceListTable'
import { ResourceLoadCompactView } from './ResourceLoadCompactView'

/**
 * 资源域新轨主工作台（v3-ui-next-resource-team-domains W1 · tasks 1.9，
 * spec「资源域工作空间与资源列表管理」）。
 *
 * - 项目详情经 projectsApi.get 载入（与主工作面同键 projectKeys.detail，RL-04）；
 * - RL-05 组织隔离：跨组织 / HTTP 404 统一中性空态「项目不存在或已被移除」；
 * - 三子视图（List 底册 / Allocations 分配 / Load 负载）本地状态切换（不写 URL），
 *   Load 视图按需挂载紧凑负荷 HUD（纯只读，RL-01）；
 * - 顶栏复用统一功能域页头 DomainPageHeader（← 返回项目工作面 + 面包屑注册），
 *   actions 插槽按 resource:manage 门禁提供「新建资源」；
 * - 写入口全部经 Mutation + 缓存失效，零 AI 自动执行（RL-01）。
 */

type ResourcesViewId = 'list' | 'allocations' | 'load'

const VIEW_TABS: ReadonlyArray<{ id: ResourcesViewId; label: string; icon: typeof List }> = [
  { id: 'list', label: '资源列表', icon: List },
  { id: 'allocations', label: '分配视图', icon: Link2 },
  { id: 'load', label: '负载分析', icon: Users },
]

/** 底册与分配视图共享的资源分页口径（同 key 同 query，缓存去重）。 */
const RESOURCE_LIST_PAGE = { perPage: 100 } as const

export function ProjectResourcesWorkspace({ projectId }: { projectId: number }) {
  const router = useRouter()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)
  const { canAny } = usePermissions()
  const tier = useImmersionTier()

  const [view, setView] = React.useState<ResourcesViewId>('list')
  const [createOpen, setCreateOpen] = React.useState(false)
  const [pickerResourceId, setPickerResourceId] = React.useState<number | null>(null)
  const [detailResourceId, setDetailResourceId] = React.useState<number | null>(null)

  const canManage = canAny(['resource:manage'])

  const {
    data: project,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  })

  // RL-05 组织隔离：跨组织项目视同不存在。
  const orgMismatch =
    project !== undefined &&
    currentOrganizationId !== null &&
    project.organizationId !== currentOrganizationId
  const notFound = orgMismatch || (isError && isNotFoundError(error))

  // 分配视图资源选择器底册（与 ResourceListTable 同 key，零重复请求）。
  const resourcesQuery = useQuery({
    queryKey: resourceKeys.list(projectId, RESOURCE_LIST_PAGE),
    queryFn: () => resourcesApi.list(projectId, RESOURCE_LIST_PAGE),
    enabled: !isPending && !notFound && !isError,
  })
  const resources = resourcesQuery.data?.data ?? []
  const pickerResource: Resource | null =
    resources.find((item) => item.id === pickerResourceId) ?? null
  const effectivePickerId = pickerResource?.id ?? null

  // 数据变更（新建/停用/分配/删除）后若当前选中资源被移除则回落首个资源。
  React.useEffect(() => {
    if (view !== 'allocations' || resources.length === 0) return
    if (effectivePickerId === null || !resources.some((item) => item.id === effectivePickerId)) {
      setPickerResourceId(resources[0]!.id)
    }
  }, [resources, effectivePickerId, view])

  if (isPending) {
    return <ProjectSpaceSkeleton />
  }
  if (notFound) {
    return <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
  }
  if (isError || project === undefined) {
    return (
      <ProjectSpaceErrorView
        onRetry={() => void refetch()}
        onBackHome={() => router.push('/next')}
      />
    )
  }

  return (
    <div
      data-project-resources-workspace
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      <DomainPageHeader
        projectId={projectId}
        projectName={project.name}
        domainLabel="资源工作台"
        description={`#${project.code ?? `PROJ-${project.id}`} · 资源底册 / 任务分配 / 团队负荷紧凑排查`}
        actions={
          canManage ? (
            <button
              type="button"
              data-resource-create-open
              aria-label="新建资源"
              onClick={() => setCreateOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新建资源
            </button>
          ) : null
        }
      />

      {/* 子视图切换（本地状态，页面 URL 稳定） */}
      <div
        role="tablist"
        aria-label="资源工作台视图"
        data-resource-tabs
        className="flex w-fit items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1"
      >
        {VIEW_TABS.map((tab) => {
          const active = view === tab.id
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-resource-tab={tab.id}
              aria-selected={active}
              aria-label={`${tab.label}视图`}
              onClick={() => setView(tab.id)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-xs transition-colors',
                active
                  ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                  : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {tab.label}
            </button>
          )
        })}
      </div>

      {view === 'list' ? (
        <section data-resource-list-view className="flex flex-col gap-3">
          <ResourceListTable
            projectId={projectId}
            canManage={canManage}
            onCreateResource={canManage ? () => setCreateOpen(true) : undefined}
            onOpenDetail={(id) => setDetailResourceId(id)}
          />
        </section>
      ) : null}

      {view === 'allocations' ? (
        <section data-resource-allocations-view className="flex flex-col gap-3">
          {resources.length === 0 ? (
            <div
              data-resource-allocations-no-resources
              className="flex flex-col items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] px-4 py-10 text-center"
            >
              <p className="text-sm text-[var(--nx-text-primary)]">当前项目暂无资源</p>
              <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                请先在「资源列表」登记资源，再为其挂接任务分配与占比。
              </p>
              {canManage ? (
                <button
                  type="button"
                  data-resource-allocations-create
                  onClick={() => setCreateOpen(true)}
                  className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  新建资源
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className="text-[11px] text-[var(--nx-text-muted)]"
                  htmlFor="resource-alloc-picker"
                >
                  按资源查看分配明细：
                </label>
                <select
                  id="resource-alloc-picker"
                  data-resource-alloc-picker
                  value={effectivePickerId ?? ''}
                  onChange={(event) => setPickerResourceId(Number(event.target.value))}
                  className="h-8 min-w-56 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                >
                  {resources.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}（{resource.id}）
                    </option>
                  ))}
                </select>
              </div>
              {resourcesQuery.isError ? (
                <div
                  data-resource-allocations-error
                  role="alert"
                  className="rounded-sm border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-3 py-2 text-[11px] text-[var(--nx-text-secondary)]"
                >
                  资源底册加载失败，请切换回「资源列表」视图重试。
                </div>
              ) : null}
              {effectivePickerId !== null ? (
                <ResourceAllocationPanel
                  projectId={projectId}
                  resourceId={effectivePickerId}
                  resourceName={pickerResource?.name ?? `资源 #${effectivePickerId}`}
                  canManage={canManage}
                />
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {view === 'load' ? (
        <section data-resource-load-view className="flex flex-col gap-3">
          <ResourceLoadCompactView projectId={projectId} />
        </section>
      ) : null}

      <ResourceCreateDrawer
        projectId={projectId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      <ResourceDetailDrawer
        projectId={projectId}
        resourceId={detailResourceId}
        onClose={() => setDetailResourceId(null)}
        canManage={canManage}
        currentUserId={currentUserId}
      />
    </div>
  )
}

export default ProjectResourcesWorkspace
