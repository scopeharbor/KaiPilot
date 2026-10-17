'use client'

import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowRight, Gauge } from 'lucide-react'
import type { PortfolioTrafficLightBlock } from '@aiproj/types'
import { TRAFFIC_LIGHT_STATUS_LABELS } from '@aiproj/types'

/**
 * 组合交通灯摘要卡（/next/pmo，v3-ui-next-pmo-domain W1 · tasks 1.3，
 * spec「PMO 组合仪表盘新轨主页与组织层信息架构 · 组合态势呈现」）。
 *
 * - 纯展示层：trafficLight 由 PmoPortfolioOverviewWorkspace 从
 *   `usePortfolioSummary({ includeTrafficLight: true })` 下推（查询键含
 *   trafficLight 块），本组件零网络；
 * - 红/黄/绿/灰四色计数卡，色点 + `TRAFFIC_LIGHT_STATUS_LABELS` 文字双通道；
 *   能力不可用（available=false）时展示后端 warnings 文案而非空白；
 * - 头部提供「查看红绿灯报告」下钻（/next/pmo/traffic-light，W2 独立页）。
 */
export interface PmoTrafficSummaryCardProps {
  trafficLight: PortfolioTrafficLightBlock
}

export function PmoTrafficSummaryCard({ trafficLight }: PmoTrafficSummaryCardProps) {
  const router = useRouter()

  if (!trafficLight.available) {
    const warningText = trafficLight.warnings[0]?.message ?? 'PMO 交通灯能力未启用或当前不可用'
    return (
      <section
        data-pmo-traffic-summary
        data-pmo-traffic-unavailable
        aria-label="组合交通灯摘要"
        className="flex items-start gap-2.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3.5"
      >
        <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-xs font-medium text-[var(--nx-text-primary)]">交通灯状态</h2>
          <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
            <AlertTriangle
              className="mt-px h-3 w-3 shrink-0 text-[var(--nx-status-warning)]"
              aria-hidden
            />
            {warningText}
          </p>
        </div>
      </section>
    )
  }

  const entries: Array<{
    status: 'red' | 'yellow' | 'green' | 'gray'
    count: number
    dotClass: string
  }> = [
    {
      status: 'red',
      count: trafficLight.redCount,
      dotClass: 'bg-[var(--nx-status-danger)]',
    },
    {
      status: 'yellow',
      count: trafficLight.yellowCount,
      dotClass: 'bg-[var(--nx-status-warning)]',
    },
    {
      status: 'green',
      count: trafficLight.greenCount,
      dotClass: 'bg-[var(--nx-status-success)]',
    },
    {
      status: 'gray',
      count: trafficLight.grayCount,
      dotClass: 'bg-[var(--nx-text-muted)]',
    },
  ]

  return (
    <section
      data-pmo-traffic-summary
      aria-label="组合交通灯摘要"
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xs font-medium text-[var(--nx-text-primary)]">
          <Gauge className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          交通灯状态
        </h2>
        <button
          type="button"
          data-pmo-traffic-report-link
          onClick={() => router.push('/next/pmo/traffic-light')}
          className="flex items-center gap-1 text-[11px] text-[var(--nx-accent)] transition-colors hover:text-[var(--nx-space-cyan)]"
        >
          查看红绿灯报告
          <ArrowRight className="h-3 w-3" aria-hidden />
        </button>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {entries.map(({ status, count, dotClass }) => (
          <li
            key={status}
            data-pmo-traffic-count={status}
            className="flex items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2"
          >
            <span
              className={['h-2.5 w-2.5 shrink-0 rounded-full', dotClass].join(' ')}
              aria-hidden
            />
            <span className="text-xs text-[var(--nx-text-secondary)]">
              {TRAFFIC_LIGHT_STATUS_LABELS[status]}
            </span>
            <span className="ml-auto font-mono text-sm font-semibold text-[var(--nx-text-primary)]">
              {count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default PmoTrafficSummaryCard
