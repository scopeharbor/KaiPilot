'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  Plus,
  Power,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import {
  allocationKeys,
  allocationsApi,
  resourceKeys,
  resourcesApi,
  type Resource,
  type ResourceStatus,
  type ResourceType,
} from '@/lib/api/resources'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { cn } from '@/lib/utils'
import {
  filterResources,
  formatUnitCost,
  parseSkillTags,
  resourceRoleLabel,
  RESOURCE_STATUS_LABELS,
  RESOURCE_TYPE_LABELS,
  resourceStatusLabel,
  resourceTypeLabel,
} from '@/lib/next/resources/resource-workbench-adapter'
import { ResourceAllocationPanel } from './ResourceAllocationPanel'

/**
 * 暗黑仪器感资源底册（v3-ui-next-resource-team-domains W1 · tasks 1.5，
 * spec「资源域工作空间与资源列表管理」）。
 *
 * - 卡片网格 / 高密度表格（36px 行高）双视图切换（偏好存组件状态）；
 * - 客户端即时过滤：类型（人员/物料/设备/预算）· 状态（活跃/停用）· 名称模糊；
 * - human/material/equipment/budget 全类型字段展示：类型徽章、日容量工时、时区、
 *   技能发丝线胶囊与工时单价；
 * - 行内受控操作（resource:manage 门禁，只读时按钮物理置灰）：
 *   - 停用/启用状态切换（PATCH /resources/:id）；
 *   - 安全删除两步流：先异步核对未结分配（GET allocations）——有未结分配时弹出
 *     阻断提示「该资源当前承担 X 项任务」，无分配才进入二次确认（RL-06）；
 *   - 行展开内嵌分配明细（ResourceAllocationPanel，展开才拉取）；
 * - 三态：加载骨架（aria-busy）/ 语义化空态（新建首个资源引导）/ 错误重试。
 */

/** ApiError（非 Error 实例）与 Error 统一提取可读 message。 */
function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return fallback
}

/** 资源底册查询分页口径（底册与删除预检同 key 同 query，缓存去重）。 */
const RESOURCE_LIST_PAGE: { perPage: number } = { perPage: 100 }

type ListViewMode = 'table' | 'cards'

export interface ResourceListTableProps {
  projectId: number
  /** resource:manage 写权限（只读时停用/删除操作置灰）。 */
  canManage: boolean
  /** 空态「新建首个资源」引导回调（无写权限时为空态不展示按钮）。 */
  onCreateResource?: () => void
  /** 打开资源详情抽屉（基本信息/可用性/负载）。 */
  onOpenDetail?: (resourceId: number) => void
}

