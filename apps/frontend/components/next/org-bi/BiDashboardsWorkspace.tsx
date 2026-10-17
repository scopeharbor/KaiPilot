'use client'

import * as React from 'react'
import { Archive, Eye, LayoutDashboard, Plus, RefreshCw, Star } from 'lucide-react'
import {
  useWidgetRegistry,
  useDashboardList,
  useCurrentDashboard,
  useSetDefaultDashboard,
  useArchiveDashboard,
} from '@/hooks/use-bi-dashboard'
import { usePermissions } from '@/hooks/use-permissions'
import { useAuthStore } from '@/stores/auth-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import type {
  BiDashboardDefinition,
  BiDashboardScope,
  BiDashboardWidgetRegistryEntry,
} from '@aiproj/types'
import { BI_DASHBOARD_SCOPES } from '@aiproj/types'
import {
  BI_DASHBOARD_DENSITY_LABELS,
  biDashboardScopeLabel,
} from '@/lib/next/org-bi/org-bi-adapter'
import { BiDashboardGrid } from './BiDashboardGrid'
import { BiDashboardEditorDrawer, type BiDashboardEditorMode } from './BiDashboardEditorDrawer'

/**
 * BI 仪表盘工作台（v3-ui-next-org-portfolio-domains W3 · tasks 3.3）。
 *
 * - 双作用域：单次 list（shared + 本人 personal）按 scope 分组为「我的仪表盘 /
 *   组织共享」两个页签；右侧主区展示当前盘（默认/选中盘）widget 网格；
 * - 写门禁：新建个人盘=组织成员（页面准入基底）；新建/编辑/设默认/归档共享盘
 *   一律 `org:manage`；个人盘仅 owner（列表语义已含 owner 过滤，前端再按
 *   ownerActorId===当前用户收敛渲染）；无权限动作物理隐藏（RL-06）；
 * - RL-14：网格只渲染注册表既有 widget 类型，未知类型不渲染不报错；
 * - 三态闭环与精确档降级与同域页面一致。
 */
export interface BiDashboardsWorkspaceProps {
  organizationId: number
}

type ScopeTab = 'current' | BiDashboardScope

const SCOPE_TABS: ReadonlyArray<{ id: ScopeTab; label: string }> = [
  { id: 'current', label: '当前视图' },
  { id: BI_DASHBOARD_SCOPES.PERSONAL, label: '我的仪表盘' },
  { id: BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED, label: '组织共享' },
]

