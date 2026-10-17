'use client'

import * as React from 'react'
import { AlertTriangle, EyeOff } from 'lucide-react'
import type {
  OrganizationResourcePoolLoadStatus,
  OrganizationResourcePoolMetric,
  OrganizationResourcePoolSummary,
  OrganizationResourcePoolWarning,
} from '@aiproj/types'
import {
  formatPoolHours,
  formatPoolPercent,
  getPoolLoadLabel,
  getPoolLoadTone,
  isPoolMetricRestricted,
  POOL_RESTRICTED_TEXT,
} from '@/lib/next/org-pool/org-pool-adapter'

/**
 * 组织资源池概览 KPI 卡（v3-ui-next-org-portfolio-domains W4 · tasks 4.3）。
 *
 * - 纯只读呈现 `OrganizationResourcePoolSummary` 指标：受限指标（metric.status
 *   forbidden/redacted/unavailable）渲染 EyeOff + 「不可见」中性卡，界面不出现
 *   任何猜测数值（RL-05）；授权指标按 unit（count/percent/hours）格式化；
 * - 负载分布条带：五种负载状态计数 + --nx-* 令牌色阶 + 文字标签双通道（RL-15）；
 * - 顶部警告（source stale / 脱敏等）以警示色 chip 呈现（只读）。
 */

const KPI_METRIC_KEYS: ReadonlyArray<{
  key: OrganizationResourcePoolMetric['key']
  label: string
}> = [
  { key: 'org_respool_total_resources', label: '资源总数' },
  { key: 'org_respool_total_capacity_hours', label: '总容量' },
  { key: 'org_respool_allocated_capacity_hours', label: '已分配' },
  { key: 'org_respool_remaining_capacity_hours', label: '剩余容量' },
  { key: 'org_respool_avg_utilization_percent', label: '平均利用率' },
  { key: 'org_respool_overloaded_resources', label: '过载人数' },
  { key: 'org_respool_conflict_count', label: '冲突' },
  { key: 'org_respool_demand_gap_count', label: '需求缺口' },
]

const LOAD_DISTRIBUTION_KEYS: OrganizationResourcePoolLoadStatus[] = [
  'idle',
  'normal',
  'high',
  'overloaded',
  'unavailable',
]

function formatMetricValue(metric: OrganizationResourcePoolMetric | undefined): string {
  if (!metric || metric.value === null || metric.value === undefined) return '—'
  if (metric.unit === 'hours') return formatPoolHours(metric.value)
  if (metric.unit === 'percent') return formatPoolPercent(metric.value)
  return String(metric.value)
}

export interface PoolSummaryCardsProps {
  summary: OrganizationResourcePoolSummary
}

export function PoolSummaryCards({ summary }: PoolSummaryCardsProps) {
  const metrics = summary.metrics
  const findMetric = (key: OrganizationResourcePoolMetric['key']) =>
    metrics.find((metric) => metric.key === key)

  return (
    <section data-pool-summary aria-label="组织资源池概览指标" className="space-y-3">
      {/* 警告 chips */}
      {summary.warnings.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {summary.warnings.map((warning, index) => (
            <PoolWarningChip key={`${warning.code}-${index}`} warning={warning} />
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {KPI_METRIC_KEYS.map(({ key, label }) => {
          const metric = findMetric(key)
          const restricted = metric ? isPoolMetricRestricted(metric) : false
          return (
            <div
              key={key}
              data-pool-metric={key}
              className="flex flex-col gap-1.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2.5"
            >
              <span className="text-[11px] text-[var(--nx-text-muted)]">{label}</span>
              {restricted ? (
                <span
                  data-restricted-metric
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--nx-text-muted)]"
                >
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                  {POOL_RESTRICTED_TEXT}
                </span>
              ) : (
                <span className="text-lg font-semibold tabular-nums text-[var(--nx-text-primary)]">
                  {formatMetricValue(metric)}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* 负载分布条带（色阶 + 文字双通道） */}
      <div
        data-pool-load-distribution
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2"
      >
        <span className="mr-1 text-[11px] text-[var(--nx-text-muted)]">负载分布</span>
        {LOAD_DISTRIBUTION_KEYS.map((status) => {
          const count = summary.loadDistribution[status] ?? 0
          const overloaded = status === 'overloaded' && count > 0
          return (
            <span
              key={status}
              data-pool-load-chip={status}
              className="inline-flex items-center gap-1.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-0.5 text-[11px]"
              style={
                overloaded
                  ? { color: 'var(--nx-status-danger)' }
                  : { color: `var(${getPoolLoadTone(status)})` }
              }
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: `var(${getPoolLoadTone(status)})` }}
              />
              {getPoolLoadLabel(status)} {count}
              {overloaded ? (
                <span
                  data-overload-text
                  className="rounded border border-[var(--nx-border-hairline)] px-1 text-[10px] font-semibold text-[var(--nx-status-danger)]"
                >
                  过载
                </span>
              ) : null}
            </span>
          )
        })}
      </div>
    </section>
  )
}

function PoolWarningChip({ warning }: { warning: OrganizationResourcePoolWarning }) {
  return (
    <span
      data-pool-warning={warning.code}
      title={warning.message}
      className="inline-flex items-center gap-1.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-0.5 text-[11px] text-[var(--nx-status-warning)]"
    >
      <AlertTriangle className="h-3 w-3" aria-hidden />
      {warning.message || warning.code}
    </span>
  )
}

export default PoolSummaryCards
