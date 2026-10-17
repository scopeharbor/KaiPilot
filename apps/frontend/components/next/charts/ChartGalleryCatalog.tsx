'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Search, SearchX } from 'lucide-react'
import {
  CHART_DOMAINS,
  CHART_DOMAIN_LABELS,
  isComingSoonChartId,
  PM_CHART_DEFINITIONS,
  filterChartDefinitions,
  type ChartDomainId,
  type PmChartDefinition,
} from '@/lib/next/charts/chart-catalog-metadata'
import { cn } from '@/lib/utils'
import { ChartUpcomingDrawer } from './ChartUpcomingDrawer'
import { CHART_ICONS } from './chart-icons'

/**
 * 图表馆 20 项全景卡片目录（v3-ui-next-chart-gallery design §2.2 / spec
 * 「图表馆独立空间与 20 项全景目录」）。
 *
 * - 分类 Tab（全部/立项治理/进度网络/工期平衡/结构质量）+ 即时模糊检索（纯函数）；
 * - 24 项卡片全部已就绪可点击：23 项直达 `charts/:chartId` 深层路由，看板平滑
 *   跳转项目空间看板工作面（`?lens=kanban`，浏览器历史保留）；
 * - 「即将上线」占位与 ChartUpcomingDrawer 预告抽屉保留为后续新增图表的基础设施，
 *   当前目录无占位项（批 G1~G4 已全部落地，spec 场景的置灰/预告路径处于空态）；
 * - RL-14：卡片与分类全部由静态元数据确定性渲染，零动态注入。
 */
export interface ChartGalleryCatalogProps {
  projectId: number
  /** 挂载即自动弹出的第二层图表预告（chartId 路由回退时使用）；非即将上线 id 忽略。 */
  defaultComingSoonChartId?: string | null
}

type CatalogTabId = ChartDomainId | 'all'

const TAB_OPTIONS: readonly { id: CatalogTabId; label: string }[] = [
  { id: 'all', label: '全部' },
  ...CHART_DOMAINS.map((domain) => ({ id: domain.id as CatalogTabId, label: domain.label })),
]