export function ResourceListTable({
  projectId,
  canManage,
  onCreateResource,
  onOpenDetail,
}: ResourceListTableProps) {
  const queryClient = useQueryClient()
  const tier = useImmersionTier()

  const [viewMode, setViewMode] = React.useState<ListViewMode>('table')
  const [typeFilter, setTypeFilter] = React.useState<ResourceType | ''>('')
  const [statusFilter, setStatusFilter] = React.useState<ResourceStatus | ''>('')
  const [keyword, setKeyword] = React.useState('')
  const [expandedId, setExpandedId] = React.useState<number | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = React.useState<number | null>(null)
  const [toggleError, setToggleError] = React.useState<string | null>(null)

  const resourcesQuery = useQuery({
    queryKey: resourceKeys.list(projectId, RESOURCE_LIST_PAGE),
    queryFn: () => resourcesApi.list(projectId, RESOURCE_LIST_PAGE),
  })

  const resources = resourcesQuery.data?.data ?? []
  const filtered = React.useMemo(
    () => filterResources(resources, { resourceType: typeFilter, status: statusFilter, keyword }),
    [resources, typeFilter, statusFilter, keyword],
  )

  const toggleStatus = useMutation({
    mutationFn: (resource: Resource) =>
      resourcesApi.update(projectId, resource.id, {
        status: resource.status === 'active' ? 'inactive' : 'active',
      }),
    onSuccess: () => {
      setToggleError(null)
      void queryClient.invalidateQueries({ queryKey: resourceKeys.lists(projectId) })
    },
    onError: (error) => {
      setToggleError(errorText(error, '状态切换失败，请重试'))
    },
  })

  if (resourcesQuery.isPending) {
    return (
      <div
        data-resource-list-skeleton
        aria-busy="true"
        aria-label="正在加载项目资源"
        className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] p-3"
      >
        {[0, 1, 2, 3, 4].map((line) => (
          <div
            key={line}
            className="flex h-9 items-center gap-3 rounded-sm border border-[var(--nx-border-hairline)]/60 px-3"
          >
            <div className="h-3 w-28 animate-pulse rounded bg-[var(--nx-bg-1)]" />
            <div className="h-3 w-12 animate-pulse rounded bg-[var(--nx-bg-1)]" />
            <div className="h-3 w-16 animate-pulse rounded bg-[var(--nx-bg-1)]" />
            <div className="h-3 min-w-0 flex-1 animate-pulse rounded bg-[var(--nx-bg-1)]" />
            <div className="h-6 w-20 animate-pulse rounded bg-[var(--nx-bg-1)]" />
          </div>
        ))}
      </div>
    )
  }

  if (resourcesQuery.isError) {
    return (
      <div
        data-resource-list-error
        role="alert"
        aria-label="资源底册加载失败"
        className="flex items-center justify-between gap-3 rounded-lg border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-4 py-3"
      >
        <div className="flex items-center gap-2 text-xs text-[var(--nx-text-secondary)]">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--nx-status-danger)]" aria-hidden />
          <span>
            资源底册加载失败：
            {resourcesQuery.error instanceof Error
              ? resourcesQuery.error.message
              : '网络异常或服务暂不可用'}
          </span>
        </div>
        <button
          type="button"
          data-resource-list-retry
          onClick={() => void resourcesQuery.refetch()}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          重试加载
        </button>
      </div>
    )
  }

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: resourceKeys.lists(projectId) })
  }

  return (
    <section
      data-resource-list-table
      aria-label="项目资源底册"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] p-3',
        tier === 'precise' ? 'bg-[var(--nx-workspace-bg)]' : 'bg-[var(--nx-workspace-surface)]',
      )}
    >
      {/* 工具条：检索 / 类型 / 状态 / 视图模式 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-52">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-text-muted)]"
            aria-hidden
          />
          <input
            type="search"
            data-resource-keyword-input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="按资源名称模糊检索…"
            aria-label="按资源名称搜索"
            className="h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] pl-7 pr-2 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]"
          />
        </div>
        <select
          data-resource-type-filter
          aria-label="按类型过滤资源"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as ResourceType | '')}
          className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        >
          <option value="">全部类型</option>
          {Object.entries(RESOURCE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          data-resource-status-filter
          aria-label="按状态过滤资源"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as ResourceStatus | '')}
          className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        >
          <option value="">全部状态</option>
          {Object.entries(RESOURCE_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div
          role="radiogroup"
          aria-label="底册视图模式"
          className="flex items-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-0.5"
        >
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === 'table'}
            data-resource-mode-table
            onClick={() => setViewMode('table')}
            className={cn(
              'h-7 rounded-sm px-2.5 text-[11px] transition-colors',
              viewMode === 'table'
                ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
            )}
          >
            表格
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === 'cards'}
            data-resource-mode-cards
            onClick={() => setViewMode('cards')}
            className={cn(
              'h-7 rounded-sm px-2.5 text-[11px] transition-colors',
              viewMode === 'cards'
                ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
            )}
          >
            卡片
          </button>
        </div>
        <span data-resource-count className="font-mono text-[11px] text-[var(--nx-text-muted)]">
          {filtered.length} / {resources.length}
        </span>
      </div>

      {toggleError ? (
        <p
          role="alert"
          data-resource-toggle-error
          className="rounded-sm border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
        >
          {toggleError}
        </p>
      ) : null}

      {resources.length === 0 ? (
        <div
          data-resource-list-empty
          className="flex flex-col items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] px-4 py-10 text-center"
        >
          <p className="text-sm text-[var(--nx-text-primary)]">当前项目暂无资源</p>
          <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            登记人员 / 物料 / 设备 / 预算资源后，即可在分配视图挂接任务工时并排查团队负荷。
          </p>
          {canManage && onCreateResource ? (
            <button
              type="button"
              data-resource-empty-create
              onClick={onCreateResource}
              className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新建首个资源
            </button>
          ) : null}
        </div>
      ) : filtered.length === 0 ? (
        <div
          data-resource-list-empty-filtered
          className="flex flex-col items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-4 py-8 text-center"
        >
          <p className="text-xs text-[var(--nx-text-secondary)]">没有符合当前筛选条件的资源</p>
          <button
            type="button"
            data-resource-filter-reset
            onClick={() => {
              setTypeFilter('')
              setStatusFilter('')
              setKeyword('')
            }}
            className="mt-1 text-[11px] text-[var(--nx-accent)] transition-colors hover:underline"
          >
            清除筛选条件
          </button>
        </div>
      ) : viewMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)] text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
                <th className="w-9 px-2 py-1.5" />
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">资源名称</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">类型</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">角色</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">状态</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">日容量</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">时区</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">技能</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">单价</th>
                <th className="w-28 px-2 py-1.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((resource) => (
                <ResourceTableRows
                  key={resource.id}
                  resource={resource}
                  projectId={projectId}
                  canManage={canManage}
                  expanded={expandedId === resource.id}
                  onToggleExpand={() =>
                    setExpandedId((current) => (current === resource.id ? null : resource.id))
                  }
                  onToggleStatus={() => toggleStatus.mutate(resource)}
                  statusPending={toggleStatus.isPending}
                  onOpenDelete={() => setPendingDeleteId(resource.id)}
                  onOpenDetail={onOpenDetail ? () => onOpenDetail(resource.id) : undefined}
                  onRefresh={refreshAll}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div data-resource-card-grid className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              canManage={canManage}
              onToggleStatus={() => toggleStatus.mutate(resource)}
              statusPending={toggleStatus.isPending}
              onOpenDelete={() => setPendingDeleteId(resource.id)}
              onOpenDetail={onOpenDetail ? () => onOpenDetail(resource.id) : undefined}
            />
          ))}
        </div>
      )}

      {pendingDeleteId !== null ? (
        <ResourceDeleteFlow
          projectId={projectId}
          resource={resources.find((item) => item.id === pendingDeleteId) ?? null}
          onClose={() => setPendingDeleteId(null)}
        />
      ) : null}
    </section>
  )
}

/** 表格行 + 展开子行（内嵌分配明细面板）。 */
function ResourceTableRows({
  resource,
  projectId,
  canManage,
  expanded,
  onToggleExpand,
  onToggleStatus,
  statusPending,
  onOpenDelete,
  onOpenDetail,
  onRefresh,
}: {
  resource: Resource
  projectId: number
  canManage: boolean
  expanded: boolean
  onToggleExpand: () => void
  onToggleStatus: () => void
  statusPending: boolean
  onOpenDelete: () => void
  onOpenDetail?: () => void
  onRefresh: () => void
}) {
  const tags = parseSkillTags(resource.skillTags)
  return (
    <React.Fragment>
      <tr
        data-resource-row={resource.id}
        style={{ height: 36 }}
        className={cn(
          'border-b border-[var(--nx-border-hairline)]/60 text-[12px] transition-colors hover:bg-[var(--nx-bg-1)]/50',
          expanded && 'bg-[var(--nx-bg-1)]/40',
        )}
      >
        <td className="px-2 text-center">
          <button
            type="button"
            data-resource-expand={resource.id}
            aria-expanded={expanded}
            aria-label={
              expanded ? `收起 ${resource.name} 的分配明细` : `展开 ${resource.name} 的分配明细`
            }
            onClick={onToggleExpand}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-0)] hover:text-[var(--nx-accent)]"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        </td>
        <td className="px-2">
          {onOpenDetail ? (
            <button
              type="button"
              data-resource-detail-open={resource.id}
              aria-label={`查看 ${resource.name} 的详情`}
              onClick={onOpenDetail}
              className="whitespace-nowrap font-medium text-[var(--nx-text-primary)] transition-colors hover:text-[var(--nx-accent)]"
            >
              {resource.name}
            </button>
          ) : (
            <div className="whitespace-nowrap font-medium text-[var(--nx-text-primary)]">
              {resource.name}
            </div>
          )}
          {resource.email ? (
            <div className="whitespace-nowrap font-mono text-[10px] text-[var(--nx-text-muted)]">
              {resource.email}
            </div>
          ) : null}
        </td>
        <td className="whitespace-nowrap px-2">
          <span
            data-resource-type={resource.resourceType}
            className={cn(
              'inline-flex rounded-sm border px-1.5 py-0.5 text-[10px]',
              resource.resourceType === 'human'
                ? 'border-[var(--nx-border-focus)]/50 text-[var(--nx-accent)]'
                : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
            )}
          >
            {resourceTypeLabel(resource.resourceType)}
          </span>
        </td>
        <td className="whitespace-nowrap px-2 text-[var(--nx-text-secondary)]">
          {resourceRoleLabel(resource.role)}
        </td>
        <td className="whitespace-nowrap px-2">
          <span
            data-resource-status={resource.status}
            className={cn(
              'inline-flex rounded-sm border px-1.5 py-0.5 text-[10px]',
              resource.status === 'active'
                ? 'border-[var(--nx-border-focus)]/50 text-[var(--nx-accent)]'
                : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
            )}
          >
            {resourceStatusLabel(resource.status)}
          </span>
        </td>
        <td className="whitespace-nowrap px-2 text-right font-mono text-[var(--nx-text-secondary)]">
          {resource.dailyCapacityHours}h
        </td>
        <td className="whitespace-nowrap px-2 font-mono text-[10px] text-[var(--nx-text-muted)]">
          {resource.timezone}
        </td>
        <td className="max-w-[180px] px-2">
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  data-resource-skill-tag
                  className="whitespace-nowrap rounded-sm border border-[var(--nx-border-hairline)] px-1 py-px text-[10px] text-[var(--nx-text-muted)]"
                >
                  {tag}
                </span>
              ))}
              {tags.length > 4 ? (
                <span className="text-[10px] text-[var(--nx-text-muted)]">+{tags.length - 4}</span>
              ) : null}
            </div>
          ) : (
            <span className="text-[10px] text-[var(--nx-text-muted)]">—</span>
          )}
        </td>
        <td className="whitespace-nowrap px-2 text-right font-mono text-[11px] text-[var(--nx-text-secondary)]">
          {formatUnitCost(resource.costPerUnitCents)}
        </td>
        <td className="px-2">
          <div className="flex items-center justify-end gap-1">
            {canManage ? (
              <button
                type="button"
                data-resource-toggle={resource.id}
                aria-label={
                  resource.status === 'active'
                    ? `停用资源 ${resource.name}`
                    : `启用资源 ${resource.name}`
                }
                title={resource.status === 'active' ? '切换为停用状态' : '切换为活跃状态'}
                onClick={onToggleStatus}
                disabled={statusPending}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 text-[10px] transition-colors disabled:opacity-50',
                  resource.status === 'active'
                    ? 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)] hover:border-[var(--nx-status-warning)] hover:text-[var(--nx-status-warning)]'
                    : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)] hover:border-[var(--nx-accent)] hover:text-[var(--nx-accent)]',
                )}
              >
                <Power className="h-3 w-3" aria-hidden />
                {resource.status === 'active' ? '停用' : '启用'}
              </button>
            ) : (
              <span
                data-resource-toggle-readonly={resource.id}
                title="需要 resource:manage 权限"
                className="inline-flex h-6 cursor-not-allowed items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 text-[10px] text-[var(--nx-text-muted)] opacity-50"
              >
                <Lock className="h-3 w-3" aria-hidden />
                {resource.status === 'active' ? '停用' : '启用'}
              </span>
            )}
            {canManage ? (
              <button
                type="button"
                data-resource-delete-open={resource.id}
                aria-label={`删除资源 ${resource.name}`}
                title="删除资源（需无未结任务分配）"
                onClick={onOpenDelete}
                className="inline-flex h-6 items-center gap-1 rounded-sm border border-transparent px-1.5 text-[10px] text-[var(--nx-text-muted)] transition-colors hover:border-[var(--nx-status-danger)]/50 hover:text-[var(--nx-status-danger)]"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                删除
              </button>
            ) : (
              <span
                data-resource-delete-readonly={resource.id}
                title="需要 resource:manage 权限"
                className="inline-flex h-6 cursor-not-allowed items-center gap-1 rounded-sm border border-transparent px-1.5 text-[10px] text-[var(--nx-text-muted)] opacity-50"
              >
                <Lock className="h-3 w-3" aria-hidden />
                删除
              </span>
            )}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr
          data-resource-expand-row={resource.id}
          className="border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]/60"
        >
          <td colSpan={10} className="px-4 py-3">
            <ResourceAllocationPanel
              projectId={projectId}
              resourceId={resource.id}
              resourceName={resource.name}
              canManage={canManage}
              onChanged={onRefresh}
            />
          </td>
        </tr>
      ) : null}
    </React.Fragment>
  )
}

