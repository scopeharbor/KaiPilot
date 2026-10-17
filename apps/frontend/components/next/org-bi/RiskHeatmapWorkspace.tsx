'use client'

import * as React from 'react'
import { AlertTriangle, BarChart3, EyeOff, RefreshCw, X } from 'lucide-react'
import { useBiRiskHeatmap, type BiRiskHeatmapApiParams } from '@/hooks/use-bi-risk-heatmap'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import type {
  BiRiskHeatmapCell,
  BiRiskHeatmapMetricKey,
  BiRiskHeatmapWindow,
  BiRiskHeatmapDimensionKey,
  BiRiskHeatmapCompareMode,
} from '@aiproj/types'
import { isBiRiskHeatmapRedacted, isBiRiskHeatmapDimensionPairUnsafe } from '@aiproj/types'
import {
  BI_RISK_HEATMAP_METRIC_KEYS,
  BI_RISK_HEATMAP_WINDOWS,
  BI_RISK_HEATMAP_DIMENSIONS,
  BI_RISK_HEATMAP_COMPARE_MODES,
  biRiskHeatmapMetricLabel,
  biRiskHeatmapWindowLabel,
  biRiskHeatmapDimensionLabel,
  biRiskHeatmapCompareLabel,
  biHeatLevelMeta,
  formatBiMetricNumber,
  formatSignedDelta,
} from '@/lib/next/org-bi/org-bi-adapter'
import { RiskHeatmapGrid5x5 } from './RiskHeatmapGrid5x5'
import { RiskHeatmapTopList } from './RiskHeatmapTopList'

/**
 * BI 风险热力工作台（v3-ui-next-org-portfolio-domains W3 · tasks 3.6）。
 *
 * - 消费 `useBiRiskHeatmap`（GET /organizations/:organizationId/bi/risk-heatmap）：
 *   5×5 概率×影响 DOM 热力矩阵（--nx-* 色阶 + 中文等级双通道）、风险 Top 榜、
 *   单元摘要抽屉与筛选条（指标/时间窗口/行列维度/对比）；
 * - 纯只读工作台：筛选、翻页、抽屉全部零写请求（RL-01）；脱敏单元中性「不可见」；
 * - 三态闭环：几何匹配骨架（aria-busy）、语义空态、错误重试；受限态与 5xx 区分；
 * - 精确档降级：precise 下剥离开放光晕，纯色仪器面板。
 */
export interface RiskHeatmapWorkspaceProps {
  organizationId: number
}

const DEFAULT_METRIC: BiRiskHeatmapMetricKey = 'risk_exposure_score'
const DEFAULT_WINDOW: BiRiskHeatmapWindow = 'last_90_days'
const DEFAULT_ROW_DIMENSION: BiRiskHeatmapDimensionKey = 'project'
const DEFAULT_COLUMN_DIMENSION: BiRiskHeatmapDimensionKey = 'risk_level'
const DEFAULT_COMPARE: BiRiskHeatmapCompareMode = 'previous_period'
const PER_PAGE = 50

const fieldClass =
  'h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]'
const labelClass = 'mb-1 block text-[10px] text-[var(--nx-text-muted)]'

