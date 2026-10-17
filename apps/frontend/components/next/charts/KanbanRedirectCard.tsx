'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, LayoutGrid } from 'lucide-react'
import { getChartDefinition } from '@/lib/next/charts/chart-catalog-metadata'
import { CHART_ICONS } from '@/components/next/charts/chart-icons'

/**
 * 经典看板直达卡片（v3-ui-next-chart-gallery tasks 4.7 / spec「经典看板直达入口」）。
 *
 * 看板被收录为图表馆第 8 项「已就绪」工具：点击卡片通过客户端路由平滑跳转至项目
 * 既有看板主工作面 `/next/projects/:id?lens=kanban`——不重复构建冗余看板组件、
 * 保留浏览器历史（push 而非 replace，可一键返回图表馆）。
 *
 * 契约：props {projectId} 与全部镜头组件一致；静态元数据来自 chart-catalog-metadata
 * （id=kanban，RL-14 确定性渲染），图标收敛于 chart-icons。
 */
export interface KanbanRedirectCardProps {
  projectId: number
}

export function KanbanRedirectCard({ projectId }: KanbanRedirectCardProps) {
  const router = useRouter()
  const definition = React.useMemo(() => getChartDefinition('kanban'), [])
  if (!definition) return null

  const Icon = CHART_ICONS[definition.iconName]

  const handleNavigate = () => {
    // push：保留图表馆来源历史，浏览器返回键可回到目录
    router.push(`/next/projects/${projectId}?lens=kanban`)
  }

  return (
    <button
      type="button"
      data-kanban-redirect-card
      data-chart-card={definition.id}
      data-chart-status={definition.status}
      aria-label={`${definition.title}（${definition.badge}）`}
      onClick={handleNavigate}
      className="group flex flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 text-left transition-colors hover:border-[var(--nx-border-focus)] hover:bg-[var(--nx-space-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)]"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
          <Icon className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          {definition.id}
        </span>
        <span className="flex items-center gap-1 rounded border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-accent)]">
          <LayoutGrid className="h-3 w-3" aria-hidden />
          {definition.badge}
        </span>
      </span>
      <span className="text-sm font-semibold leading-snug text-[var(--nx-text-primary)]">
        {definition.title}
      </span>
      <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
        {definition.subtitle}
      </span>
      <span className="line-clamp-2 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
        {definition.description}
      </span>
      <span className="mt-auto flex items-center gap-1 pt-1 text-[10px] text-[var(--nx-accent)]">
        <ArrowRight
          className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
        前往看板工作面（lens=kanban）
      </span>
    </button>
  )
}

export default KanbanRedirectCard
