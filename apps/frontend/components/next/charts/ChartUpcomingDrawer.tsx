'use client'

import * as React from 'react'
import { Rocket, X } from 'lucide-react'
import type { PmChartDefinition } from '@/lib/next/charts/chart-catalog-metadata'
import { CHART_DOMAIN_LABELS } from '@/lib/next/charts/chart-catalog-metadata'
import { CHART_ICONS } from './chart-icons'

/**
 * 第二层「即将上线」图表预告抽屉（v3-ui-next-chart-gallery design §2.2 / spec：
 * 用户点击置灰卡片时弹出包含简介、应用价值与数据依赖规划的预告说明抽屉，
 * 禁止无效路由跳转或空白报错）。
 *
 * - 纯展示 + 关闭（Esc / 遮罩 / 关闭按钮），零路由副作用、零网络请求（RL-01）；
 * - 规划内容来自静态元数据 `upcoming`（管理价值 / B6a 已上线端点对应 / 演进路线）；
 * - chart 为 null 时不渲染任何内容（目录页缺省关闭态）。
 */
export interface ChartUpcomingDrawerProps {
  /** 目标图表定义；null = 关闭态 */
  chart: PmChartDefinition | null
  onClose: () => void
}

export function ChartUpcomingDrawer({ chart, onClose }: ChartUpcomingDrawerProps) {
  // Esc 关闭
  React.useEffect(() => {
    if (chart === null) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chart, onClose])

  if (chart === null) return null

  const Icon = CHART_ICONS[chart.iconName]

  return (
    <div
      data-chart-upcoming-drawer
      data-chart-upcoming-chart={chart.id}
      className="fixed inset-0 z-50"
      role="presentation"
    >
      {/* 遮罩：点击关闭，绝不放行穿透到页面 */}
      <button
        type="button"
        data-chart-upcoming-scrim
        aria-label="关闭预告"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${chart.title} · 即将上线预告`}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]">
              <Icon className="h-4 w-4 text-[var(--nx-text-muted)]" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[var(--nx-text-primary)]">
                {chart.title}
              </h3>
              <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--nx-text-muted)]">
                {chart.subtitle} · {CHART_DOMAIN_LABELS[chart.domain]}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-chart-upcoming-close
            aria-label="关闭预告"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex items-center gap-2 border-b border-[var(--nx-border-hairline)] px-5 py-2.5">
          <Rocket className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
          <span className="text-xs font-medium text-[var(--nx-text-primary)]">
            即将上线 · 数据底座已就绪
          </span>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <h4 className="mb-1.5 text-xs font-semibold text-[var(--nx-text-secondary)]">
              图表简介
            </h4>
            <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
              {chart.description}
            </p>
          </section>

          <section data-chart-upcoming-section="value">
            <h4 className="mb-1.5 text-xs font-semibold text-[var(--nx-text-secondary)]">
              管理应用价值
            </h4>
            <ul className="space-y-1.5">
              {(chart.upcoming?.value ?? []).map((point) => (
                <li
                  key={point}
                  className="flex items-start gap-1.5 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
                >
                  <span
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--nx-accent)]"
                    aria-hidden
                  />
                  {point}
                </li>
              ))}
            </ul>
          </section>

          <section data-chart-upcoming-section="endpoints">
            <h4 className="mb-1.5 text-xs font-semibold text-[var(--nx-text-secondary)]">
              数据依赖 · 后端端点规划
            </h4>
            <p className="mb-2 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
              以下 B6a 批次数据端点已上线，图表镜头将直接消费（RL-04 同缓存键）：
            </p>
            <ul className="space-y-1.5">
              {(chart.upcoming?.endpoints ?? []).map((endpoint) => (
                <li
                  key={endpoint}
                  className="overflow-x-auto rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--nx-text-secondary)]"
                >
                  {endpoint}
                </li>
              ))}
            </ul>
          </section>

          <section data-chart-upcoming-section="roadmap">
            <h4 className="mb-1.5 text-xs font-semibold text-[var(--nx-text-secondary)]">
              未来演进路线
            </h4>
            <ul className="space-y-1.5">
              {(chart.upcoming?.roadmap ?? []).map((step) => (
                <li
                  key={step}
                  className="flex items-start gap-1.5 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
                >
                  <span
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--nx-status-warning)]"
                    aria-hidden
                  />
                  {step}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <footer className="border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <button
            type="button"
            data-chart-upcoming-confirm
            onClick={onClose}
            className="h-9 w-full rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            知道了
          </button>
        </footer>
      </aside>
    </div>
  )
}

export default ChartUpcomingDrawer
