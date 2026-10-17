'use client'

import { AlertTriangle, BellOff, Clock, Info, RefreshCw } from 'lucide-react'
import type {
  PortfolioDashboardSource,
  PortfolioDashboardWarning,
  PortfolioSourceFreshness,
} from '@aiproj/types'

/**
 * 组合告警与数据新鲜度区（/next/pmo，v3-ui-next-pmo-domain W1 · tasks 1.4，
 * spec「PMO 组合仪表盘新轨主页与组织层信息架构 · 告警与数据新鲜度提示区」）。
 *
 * - 纯展示层：warnings/freshness 由 PmoPortfolioOverviewWorkspace 从
 *   `usePortfolioSummary({ includeFreshness: true })` 下推，零网络；
 * - 告警条目按 `warnings`（含 freshness 降级/权限脱敏/能力不可用等 code）
 *   渲染，图标 + 文案双通道；数据源新鲜度行以「过期/正常」状态字 + 更新时间
 *   双通道呈现（RL-15），`lastUpdatedAt` 为空的源以「无更新记录」中性呈现；
 * - 两者皆空渲染语义空态，杜绝空白区（spec 三态完备）。
 */
export interface PmoPortfolioAlertsCardProps {
  warnings: PortfolioDashboardWarning[]
  freshness: PortfolioSourceFreshness[]
}

export function PmoPortfolioAlertsCard({ warnings, freshness }: PmoPortfolioAlertsCardProps) {
  const staleSources = freshness.filter((item) => item.isStale)
  const hasContent = warnings.length > 0 || staleSources.length > 0

  if (!hasContent) {
    return (
      <section
        data-pmo-alerts-card
        data-pmo-alerts-empty
        aria-label="组合提示"
        className="flex items-center justify-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-5 text-center"
      >
        <BellOff className="h-4 w-4 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="text-xs text-[var(--nx-text-muted)]">当前没有组合提示</p>
      </section>
    )
  }

  return (
    <section
      data-pmo-alerts-card
      aria-label="组合提示与数据新鲜度"
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3.5"
    >
      <h2 className="flex items-center gap-2 text-xs font-medium text-[var(--nx-text-primary)]">
        <AlertTriangle className="h-4 w-4 text-[var(--nx-status-warning)]" aria-hidden />
        提示与数据新鲜度
        <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-text-muted)]">
          {warnings.length + staleSources.length}
        </span>
      </h2>

      {warnings.length > 0 ? (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {warnings.map((warning, index) => (
            <li
              key={`${warning.code}-${index}`}
              data-pmo-alert-item
              data-pmo-alert-code={warning.code}
              className="flex items-start gap-2 rounded-sm bg-[var(--nx-bg-0)] px-2.5 py-2"
            >
              <span
                className={
                  isWarningTone(warning.code)
                    ? 'text-[var(--nx-status-warning)]'
                    : 'text-[var(--nx-text-muted)]'
                }
              >
                {isWarningTone(warning.code) ? (
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : (
                  <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                {warning.message || warning.code}
              </span>
              <code className="shrink-0 rounded border border-[var(--nx-border-hairline)] px-1 py-px font-mono text-[9px] text-[var(--nx-text-muted)]">
                {warning.code}
              </code>
            </li>
          ))}
        </ul>
      ) : null}

      {freshness.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--nx-border-hairline)] pt-2.5">
          {freshness.map((item) => (
            <li
              key={item.source}
              data-pmo-freshness-item
              data-pmo-freshness-source={item.source}
              className="flex items-center gap-1.5 text-[10px] leading-none"
            >
              {item.isStale ? (
                <RefreshCw className="h-3 w-3 text-[var(--nx-status-warning)]" aria-hidden />
              ) : (
                <Clock className="h-3 w-3 text-[var(--nx-text-muted)]" aria-hidden />
              )}
              <span className="text-[var(--nx-text-secondary)]">{sourceLabel(item.source)}</span>
              {item.isStale ? (
                <span className="rounded border border-[var(--nx-status-warning)]/40 bg-[var(--nx-status-warning)]/10 px-1 py-px text-[9px] leading-none text-[var(--nx-status-warning)]">
                  已过期
                </span>
              ) : null}
              <span className="font-mono text-[var(--nx-text-muted)]">
                {item.lastUpdatedAt ? formatStamp(item.lastUpdatedAt) : '无更新记录'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** 告警是否需要警示黄调（其余中性信息调）。 */
function isWarningTone(code: string): boolean {
  return (
    code.startsWith('TRAFFIC_LIGHT_') ||
    code === 'METRIC_STALE' ||
    code === 'SOURCE_STALE' ||
    code === 'CACHE_DEGRADED'
  )
}

/** ISO 时间戳 → `YYYY-MM-DD HH:mm`（UTC 切割展示，确定性无时区换算）。 */
function formatStamp(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16)
}

const SOURCE_LABELS: Record<PortfolioDashboardSource, string> = {
  project_dashboard: '项目仪表盘',
  health_diagnosis: '健康诊断',
  prediction: '预测',
  risk_summary: '风险汇总',
  resource_summary: '资源汇总',
  traffic_light: '交通灯',
  computed: '计算派生',
}

function sourceLabel(source: PortfolioDashboardSource): string {
  return SOURCE_LABELS[source] ?? source
}

export default PmoPortfolioAlertsCard
