'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'
import { useGroupingViewList } from '@/hooks/use-portfolio-grouping-views'
import { usePermissions } from '@/hooks/use-permissions'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import type { PmoGroupingViewDefinition, PmoGroupingViewQueryDefinition } from '@aiproj/types'
import {
  PMO_GROUPING_VIEW_PRIMARY_KEYS,
  PMO_GROUPING_VIEW_SCOPES,
  PMO_GROUPING_VIEW_SORT_KEYS,
} from '@aiproj/types'
import { PmoGroupingDefinitionList } from './PmoGroupingDefinitionList'
import { PmoGroupingPreviewBoard } from './PmoGroupingPreviewBoard'
import {
  PmoGroupingViewSaveDialog,
  type PmoGroupingViewSaveDialogState,
} from './PmoGroupingViewSaveDialog'

/**
 * PMO 分组视图工作台容器（v3-ui-next-pmo-domain W3 · tasks 3.1）。
 *
 * - 路由壳门禁（portfolio:view）通过后装配本容器；写门禁（portfolio:manage）
 *   在此统一派生并下发给列表/预览/保存对话框（RL-06）；
 * - 状态编排：左侧视图库（系统预设/个人/组织共享）+ 右侧组合预览工作台；
 *   激活视图对象由此持有（列表与工作台共享同一 list 查询键，无重复请求）；
 *   保存对话框承载「保存为视图 / 新建视图 / 编辑既有视图」三种入口；
 * - 列表加载完成后自动激活默认视图（无默认时取列表首项），激活视图被删除后
 *   自动回退；骨架/空态/错误三态由子组件各自闭环。
 */

export interface PmoGroupingViewsWorkspaceProps {
  organizationId: number
}

const DEFAULT_NEW_VIEW_QUERY: PmoGroupingViewQueryDefinition = {
  primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
  sort: PMO_GROUPING_VIEW_SORT_KEYS.PROJECT_COUNT,
  order: 'desc',
}

export function PmoGroupingViewsWorkspace({ organizationId }: PmoGroupingViewsWorkspaceProps) {
  const tier = useImmersionTier()
  const { can } = usePermissions()
  const canManage = can('portfolio:manage')

  // 与左侧列表组件共享同一查询键（React Query 去重，单次请求）。
  const { data } = useGroupingViewList()
  const definitions = data?.data ?? []

  const [activeView, setActiveView] = React.useState<PmoGroupingViewDefinition | null>(null)
  const [saveDialog, setSaveDialog] = React.useState<PmoGroupingViewSaveDialogState | null>(null)

  // 列表就绪后自动激活默认视图（无默认标记则取首个系统预设，再退而取列表首项）；
  // 激活视图被删除后自动回退。
  React.useEffect(() => {
    if (definitions.length === 0) return
    setActiveView((current) => {
      if (current && definitions.some((view) => view.id === current.id)) return current
      return (
        definitions.find((view) => view.isDefault) ??
        definitions.find((view) => view.scope === PMO_GROUPING_VIEW_SCOPES.SYSTEM) ??
        definitions[0] ??
        null
      )
    })
  }, [definitions])

  const handleSelectView = (view: PmoGroupingViewDefinition) => setActiveView(view)
  const handleEditView = (view: PmoGroupingViewDefinition) => setSaveDialog({ kind: 'edit', view })
  const handleSaveAsView = (query: PmoGroupingViewQueryDefinition) =>
    setSaveDialog({ kind: 'create', initialQuery: query })

  return (
    <div
      data-gv-workspace
      data-gv-org={organizationId}
      className={cn(
        'flex min-h-[72vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 data-gv-title className="text-lg font-semibold text-[var(--nx-text-primary)]">
            分组视图
          </h2>
          <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
            系统预设与自定义分组定义管理 · 组合实时预览工作台 · 写操作仅组合管理可见
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canManage ? (
            <button
              type="button"
              data-gv-create-view
              onClick={() =>
                setSaveDialog({ kind: 'create', initialQuery: DEFAULT_NEW_VIEW_QUERY })
              }
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新建视图
            </button>
          ) : null}
        </div>
      </header>

      <div className="grid flex-1 items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <PmoGroupingDefinitionList
          canManage={canManage}
          activeViewId={activeView?.id ?? null}
          onSelectView={handleSelectView}
          onEditView={handleEditView}
        />
        <PmoGroupingPreviewBoard
          activeView={activeView}
          canManage={canManage}
          onSaveAsView={handleSaveAsView}
        />
      </div>

      <PmoGroupingViewSaveDialog
        state={saveDialog}
        canManageShared={canManage}
        onClose={() => setSaveDialog(null)}
      />
    </div>
  )
}

export default PmoGroupingViewsWorkspace
