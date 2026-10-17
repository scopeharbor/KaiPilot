'use client'

import * as React from 'react'
import { AlertTriangle, ChevronRight, Clock, Inbox, PieChart, RefreshCw, X } from 'lucide-react'
import {
  useInvestmentDistributionCatalogue,
  useInvestmentDistributionDrillDown,
  useInvestmentDistributionSummary,
  useInvestmentDistributionTrends,
} from '@/hooks/use-pmo-investment-distribution'
import type {
  PmoInvestmentBucket,
  PmoInvestmentDistributionBasis,
  PmoInvestmentDistributionDimension,
  PmoInvestmentDistributionSummary,
  PmoInvestmentTrendWindow,
} from '@aiproj/types'
import {
  PMO_INVESTMENT_DEFAULT_TOP_N,
  PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS,
  PMO_INVESTMENT_NON_FINANCIAL_BASIS,
  PMO_INVESTMENT_TREND_WINDOW_VALUES,
} from '@aiproj/types'

/**
 * 投入分布只读区块（/next/pmo，v3-ui-next-pmo-domain W1 · tasks 1.4，
 * spec「PMO 组合仪表盘新轨主页与组织层信息架构 · 投入分布区块与域内导航」）。
 *
 * - 数据 100% 复用 `use-pmo-investment-distribution` 族（summary/catalogue/
 *   trends/drillDown，GET 只读端点），catalogue 驱动口径/维度选项，杜绝臆造
 *   后端不支持的维度（RL-14 零动态渲染：全部标签来自类型契约 + 既有语义）；
 * - summary 桶列表（双通道：占比文本 + 色带）与 trends 窗摘要只读呈现；桶行
 *   点击展开 drill-down 明细（GET，只读），redacted/受限桶诚实呈现「已脱敏/
 *   不可用」，绝不回填隐藏数量；
 * - 红线：区块内全部交互（口径切换/下钻/刷新）零写请求（RL-01）；财务口径
 *   不可用文案来自后端 warnings，不画 0 值图表（与旧页语义一致）；
 * - 三态：区块骨架（aria-busy）/ 空态 / 错误卡重试。
 */
