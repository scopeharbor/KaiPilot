'use client'

import type { BiTrendSeries, BiTrendQueryShape } from '@aiproj/types'
import { Badge } from '@/components/ui/Badge'
import { AlertTriangle, Calendar, Hash, Info, Link as LinkIcon, TrendingUp, X } from 'lucide-react'
import { BiTrendChart } from './BiTrendChart'

export interface BiTrendExplanationDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  series: BiTrendSeries | null
  metricLabels: Record<string, string>
  queryShape?: BiTrendQueryShape
}

/**
 * BI 趋势解释抽屉（v3-bi-trend-analysis §4.6–§4.7）。
 *
 * 展示低敏 evidence、指标版本、计算时间、查询形状、advisory-only copy
 * 与安全下钻链接。不暴露隐藏计数、名称或原文。
 */
export function BiTrendExplanationDrawer({
  open,
  onOpenChange,
  series,
  metricLabels,
  queryShape,
}: BiTrendExplanationDrawerProps) {
  if (!open || !series) return null

  const label = metricLabels[series.metricKey] ?? series.metricKey

  const directionText: Record<string, string> = {
    up: '上升',
    down: '下降',
    flat: '持平',
    unknown: '未知',
  }

  const directionColor: Record<string, string> = {
    up: 'text-red-600',
    down: 'text-green-600',
    flat: 'text-gray-500',
    unknown: 'text-gray-400',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`${label} 趋势详情`}
    >
      {/* 遮罩 */}
      <div
        className="fixed inset-0 bg-black/30"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* 抽屉面板 */}
      <div className="relative z-50 h-full w-full max-w-lg overflow-y-auto bg-background shadow-xl">
        {/* 关闭按钮 */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-4 py-3">
          <h2 className="text-lg font-semibold">{label}</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1.5 transition-colors hover:bg-muted"
            aria-label="关闭详情"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* 趋势图 */}
          <div className="rounded-lg border bg-card p-3">
            <BiTrendChart series={series} height={200} showAnomalies={true} showForecast={true} />
          </div>

          {/* Advisory-only 声明 */}
          <div className="flex items-start gap-2 rounded-md bg-blue-50 p-3 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-400">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              趋势分析仅提供观察参考（advisory），不自动修改项目、OKR、资源或 PMO 事实。
              正式调整请到对应页面走人审流程。
            </span>
          </div>

          {/* 关键统计 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border p-3">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3" />
                趋势方向
              </div>
              <div className={`mt-1 text-lg font-bold ${directionColor[series.direction]}`}>
                {directionText[series.direction] ?? series.direction}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Hash className="h-3 w-3" />
                样本数
              </div>
              <div className="mt-1 text-lg font-bold">{series.sampleCount}</div>
            </div>
            {series.comparison && (
              <>
                <div className="rounded-md border p-3">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    上期均值
                  </div>
                  <div className="mt-1 text-lg font-bold">
                    {series.comparison.previousAverage?.toFixed(1) ?? '—'}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    当期均值
                  </div>
                  <div className="mt-1 text-lg font-bold">
                    {series.comparison.currentAverage.toFixed(1)}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 对比信息 */}
          {series.comparison && series.comparison.deltaRatio !== null && (
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">变化幅度</div>
              <div className="mt-1 font-mono text-sm">
                {(series.comparison.deltaRatio * 100).toFixed(1)}%
                {series.comparison.deltaRatio > 0 ? ' ↑' : ' ↓'}
              </div>
            </div>
          )}

          {/* 异常点详情 */}
          {(series.anomalies ?? []).length > 0 && (
            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                异常点详情
              </div>
              <ul className="space-y-2">
                {series.anomalies!.map((a, i) => (
                  <li key={i} className="rounded bg-muted/50 p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono">{a.bucketStart}</span>
                      <Badge variant="outline" className="text-[10px]">
                        z={a.zScore.toFixed(2)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      实际 {a.value.toFixed(1)} · 期望 {a.expected.toFixed(1)} · 偏差{' '}
                      {a.deviation > 0 ? '+' : ''}
                      {a.deviation.toFixed(1)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warning */}
          {series.warnings.length > 0 && (
            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                数据质量
              </div>
              <ul className="space-y-1">
                {series.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs">
                    <span className="mt-0.5 font-mono text-[10px] text-yellow-600">{w.code}</span>
                    <span className="text-muted-foreground">{w.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 元信息 */}
          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Info className="h-3.5 w-3.5" />
              元信息
            </div>
            <dl className="space-y-1 text-xs">
              {queryShape && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">查询形状</dt>
                    <dd className="font-mono">
                      {queryShape.metricKeys?.length ?? 0} 指标 · {queryShape.window} ·{' '}
                      {queryShape.grain}
                    </dd>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">指标版本</dt>
                <dd className="font-mono">{series.metricVersion}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">来源新鲜度</dt>
                <dd>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      series.freshness.state === 'stale' ? 'text-yellow-600' : 'text-green-600'
                    }`}
                  >
                    {series.freshness.state}
                  </Badge>
                </dd>
              </div>
            </dl>
          </div>

          {/* 安全下钻链接 */}
          {series.evidenceRefs.length > 0 && (
            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <LinkIcon className="h-3.5 w-3.5" />
                下钻
              </div>
              <ul className="space-y-1">
                {series.evidenceRefs.map((ref, i) => (
                  <li key={i} className="text-xs">
                    <span className="text-muted-foreground">
                      {ref.label} ({ref.kind} → {ref.targetKind})
                      {ref.redaction && (
                        <Badge variant="outline" className="ml-1 text-[10px] text-red-500">
                          受限
                        </Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
