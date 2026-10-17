'use client'

import * as React from 'react'
import type {
  BiDashboardDefinition,
  BiDashboardWidgetRegistryEntry,
  BiDashboardWidgetInstance,
} from '@aiproj/types'
import {
  biWidgetSizeLabel,
  biWidgetTypeDescription,
  biWidgetTypeLabel,
} from '@/lib/next/org-bi/org-bi-adapter'

/**
 * BI 仪表盘 widget 网格（v3-ui-next-org-portfolio-domains W3 · tasks 3.3）。
 *
 * - RL-14 确定性渲染：widget 实例只渲染「服务端注册表既有类型」；未知类型
 *   不渲染、不报错中断（统计跳过并在角标注明），其余已注册 widget 正常呈现；
 * - 卡片双通道：widget 中文标签 + 只读描述 + 键名/尺寸/位置元信息；
 * - 纯展示组件：零网络请求，供「当前盘视图」与选中盘预览共用。
 */
export interface BiDashboardGridProps {
  definition: BiDashboardDefinition
  registry: BiDashboardWidgetRegistryEntry[]
}

export function BiDashboardGrid({ definition, registry }: BiDashboardGridProps) {
  const registryByKey = React.useMemo(
    () => new Map(registry.map((entry) => [entry.widgetKey, entry])),
    [registry],
  )

  const known = definition.widgets.filter((widget) => registryByKey.has(widget.widgetKey))
  const skipped = definition.widgets.length - known.length
  const ordered = [...known].sort((a, b) => {
    const byY = a.position.y - b.position.y
    return byY !== 0 ? byY : a.position.x - b.position.x
  })

  if (definition.widgets.length === 0) {
    return (
      <div
        data-bi-dash-grid-empty
        className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
      >
        <p className="text-xs font-medium text-[var(--nx-text-primary)]">该看板尚未配置 widget</p>
        <p className="text-[11px] text-[var(--nx-text-muted)]">
          通过编辑仪表盘从 widget 库添加类型后保存，网格将按布局呈现。
        </p>
      </div>
    )
  }

  const columnClass =
    definition.layout.columns === 1
      ? 'grid-cols-1'
      : definition.layout.columns === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : definition.layout.columns === 3
          ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
          : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'

  return (
    <div data-bi-dash-grid className="flex flex-col gap-2">
      {skipped > 0 ? (
        <p
          data-bi-dash-grid-skipped
          className="rounded-sm border border-dashed border-[var(--nx-border-hairline)] px-2 py-1 text-[10px] text-[var(--nx-text-muted)]"
        >
          {skipped} 个未注册 widget 类型已按确定性规则跳过渲染（不中断）
        </p>
      ) : null}
      {ordered.length === 0 ? (
        <div
          data-bi-dash-grid-skipped
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
        >
          <p className="text-xs font-medium text-[var(--nx-text-primary)]">
            看板 widget 均为未注册类型，无可渲染内容
          </p>
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            请在编辑器中移除未知类型并重新保存。
          </p>
        </div>
      ) : (
        <div
          className={`grid gap-2 ${columnClass}`}
          data-bi-dash-grid-layout={`${definition.layout.columns}-col-${definition.layout.density}`}
        >
          {ordered.map((widget) => (
            <BiDashboardWidgetCard
              key={`${widget.widgetKey}:${widget.position.x}:${widget.position.y}`}
              widget={widget}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BiDashboardWidgetCard({ widget }: { widget: BiDashboardWidgetInstance }) {
  return (
    <article
      data-bi-dash-widget
      data-bi-dash-widget-key={widget.widgetKey}
      className="flex min-h-24 flex-col gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h4 className="truncate text-xs font-semibold text-[var(--nx-text-primary)]">
          {biWidgetTypeLabel(widget.widgetKey)}
        </h4>
        <span className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-text-muted)]">
          {biWidgetSizeLabel(widget.size)}
        </span>
      </header>
      <p className="line-clamp-2 text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
        {biWidgetTypeDescription(widget.widgetKey)}
      </p>
      <footer className="mt-auto font-mono text-[9px] text-[var(--nx-text-muted)]">
        {widget.widgetKey} · ({widget.position.x},{widget.position.y})
        {widget.visualization ? ` · ${widget.visualization}` : ''}
      </footer>
    </article>
  )
}

export default BiDashboardGrid
