'use client'

import * as React from 'react'
import {
  AlertTriangle,
  BarChart3,
  EyeOff,
  Info,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import { useBiTrendAnalysis, type BiTrendAnalysisApiParams } from '@/hooks/use-bi-trend-analysis'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import type {
  BiTrendSeries,
  BiTrendMetricKey,
  BiTrendWindow,
  BiTrendGrain,
  BiTrendCompareMode,
  BiTrendDirection,
  BiTrendInsight,
} from '@aiproj/types'
import {
  BI_TREND_METRIC_KEYS,
  BI_TREND_WINDOWS,
  BI_TREND_GRAINS,
  BI_TREND_METRIC_UNITS,
  BI_TREND_INSIGHT_SEVERITY_META,
  biTrendGrainLabel,
  biTrendMetricLabel,
  biTrendWindowLabel,
  formatBiTrendValue,
  formatCompareText,
  latestNonNull,
} from '@/lib/next/org-bi/org-bi-adapter'
import { TrendLineCharts } from './TrendLineCharts'
import { TrendAnomalyList, trendAnomalyDirectionLabel } from './TrendAnomalyList'

/**
 * BI 趋势分析工作台（v3-ui-next-org-portfolio-domains W3 · tasks 3.9）。
 *
 * - 消费 `useBiTrendAnalysis`（GET /organizations/:organizationId/bi/trends）：
 *   指标多选 → 组织时序线图网格（echarts-core nx-dark）、异常点标注与解释抽屉；
 * - 纯只读：指标切换/窗口/粒度/对比/开关全部只触发 GET 重查，零写请求（RL-01）；
 * - 三态闭环：骨架 / 语义空态 / 错误重试；受限态中性呈现；精确档动画归零。
 */
export interface TrendsWorkspaceProps {
  organizationId: number
}

const DEFAULT_WINDOW: BiTrendWindow = 'last_12_weeks'
const DEFAULT_GRAIN: BiTrendGrain = 'week'
const DEFAULT_COMPARE: BiTrendCompareMode = 'previous_period'

const fieldClass =
  'h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]'
const labelClass = 'mb-1 block text-[10px] text-[var(--nx-text-muted)]'

export function TrendsWorkspace({ organizationId }: TrendsWorkspaceProps) {
  const tier = useImmersionTier()
  const animation = tier !== 'precise'

  const [metricKeys, setMetricKeys] = React.useState<BiTrendMetricKey[]>([...BI_TREND_METRIC_KEYS])
  const [window, setWindow] = React.useState<BiTrendWindow>(DEFAULT_WINDOW)
  const [grain, setGrain] = React.useState<BiTrendGrain>(DEFAULT_GRAIN)
  const [compareWith, setCompareWith] = React.useState<BiTrendCompareMode>(DEFAULT_COMPARE)
  const [includeAnomalies, setIncludeAnomalies] = React.useState(true)
  const [includeForecast, setIncludeForecast] = React.useState(false)
  const [selectedSeries, setSelectedSeries] = React.useState<BiTrendSeries | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  const params: BiTrendAnalysisApiParams = React.useMemo(
    () => ({
      organizationId,
      metricKeys: [...metricKeys],
      window,
      grain,
      compareWith,
      includeAnomalies,
      includeForecast,
      perPage: 20,
    }),
    [organizationId, metricKeys, window, grain, compareWith, includeAnomalies, includeForecast],
  )

  const {
    data,
    meta,
    warnings,
    isLoading,
    isError,
    error,
    isRestricted,
    isEmpty,
    isDegraded,
    refetch,
  } = useBiTrendAnalysis(params)

  const refresh = React.useCallback(() => {
    void refetch()
  }, [refetch])

  const toggleMetric = React.useCallback((metricKey: BiTrendMetricKey) => {
    setMetricKeys((current) => {
      const next = current.includes(metricKey)
        ? current.filter((key) => key !== metricKey)
        : [...current, metricKey]
      return next.length === 0 ? current : next
    })
  }, [])

  const openDrawer = React.useCallback((series: BiTrendSeries) => {
    setSelectedSeries(series)
    setDrawerOpen(true)
  }, [])

  return (
    <div
      data-bi-trend-workspace
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 data-bi-trend-title className="text-lg font-semibold text-[var(--nx-text-primary)]">
            BI 趋势分析
          </h2>
          <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
            组织指标时序、异常点与可解释洞察
            {meta?.calculatedAt ? ` · 更新于 ${new Date(meta.calculatedAt).toLocaleString()}` : ''}
          </p>
        </div>
        <button
          type="button"
          data-bi-trend-refresh
          aria-label="刷新趋势数据"
          onClick={refresh}
          disabled={isLoading}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} aria-hidden />
          刷新
        </button>
      </header>

      {/* 筛选区（只读重查） */}
      <div
        data-bi-trend-filter-bar
        className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
      >
        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>指标（多选）</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="趋势指标多选">
            {BI_TREND_METRIC_KEYS.map((key) => {
              const active = metricKeys.includes(key)
              const soleActive = active && metricKeys.length === 1
              return (
                <button
                  key={key}
                  type="button"
                  data-bi-trend-filter-metric={key}
                  aria-pressed={active}
                  disabled={soleActive}
                  onClick={() => toggleMetric(key)}
                  className={cn(
                    'h-7 rounded-sm border px-2.5 text-[11px] transition-colors disabled:opacity-50',
                    active
                      ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                      : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
                  )}
                >
                  {biTrendMetricLabel(key)}
                </button>
              )
            })}
          </div>
        </div>
        <label className="flex flex-col">
          <span className={labelClass}>时间窗口</span>
          <select
            data-bi-trend-filter-window
            value={window}
            onChange={(event) => setWindow(event.target.value as BiTrendWindow)}
            className={fieldClass}
            aria-label="时间窗口"
          >
            {BI_TREND_WINDOWS.map((key) => (
              <option key={key} value={key}>
                {biTrendWindowLabel(key)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={labelClass}>粒度</span>
          <select
            data-bi-trend-filter-grain
            value={grain}
            onChange={(event) => setGrain(event.target.value as BiTrendGrain)}
            className={fieldClass}
            aria-label="时间粒度"
          >
            {BI_TREND_GRAINS.map((key) => (
              <option key={key} value={key}>
                {biTrendGrainLabel(key)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={labelClass}>对比</span>
          <select
            data-bi-trend-filter-compare
            value={compareWith}
            onChange={(event) => setCompareWith(event.target.value as BiTrendCompareMode)}
            className={fieldClass}
            aria-label="对比模式"
          >
            <option value="previous_period">与上期对比</option>
            <option value="none">无对比</option>
          </select>
        </label>
        <label className="flex h-8 items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]">
          <input
            data-bi-trend-filter-anomalies
            type="checkbox"
            checked={includeAnomalies}
            onChange={(event) => setIncludeAnomalies(event.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--nx-accent)]"
          />
          异常点
        </label>
        <label className="flex h-8 items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]">
          <input
            data-bi-trend-filter-forecast
            type="checkbox"
            checked={includeForecast}
            onChange={(event) => setIncludeForecast(event.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--nx-accent)]"
          />
          外推
        </label>
      </div>

      {/* warning / 降级 */}
      {warnings.length > 0 && !isLoading ? (
        <div
          data-bi-trend-warnings
          role="note"
          className="rounded-md border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs text-[var(--nx-text-secondary)]"
        >
          {warnings.map((item) => item.message).join('；')}
        </div>
      ) : null}
      {isDegraded && !isLoading ? (
        <div
          data-bi-trend-degraded
          role="note"
          className="flex items-center gap-2 rounded-md border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs text-[var(--nx-text-secondary)]"
        >
          <AlertTriangle
            className="h-3.5 w-3.5 shrink-0 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          部分数据不完整——趋势方向与异常仅供参考，建议结合来源页面验证。
        </div>
      ) : null}

      {/* 加载骨架 */}
      {isLoading ? (
        <div data-bi-trend-skeleton role="status" aria-label="趋势数据加载中" aria-busy="true">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((card) => (
              <div
                key={card}
                className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
              >
                <div className="h-3 w-28 animate-pulse rounded bg-[var(--nx-bg-1)]" />
                <div className="mt-3 h-40 animate-pulse rounded bg-[var(--nx-bg-1)]" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 错误态 */}
      {isError ? (
        <div
          data-bi-trend-error
          role="alert"
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-xs text-[var(--nx-text-secondary)]">
            趋势数据加载失败：{error?.message ?? '未知错误'}
          </p>
          <button
            type="button"
            data-bi-trend-retry
            onClick={refresh}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新加载
          </button>
        </div>
      ) : null}

      {/* 受限态 */}
      {isRestricted && !isLoading ? (
        <div
          data-bi-trend-restricted
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <EyeOff className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs font-medium text-[var(--nx-text-primary)]">无权限查看该趋势数据</p>
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            当前角色对所选指标范围不可见，请联系组织管理员调整权限。
          </p>
        </div>
      ) : null}

      {/* 空态 */}
      {isEmpty && !isLoading ? (
        <div
          data-bi-trend-empty
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <BarChart3 className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs font-medium text-[var(--nx-text-primary)]">暂无趋势数据</p>
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            所选指标在当前时间窗口内无可用数据，请尝试调整窗口或指标选择。
          </p>
        </div>
      ) : null}

      {/* 序列卡片网格 */}
      {!isLoading && !isError && !isRestricted && !isEmpty && data.length > 0 ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.map((series) => (
              <TrendSeriesCard
                key={series.metricKey}
                series={series}
                showAnomalies={includeAnomalies}
                showForecast={includeForecast}
                animation={animation}
                onOpenDrawer={() => openDrawer(series)}
              />
            ))}
          </div>
          {includeAnomalies ? (
            <TrendAnomalyList seriesList={data} onSelectSeries={openDrawer} />
          ) : null}
        </>
      ) : null}

      <TrendExplanationDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        series={selectedSeries}
      />
    </div>
  )
}

/** 单指标趋势卡片（头部摘要 + 线图 + 点击解释入口）。 */
function TrendSeriesCard({
  series,
  showAnomalies,
  showForecast,
  animation,
  onOpenDrawer,
}: {
  series: BiTrendSeries
  showAnomalies: boolean
  showForecast: boolean
  animation: boolean
  onOpenDrawer: () => void
}) {
  const metricKey = series.metricKey
  const latest = latestNonNull(series.points)
  const hasAnomalies = (series.anomalies ?? []).length > 0
  const stale = series.freshness.state !== 'fresh'
  const hasForecast = !!series.forecast && !series.forecast.suppressed

  return (
    <article
      data-bi-trend-card
      data-bi-trend-card-metric={metricKey}
      className="flex cursor-pointer flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3 transition-colors hover:border-[var(--nx-border-focus)]"
      role="button"
      tabIndex={0}
      aria-label={`查看${biTrendMetricLabel(metricKey)}趋势解释`}
      onClick={onOpenDrawer}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpenDrawer()
        }
      }}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-medium text-[var(--nx-text-primary)]">
            {biTrendMetricLabel(metricKey)}
          </h3>
          {hasAnomalies ? (
            <span
              data-bi-trend-anomaly-badge
              className="inline-flex h-5 shrink-0 items-center rounded-sm border border-[rgba(239,68,68,0.45)] px-1.5 font-mono text-[10px] text-[var(--nx-status-danger)]"
            >
              {(series.anomalies ?? []).length} 异常
            </span>
          ) : null}
          {hasForecast && showForecast ? (
            <span className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[9px] text-[var(--nx-text-muted)]">
              含外推
            </span>
          ) : null}
        </div>
        <DirectionBadge direction={series.direction} />
      </header>

      <div className="flex items-baseline gap-2">
        {latest !== null ? (
          <span
            data-bi-trend-latest
            className="font-mono text-lg font-semibold text-[var(--nx-text-primary)]"
          >
            {formatBiTrendValue(metricKey, latest)}
          </span>
        ) : null}
        {series.comparison ? (
          <span data-bi-trend-compare className="font-mono text-[11px] text-[var(--nx-text-muted)]">
            {formatCompareText(series.comparison.deltaRatio, series.comparison.delta)}
          </span>
        ) : null}
        <span className="ml-auto text-[10px] text-[var(--nx-text-muted)]">
          样本 {series.sampleCount}
          {stale ? ' · 数据陈旧' : ''}
          {series.freshness.state === 'unknown' ? ' · 来源未知' : ''}
        </span>
      </div>

      <TrendLineCharts
        series={series}
        showAnomalies={showAnomalies}
        showForecast={showForecast}
        animation={animation}
        height={150}
      />

      <footer className="flex items-center justify-between text-[10px] text-[var(--nx-text-muted)]">
        <span>
          {unitLabel(metricKey)} · {biTrendGrainLabel(series.grain)}粒
          {hasAnomalies ? ' · 点击卡片查看解释' : ''}
        </span>
        <span className="flex items-center gap-1">
          <Info className="h-3 w-3" aria-hidden />
          解释
        </span>
      </footer>
    </article>
  )
}

function unitLabel(metricKey: BiTrendMetricKey): string {
  const unit = BI_TREND_METRIC_UNITS[metricKey]
  if (unit === 'percent') return '%'
  if (unit === 'hours') return 'h'
  return '评分'
}

function DirectionBadge({ direction }: { direction: BiTrendDirection }) {
  const icon =
    direction === 'up' ? (
      <TrendingUp className="h-3 w-3" aria-hidden />
    ) : direction === 'down' ? (
      <TrendingDown className="h-3 w-3" aria-hidden />
    ) : (
      <Minus className="h-3 w-3" aria-hidden />
    )
  const label =
    direction === 'up'
      ? '上升'
      : direction === 'down'
        ? '下降'
        : direction === 'flat'
          ? '持平'
          : '未知'
  return (
    <span
      data-bi-trend-direction
      data-bi-trend-direction-value={direction}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-2 font-mono text-[11px] text-[var(--nx-text-secondary)]"
    >
      {icon}
      {label}
    </span>
  )
}

/** 趋势解释抽屉（只读；AI 洞察带 advisoryOnly 免责声明，RL-01）。 */
function TrendExplanationDrawer({
  open,
  onClose,
  series,
}: {
  open: boolean
  onClose: () => void
  series: BiTrendSeries | null
}) {
  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const metricLabel = series ? biTrendMetricLabel(series.metricKey) : '趋势'
  const insights: BiTrendInsight[] = series?.insights ?? []
  const anomalies = series?.anomalies ?? []

  return (
    <div data-bi-trend-drawer className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-bi-trend-drawer-scrim
        aria-label="关闭趋势解释"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="趋势解释"
        data-bi-trend-drawer-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[var(--nx-text-primary)]">
              {metricLabel} · 解释
            </h3>
            <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--nx-text-muted)]">
              {series
                ? `${biTrendWindowLabel(series.window)} · ${biTrendGrainLabel(series.grain)}粒`
                : '—'}
            </p>
          </div>
          <button
            type="button"
            data-bi-trend-drawer-close
            aria-label="关闭趋势解释"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {series === null ? (
            <p className="text-xs text-[var(--nx-text-muted)]">请选择一个指标序列查看解释。</p>
          ) : (
            <>
              {/* 对比摘要 */}
              {series.comparison ? (
                <section
                  data-bi-trend-drawer-compare
                  className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
                >
                  <h4 className="mb-2 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                    与上期对比
                  </h4>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--nx-text-primary)]">
                        {formatBiTrendValue(series.metricKey, series.comparison.currentAverage)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">本期均值</p>
                    </div>
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--nx-text-primary)]">
                        {series.comparison.previousAverage !== null
                          ? formatBiTrendValue(series.metricKey, series.comparison.previousAverage)
                          : '—'}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">上期均值</p>
                    </div>
                    <div>
                      <p
                        data-bi-trend-drawer-delta
                        className={cn(
                          'font-mono text-sm font-semibold',
                          (series.comparison.delta ?? 0) > 0
                            ? 'text-[var(--nx-status-danger)]'
                            : (series.comparison.delta ?? 0) < 0
                              ? 'text-[var(--nx-status-success)]'
                              : 'text-[var(--nx-text-secondary)]',
                        )}
                      >
                        {formatCompareText(series.comparison.deltaRatio, series.comparison.delta)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">变化</p>
                    </div>
                  </div>
                </section>
              ) : null}

              {/* 可解释洞察（advisoryOnly 恒真：仅供建议不自动执行） */}
              {insights.length > 0 ? (
                <section>
                  <h4 className="mb-2 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                    洞察
                  </h4>
                  <div className="space-y-2">
                    {insights.map((insight, index) => {
                      const meta =
                        BI_TREND_INSIGHT_SEVERITY_META[insight.severity] ??
                        BI_TREND_INSIGHT_SEVERITY_META.info
                      return (
                        <article
                          key={index}
                          data-bi-trend-drawer-insight
                          data-bi-trend-insight-severity={insight.severity}
                          className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-flex h-5 items-center rounded-sm border px-1.5 text-[10px] font-medium"
                              style={{ color: meta.token, borderColor: meta.token }}
                            >
                              {meta.label}
                            </span>
                            <h5 className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--nx-text-primary)]">
                              {insight.title}
                            </h5>
                          </div>
                          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                            {insight.description}
                          </p>
                          {insight.advisoryOnly ? (
                            <p
                              data-bi-trend-advisory-note
                              className="mt-2 rounded-sm border border-dashed border-[var(--nx-border-hairline)] px-2 py-1 text-[10px] text-[var(--nx-text-muted)]"
                            >
                              仅供建议，不自动执行——采纳需人工确认
                            </p>
                          ) : null}
                        </article>
                      )
                    })}
                  </div>
                </section>
              ) : null}

              {/* 异常明细 */}
              {anomalies.length > 0 ? (
                <section>
                  <h4 className="mb-2 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                    异常点（{anomalies.length}）
                  </h4>
                  <ul className="space-y-1.5">
                    {anomalies.map((anomaly, index) => (
                      <li
                        key={index}
                        data-bi-trend-drawer-anomaly
                        className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2 text-[11px]"
                      >
                        <span className="flex items-center justify-between">
                          <span className="font-mono text-[var(--nx-text-secondary)]">
                            {anomaly.bucketStart.slice(0, 10)}
                          </span>
                          <span className="text-[var(--nx-text-primary)]">
                            {trendAnomalyDirectionLabel(anomaly.direction)}（z=
                            {anomaly.zScore.toFixed(2)}）
                          </span>
                        </span>
                        <span className="mt-1 block text-[var(--nx-text-muted)]">
                          实际 {formatBiTrendValue(series.metricKey, anomaly.value)} vs 期望{' '}
                          {formatBiTrendValue(series.metricKey, anomaly.expected)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* freshness */}
              <p className="text-[10px] text-[var(--nx-text-muted)]">
                数据新鲜度：
                {series.freshness.state === 'fresh'
                  ? '新鲜'
                  : series.freshness.state === 'stale'
                    ? '数据可能陈旧'
                    : '来源未知'}
                {series.warnings.length > 0
                  ? ` · ${series.warnings.map((item) => item.message).join('；')}`
                  : ''}
              </p>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

export default TrendsWorkspace
