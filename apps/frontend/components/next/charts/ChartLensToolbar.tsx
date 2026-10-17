'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, EyeOff, PenLine } from 'lucide-react'
import {
  CHART_DOMAIN_LABELS,
  type PmChartDefinition,
} from '@/lib/next/charts/chart-catalog-metadata'
import type { ChartLensInteractionMode } from './chart-lens-registry'
import { CHART_ICONS } from './chart-icons'

/**
 * 图表镜头统一顶栏（v3-ui-next-chart-gallery design §5 / tasks 1.8）。
 *
 * - 左侧：返回图表馆目录（Link，历史保留）+ 图标 + 图表中文名 + 领域胶囊；
 * - 右侧：只读/受控编辑微标 + **汇出菜单挂载点**（`data-chart-export-mount`，
 *   W5 将 ChartExportMenu 注入 exportSlot，捕获 `[data-chart-viewport-slot]`）；
 * - 视图切换 Tab（Trend/Team 等）由镜头组件自持，不在此横向扩展（W2+ 镜头内部实现）；
 * - 展示层零网络请求；数据属性供集成测试与汇出引擎定位。
 */
export interface ChartLensToolbarProps {
  projectId: number
  definition: PmChartDefinition
  /** 编辑边界（registry 派生：editable 仅鱼骨图/风险登记表） */
  interactionMode?: ChartLensInteractionMode
  /** 汇出菜单挂载点（W5 注入 ChartExportMenu；缺省不渲染汇出区） */
  exportSlot?: React.ReactNode
  /** 顶部右侧扩展动作插槽（如鱼骨图保存按钮，W3 注入） */
  actionSlot?: React.ReactNode
}

export function ChartLensToolbar({
  projectId,
  definition,
  interactionMode = 'readonly',
  exportSlot,
  actionSlot,
}: ChartLensToolbarProps) {
  const Icon = CHART_ICONS[definition.iconName]
  const editable = interactionMode === 'editable'

  return (
    <header
      data-chart-lens-toolbar
      data-chart-id={definition.id}
      className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-3 py-2 border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          href={`/next/projects/${projectId}/charts`}
          aria-label="返回图表馆目录"
          data-chart-back-to-catalog
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <Icon className="h-4 w-4 shrink-0 text-[var(--nx-accent)]" aria-hidden />
        <h2
          data-chart-lens-title
          className="truncate text-sm font-semibold text-[var(--nx-text-primary)]"
        >
          {definition.title}
        </h2>
        <span
          data-chart-lens-domain
          className="hidden shrink-0 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)] sm:inline-block"
        >
          {CHART_DOMAIN_LABELS[definition.domain]}
        </span>
        <span
          data-chart-lens-mode
          className="hidden shrink-0 items-center gap-1 rounded border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-1.5 py-0.5 text-[10px] text-[var(--nx-accent)] md:inline-flex"
        >
          {editable ? (
            <PenLine className="h-3 w-3" aria-hidden />
          ) : (
            <EyeOff className="h-3 w-3" aria-hidden />
          )}
          {editable ? '受控手动编辑' : '纯只读分析'}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {actionSlot}
        <div data-chart-export-mount className="flex items-center">
          {exportSlot ?? null}
        </div>
      </div>
    </header>
  )
}

export default ChartLensToolbar