/** 卡片视图单卡。 */
function ResourceCard({
  resource,
  canManage,
  onToggleStatus,
  statusPending,
  onOpenDelete,
  onOpenDetail,
}: {
  resource: Resource
  canManage: boolean
  onToggleStatus: () => void
  statusPending: boolean
  onOpenDelete: () => void
  onOpenDetail?: () => void
}) {
  const tags = parseSkillTags(resource.skillTags)
  return (
    <article
      data-resource-card={resource.id}
      className="flex flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {onOpenDetail ? (
            <button
              type="button"
              data-resource-detail-open={resource.id}
              aria-label={`查看 ${resource.name} 的详情`}
              onClick={onOpenDetail}
              className="truncate text-[13px] font-medium text-[var(--nx-text-primary)] transition-colors hover:text-[var(--nx-accent)]"
            >
              {resource.name}
            </button>
          ) : (
            <h5 className="truncate text-[13px] font-medium text-[var(--nx-text-primary)]">
              {resource.name}
            </h5>
          )}
          {resource.email ? (
            <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--nx-text-muted)]">
              {resource.email}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            data-resource-type={resource.resourceType}
            className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
          >
            {resourceTypeLabel(resource.resourceType)}
          </span>
          <span
            data-resource-status={resource.status}
            className={cn(
              'rounded-sm border px-1.5 py-0.5 text-[10px]',
              resource.status === 'active'
                ? 'border-[var(--nx-border-focus)]/50 text-[var(--nx-accent)]'
                : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
            )}
          >
            {resourceStatusLabel(resource.status)}
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--nx-text-muted)]">角色</dt>
          <dd className="text-[var(--nx-text-secondary)]">{resourceRoleLabel(resource.role)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--nx-text-muted)]">日容量</dt>
          <dd className="font-mono text-[var(--nx-text-secondary)]">
            {resource.dailyCapacityHours}h
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--nx-text-muted)]">时区</dt>
          <dd className="font-mono text-[var(--nx-text-secondary)]">{resource.timezone}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--nx-text-muted)]">单价</dt>
          <dd className="font-mono text-[var(--nx-text-secondary)]">
            {formatUnitCost(resource.costPerUnitCents)}
          </dd>
        </div>
      </dl>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              data-resource-skill-tag
              className="rounded-sm border border-[var(--nx-border-hairline)] px-1 py-px text-[10px] text-[var(--nx-text-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <footer className="mt-auto flex items-center justify-end gap-1 border-t border-[var(--nx-border-hairline)]/60 pt-2">
        {canManage ? (
          <button
            type="button"
            data-resource-toggle={resource.id}
            aria-label={
              resource.status === 'active'
                ? `停用资源 ${resource.name}`
                : `启用资源 ${resource.name}`
            }
            onClick={onToggleStatus}
            disabled={statusPending}
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-accent)] hover:text-[var(--nx-accent)] disabled:opacity-50"
          >
            <Power className="h-3 w-3" aria-hidden />
            {resource.status === 'active' ? '停用' : '启用'}
          </button>
        ) : (
          <span
            data-resource-toggle-readonly={resource.id}
            title="需要 resource:manage 权限"
            className="inline-flex h-6 cursor-not-allowed items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 text-[10px] text-[var(--nx-text-muted)] opacity-50"
          >
            <Lock className="h-3 w-3" aria-hidden />
            停用
          </span>
        )}
        {canManage ? (
          <button
            type="button"
            data-resource-delete-open={resource.id}
            aria-label={`删除资源 ${resource.name}`}
            onClick={onOpenDelete}
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-transparent px-1.5 text-[10px] text-[var(--nx-text-muted)] transition-colors hover:border-[var(--nx-status-danger)]/50 hover:text-[var(--nx-status-danger)]"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            删除
          </button>
        ) : (
          <span
            data-resource-delete-readonly={resource.id}
            title="需要 resource:manage 权限"
            className="inline-flex h-6 cursor-not-allowed items-center gap-1 rounded-sm border border-transparent px-1.5 text-[10px] text-[var(--nx-text-muted)] opacity-50"
          >
            <Lock className="h-3 w-3" aria-hidden />
            删除
          </span>
        )}
      </footer>
    </article>
  )
}