export function BiDashboardsWorkspace({ organizationId }: BiDashboardsWorkspaceProps) {
  const tier = useImmersionTier()
  const { can } = usePermissions()
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const canManageShared = can('org:manage')

  const registryQuery = useWidgetRegistry(organizationId)
  const currentQuery = useCurrentDashboard(organizationId)
  const listQuery = useDashboardList(organizationId, { perPage: 50 })

  const setDefaultMutation = useSetDefaultDashboard(organizationId)
  const archiveMutation = useArchiveDashboard(organizationId)

  const [scopeTab, setScopeTab] = React.useState<ScopeTab>('current')
  const [selectedDashboardId, setSelectedDashboardId] = React.useState<number | null>(null)
  const [editorMode, setEditorMode] = React.useState<BiDashboardEditorMode | null>(null)

  const registry = registryQuery.data?.data ?? []
  const currentDefinition = currentQuery.data?.data ?? null
  const listDefinitions = listQuery.data?.data ?? []

  const personalDashboards = listDefinitions.filter(
    (dashboard) => dashboard.scope === BI_DASHBOARD_SCOPES.PERSONAL,
  )
  const sharedDashboards = listDefinitions.filter(
    (dashboard) => dashboard.scope === BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED,
  )

  // 查看目标：当前视图（tab=current）或选中盘；当前视图无数据时回退选中盘。
  const viewerDefinition =
    scopeTab === 'current'
      ? (currentDefinition ??
        listDefinitions.find((dashboard) => dashboard.dashboardId === selectedDashboardId) ??
        null)
      : (listDefinitions.find((dashboard) => dashboard.dashboardId === selectedDashboardId) ?? null)

  const handleSelectDashboard = (dashboard: BiDashboardDefinition) => {
    setSelectedDashboardId(dashboard.dashboardId)
    setScopeTab(dashboard.scope)
  }

  const canManageDashboard = (dashboard: BiDashboardDefinition): boolean => {
    if (dashboard.scope === BI_DASHBOARD_SCOPES.PERSONAL) {
      return userId !== null && dashboard.ownerActorId === userId
    }
    return canManageShared
  }

  const isLoading = registryQuery.isLoading || currentQuery.isLoading || listQuery.isLoading

  return (
    <div
      data-bi-dash-workspace
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 data-bi-dash-title className="text-lg font-semibold text-[var(--nx-text-primary)]">
            BI 仪表盘
          </h2>
          <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
            我的仪表盘 / 组织共享 双作用域 · widget 确定性渲染（RL-14）
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <button
            type="button"
            data-bi-dash-refresh
            aria-label="刷新仪表盘数据"
            disabled={isLoading}
            onClick={() => {
              void registryQuery.refetch()
              void currentQuery.refetch()
              void listQuery.refetch()
            }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} aria-hidden />
            刷新
          </button>
          <button
            type="button"
            data-bi-dash-create-personal
            onClick={() => setEditorMode({ kind: 'create', scope: BI_DASHBOARD_SCOPES.PERSONAL })}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            新建个人盘
          </button>
          {canManageShared ? (
            <button
              type="button"
              data-bi-dash-create-shared
              onClick={() =>
                setEditorMode({ kind: 'create', scope: BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED })
              }
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新建共享盘
            </button>
          ) : null}
        </div>
      </header>

      {isLoading ? (
        <div
          data-bi-dash-skeleton
          role="status"
          aria-label="BI 仪表盘加载中"
          aria-busy="true"
          className="grid gap-3 lg:grid-cols-[260px_1fr]"
        >
          <div className="space-y-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
            ))}
          </div>
          <div className="space-y-2">
            <div className="h-8 w-64 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-28 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
              <div className="h-28 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 gap-4 lg:grid-cols-[280px_1fr]">
          {/* 左栏：作用域切换 + 盘列表 */}
          <aside className="flex flex-col gap-3">
            <div
              role="tablist"
              aria-label="仪表盘作用域"
              data-bi-dash-scope-tabs
              className="flex items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1"
            >
              {SCOPE_TABS.map((tab) => {
                const active = scopeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    data-bi-dash-scope-tab={tab.id}
                    aria-selected={active}
                    onClick={() => {
                      setScopeTab(tab.id)
                      if (tab.id !== 'current') setSelectedDashboardId(null)
                    }}
                    className={cn(
                      'h-7 flex-1 rounded-sm px-1.5 text-[11px] transition-colors',
                      active
                        ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                        : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
                    )}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {scopeTab !== 'current' ? (
              <DashboardList
                dashboards={
                  scopeTab === BI_DASHBOARD_SCOPES.PERSONAL ? personalDashboards : sharedDashboards
                }
                selectedId={selectedDashboardId ?? undefined}
                canManage={canManageDashboard}
                canManageShared={canManageShared}
                onSelect={handleSelectDashboard}
                onEdit={(dashboard) => setEditorMode({ kind: 'edit', dashboard })}
                onSetDefault={(dashboardId) => void setDefaultMutation.mutate(dashboardId)}
                onArchive={(dashboardId) => void archiveMutation.mutate(dashboardId)}
              />
            ) : (
              <div className="flex flex-1 flex-col gap-2">
                {registryQuery.isError ? (
                  <p
                    data-bi-dash-list-error
                    role="alert"
                    className="rounded-md border border-dashed border-[var(--nx-border-hairline)] px-3 py-4 text-center text-[11px] text-[var(--nx-text-secondary)]"
                  >
                    widget 注册表加载失败，请刷新重试
                  </p>
                ) : (
                  <DashboardList
                    dashboards={[...sharedDashboards, ...personalDashboards]}
                    selectedId={currentDefinition?.dashboardId}
                    canManage={canManageDashboard}
                    canManageShared={canManageShared}
                    onSelect={handleSelectDashboard}
                    onEdit={(dashboard) => setEditorMode({ kind: 'edit', dashboard })}
                    onSetDefault={(dashboardId) => void setDefaultMutation.mutate(dashboardId)}
                    onArchive={(dashboardId) => void archiveMutation.mutate(dashboardId)}
                  />
                )}
              </div>
            )}
          </aside>

          {/* 右栏：看板查看器 */}
          <section className="flex flex-col gap-3">
            {listQuery.isError && scopeTab !== 'current' ? (
              <div
                data-bi-dash-list-error
                role="alert"
                className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
              >
                <p className="text-xs text-[var(--nx-text-secondary)]">仪表盘列表加载失败。</p>
                <button
                  type="button"
                  data-bi-dash-list-retry
                  onClick={() => void listQuery.refetch()}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)]"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  重新加载
                </button>
              </div>
            ) : viewerDefinition ? (
              <DashboardViewer
                definition={viewerDefinition}
                registry={registry}
                onEdit={
                  canManageDashboard(viewerDefinition)
                    ? () => setEditorMode({ kind: 'edit', dashboard: viewerDefinition })
                    : null
                }
              />
            ) : (
              <div
                data-bi-dash-empty
                className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-14 text-center"
              >
                <LayoutDashboard className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
                <p className="text-xs font-medium text-[var(--nx-text-primary)]">
                  {scopeTab === 'current'
                    ? '暂无当前 BI 仪表盘'
                    : scopeTab === BI_DASHBOARD_SCOPES.PERSONAL
                      ? '还没有个人仪表盘'
                      : '还没有组织共享仪表盘'}
                </p>
                <p className="text-[11px] text-[var(--nx-text-muted)]">
                  {scopeTab === BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED && !canManageShared
                    ? '组织共享盘由管理员维护，可切换「当前视图」查看默认盘。'
                    : '从列表选择一个仪表盘查看，或点击右上角新建。'}
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      <BiDashboardEditorDrawer
        organizationId={organizationId}
        mode={editorMode}
        registry={registry}
        onClose={() => setEditorMode(null)}
      />
    </div>
  )
}

/** 盘列表（当前盘/我的/共享三语境共用）。 */
function DashboardList({
  dashboards,
  selectedId,
  canManage,
  canManageShared,
  onSelect,
  onEdit,
  onSetDefault,
  onArchive,
}: {
  dashboards: BiDashboardDefinition[]
  selectedId?: number
  canManage: (dashboard: BiDashboardDefinition) => boolean
  canManageShared: boolean
  onSelect: (dashboard: BiDashboardDefinition) => void
  onEdit: (dashboard: BiDashboardDefinition) => void
  onSetDefault: (dashboardId: number) => void
  onArchive: (dashboardId: number) => void
}) {
  const visible = dashboards.filter((dashboard) => !dashboard.isArchived)
  if (visible.length === 0) {
    return (
      <div
        data-bi-dash-list-empty
        className="flex flex-1 flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] px-3 py-8 text-center"
      >
        <p className="text-[11px] font-medium text-[var(--nx-text-primary)]">暂无仪表盘</p>
        <p className="text-[10px] text-[var(--nx-text-muted)]">
          {canManageShared ? '可点击右上角新建个人或共享盘。' : '可点击右上角新建个人盘。'}
        </p>
      </div>
    )
  }
  return (
    <ol data-bi-dash-list className="flex flex-1 flex-col gap-1.5" aria-label="仪表盘列表">
      {visible.map((dashboard) => {
        const active = dashboard.dashboardId === selectedId
        const manageable = canManage(dashboard)
        return (
          <li
            key={dashboard.dashboardId}
            data-bi-dash-list-item
            data-bi-dash-list-scope={dashboard.scope}
            data-bi-dash-list-default={dashboard.isDefault || undefined}
            className={cn(
              'rounded-md border bg-[var(--nx-workspace-surface)] transition-colors',
              active ? 'border-[var(--nx-border-focus)]' : 'border-[var(--nx-border-hairline)]',
            )}
          >
            <button
              type="button"
              data-bi-dash-list-open
              onClick={() => onSelect(dashboard)}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
              aria-label={`查看 ${dashboard.name}`}
            >
              <Eye className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--nx-text-primary)]">
                {dashboard.name}
              </span>
              {dashboard.isDefault ? (
                <span
                  data-bi-dash-default-badge
                  className="shrink-0 rounded-sm border border-[rgba(56,189,248,0.4)] px-1 py-0.5 font-mono text-[9px] text-[var(--nx-accent)]"
                >
                  默认
                </span>
              ) : null}
            </button>
            {manageable ? (
              <div className="flex items-center gap-1 border-t border-[var(--nx-border-hairline)] px-1.5 py-1">
                <button
                  type="button"
                  data-bi-dash-row-edit
                  onClick={() => onEdit(dashboard)}
                  className="h-6 rounded-sm px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-accent)]"
                >
                  编辑
                </button>
                {dashboard.scope === BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED &&
                canManageShared &&
                !dashboard.isDefault ? (
                  <button
                    type="button"
                    data-bi-dash-row-set-default
                    onClick={() => onSetDefault(dashboard.dashboardId)}
                    className="flex h-6 items-center gap-1 rounded-sm px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-accent)]"
                  >
                    <Star className="h-3 w-3" aria-hidden />
                    设为默认
                  </button>
                ) : null}
                <button
                  type="button"
                  data-bi-dash-row-archive
                  onClick={() => onArchive(dashboard.dashboardId)}
                  className="flex h-6 items-center gap-1 rounded-sm px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-status-danger)]"
                >
                  <Archive className="h-3 w-3" aria-hidden />
                  归档
                </button>
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

/** 看板查看器（含当前/选中盘元信息 + widget 网格；零额外网络请求）。 */
function DashboardViewer({
  definition,
  registry,
  onEdit,
}: {
  definition: BiDashboardDefinition
  registry: BiDashboardWidgetRegistryEntry[]
  onEdit: (() => void) | null
}) {
  return (
    <div data-bi-dash-viewer className="flex flex-1 flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3
              data-bi-dash-viewer-name
              className="truncate text-sm font-semibold text-[var(--nx-text-primary)]"
            >
              {definition.name}
            </h3>
            <span
              data-bi-dash-viewer-scope
              className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-text-muted)]"
            >
              {biDashboardScopeLabel(definition.scope)}
            </span>
            {definition.isDefault ? (
              <span className="shrink-0 rounded-sm border border-[rgba(56,189,248,0.4)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-accent)]">
                默认
              </span>
            ) : null}
            {definition.isArchived ? (
              <span className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-text-muted)]">
                已归档
              </span>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-[10px] text-[var(--nx-text-muted)]">
            {definition.layout.columns} 列 ·{' '}
            {BI_DASHBOARD_DENSITY_LABELS[definition.layout.density] ?? definition.layout.density} ·
            v{definition.version}
            {definition.updatedAt
              ? ` · 更新于 ${new Date(definition.updatedAt).toLocaleString()}`
              : ''}
          </p>
        </div>
        {onEdit ? (
          <button
            type="button"
            data-bi-dash-viewer-edit
            onClick={onEdit}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            编辑此盘
          </button>
        ) : null}
      </header>

      {definition.warningSummary && definition.warningSummary.length > 0 ? (
        <p
          role="note"
          className="rounded-sm border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--nx-text-secondary)]"
        >
          {definition.warningSummary.map((item) => item.message).join('；')}
        </p>
      ) : null}

      <BiDashboardGrid definition={definition} registry={registry} />
    </div>
  )
}

export default BiDashboardsWorkspace
