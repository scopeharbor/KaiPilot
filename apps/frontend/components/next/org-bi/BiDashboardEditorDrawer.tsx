'use client'

import * as React from 'react'
import { Loader2, Plus, Save, X } from 'lucide-react'
import { useCreateDashboard, useUpdateDashboard } from '@/hooks/use-bi-dashboard'
import { cn } from '@/lib/utils'
import type {
  BiDashboardDefinition,
  BiDashboardLayout,
  BiDashboardScope,
  BiDashboardWidgetInstance,
  BiDashboardWidgetRegistryEntry,
  BiDashboardWidgetSize,
} from '@aiproj/types'
import { BI_DASHBOARD_SCOPES, BI_DASHBOARD_MAX_WIDGETS } from '@aiproj/types'
import {
  BI_WIDGET_SIZES,
  biDashboardScopeLabel,
  biWidgetSizeLabel,
  biWidgetTypeDescription,
  biWidgetTypeLabel,
} from '@/lib/next/org-bi/org-bi-adapter'

/**
 * BI 仪表盘编辑抽屉（v3-ui-next-org-portfolio-domains W3 · tasks 3.3）。
 *
 * - 创建态：个人盘（组织成员）与组织共享盘（org:manage 门禁在容器层完成，
 *   本抽屉只承接创建动作）双作用域；
 * - 编辑态：携带完整既有定义（版本乐观锁 version 随保存回写），保存走
 *   useUpdateDashboard；widget 只可从注册表 available 类型添加（RL-14）；
 * - 写路径显式人工触发：保存按钮 + 提交中防抖，成功后关闭并刷新列表缓存。
 */
export type BiDashboardEditorMode =
  { kind: 'create'; scope: BiDashboardScope } | { kind: 'edit'; dashboard: BiDashboardDefinition }

export interface BiDashboardEditorDrawerProps {
  organizationId: number
  mode: BiDashboardEditorMode | null
  registry: BiDashboardWidgetRegistryEntry[]
  onClose: () => void
}

const fieldClass =
  'h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50'
const labelClass = 'mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]'