/**
 * 删除两步流弹窗：先查询未结分配 ——
 * 有分配 → 阻断提示；零分配 → 二次确认后 DELETE（RL-06 防误触）。
 */
function ResourceDeleteFlow({
  projectId,
  resource,
  onClose,
}: {
  projectId: number
  resource: Resource | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const allocationQuery = useQuery({
    queryKey: allocationKeys.lists(projectId, resource?.id ?? 0),
    queryFn: () => allocationsApi.list(projectId, resource?.id ?? 0, { perPage: 100 }),
    enabled: resource !== null,
  })
  const deleteMutation = useMutation({
    mutationFn: () => resourcesApi.delete(projectId, resource!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceKeys.lists(projectId) })
      onClose()
    },
  })
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (deleteMutation.isError) {
      setDeleteError(errorText(deleteMutation.error, '删除资源失败，请重试'))
    }
  }, [deleteMutation.isError, deleteMutation.error])

  // 删除弹层：Escape 关闭；删除请求在途时拒绝关闭（与弹层「取消」按钮 disabled 同判据；
  // 分配核对查询在途不拦截——现状「取消」即时可用）。
  const dialogRef = React.useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref: dialogRef,
    open: resource !== null,
    onClose,
    canClose: () => !deleteMutation.isPending,
  })

  if (resource === null) return null
  const allocationCount = allocationQuery.data?.data.length ?? 0
  const checking = allocationQuery.isPending
  const checkFailed = allocationQuery.isError
  const blocked = !checking && !checkFailed && allocationCount > 0

  return (
    <div data-resource-delete-dialog-overlay className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="关闭删除资源弹窗"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={blocked ? '无法删除资源' : `确认删除资源 ${resource.name}`}
        data-resource-delete-dialog
        ref={dialogRef}
        tabIndex={-1}
        className="absolute left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-0 shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <h3
            data-resource-delete-dialog-title
            className="text-sm font-semibold text-[var(--nx-text-primary)]"
          >
            {blocked ? '删除被阻断' : checking ? '正在核对任务分配…' : '确认删除资源'}
          </h3>
        </header>
        <div className="px-5 py-4">
          {checking ? (
            <div className="flex items-center gap-2 text-xs text-[var(--nx-text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--nx-accent)]" aria-hidden />
              正在核对「{resource.name}」是否存在未结任务分配…
            </div>
          ) : checkFailed ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs text-[var(--nx-status-danger)]">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                分配核对失败，请重试后再删除。
              </p>
            </div>
          ) : blocked ? (
            <div data-resource-delete-block className="space-y-2">
              <p className="flex items-start gap-1.5 text-[13px] text-[var(--nx-status-danger)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  该资源当前承担 <b className="font-mono">{allocationCount}</b> 项任务分配，
                  请先在分配视图中解除关联后再删除。
                </span>
              </p>
            </div>
          ) : (
            <div data-resource-delete-confirm className="space-y-2">
              <p className="text-[13px] text-[var(--nx-text-secondary)]">
                「{resource.name}」将从项目资源底册中移除，此操作不可撤销。
              </p>
              <p className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                {resourceTypeLabel(resource.resourceType)} · {resourceStatusLabel(resource.status)}{' '}
                · #ID {resource.id}
              </p>
              {deleteError ? (
                <p
                  role="alert"
                  data-resource-delete-error
                  className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2 py-1 text-[11px] text-[var(--nx-status-danger)]"
                >
                  {deleteError}
                </p>
              ) : null}
            </div>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <button
            type="button"
            data-resource-delete-cancel
            onClick={onClose}
            disabled={deleteMutation.isPending}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            {blocked ? '知道了' : '取消'}
          </button>
          {!checking && !checkFailed && !blocked ? (
            <button
              type="button"
              data-resource-delete-confirm-ok
              aria-label={`确认删除资源 ${resource.name}`}
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
              className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.12)] px-4 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:bg-[var(--nx-status-danger)] hover:text-white disabled:opacity-50"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              )}
              确认删除
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  )
}

export default ResourceListTable
