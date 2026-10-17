'use client'

import { AlertTriangle, ChevronRight } from 'lucide-react'
import type { BiTrendSeries } from '@aiproj/types'
import { cn } from '@/lib/utils'
import {
  BI_ANOMALY_DIRECTION_LABELS,
  biTrendMetricLabel,
  classifyTrendAnomalySeverity,
  BI_ANOMALY_SEVERITY_META,
  formatBiMetricNumber,
  formatSignedDelta,
} from '@/lib/next/org-bi/org-bi-adapter'

/**
 * 趋势异常点列表（v3-ui-next-org-portfolio-domains W3 · tasks 3.9）。
 *
 * - 汇总全部选中序列的异常点，按 |zScore| 降序稳定排列；
 * - 每项以「方向（上/下箭头）＋ 严重度徽标（文案+色阶令牌）」双通道表达，
 *   行内回显实际值 vs 期望值与偏差；点击唤起该序列的解释抽屉；
 * - 纯只读（RL-01）。
 */
export interface TrendAnomalyListProps {
  seriesList: BiTrendSeries[]
  onSelectSeries: (series: BiTrendSeries) => void
}

export function TrendAnomalyList({ seriesList, onSelectSeries }: TrendAnomalyListProps) {
  const rows = seriesList
    .flatMap((series) => (series.anomalies ?? []).map((anomaly) => ({ series, anomaly })))
    .sort((a, b) => Math.abs(b.anomaly.zScore) - Math.abs(a.anomaly.zScore))

  if (rows.length === 0) return null

  return (
    <section
      data-bi-trend-anomaly-list
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-[var(--nx-text-secondary)]">
          <AlertTriangle
            className="mr-1 inline h-3.5 w-3.5 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          异常点
          <span className="ml-1 font-mono text-[10px] text-[var(--nx-text-muted)]">
            （{rows.length} 个）
          </span>
        </h3>
      </div>
      <ul className="divide-y divide-[var(--nx-border-hairline)]" aria-label="趋势异常点列表">
        {rows.map(({ series, anomaly }, index) => {
          const severity = classifyTrendAnomalySeverity(anomaly.zScore)
          const severityMeta = BI_ANOMALY_SEVERITY_META[severity]
          const metricKey = series.metricKey
          const above = anomaly.direction === 'above'
          return (
            <li key={`${metricKey}-${anomaly.bucketStart}-${index}`}>
              <button
                type="button"
                data-bi-trend-anomaly-item
                data-bi-trend-anomaly-metric={metricKey}
                onClick={() => onSelectSeries(series)}
                aria-label={`${biTrendMetricLabel(metricKey)} ${anomaly.bucketStart} 异常，zScore ${anomaly.zScore.toFixed(2)}`}
                className="flex w-full items-center gap-3 px-1 py-2 text-left transition-colors hover:bg-[var(--nx-bg-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
              >
                <span
                  data-bi-trend-anomaly-direction
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border font-mono text-[11px]',
                    above
                      ? 'border-[rgba(239,68,68,0.4)] text-[var(--nx-status-danger)]'
                      : 'border-[rgba(245,158,11,0.4)] text-[var(--nx-status-warning)]',
                  )}
                  aria-hidden
                >
                  {above ? '↑' : '↓'}
                </span>
                <span
                  data-bi-trend-anomaly-severity
                  className="inline-flex h-5 w-10 shrink-0 items-center justify-center rounded-[4px] border text-[10px] font-medium"
                  style={{
                    color: severityMeta.token,
                    borderColor: severityMeta.token,
                    backgroundColor: 'rgba(255,255,255,0.02)',
                  }}
                >
                  {severityMeta.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--nx-text-primary)]">
                  {biTrendMetricLabel(metricKey)}
                  <span className="ml-2 font-mono text-[10px] text-[var(--nx-text-muted)]">
                    {formatBucket(anomaly.bucketStart)}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-[var(--nx-text-secondary)]">
                  实际 {formatBiMetricNumber(anomaly.value, 1)} vs 期望{' '}
                  {formatBiMetricNumber(anomaly.expected, 1)}
                  <span
                    className={cn(
                      'ml-1.5',
                      anomaly.deviation > 0
                        ? 'text-[var(--nx-status-danger)]'
                        : 'text-[var(--nx-status-success)]',
                    )}
                  >
                    {formatSignedDelta(anomaly.deviation, 1)}
                  </span>
                  <span className="ml-1.5 text-[var(--nx-text-muted)]">
                    z={anomaly.zScore.toFixed(1)}
                  </span>
                </span>
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]"
                  aria-hidden
                />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function formatBucket(bucketStart: string): string {
  const raw = bucketStart.slice(0, 10)
  return raw.length === 10 ? raw : bucketStart
}

/** 异常方向 → 中文语义（供解释抽屉回显，双通道文字）。 */
export function trendAnomalyDirectionLabel(direction: 'above' | 'below'): string {
  return BI_ANOMALY_DIRECTION_LABELS[direction]
}

export default TrendAnomalyList