export function BiDashboardEditorDrawer({
  organizationId,
  mode,
  registry,
  onClose,
}: BiDashboardEditorDrawerProps) {
  const createMutation = useCreateDashboard(organizationId)
  const updateMutation = useUpdateDashboard(organizationId)

  const isEdit = mode?.kind === 'edit'
  const source = mode?.kind === 'edit' ? mode.dashboard : null
  const scope: BiDashboardScope =
    mode?.kind === 'edit'
      ? mode.dashboard.scope
      : mode?.kind === 'create'
        ? mode.scope
        : BI_DASHBOARD_SCOPES.PERSONAL

  const [name, setName] = React.useState('')
  const [columns, setColumns] = React.useState(2)
  const [density, setDensity] = React.useState<BiDashboardLayout['density']>('comfortable')
  const [widgets, setWidgets] = React.useState<BiDashboardWidgetInstance[]>([])
  const [formError, setFormError] = React.useState<string | null>(null)

  // 打开时装载：编辑态回填既有定义，创建态重置为空白表单。
  React.useEffect(() => {
    if (!mode) return
    setFormError(null)
    if (mode.kind === 'edit') {
      setName(mode.dashboard.name)
      setColumns(mode.dashboard.layout.columns)
      setDensity(mode.dashboard.layout.density)
      setWidgets(mode.dashboard.widgets.map((widget) => ({ ...widget })))
    } else {
      setName('')
      setColumns(2)
      setDensity('comfortable')
      setWidgets([])
    }
  }, [mode])

  React.useEffect(() => {
    if (!mode) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, onClose])

  if (!mode) return null

  const availableRegistry = registry.filter((entry) => entry.availability === 'available')

  const addWidget = (widgetKey: BiDashboardWidgetInstance['widgetKey']) => {
    setWidgets((current) => {
      if (current.length >= BI_DASHBOARD_MAX_WIDGETS) return current
      const nextWidget: BiDashboardWidgetInstance = {
        widgetKey,
        size: 'medium',
        position: {
          x: current.length % Math.max(1, columns),
          y: Math.floor(current.length / Math.max(1, columns)),
          w: 1,
          h: 1,
        },
        settings: {},
      }
      return [...current, nextWidget]
    })
  }

  const updateWidgetSize = (index: number, size: BiDashboardWidgetSize) => {
    setWidgets((current) =>
      current.map((widget, i) => (i === index ? { ...widget, size } : widget)),
    )
  }

  const removeWidget = (index: number) => {
    setWidgets((current) => current.filter((_, i) => i !== index))
  }

  const isPending = createMutation.isPending || updateMutation.isPending
  const canSubmit = name.trim() !== '' && !isPending

  const handleSave = async () => {
    if (!canSubmit) return
    setFormError(null)
    const payload = {
      name: name.trim(),
      scope,
      layout: { columns, density },
      widgets,
      timeWindow: { mode: 'last_n_days' as const, days: 30 },
      freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' as const },
    }
    try {
      if (isEdit && source) {
        await updateMutation.mutateAsync({
          dashboardId: source.dashboardId,
          payload: { ...payload, version: source.version },
        })
      } else {
        await createMutation.mutateAsync(payload)
      }
      onClose()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存失败，请重试')
    }
  }

  const scopeText = biDashboardScopeLabel(scope)

  return (
    <div data-bi-dash-editor className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-bi-dash-editor-scrim
        aria-label="关闭仪表盘编辑"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="编辑 BI 仪表盘"
        data-bi-dash-editor-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <Save className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                {isEdit ? `编辑仪表盘 · ${scopeText}` : `新建仪表盘 · ${scopeText}`}
              </h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                {isEdit && source ? `v${source.version} · ${source.dashboardId}` : '草稿'}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-bi-dash-editor-close
            aria-label="关闭仪表盘编辑"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* 名称 */}
          <label className="block">
            <span className={labelClass}>仪表盘名称</span>
            <input
              data-bi-dash-editor-name
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              placeholder={isEdit ? '未命名看板' : '例如：组织健康月度看板'}
              className={fieldClass}
            />
          </label>

          {/* 布局 */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>列数</span>
              <select
                data-bi-dash-editor-columns
                value={columns}
                onChange={(event) => setColumns(Number(event.target.value))}
                className={fieldClass}
              >
                <option value={1}>1 列</option>
                <option value={2}>2 列</option>
                <option value={3}>3 列</option>
                <option value={4}>4 列</option>
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>密度</span>
              <select
                data-bi-dash-editor-density
                value={density}
                onChange={(event) => setDensity(event.target.value as BiDashboardLayout['density'])}
                className={fieldClass}
              >
                <option value="comfortable">舒适</option>
                <option value="compact">紧凑</option>
              </select>
            </label>
          </div>

          {/* widget 库（仅注册表 available 类型，RL-14） */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h4 className="text-[11px] font-medium text-[var(--nx-text-secondary)]">Widget 库</h4>
              <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                {widgets.length}/{BI_DASHBOARD_MAX_WIDGETS}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableRegistry.length === 0 ? (
                <p className="text-[11px] text-[var(--nx-text-muted)]">
                  当前无可用 widget 类型（注册表为空或全部不可用）。
                </p>
              ) : (
                availableRegistry.map((entry) => (
                  <button
                    key={entry.widgetKey}
                    type="button"
                    data-bi-dash-editor-add-widget
                    data-bi-dash-editor-add-key={entry.widgetKey}
                    disabled={widgets.length >= BI_DASHBOARD_MAX_WIDGETS}
                    onClick={() => addWidget(entry.widgetKey)}
                    className="inline-flex h-7 items-center gap-1 rounded-sm border border-dashed border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3" aria-hidden />
                    {biWidgetTypeLabel(entry.widgetKey)}
                  </button>
                ))
              )}
            </div>
          </section>

          {/* 已添加实例 */}
          <section>
            <h4 className="mb-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
              看板内容（{widgets.length}）
            </h4>
            {widgets.length === 0 ? (
              <p className="rounded-sm border border-dashed border-[var(--nx-border-hairline)] px-2 py-3 text-[11px] text-[var(--nx-text-muted)]">
                从上方 Widget 库添加实例；未知类型不会出现在库中。
              </p>
            ) : (
              <ol className="space-y-1.5">
                {widgets.map((widget, index) => (
                  <li
                    key={`${widget.widgetKey}-${index}`}
                    data-bi-dash-editor-widget
                    data-bi-dash-editor-widget-key={widget.widgetKey}
                    className="flex items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2"
                  >
                    <span className="w-5 shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-[var(--nx-text-primary)]">
                        {biWidgetTypeLabel(widget.widgetKey)}
                      </span>
                      <span className="block truncate text-[9px] text-[var(--nx-text-muted)]">
                        {biWidgetTypeDescription(widget.widgetKey)}
                      </span>
                    </span>
                    <select
                      aria-label={`${biWidgetTypeLabel(widget.widgetKey)} 尺寸`}
                      value={widget.size}
                      onChange={(event) =>
                        updateWidgetSize(index, event.target.value as BiDashboardWidgetSize)
                      }
                      className="h-6 w-16 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 text-[10px] text-[var(--nx-text-primary)]"
                    >
                      {BI_WIDGET_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {biWidgetSizeLabel(size)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      data-bi-dash-editor-remove-widget
                      aria-label={`移除 ${biWidgetTypeLabel(widget.widgetKey)}`}
                      onClick={() => removeWidget(index)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-transparent text-[var(--nx-text-muted)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-status-danger)]"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {formError ? (
            <p
              data-bi-dash-editor-error
              role="alert"
              className="rounded-sm border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.08)] px-2.5 py-2 text-[11px] text-[var(--nx-status-danger)]"
            >
              {formError}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            取消
          </button>
          <button
            type="button"
            data-bi-dash-editor-save
            disabled={!canSubmit}
            onClick={() => void handleSave()}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-40',
            )}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden />
            )}
            {isEdit ? '保存修改' : '创建仪表盘'}
          </button>
        </footer>
      </aside>
    </div>
  )
}

export default BiDashboardEditorDrawer