export function RiskHeatmapWorkspace({ organizationId }: RiskHeatmapWorkspaceProps) {
  const tier = useImmersionTier()
  const [metricKey, setMetricKey] = React.useState<BiRiskHeatmapMetricKey>(DEFAULT_METRIC)
  const [window, setWindow] = React.useState<BiRiskHeatmapWindow>(DEFAULT_WINDOW)
  const [rowDimension, setRowDimension] =
    React.useState<BiRiskHeatmapDimensionKey>(DEFAULT_ROW_DIMENSION)
  const [columnDimension, setColumnDimension] =
    React.useState<BiRiskHeatmapDimensionKey>(DEFAULT_COLUMN_DIMENSION)
  const [compareWith, setCompareWith] = React.useState<BiRiskHeatmapCompareMode>(DEFAULT_COMPARE)
  const [page, setPage] = React.useState(1)
  const [selectedCell, setSelectedCell] = React.useState<BiRiskHeatmapCell | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  const params: BiRiskHeatmapApiParams = React.useMemo(
    () => ({
      organizationId,
      metricKey,
      window,
      rowDimension,
      columnDimension,
      compareWith,
      page,
      perPage: PER_PAGE,
    }),
    [organizationId, metricKey, window, rowDimension, columnDimension, compareWith, page],
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
  } = useBiRiskHeatmap(params)

  // 行列维度撞车：自动把后改的列维度拉回默认（保持查询形状合法，避免后端拒绝）。
  const handleColumnChange = React.useCallback(
    (next: BiRiskHeatmapDimensionKey) => {
      if (isBiRiskHeatmapDimensionPairUnsafe(rowDimension, next)) {
        setColumnDimension(DEFAULT_COLUMN_DIMENSION)
        return
      }
      setColumnDimension(next)
    },
    [rowDimension],
  )
  const handleRowChange = React.useCallback(
    (next: BiRiskHeatmapDimensionKey) => {
      if (isBiRiskHeatmapDimensionPairUnsafe(next, columnDimension)) {
        setRowDimension(DEFAULT_ROW_DIMENSION)
        return
      }
      setRowDimension(next)
    },
    [columnDimension],
  )

  const refresh = React.useCallback(() => {
    void refetch()
  }, [refetch])

  const totalPages = meta?.totalPages ?? 1

  return (
    <div
      data-bi-heat-workspace
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
          <h2 data-bi-heat-title className="text-lg font-semibold text-[var(--nx-text-primary)]">
            BI 风险热力图
          </h2>
          <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
            组织风险热力矩阵 · 集中度与 Top 风险扫描
            {meta?.calculatedAt ? ` · 更新于 ${new Date(meta.calculatedAt).toLocaleString()}` : ''}
          </p>
        </div>
        <button
          type="button"
          data-bi-heat-refresh
          aria-label="刷新热力图数据"
          onClick={refresh}
          disabled={isLoading}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} aria-hidden />
          刷新
        </button>
      </header>

      {/* 筛选条（只读重查，零写） */}
      <div
        data-bi-heat-filter-bar
        className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
      >
        <label className="flex flex-col">
          <span className={labelClass}>指标</span>
          <select
            data-bi-heat-filter-metric
            value={metricKey}
            onChange={(event) => setMetricKey(event.target.value as BiRiskHeatmapMetricKey)}
            className={fieldClass}
            aria-label="热力指标"
          >
            {BI_RISK_HEATMAP_METRIC_KEYS.map((key) => (
              <option key={key} value={key}>
                {biRiskHeatmapMetricLabel(key)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={labelClass}>时间窗口</span>
          <select
            data-bi-heat-filter-window
            value={window}
            onChange={(event) => setWindow(event.target.value as BiRiskHeatmapWindow)}
            className={fieldClass}
            aria-label="时间窗口"
          >
            {BI_RISK_HEATMAP_WINDOWS.map((key) => (
              <option key={key} value={key}>
                {biRiskHeatmapWindowLabel(key)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={labelClass}>行维度</span>
          <select
            data-bi-heat-filter-row
            value={rowDimension}
            onChange={(event) => handleRowChange(event.target.value as BiRiskHeatmapDimensionKey)}
            className={fieldClass}
            aria-label="行维度"
          >
            {BI_RISK_HEATMAP_DIMENSIONS.map((key) => (
              <option key={key} value={key}>
                {biRiskHeatmapDimensionLabel(key)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={labelClass}>列维度</span>
          <select
            data-bi-heat-filter-column
            value={columnDimension}
            onChange={(event) =>
              handleColumnChange(event.target.value as BiRiskHeatmapDimensionKey)
            }
            className={fieldClass}
            aria-label="列维度"
          >
            {BI_RISK_HEATMAP_DIMENSIONS.map((key) => (
              <option key={key} value={key}>
                {biRiskHeatmapDimensionLabel(key)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={labelClass}>对比</span>
          <select
            data-bi-heat-filter-compare
            value={compareWith}
            onChange={(event) => setCompareWith(event.target.value as BiRiskHeatmapCompareMode)}
            className={fieldClass}
            aria-label="对比模式"
          >
            {BI_RISK_HEATMAP_COMPARE_MODES.map((key) => (
              <option key={key} value={key}>
                {biRiskHeatmapCompareLabel(key)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 全局 warning 与降级提示 */}
      {warnings.length > 0 && !isLoading ? (
        <div
          data-bi-heat-warnings
          role="note"
          className="rounded-md border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs text-[var(--nx-text-secondary)]"
        >
          {warnings.map((item) => item.message).join('；')}
        </div>
      ) : null}
      {isDegraded && !isLoading ? (
        <div
          data-bi-heat-degraded
          role="note"
          className="flex items-center gap-2 rounded-md border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs text-[var(--nx-text-secondary)]"
        >
          <AlertTriangle
            className="h-3.5 w-3.5 shrink-0 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          部分数据不完整——热力分值仅供参考，建议结合来源页面验证。
        </div>
      ) : null}

      {/* 加载骨架 */}
      {isLoading ? (
        <div data-bi-heat-skeleton role="status" aria-label="风险热力图加载中" aria-busy="true">
          <div className="flex items-center gap-2">
            <div className="h-3 w-40 animate-pulse rounded bg-[var(--nx-bg-1)]" />
            <div className="h-3 w-24 animate-pulse rounded bg-[var(--nx-bg-1)]" />
          </div>
          <div className="mt-3 space-y-1.5">
            {[1, 2, 3, 4].map((row) => (
              <div key={row} className="flex gap-1.5">
                <div className="h-14 w-28 animate-pulse rounded bg-[var(--nx-bg-1)]" />
                {[1, 2, 3, 4, 5].map((col) => (
                  <div
                    key={col}
                    className="h-14 flex-1 animate-pulse rounded bg-[var(--nx-bg-1)]"
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 错误（5xx/网络可重试） */}
      {isError ? (
        <div
          data-bi-heat-error
          role="alert"
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-xs text-[var(--nx-text-secondary)]">
            热力图数据加载失败：{error?.message ?? '未知错误'}
          </p>
          <button
            type="button"
            data-bi-heat-retry
            onClick={refresh}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新加载
          </button>
        </div>
      ) : null}

      {/* 受限态（中性，不猜测数值） */}
      {isRestricted && !isLoading ? (
        <div
          data-bi-heat-restricted
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <EyeOff className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs font-medium text-[var(--nx-text-primary)]">无权限查看该热力数据</p>
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            当前角色对所选范围不可见，请联系组织管理员调整权限。
          </p>
        </div>
      ) : null}

      {/* 语义空态 */}
      {isEmpty && !isLoading ? (
        <div
          data-bi-heat-empty
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <BarChart3 className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs font-medium text-[var(--nx-text-primary)]">暂无热力图数据</p>
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            所选指标在当前时间窗口内无可用数据，请调整时间窗口或指标选择。
          </p>
        </div>
      ) : null}

      {/* 内容区 */}
      {!isLoading && !isError && !isRestricted && !isEmpty && data.length > 0 ? (
        <>
          <RiskHeatmapGrid5x5
            cells={data}
            metricKey={metricKey}
            rowDimension={rowDimension}
            columnDimension={columnDimension}
            onCellClick={(cell) => {
              setSelectedCell(cell)
              setDrawerOpen(true)
            }}
          />
          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-[11px] text-[var(--nx-text-muted)]">
              <span>
                共 {meta?.total ?? 0} 个热力单元 · 第 {page}/{totalPages} 页
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-bi-heat-prev-page
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  className="h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  type="button"
                  data-bi-heat-next-page
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  className="h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          ) : null}
          <RiskHeatmapTopList
            cells={data}
            onSelectCell={(cell) => {
              setSelectedCell(cell)
              setDrawerOpen(true)
            }}
          />
        </>
      ) : null}

      <RiskHeatmapCellDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        cell={selectedCell}
        metricKey={metricKey}
      />
    </div>
  )
}

/** 热力单元摘要抽屉（只读；脱敏单元零数值呈现）。 */
function RiskHeatmapCellDrawer({
  open,
  onClose,
  cell,
  metricKey,
}: {
  open: boolean
  onClose: () => void
  cell: BiRiskHeatmapCell | null
  metricKey: BiRiskHeatmapMetricKey
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

  const redacted = cell !== null && isBiRiskHeatmapRedacted(cell.redactionState)
  const meta = cell ? biHeatLevelMeta(cell.riskLevel) : null
  const title = cell ? `${cell.rowLabel} × ${cell.columnLabel}` : '风险单元详情'

  return (
    <div data-bi-heat-drawer className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-bi-heat-drawer-scrim
        aria-label="关闭风险单元详情"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="风险单元详情"
        data-bi-heat-drawer-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[var(--nx-text-primary)]">
              {title}
            </h3>
            <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--nx-text-muted)]">
              {biRiskHeatmapMetricLabel(metricKey)} · 热力单元摘要
            </p>
          </div>
          <button
            type="button"
            data-bi-heat-drawer-close
            aria-label="关闭风险单元详情"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {cell === null ? (
            <p className="text-xs text-[var(--nx-text-muted)]">请选择一个热力单元查看详情。</p>
          ) : redacted ? (
            <div
              data-bi-heat-drawer-redacted
              className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] px-4 py-8 text-center"
            >
              <EyeOff className="h-5 w-5 text-[var(--nx-text-muted)]" aria-hidden />
              <p className="text-xs font-medium text-[var(--nx-text-primary)]">该单元数据不可见</p>
              <p className="text-[11px] text-[var(--nx-text-muted)]">
                当前角色无权限查看此范围明细，不显示任何猜测数值。
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span
                  data-bi-heat-drawer-level
                  className="inline-flex h-7 items-center rounded-[4px] border px-2.5 text-xs font-medium"
                  style={{
                    color: meta?.token,
                    backgroundColor: meta?.bg,
                    borderColor: meta?.border,
                  }}
                >
                  {meta?.label}
                </span>
                <span className="font-mono text-sm text-[var(--nx-text-primary)]">
                  {formatBiMetricNumber(cell.score, 4)}
                </span>
                <span className="text-[10px] text-[var(--nx-text-muted)]">风险分值</span>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-md bg-[var(--nx-bg-0)] p-3 text-center">
                <div>
                  <p className="font-mono text-lg font-semibold text-[var(--nx-text-primary)]">
                    {formatBiMetricNumber(cell.count, 0)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">风险数量</p>
                </div>
                <div>
                  <p className="font-mono text-lg font-semibold text-[var(--nx-text-primary)]">
                    {formatBiMetricNumber(cell.sampleCount, 0)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">样本数</p>
                </div>
                <div>
                  <p className="font-mono text-lg font-semibold text-[var(--nx-text-primary)]">
                    {Math.round(cell.confidence * 100)}%
                  </p>
                  <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">置信度</p>
                </div>
              </div>

              {cell.delta !== null ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[var(--nx-text-muted)]">对比变化</span>
                  <span
                    className={cn(
                      'font-mono font-medium',
                      cell.delta > 0
                        ? 'text-[var(--nx-status-danger)]'
                        : cell.delta < 0
                          ? 'text-[var(--nx-status-success)]'
                          : 'text-[var(--nx-text-secondary)]',
                    )}
                  >
                    {formatSignedDelta(cell.delta, 4)}
                  </span>
                </div>
              ) : null}

              {cell.contributors.length > 0 ? (
                <section>
                  <h4 className="mb-2 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                    主要贡献单元
                  </h4>
                  <ol className="space-y-1">
                    {cell.contributors.map((contributor) => (
                      <li
                        key={`${contributor.kind}:${contributor.id}`}
                        className="flex items-center justify-between rounded-sm bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate text-[var(--nx-text-primary)]">
                          {contributor.label}
                        </span>
                        <span className="ml-3 font-mono text-[11px] text-[var(--nx-text-muted)]">
                          {Math.round(contributor.contributionWeight * 100)}%
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              {cell.evidenceRefs.length > 0 ? (
                <section>
                  <h4 className="mb-2 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                    证据来源
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {cell.evidenceRefs.map((evidence) => (
                      <span
                        key={`${evidence.kind}:${evidence.label}`}
                        className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
                      >
                        {evidence.label}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {cell.warnings.length > 0 ? (
                <section>
                  <h4 className="mb-2 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                    数据提示
                  </h4>
                  <ul className="space-y-1 text-[11px] text-[var(--nx-status-warning)]">
                    {cell.warnings.map((item, index) => (
                      <li key={index} className="flex items-start gap-1.5">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                        {item.message}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {cell.drilldownTargets.length > 0 ? (
                <section>
                  <h4 className="mb-2 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                    下钻目标
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {cell.drilldownTargets.map((target) => (
                      <span
                        key={`${target.kind}:${target.label}`}
                        data-bi-heat-drawer-drilldown
                        className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)]"
                      >
                        {target.label}
                        <span
                          className={cn(
                            'rounded-sm px-1 font-mono text-[9px]',
                            target.requiresPermission
                              ? 'text-[var(--nx-text-muted)]'
                              : 'text-[var(--nx-status-success)]',
                          )}
                        >
                          {target.requiresPermission ? '需权限' : '可直达'}
                        </span>
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

export default RiskHeatmapWorkspace