export function PmoInvestmentDistributionSection() {
  const catalogueQuery = useInvestmentDistributionCatalogue()
  const catalogue = catalogueQuery.data

  const [basis, setBasis] = React.useState<PmoInvestmentDistributionBasis>(
    PMO_INVESTMENT_NON_FINANCIAL_BASIS.PROJECT_COUNT,
  )
  const [dimension, setDimension] = React.useState<PmoInvestmentDistributionDimension>(
    PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.PROJECT_TYPE,
  )
  const [trendWindow, setTrendWindow] = React.useState<PmoInvestmentTrendWindow>(
    PMO_INVESTMENT_TREND_WINDOW_VALUES[0]!,
  )
  const [drillBucket, setDrillBucket] = React.useState<PmoInvestmentBucket | null>(null)

  const basisOptions = React.useMemo(() => {
    if (!catalogue) return []
    return [...catalogue.nonFinancialBasis, ...catalogue.unsupportedFinancialBasis]
  }, [catalogue])
  const dimensionOptions = React.useMemo(() => catalogue?.dimensions ?? [], [catalogue])
  const catalogueReady = catalogue !== undefined

  // 既有 hooks 无 enabled 选项：以默认口径发起（服务端 normalizeQuery 与目录
  // 首项语义一致），catalogue 仅驱动骨架与选项，杜绝先渲染空控件。
  const summaryQuery = useInvestmentDistributionSummary({
    basis,
    dimension,
    topN: PMO_INVESTMENT_DEFAULT_TOP_N,
  })
  const trendsQuery = useInvestmentDistributionTrends({
    basis,
    dimension,
    topN: PMO_INVESTMENT_DEFAULT_TOP_N,
    trendWindow,
  })

  // 参数切换（口径/维度）时新 query key 无缓存：镜像最近一次成功载荷，避免
  // 整块区块回退骨架屏闪烁；仅首次加载才展示骨架。
  const [lastSummary, setLastSummary] = React.useState<PmoInvestmentDistributionSummary | null>(
    null,
  )
  const [lastTrends, setLastTrends] = React.useState<NonNullable<
    ReturnType<typeof useInvestmentDistributionTrends>['data']
  > | null>(null)
  React.useEffect(() => {
    if (summaryQuery.data) setLastSummary(summaryQuery.data)
  }, [summaryQuery.data])
  React.useEffect(() => {
    if (trendsQuery.data) setLastTrends(trendsQuery.data)
  }, [trendsQuery.data])

  const summary = summaryQuery.data ?? lastSummary
  const trends = trendsQuery.data ?? lastTrends
  const pending = summaryQuery.isLoading || summaryQuery.isPending
  const loading = !catalogueReady || (pending && summary === null)
  const sectionError = summaryQuery.error !== null && summary === null

  if (loading) {
    return <PmoInvestmentSkeleton />
  }

  if (sectionError) {
    return (
      <PmoInvestmentError
        onRetry={() => {
          void summaryQuery.refetch()
          void trendsQuery.refetch()
        }}
      />
    )
  }

  const warnings = summary?.warnings ?? []
  const buckets = summary?.buckets ?? []
  const meta = summary?.meta
  const isRedacted = warnings.some(
    (warning) =>
      warning.code === 'PERMISSION_REDACTED' || warning.code === 'LOW_CARDINALITY_REDACTED',
  )
  const financialUnsupported = warnings.some(
    (warning) =>
      warning.code === 'FINANCIAL_BASIS_UNSUPPORTED' ||
      warning.code === 'FINANCIAL_SOURCE_UNAVAILABLE',
  )
  const isStale = meta?.sourceFreshness.some((item) => item.isStale) ?? false
  const isEmpty = buckets.length === 0 && warnings.length === 0

  return (
    <section
      data-pmo-invest-section
      aria-label="投入分布"
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3.5"
    >
      {/* 标题 + 口径上下文 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xs font-medium text-[var(--nx-text-primary)]">
          <PieChart className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          投入分布
          {isStale ? (
            <span
              data-pmo-invest-stale
              className="flex items-center gap-1 rounded border border-[var(--nx-status-warning)]/40 bg-[var(--nx-status-warning)]/10 px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-status-warning)]"
            >
              <Clock className="h-3 w-3" aria-hidden />
              来源过期
            </span>
          ) : null}
        </h2>
        {meta ? (
          <p data-pmo-invest-meta className="text-[10px] text-[var(--nx-text-muted)]">
            {basisLabel(meta.basis)} · {dimensionLabel(meta.dimension)}
            {isRedacted || meta.visibleProjectCount === 0
              ? ''
              : ` · ${meta.visibleProjectCount} 个可见项目`}
          </p>
        ) : null}
      </div>

      {/* catalogue 驱动控件（只读重查，零写） */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--nx-text-muted)]">
          口径
          <select
            data-pmo-invest-basis
            aria-label="投入口径"
            value={basis}
            onChange={(event) => {
              setBasis(event.target.value as PmoInvestmentDistributionBasis)
              setDrillBucket(null)
            }}
            className="h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          >
            {basisOptions.map((option) => (
              <option key={option} value={option}>
                {basisLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--nx-text-muted)]">
          维度
          <select
            data-pmo-invest-dimension
            aria-label="分布维度"
            value={dimension}
            onChange={(event) => {
              setDimension(event.target.value as PmoInvestmentDistributionDimension)
              setDrillBucket(null)
            }}
            className="h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          >
            {dimensionOptions.map((option) => (
              <option key={option} value={option}>
                {dimensionLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--nx-text-muted)]">
          趋势窗
          <select
            data-pmo-invest-trend-window
            aria-label="趋势窗口"
            value={trendWindow}
            onChange={(event) => setTrendWindow(event.target.value as PmoInvestmentTrendWindow)}
            className="h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          >
            {PMO_INVESTMENT_TREND_WINDOW_VALUES.map((option) => (
              <option key={option} value={option}>
                {trendWindowLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto text-[10px] text-[var(--nx-text-muted)]">
          只读呈现 · 分布仅作投入代理口径
        </span>
      </div>

      {/* 告警条（财务不可用/脱敏等，双通道） */}
      {warnings.length > 0 ? (
        <ul className="mt-2.5 flex flex-wrap items-center gap-2">
          {warnings.map((warning, index) => (
            <li
              key={`${warning.code}-${index}`}
              data-pmo-invest-warning
              data-pmo-invest-warning-code={warning.code}
              className="flex items-center gap-1.5 rounded-sm border border-[var(--nx-status-warning)]/30 bg-[var(--nx-status-warning)]/10 px-2 py-1 text-[10px] leading-none text-[var(--nx-status-warning)]"
            >
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
              {warning.message || warning.code}
            </li>
          ))}
        </ul>
      ) : null}

      {/* 主体：空态 / 财务不可用 / 桶列表 + 趋势 + 下钻 */}
      {isEmpty ? (
        <PmoInvestmentEmpty />
      ) : financialUnsupported ? (
        <div
          data-pmo-invest-unsupported
          className="mt-3 rounded-sm border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-8 text-center"
        >
          <p className="text-xs text-[var(--nx-text-secondary)]">该财务口径当前不可用</p>
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
            财务、预算、成本、收益与 ROI 口径不在当前 PMO 投入分布范围内（铁律 4）。
          </p>
        </div>
      ) : (
        <>
          <PmoInvestmentBucketList
            buckets={buckets}
            drillBucketKey={drillBucket?.key ?? null}
            onDrillDown={(bucket) =>
              setDrillBucket(drillBucket?.key === bucket.key ? null : bucket)
            }
          />
          <PmoInvestmentDrillDownPanel
            drillBucket={drillBucket}
            basis={meta?.basis ?? basis}
            dimension={meta?.dimension ?? dimension}
            topN={PMO_INVESTMENT_DEFAULT_TOP_N}
            onClose={() => setDrillBucket(null)}
          />
          <PmoInvestmentTrendStrip
            trends={trends}
            error={trendsQuery.error !== null && trends === null ? trendsQuery.error : null}
            loading={(trendsQuery.isLoading || trendsQuery.isPending) && trends === null}
            onRetry={() => void trendsQuery.refetch()}
            basis={meta?.basis ?? basis}
          />
        </>
      )}
    </section>
  )
}

// ── 桶列表 ───────────────────────────────────────────────────────────────────

const BUCKET_COLORS = [
  'var(--nx-chart-1)',
  'var(--nx-chart-2)',
  'var(--nx-chart-3)',
  'var(--nx-chart-4)',
  'var(--nx-chart-5)',
  'var(--nx-chart-6)',
  'var(--nx-chart-7)',
  'var(--nx-chart-8)',
]

function PmoInvestmentBucketList({
  buckets,
  drillBucketKey,
  onDrillDown,
}: {
  buckets: PmoInvestmentBucket[]
  drillBucketKey: string | null
  onDrillDown: (bucket: PmoInvestmentBucket) => void
}) {
  return (
    <ul className="mt-3 flex flex-col gap-1.5" data-pmo-invest-buckets>
      {buckets.map((bucket, index) => {
        const redacted =
          bucket.status === 'redacted' ||
          bucket.status === 'forbidden' ||
          bucket.projectCount === null
        const isOpen = drillBucketKey === bucket.key
        return (
          <li key={bucket.key}>
            <button
              type="button"
              data-pmo-invest-bucket={bucket.key}
              aria-expanded={isOpen}
              onClick={() => onDrillDown(bucket)}
              className="group flex w-full items-center gap-2.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2 text-left transition-colors hover:border-[var(--nx-border-focus)]"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: BUCKET_COLORS[index % BUCKET_COLORS.length] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--nx-text-secondary)]">
                {bucket.label || bucket.key}
              </span>
              <span className="w-24 shrink-0">
                <span
                  className="block h-1.5 rounded-full"
                  style={{
                    width: `${Math.max(bucket.percent, bucket.percent > 0 ? 1 : 0)}%`,
                    backgroundColor: BUCKET_COLORS[index % BUCKET_COLORS.length],
                    opacity: redacted ? 0.35 : 1,
                  }}
                  aria-hidden
                />
              </span>
              <span className="shrink-0 font-mono text-[11px] text-[var(--nx-text-primary)]">
                {redacted ? '不可用' : `${bucket.percent}%`}
              </span>
              {redacted ? (
                <span
                  data-pmo-invest-redacted={bucket.key}
                  className="shrink-0 rounded border border-[var(--nx-border-hairline)] px-1 py-px text-[9px] leading-none text-[var(--nx-text-muted)]"
                >
                  已脱敏
                </span>
              ) : (
                <span className="shrink-0 text-[10px] text-[var(--nx-text-muted)]">
                  {bucket.projectCount} 个项目
                </span>
              )}
              <ChevronRight
                className={[
                  'h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)] transition-transform group-hover:text-[var(--nx-accent)]',
                  isOpen ? 'rotate-90' : '',
                ].join(' ')}
                aria-hidden
              />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ── 下钻明细（只读）─────────────────────────────────────────────────────────

function PmoInvestmentDrillDownPanel({
  drillBucket,
  basis,
  dimension,
  topN,
  onClose,
}: {
  drillBucket: PmoInvestmentBucket | null
  basis: PmoInvestmentDistributionBasis
  dimension: PmoInvestmentDistributionDimension
  topN: number
  onClose: () => void
}) {
  const drillQuery = useInvestmentDistributionDrillDown(
    drillBucket ? { bucketKey: drillBucket.key, basis, dimension, topN } : undefined,
  )
  if (!drillBucket) return null
  const items = drillQuery.data?.data ?? []
  const redacted = drillBucket.status === 'redacted' || drillBucket.status === 'forbidden'

  return (
    <div
      data-pmo-invest-drilldown
      className="mt-2 rounded-sm border border-[var(--nx-border-focus)]/40 bg-[var(--nx-space-surface)]/60 px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-[var(--nx-text-primary)]">
          <ChevronRight className="h-3.5 w-3.5 rotate-90 text-[var(--nx-accent)]" aria-hidden />
          {drillBucket.label || drillBucket.key} · 项目明细
          <span className="text-[9px] font-normal text-[var(--nx-text-muted)]">
            {redacted ? '已脱敏桶仅显示可见项目' : '只读明细，不提供任何写入动作'}
          </span>
        </p>
        <button
          type="button"
          data-pmo-invest-drilldown-close
          aria-label="收起项目明细"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-0)] hover:text-[var(--nx-text-primary)]"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {drillQuery.isLoading || drillQuery.isPending ? (
        <div className="mt-2 flex flex-col gap-1.5" role="status" aria-busy="true">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-7 animate-pulse rounded-sm bg-[var(--nx-bg-1)]"
              aria-hidden
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="mt-2 rounded-sm border border-dashed border-[var(--nx-border-hairline)] px-3 py-4 text-center text-[10px] text-[var(--nx-text-muted)]">
          没有可下钻的项目明细（该桶可能已脱敏，或当前用户没有项目明细权限）
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.projectId}
              data-pmo-invest-drilldown-item={item.projectId}
              className="flex items-center justify-between gap-3 rounded-sm bg-[var(--nx-bg-0)] px-2.5 py-1.5"
            >
              <span className="min-w-0 truncate text-[11px] text-[var(--nx-text-secondary)]">
                {item.projectName}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--nx-text-primary)]">
                {item.basisValue === null ? '不可用' : formatBasisValue(item.basisValue, basis)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── 趋势摘要条 ───────────────────────────────────────────────────────────────

function PmoInvestmentTrendStrip({
  trends,
  loading,
  error,
  onRetry,
  basis,
}: {
  trends: NonNullable<ReturnType<typeof useInvestmentDistributionTrends>['data']> | null
  loading: boolean
  error: unknown
  onRetry: () => void
  basis: PmoInvestmentDistributionBasis
}) {
  if (loading) {
    return (
      <div
        data-pmo-invest-trend-loading
        role="status"
        aria-busy="true"
        className="mt-2.5 h-8 animate-pulse rounded-sm bg-[var(--nx-bg-1)]"
      />
    )
  }
  if (error || !trends) {
    return (
      <div className="mt-2.5 flex items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] px-3 py-2">
        <AlertTriangle className="h-3.5 w-3.5 text-[var(--nx-status-warning)]" aria-hidden />
        <p className="text-[10px] text-[var(--nx-text-muted)]">投入分布趋势加载失败</p>
        <button
          type="button"
          data-pmo-invest-trend-retry
          onClick={onRetry}
          className="ml-auto flex items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2 py-1 text-[10px] text-[var(--nx-accent)]"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          重新载入
        </button>
      </div>
    )
  }
  const windows = trends.data ?? []
  if (windows.length === 0) {
    return (
      <p data-pmo-invest-trend-empty className="mt-2.5 text-[10px] text-[var(--nx-text-muted)]">
        暂无投入分布趋势数据
      </p>
    )
  }
  return (
    <div data-pmo-invest-trends className="mt-3 border-t border-[var(--nx-border-hairline)] pt-2.5">
      <p className="text-[10px] font-medium text-[var(--nx-text-secondary)]">投入分布趋势</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {windows.map((windowItem) => {
          const dominant = [...(windowItem.buckets ?? [])].sort(
            (left, right) => right.percent - left.percent,
          )[0]
          return (
            <li
              key={windowItem.label}
              data-pmo-invest-trend={windowItem.label}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-sm bg-[var(--nx-bg-0)] px-2.5 py-1.5"
            >
              <span className="text-[11px] text-[var(--nx-text-secondary)]">
                {windowItem.label}
              </span>
              <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                {windowItem.startDate} ~ {windowItem.endDate}
              </span>
              <span className="ml-auto font-mono text-[11px] text-[var(--nx-text-primary)]">
                总投入{' '}
                {windowItem.totalBasisValue === null
                  ? '—'
                  : formatBasisValue(windowItem.totalBasisValue, basis)}
              </span>
              {dominant ? (
                <span className="text-[10px] text-[var(--nx-text-muted)]">
                  主要分布：{dominant.label} {dominant.percent}%
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── 骨架 / 空态 / 错误 ───────────────────────────────────────────────────────

function PmoInvestmentSkeleton() {
  return (
    <div
      data-pmo-invest-skeleton
      role="status"
      aria-label="正在加载投入分布"
      aria-busy="true"
      className="flex flex-col gap-2.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3.5"
    >
      <div className="h-4 w-32 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
      <div className="h-7 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
      <div className="h-24 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
    </div>
  )
}

function PmoInvestmentEmpty() {
  return (
    <div
      data-pmo-invest-empty
      className="mt-3 flex flex-col items-center gap-1.5 rounded-sm border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-8 text-center"
    >
      <Inbox className="h-5 w-5 text-[var(--nx-text-muted)]" aria-hidden />
      <p className="text-xs text-[var(--nx-text-secondary)]">暂无可展示的投入分布</p>
      <p className="text-[10px] text-[var(--nx-text-muted)]">当前范围内没有可见项目的分布数据。</p>
    </div>
  )
}

function PmoInvestmentError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-pmo-invest-error
      role="alert"
      className="flex items-center gap-2.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--nx-status-warning)]" aria-hidden />
      <p className="text-xs text-[var(--nx-text-secondary)]">加载投入分布失败，请稍后重试。</p>
      <button
        type="button"
        data-pmo-invest-retry
        onClick={onRetry}
        className="ml-auto flex h-7 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
      >
        <RefreshCw className="h-3 w-3" aria-hidden />
        重新载入
      </button>
    </div>
  )
}

// ── 语义映射（确定性，纯函数）─────────────────────────────────────────────

/** 口径 → 中文标签（与旧页投入分布区块同源）。 */
const BASIS_LABELS: Record<PmoInvestmentDistributionBasis, string> = {
  project_count: '项目数',
  planned_effort_hours: '计划工时',
  estimated_effort_hours: '预估工时',
  resource_allocation_percent: '资源投入比',
  budget_amount: '预算金额',
  actual_cost: '实际成本',
  forecast_cost: '预测成本',
  budget_execution_rate: '预算执行率',
  roi: 'ROI',
  revenue: '收入',
  npv: 'NPV',
  irr: 'IRR',
}

function basisLabel(basis: PmoInvestmentDistributionBasis): string {
  return BASIS_LABELS[basis] ?? basis
}

/** 维度 → 中文标签（与旧页投入分布区块同源）。 */
const DIMENSION_LABELS: Record<PmoInvestmentDistributionDimension, string> = {
  project_type: '项目类型',
  lifecycle_phase: '生命周期阶段',
  priority: '优先级',
  status: '状态',
  manager: '负责人',
  department: '部门',
  strategic_theme: '战略主题',
  traffic_light_status: '交通灯状态',
}

function dimensionLabel(dimension: PmoInvestmentDistributionDimension): string {
  return DIMENSION_LABELS[dimension] ?? dimension
}

/** 趋势窗 → 中文标签。 */
const TREND_WINDOW_LABELS: Record<PmoInvestmentTrendWindow, string> = {
  last_30_days: '最近 30 天',
  last_90_days: '最近 90 天',
}

function trendWindowLabel(window: PmoInvestmentTrendWindow): string {
  return TREND_WINDOW_LABELS[window] ?? window
}

/** 按口径拼装数值单位（count 无单位、工时 h、占比 %）。 */
function formatBasisValue(value: number, basis: PmoInvestmentDistributionBasis): string {
  if (!Number.isFinite(value)) return '—'
  if (basis === 'project_count') return String(value)
  if (basis === 'resource_allocation_percent' || basis === 'budget_execution_rate') {
    return `${value}%`
  }
  if (basis === 'planned_effort_hours' || basis === 'estimated_effort_hours') {
    return `${value} h`
  }
  return String(value)
}

export default PmoInvestmentDistributionSection