export function ChartGalleryCatalog({
  projectId,
  defaultComingSoonChartId = null,
}: ChartGalleryCatalogProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = React.useState<CatalogTabId>('all')
  const [query, setQuery] = React.useState('')
  // 预告抽屉：defaultComingSoonChartId 仅在挂载时评估（路由回退弹一次，不随查询变化重弹）
  const [upcomingChart, setUpcomingChart] = React.useState<PmChartDefinition | null>(() => {
    if (defaultComingSoonChartId === null) return null
    return isComingSoonChartId(defaultComingSoonChartId)
      ? (PM_CHART_DEFINITIONS.find((d) => d.id === defaultComingSoonChartId) ?? null)
      : null
  })

  const filtered = React.useMemo(
    () => filterChartDefinitions({ query, domain: activeTab }),
    [query, activeTab],
  )

  const counts = React.useMemo(
    () => ({
      available: PM_CHART_DEFINITIONS.filter((d) => d.status === 'available').length,
      comingSoon: PM_CHART_DEFINITIONS.filter((d) => d.status === 'coming-soon').length,
    }),
    [],
  )

  function tabCount(tab: CatalogTabId): number {
    if (tab === 'all') return PM_CHART_DEFINITIONS.length
    return PM_CHART_DEFINITIONS.filter((d) => d.domain === tab).length
  }

  function openChart(chart: PmChartDefinition) {
    if (chart.status !== 'available') {
      setUpcomingChart(chart)
      return
    }
    // 看板：复用项目空间主工作面（spec「经典看板直达入口」，历史记录完整保留）
    if (chart.id === 'kanban') {
      router.push(`/next/projects/${projectId}?lens=kanban`)
      return
    }
    router.push(`/next/projects/${projectId}/charts/${chart.id}`)
  }

  return (
    <div data-chart-gallery-catalog className="flex flex-col gap-4">
      {/* 目录标题行：全景统计徽章（8 已就绪 + 12 规划中） */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-[var(--nx-text-primary)]">
            经典项目管理图表全景
          </h3>
          <span className="rounded border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-accent)]">
            {counts.comingSoon > 0
              ? `已就绪 ${counts.available}`
              : `已就绪 ${counts.available} · 全量上线`}
          </span>
          {counts.comingSoon > 0 ? (
            <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-text-muted)]">
              即将上线 {counts.comingSoon}
            </span>
          ) : null}
        </div>
      </div>

      {/* 分类 Tab + 检索栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          data-chart-domain-tabs
          role="tablist"
          aria-label="按知识领域筛选图表"
          className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-0.5"
        >
          {TAB_OPTIONS.map((tab) => {
            const active = tab.id === activeTab
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                data-chart-domain-tab={tab.id}
                aria-selected={active}
                aria-controls="chart-catalog-panel"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative h-8 rounded-sm px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                  active
                    ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    'ml-1.5 font-mono text-[10px]',
                    active ? 'text-[var(--nx-accent)]' : 'text-[var(--nx-text-muted)]',
                  )}
                >
                  {tabCount(tab.id)}
                </span>
              </button>
            )
          })}
        </div>

        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-text-muted)]"
            aria-hidden
          />
          <input
            type="search"
            role="searchbox"
            aria-label="搜索图表"
            data-chart-gallery-search
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索图表名称 / 缩写 / 关键词…"
            className="h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] pl-8 pr-8 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]"
          />
          {query !== '' ? (
            <button
              type="button"
              data-chart-gallery-search-clear
              aria-label="清除搜索"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
            >
              <SearchX className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {/* 卡片网格 */}
      <div
        id="chart-catalog-panel"
        role="tabpanel"
        data-chart-catalog-panel
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {filtered.map((chart) => {
          const available = chart.status === 'available'
          const Icon = CHART_ICONS[chart.iconName]
          return (
            <button
              key={chart.id}
              type="button"
              data-chart-card={chart.id}
              data-chart-status={chart.status}
              aria-label={`${chart.title}（${chart.badge}）`}
              onClick={() => openChart(chart)}
              className={cn(
                'group flex flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 text-left',
                available
                  ? 'cursor-pointer transition-colors hover:border-[var(--nx-border-focus)] hover:bg-[var(--nx-space-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)]'
                  : 'cursor-pointer opacity-55 transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)]',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
                  <Icon
                    className={cn(
                      'h-4 w-4',
                      available ? 'text-[var(--nx-accent)]' : 'text-[var(--nx-text-muted)]',
                    )}
                    aria-hidden
                  />
                  {chart.id}
                </span>
                <span
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[10px] leading-none',
                    available
                      ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)]'
                      : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
                  )}
                >
                  {chart.badge}
                </span>
              </span>
              <span
                className={cn(
                  'text-sm font-semibold leading-snug',
                  available ? 'text-[var(--nx-text-primary)]' : 'text-[var(--nx-text-secondary)]',
                )}
              >
                {chart.title}
              </span>
              <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                {chart.subtitle} · {CHART_DOMAIN_LABELS[chart.domain]}
              </span>
              <span
                className={cn(
                  'line-clamp-2 text-xs leading-relaxed',
                  available ? 'text-[var(--nx-text-secondary)]' : 'text-[var(--nx-text-muted)]',
                )}
              >
                {chart.description}
              </span>
              <span className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span className="flex flex-wrap gap-1">
                  {chart.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-sm bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-text-muted)]"
                    >
                      {tag}
                    </span>
                  ))}
                </span>
                {available ? (
                  <ChevronRight
                    className="h-3.5 w-3.5 text-[var(--nx-accent)] opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                ) : null}
              </span>
            </button>
          )
        })}
      </div>

      {/* 无匹配空状态（零请求、可一键复位） */}
      {filtered.length === 0 ? (
        <div
          data-chart-catalog-empty
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-6 py-10 text-center"
        >
          <p className="text-sm text-[var(--nx-text-secondary)]">未找到匹配的图表</p>
          <button
            type="button"
            data-chart-catalog-reset
            onClick={() => {
              setQuery('')
              setActiveTab('all')
            }}
            className="h-8 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            清除筛选条件
          </button>
        </div>
      ) : null}

      {/* 预告抽屉（置灰卡片唯一去向，禁止路由跳转） */}
      <ChartUpcomingDrawer chart={upcomingChart} onClose={() => setUpcomingChart(null)} />
    </div>
  )
}

export default ChartGalleryCatalog
