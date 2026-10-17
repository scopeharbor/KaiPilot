'use client'

import type { BiTrendSeries } from '@aiproj/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { AlertTriangle, ArrowUp, ArrowDown, ChevronRight } from 'lucide-react'

export interface BiTrendAnomalyListProps {
  seriesList: BiTrendSeries[]
  metricLabels: Record<string, string>
  onSelectSeries: (series: BiTrendSeries) => void
}

/**
 * 异常点/洞察列表（v3-bi-trend-analysis §4.6）。
 *
 * 汇总所有选中指标的异常点，按 zScore 绝对值降序排列。
 * 每项可点击打开解释抽屉。
 */
export function BiTrendAnomalyList({
  seriesList,
  metricLabels,
  onSelectSeries,
}: BiTrendAnomalyListProps) {
  // 汇总所有异常点
  const allAnomalies = seriesList.flatMap((series) =>
    (series.anomalies ?? []).map((a) => ({
      ...a,
      metricKey: series.metricKey,
      metricLabel: metricLabels[series.metricKey] ?? series.metricKey,
    })),
  )

  if (allAnomalies.length === 0) return null

  // 按 zScore 绝对值降序
  const sorted = [...allAnomalies].sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          <AlertTriangle className="mr-1 inline h-4 w-4 text-yellow-500" />
          异常点
          <span className="ml-1 text-xs text-muted-foreground">({sorted.length} 个)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y" role="list" aria-label="异常点列表">
          {sorted.map((anomaly, i) => (
            <li
              key={`${anomaly.metricKey}-${anomaly.bucketStart}-${i}`}
              className="flex cursor-pointer items-center gap-3 py-2 text-sm transition-colors hover:bg-muted/50"
              role="button"
              tabIndex={0}
              aria-label={`${anomaly.metricLabel} ${anomaly.bucketStart} 异常，zScore ${anomaly.zScore.toFixed(2)}`}
              onClick={() => {
                const series = seriesList.find((s) => s.metricKey === anomaly.metricKey)
                if (series) onSelectSeries(series)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  const series = seriesList.find((s) => s.metricKey === anomaly.metricKey)
                  if (series) onSelectSeries(series)
                }
              }}
            >
              <div className="flex-shrink-0">
                {anomaly.direction === 'above' ? (
                  <ArrowUp className="h-4 w-4 text-red-500" />
                ) : (
                  <ArrowDown className="h-4 w-4 text-amber-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{anomaly.metricLabel}</span>
                  <Badge variant="outline" className="text-[10px]">
                    z={anomaly.zScore.toFixed(1)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {anomaly.bucketStart} · 实际 {anomaly.value.toFixed(1)} vs 期望{' '}
                  {anomaly.expected.toFixed(1)}
                  （偏差 {anomaly.deviation > 0 ? '+' : ''}
                  {anomaly.deviation.toFixed(1)}）
                </p>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
