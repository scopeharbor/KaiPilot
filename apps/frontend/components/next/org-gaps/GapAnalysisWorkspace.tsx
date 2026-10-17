'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowRight, EyeOff, TrendingDown } from 'lucide-react'
import {
  useResourceGapByPortfolio,
  useResourceGapByProject,
  useResourceGapByRole,
  useResourceGapBySkill,
  useResourceGapByTimebucket,
  useResourceGapSummary,
} from '@/hooks/use-resource-gap-analysis'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import {
  type ResourceGapDimension,
  type ResourceGapEnvelope,
  type ResourceGapEntry,
  type ResourceGapMetric,
  type ResourceGapSeverity,
} from '@aiproj/types'
import {
  GAP_DIMENSION_TABS,
  GAP_METRIC_LABELS,
  GAP_SEVERITY_LABELS,
  GAP_TOP_N_OPTIONS,
  gapUrlStateToQuery,
  getGapSeverityHex,
  getGapSeverityLabel,
  getGapSeverityTone,
  parseGapUrlState,
  serializeGapUrlState,
  type GapUrlState,
} from '@/lib/next/org-gaps/org-gaps-adapter'
import { GapDimensionCharts } from './GapDimensionCharts'

/**
 * 资源缺口分析工作台（v3-ui-next-org-portfolio-domains W4 · tasks 4.7，
 * spec「组织资源池与资源缺口分析」）。
 *
 * - 五维切换（角色/技能/时段/项目/组合）+ 口径/严重度/粒度/topN 筛选，URL query
 *   为唯一事实来源（restorable）：全部写回 URL，刷新与分享不丢状态；
 * - 维度与摘要数据消费既有 use-resource-gap-analysis hooks（envelope 契约）；
 * - 点击条目卡进行缺口下钻（reasons 原因解读就地呈现），只读（RL-01）；
 * - 图：ECharts 收敛底座（nx-dark），柱色按严重度双通道；精确档动画归零。
 */

export interface GapDimensionQueryLike {
  data?: ResourceGapEnvelope<ResourceGapEntry[]>
  isLoading: boolean
  isError: boolean
  refetch: () => Promise<unknown>
}

/** 工作台五维 Tab 键（organization 维不在本页切换范围）。 */
type GapDimensionKey = (typeof GAP_DIMENSION_TABS)[number]['key']

const GRANULARITY_LABELS: Readonly<Record<string, string>> = {
  day: '按天',
  iso_week: '按周',
  month: '按月',
}

