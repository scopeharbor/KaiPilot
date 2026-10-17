'use client'

import * as React from 'react'
import {
  AlertCircle,
  Copy,
  Globe,
  Layers,
  Lock,
  Pencil,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import {
  useGroupingViewList,
  useGroupingViewDelete,
  useGroupingViewDuplicate,
  useGroupingViewSetDefault,
} from '@/hooks/use-portfolio-grouping-views'
import { cn } from '@/lib/utils'
import type { PmoGroupingViewDefinition, PmoGroupingViewScope } from '@aiproj/types'
import { PMO_GROUPING_VIEW_SCOPES } from '@aiproj/types'

/**
 * 分组视图定义列表 + 受控 CRUD（v3-ui-next-pmo-domain W3 · tasks 3.2）。
 *
 * - 消费 useGroupingViewList/Delete/Duplicate/SetDefault；列表按归属分组展示
 *   （系统预设 / 个人 / 组织共享），默认视图带「默认」徽标；
 * - 写入口（编辑/复制/设默认/删除）仅 `portfolio:manage` 可见，且以服务端
 *   capabilities（canEdit/canDelete/canDuplicate/canSetDefault/canSetOrgDefault）
 *   为最终显隐依据（RL-06 / RL-14 确定性）；破坏性动作一律二次确认；
 * - 写成功由既有 hook 失效 `['pmo','grouping-views']` 缓存，列表自动刷新；
 * - 列表自身覆盖加载骨架 / 空态 / 错误重试三态。
 */

export const GV_SCOPE_META: Record<PmoGroupingViewScope, { label: string; badgeClass: string }> = {
  [PMO_GROUPING_VIEW_SCOPES.SYSTEM]: {
    label: '系统',
    badgeClass: 'border-[rgba(56,189,248,0.45)] text-[var(--nx-accent)]',
  },
  [PMO_GROUPING_VIEW_SCOPES.PERSONAL]: {
    label: '个人',
    badgeClass: 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
  },
  [PMO_GROUPING_VIEW_SCOPES.ORGANIZATION]: {
    label: '组织共享',
    badgeClass: 'border-[rgba(16,185,129,0.45)] text-[var(--nx-status-success)]',
  },
}

export const GV_SECTION_META: Array<{
  scope: PmoGroupingViewScope
  label: string
  icon: React.ReactNode
}> = [
  {
    scope: PMO_GROUPING_VIEW_SCOPES.SYSTEM,
    label: '系统预设',
    icon: <Layers className="h-3 w-3" aria-hidden />,
  },
  {
    scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
    label: '个人视图',
    icon: <Lock className="h-3 w-3" aria-hidden />,
  },
  {
    scope: PMO_GROUPING_VIEW_SCOPES.ORGANIZATION,
    label: '组织共享',
    icon: <Globe className="h-3 w-3" aria-hidden />,
  },
]

export interface PmoGroupingDefinitionListProps {
  /** 是否具备 portfolio:manage（写入口门禁，服务端终裁）。 */
  canManage: boolean
  /** 当前在预览工作台激活的视图 id。 */
  activeViewId: string | null
  onSelectView: (view: PmoGroupingViewDefinition) => void
  onEditView: (view: PmoGroupingViewDefinition) => void
}

type ConfirmAction = 'delete' | 'duplicate' | 'set-default'

interface ConfirmTarget {
  view: PmoGroupingViewDefinition
  action: ConfirmAction
}

function setDefaultScopeFor(view: PmoGroupingViewDefinition): 'personal' | 'organization' {
  return view.scope === PMO_GROUPING_VIEW_SCOPES.ORGANIZATION ? 'organization' : 'personal'
}

function confirmMessage(target: ConfirmTarget): string {
  const { view, action } = target
  if (action === 'delete') {
    return `确定删除视图「${view.name}」？该操作不可恢复。`
  }
  if (action === 'duplicate') {
    return `确定复制视图「${view.name}」？将基于它创建一份新视图。`
  }
  const scopeLabel =
    view.scope === PMO_GROUPING_VIEW_SCOPES.ORGANIZATION ? '组织默认视图' : '你的默认分组视图'
  return `确定将「${view.name}」设为${scopeLabel}？`
}

export function PmoGroupingDefinitionList({
  canManage,
  activeViewId,
  onSelectView,
  onEditView,
}: PmoGroupingDefinitionListProps) {
  const { data, isLoading, isError, refetch } = useGroupingViewList()
  const deleteMutation = useGroupingViewDelete()
  const duplicateMutation = useGroupingViewDuplicate()
  const setDefaultMutation = useGroupingViewSetDefault()

  const [confirmTarget, setConfirmTarget] = React.useState<ConfirmTarget | null>(null)
  const confirmDialogRef = React.useRef<HTMLDivElement | null>(null)

  // 确认弹层无表单字段（确认即提交并立即关闭，无常驻在途态）：Escape 默认可关。
  useDialogA11y({
    ref: confirmDialogRef,
    open: confirmTarget !== null,
    onClose: () => setConfirmTarget(null),
  })

  const definitions = data?.data ?? []
  const byScope = (scope: PmoGroupingViewScope) =>
    definitions.filter((view) => view.scope === scope)
  const actionError =
    deleteMutation.error ?? duplicateMutation.error ?? setDefaultMutation.error ?? null

  const handleConfirm = () => {
    if (!confirmTarget) return
    const { view, action } = confirmTarget
    if (action === 'delete') {
      deleteMutation.mutate(view.id)
    } else if (action === 'duplicate') {
      duplicateMutation.mutate({ id: view.id })
    } else {
      setDefaultMutation.mutate({
        id: view.id,
        body: { scope: setDefaultScopeFor(view) },
      })
    }
    setConfirmTarget(null)
  }

  const rowAction = (view: PmoGroupingViewDefinition, action: ConfirmAction) =>
    setConfirmTarget({ view, action })

  return (
    <aside
      data-gv-def-list
      aria-label="分组视图定义列表"
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
        <Layers className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
        视图库
        <span className="ml-auto font-mono text-[10px] text-[var(--nx-text-muted)]">
          {definitions.length}
        </span>
      </div>

      {isLoading ? (
        <div
          data-gv-list-skeleton
          role="status"
          aria-busy="true"
          aria-label="分组视图列表加载中"
          className="flex flex-col gap-2 py-1"
        >
          {[1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="h-12 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
          ))}
        </div>
      ) : isError ? (
        <div
          data-gv-list-error
          role="alert"
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] px-3 py-6 text-center"
        >
          <p className="text-[11px] text-[var(--nx-text-secondary)]">视图列表加载失败。</p>
          <button
            type="button"
            data-gv-list-retry
            onClick={() => void refetch()}
            className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-border-focus)]"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            重新加载
          </button>
        </div>
      ) : definitions.length === 0 ? (
        <div
          data-gv-list-empty
          className="flex flex-col items-center gap-1 rounded-md border border-dashed border-[var(--nx-border-hairline)] px-3 py-8 text-center"
        >
          <p className="text-[11px] font-medium text-[var(--nx-text-primary)]">暂无分组视图</p>
          <p className="text-[10px] text-[var(--nx-text-muted)]">
            {canManage
              ? '可点击右上角「新建视图」创建。'
              : '组织管理员维护视图库，可浏览系统预设。'}
          </p>
        </div>
      ) : (
        <ol className="flex min-w-0 flex-col gap-2.5">
          {GV_SECTION_META.map((section) => {
            const views = byScope(section.scope)
            if (views.length === 0) return null
            return (
              <li key={section.scope} className="flex min-w-0 flex-col gap-1.5">
                <div
                  data-gv-def-section={section.scope}
                  className="flex items-center gap-1.5 px-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--nx-text-muted)]"
                >
                  {section.icon}
                  {section.label}
                </div>
                <ul className="flex min-w-0 flex-col gap-1">
                  {views.map((view) => {
                    const active = view.id === activeViewId
                    const meta = GV_SCOPE_META[view.scope]
                    return (
                      <li
                        key={view.id}
                        data-gv-def-item
                        data-gv-def-scope={view.scope}
                        data-gv-def-default={view.isDefault || undefined}
                        className={cn(
                          'min-w-0 rounded-md border bg-[var(--nx-workspace-surface)] transition-colors',
                          active
                            ? 'border-[var(--nx-border-focus)]'
                            : 'border-[var(--nx-border-hairline)]',
                        )}
                      >
                        <button
                          type="button"
                          data-gv-def-item-open
                          aria-current={active ? 'true' : undefined}
                          aria-label={`预览视图 ${view.name}`}
                          onClick={() => onSelectView(view)}
                          className="flex w-full min-w-0 items-center gap-2 px-2.5 pb-1 pt-2 text-left"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs text-[var(--nx-text-primary)]">
                            {view.name}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 rounded-sm border px-1 py-px font-mono text-[9px]',
                              meta.badgeClass,
                            )}
                          >
                            {meta.label}
                          </span>
                          {view.isDefault ? (
                            <span
                              data-gv-def-default-badge
                              className="flex shrink-0 items-center gap-0.5 rounded-sm border border-[rgba(245,158,11,0.4)] px-1 py-px font-mono text-[9px] text-[var(--nx-status-warning)]"
                            >
                              <Star className="h-2.5 w-2.5" aria-hidden />
                              默认
                            </span>
                          ) : null}
                        </button>
                        <p className="truncate px-2.5 pb-1.5 text-[10px] text-[var(--nx-text-muted)]">
                          {view.description ?? `按 ${view.query.primaryGrouping} 分组`}
                        </p>
                        {canManage ? (
                          <div className="flex items-center gap-0.5 border-t border-[var(--nx-border-hairline)] px-1.5 py-1">
                            {view.capabilities.canEdit ? (
                              <button
                                type="button"
                                data-gv-def-edit
                                onClick={() => onEditView(view)}
                                className="flex h-6 items-center gap-1 rounded-sm px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-accent)]"
                              >
                                <Pencil className="h-3 w-3" aria-hidden />
                                编辑
                              </button>
                            ) : null}
                            {view.capabilities.canDuplicate ? (
                              <button
                                type="button"
                                data-gv-def-duplicate
                                onClick={() => rowAction(view, 'duplicate')}
                                className="flex h-6 items-center gap-1 rounded-sm px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-accent)]"
                              >
                                <Copy className="h-3 w-3" aria-hidden />
                                复制
                              </button>
                            ) : null}
                            {view.capabilities.canSetDefault ||
                            view.capabilities.canSetOrgDefault ? (
                              <button
                                type="button"
                                data-gv-def-set-default
                                onClick={() => rowAction(view, 'set-default')}
                                className="flex h-6 items-center gap-1 rounded-sm px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-status-warning)]"
                              >
                                <Star className="h-3 w-3" aria-hidden />
                                {view.scope === PMO_GROUPING_VIEW_SCOPES.ORGANIZATION
                                  ? '设为组织默认'
                                  : '设为默认'}
                              </button>
                            ) : null}
                            {view.capabilities.canDelete ? (
                              <button
                                type="button"
                                data-gv-def-delete
                                onClick={() => rowAction(view, 'delete')}
                                className="flex h-6 items-center gap-1 rounded-sm px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-status-danger)]"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden />
                                删除
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ol>
      )}

      {actionError ? (
        <div
          data-gv-list-action-error
          role="alert"
          className="flex items-start gap-1.5 rounded-md border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.08)] px-2.5 py-2 text-[11px] text-[var(--nx-status-danger)]"
        >
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{actionError instanceof Error ? actionError.message : '操作失败，请稍后重试'}</span>
        </div>
      ) : null}

      {confirmTarget ? (
        <div
          data-gv-confirm
          ref={confirmDialogRef}
          role="dialog"
          tabIndex={-1}
          aria-modal="true"
          aria-label="操作确认"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
        >
          <div className="w-full max-w-sm rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] p-4 shadow-xl">
            <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">
              {confirmTarget.action === 'delete'
                ? '删除视图'
                : confirmTarget.action === 'duplicate'
                  ? '复制视图'
                  : '设置默认视图'}
            </h3>
            <p
              data-gv-confirm-message
              className="mt-2 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
            >
              {confirmMessage(confirmTarget)}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                data-gv-confirm-cancel
                onClick={() => setConfirmTarget(null)}
                className="flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)]"
              >
                取消
              </button>
              <button
                type="button"
                data-gv-confirm-ok
                onClick={handleConfirm}
                className={cn(
                  'flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors',
                  confirmTarget.action === 'delete'
                    ? 'border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.12)] text-[var(--nx-status-danger)] hover:bg-[rgba(239,68,68,0.2)]'
                    : 'border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] text-[var(--nx-accent)] hover:border-[var(--nx-accent)]',
                )}
              >
                确认{confirmTarget.action === 'duplicate' ? '复制' : ''}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  )
}

export default PmoGroupingDefinitionList