export function GapAnalysisWorkspace() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tier = useImmersionTier()
  const [selectedGapId, setSelectedGapId] = React.useState<string | null>(null)

  const urlState = React.useMemo(() => parseGapUrlState(searchParams), [searchParams])
  const query = React.useMemo(() => gapUrlStateToQuery(urlState), [urlState])

  const summaryQuery = useResourceGapSummary(query)
  const byRole = useResourceGapByRole(query)
  const bySkill = useResourceGapBySkill(query)
  const byTimebucket = useResourceGapByTimebucket(query)
  const byProject = useResourceGapByProject(query)
  const byPortfolio = useResourceGapByPortfolio(query)

  const dimensionQueries: Record<GapDimensionKey, GapDimensionQueryLike> = {
    role: byRole,
    skill: bySkill,
    timeBucket: byTimebucket,
    project: byProject,
    portfolio: byPortfolio,
  }

  const activeQuery = dimensionQueries[urlState.dimension as GapDimensionKey]
  const entries = activeQuery.data?.data ?? []

  const updateUrl = React.useCallback(
    (patch: Partial<GapUrlState>) => {
      const next: GapUrlState = { ...urlState, ...patch }
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(serializeGapUrlState(next))) {
        params.set(key, value)
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, urlState],
  )

  const handleDimensionChange = (dimension: ResourceGapDimension) => {
    setSelectedGapId(null)
    updateUrl({ dimension })
  }

  const summary = summaryQuery.data

  // ── 主态机 ────────────────────────────────────────────────────────────────

  if (summaryQuery.isLoading || summaryQuery.isFetching) {
    return (
      <GapPageShell>
        <div
          data-gap-workspace-skeleton
          aria-busy
          className="space-y-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4"
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded bg-[var(--nx-bg-0)]" />
            ))}
          </div>
          <div className="h-72 animate-pulse rounded bg-[var(--nx-bg-0)]" />
        </div>
      </GapPageShell>
    )
  }

  if (summaryQuery.isError || !summary) {
    return (
      <GapPageShell>
        <div
          data-gap-error
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-12 text-center"
        >
          <AlertCircle className="h-6 w-6 text-[var(--nx-status-danger)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-primary)]">加载资源缺口分析失败</p>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            若问题持续，请联系组织管理员确认资源查看权限
          </p>
          <button
            type="button"
            data-gap-retry
            onClick={() => void summaryQuery.refetch()}
            className="flex h-8 items-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            重试
          </button>
        </div>
      </GapPageShell>
    )
  }

  if (summary.totalGaps === 0) {
    return (
      <GapPageShell>
        <div
          data-gap-empty
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-14 text-center"
        >
          <TrendingDown className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm font-medium text-[var(--nx-text-primary)]">暂无缺口数据</p>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            当前组织在所选时间窗口内未检测到资源缺口
          </p>
        </div>
      </GapPageShell>
    )
  }

  const selectedEntry = entries.find((entry) => entry.gapId === selectedGapId) ?? null

  return (
    <GapPageShell>
      <div
        data-gap-workspace
        className={cn(
          'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
          tier === 'precise'
            ? 'bg-[var(--nx-workspace-bg)]'
            : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
        )}
      >
        {/* 摘要统计（只读） */}
        <div data-gap-stats className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <GapStatCard label="总缺口数" text={String(summary.totalGaps)} />
          <GapStatCard
            label="严重缺口"
            text={String(summary.severityDistribution.critical ?? 0)}
            tone="--nx-status-danger"
          />
          <GapStatCard label="总需求 (h)" text={String(Math.round(summary.totalDemandHours))} />
          <GapStatCard
            label="总缺口 (h)"
            text={String(Math.round(summary.totalGapHours))}
            tone="--nx-status-warning"
          />
        </div>

        {/* 维度切换 + 筛选条（写回 URL，restorable） */}
        <div className="space-y-2">
          <div
            role="tablist"
            aria-label="缺口分析维度"
            data-gap-dimension-tabs
            className="flex w-fit flex-wrap items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1"
          >
            {GAP_DIMENSION_TABS.map((tab) => {
              const active = urlState.dimension === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-gap-dimension-tab={tab.key}
                  onClick={() => handleDimensionChange(tab.key)}
                  className={cn(
                    'flex h-8 items-center rounded px-3 text-xs transition-colors',
                    active
                      ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                      : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                  )}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div
            data-gap-filters
            className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2"
          >
            <GapSelect
              label="口径"
              dataAttr="data-gap-filter-metric"
              value={urlState.metric ?? ''}
              options={[
                { value: '', label: '全部口径' },
                ...Object.entries(GAP_METRIC_LABELS).map(([value, label]) => ({ value, label })),
              ]}
              onChange={(value) =>
                updateUrl({
                  metric: (value as ResourceGapMetric) || null,
                })
              }
            />
            <GapSelect
              label="严重度"
              dataAttr="data-gap-filter-severity"
              value={urlState.severity ?? ''}
              options={[
                { value: '', label: '全部严重度' },
                ...Object.entries(GAP_SEVERITY_LABELS).map(([value, label]) => ({ value, label })),
              ]}
              onChange={(value) =>
                updateUrl({
                  severity: (value as ResourceGapSeverity) || null,
                })
              }
            />
            <GapSelect
              label="时间粒度"
              dataAttr="data-gap-filter-granularity"
              value={urlState.granularity}
              options={Object.entries(GRANULARITY_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              onChange={(value) => updateUrl({ granularity: value as GapUrlState['granularity'] })}
            />
            <GapSelect
              label="显示数量"
              dataAttr="data-gap-filter-topn"
              value={String(urlState.topN)}
              options={GAP_TOP_N_OPTIONS.map((option) => ({
                value: String(option.value),
                label: option.label,
              }))}
              onChange={(value) => updateUrl({ topN: Number(value) })}
            />
          </div>
        </div>

        {/* 当前维度图表（ECharts 收敛底座，只读） */}
        <GapDimensionCharts
          dimension={urlState.dimension}
          entries={entries}
          isLoading={activeQuery.isLoading}
          isError={activeQuery.isError}
          onRetry={() => void activeQuery.refetch()}
          animation={tier !== 'precise'}
        />

        {/* 条目明细（下钻：点击卡片就地解读 reasons） */}
        {entries.length > 0 ? (
          <div data-gap-entries className="space-y-2.5">
            {selectedEntry ? <GapEntryDetail entry={selectedEntry} /> : null}
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {entries.map((entry) => (
                <GapEntryCard
                  key={entry.gapId}
                  entry={entry}
                  selected={entry.gapId === selectedGapId}
                  onClick={() =>
                    setSelectedGapId((current) => (current === entry.gapId ? null : entry.gapId))
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* 说明行 */}
        <p className="text-[10px] text-[var(--nx-text-muted)]">
          全部缺口数据来自组织资源计划事实（只读分析）；任何处置建议须经人工确认后走
          既有变更链路执行（RL-01）。
        </p>
      </div>
    </GapPageShell>
  )
}

// ---------------------------------------------------------------------------
// 页壳
// ---------------------------------------------------------------------------

function GapPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <TrendingDown className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <p
              data-page-breadcrumb
              className="font-mono text-[10px] tracking-wide text-[var(--nx-text-muted)]"
            >
              …/resource-gaps · 资源缺口分析
            </p>
            <h1
              data-page-title
              className="text-lg font-semibold leading-tight text-[var(--nx-text-primary)]"
            >
              资源缺口分析
            </h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              组织级需求-供给缺口多维透视 · 原因解读 · 只读工作台
            </p>
          </div>
        </div>
      </header>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

function GapStatCard({ label, text, tone }: { label: string; text: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2.5">
      <span className="text-[11px] text-[var(--nx-text-muted)]">{label}</span>
      <span
        className="text-xl font-semibold tabular-nums"
        style={tone ? { color: `var(${tone})` } : { color: 'var(--nx-text-primary)' }}
      >
        {text}
      </span>
    </div>
  )
}

function GapSelect({
  label,
  dataAttr,
  value,
  options,
  onChange,
}: {
  label: string
  dataAttr: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
      {label}
      <select
        {...{ [dataAttr]: true }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] text-[var(--nx-text-secondary)] outline-none focus:border-[var(--nx-border-focus)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function GapEntryCard({
  entry,
  selected,
  onClick,
}: {
  entry: ResourceGapEntry
  selected: boolean
  onClick: () => void
}) {
  if (entry.redacted) {
    return (
      <div
        data-gap-entry-redacted
        className="flex flex-col gap-1.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3.5 py-3"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-muted)]">
          <EyeOff className="h-3.5 w-3.5" aria-hidden />
          已脱敏
        </span>
        <p className="text-[11px] text-[var(--nx-text-muted)]">
          该缺口条目受权限保护，不显示维度明细
        </p>
      </div>
    )
  }
  const tone = getGapSeverityTone(entry.severity)
  return (
    <button
      type="button"
      data-gap-entry-card={entry.gapId}
      data-selected={selected || undefined}
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border bg-[var(--nx-bg-1)] px-3.5 py-3 text-left transition-colors hover:border-[var(--nx-border-focus)]',
        selected ? 'border-[var(--nx-border-focus)]' : 'border-[var(--nx-border-hairline)]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-[var(--nx-text-primary)]">
          {entry.dimensionLabel || entry.dimensionValue}
        </span>
        <span
          data-severity={entry.severity}
          className="shrink-0 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] font-medium"
          style={{ color: `var(${tone})` }}
        >
          {getGapSeverityLabel(entry.severity)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--nx-text-muted)]">
        <span className="tabular-nums">缺口 {formatGapEntryHours(entry.gapHours)}</span>
        <span className="tabular-nums">
          缺口率 {entry.gapRatio !== undefined ? `${Math.round(entry.gapRatio * 100)}%` : '—'}
        </span>
        {entry.dateWindow ? (
          <span className="font-mono">
            {entry.dateWindow.from.slice(0, 10)} ~ {entry.dateWindow.to.slice(0, 10)}
          </span>
        ) : null}
      </div>
      {entry.reasons.length > 0 ? (
        <span className="text-[10px] text-[var(--nx-text-muted)]">
          原因：{entry.reasons.map((reason) => reason.label).join('、')}
        </span>
      ) : null}
    </button>
  )
}

function GapEntryDetail({ entry }: { entry: ResourceGapEntry }) {
  return (
    <div
      data-gap-detail
      className="rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: `var(${getGapSeverityTone(entry.severity)})` }}
        >
          {entry.dimensionLabel || entry.dimensionValue}
          <span
            data-severity={entry.severity}
            className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] font-medium"
          >
            {getGapSeverityLabel(entry.severity)}缺口
          </span>
        </span>
        <ArrowRight className="h-3 w-3 text-[var(--nx-text-muted)]" aria-hidden />
        <span className="text-[11px] text-[var(--nx-text-muted)]">
          缺口容量 {formatGapEntryHours(entry.gapHours)}（需求{' '}
          {formatGapEntryHours(entry.demandHours)} / 供给 {formatGapEntryHours(entry.supplyHours)}
          ，缺口率 {entry.gapRatio !== undefined ? `${Math.round(entry.gapRatio * 100)}%` : '—'}）
        </span>
      </div>
      {entry.reasons.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {entry.reasons.map((reason) => (
            <li
              key={reason.code}
              data-gap-reason={reason.code}
              className="flex items-start gap-2 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
            >
              <span
                aria-hidden
                className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: getGapSeverityHex(entry.severity) }}
              />
              <span>
                <span className="font-medium text-[var(--nx-text-primary)]">{reason.label}</span>：
                {reason.explanation || '—'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function formatGapEntryHours(hours: number): string {
  if (!Number.isFinite(hours)) return '—'
  return `${hours.toFixed(1)}h`
}
