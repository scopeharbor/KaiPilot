'use client'

import * as React from 'react'
import { Gauge, RefreshCw } from 'lucide-react'
import { useOkrCycles } from '@/hooks/use-okr'
import { useOkrDashboardSummary } from '@/hooks/use-okr-dashboard'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import { OKR_DASHBOARD_SECTION_VALUES } from '@aiproj/types'
import type { OkrDashboardQuery } from '@aiproj/types'
import { okrCycleListOf } from '@/lib/next/org-okr/org-okr-adapter'
import { OkrCyclePicker } from './OkrCyclePicker'
import { OkrDashboardSections } from './OkrDashboardSections'

/**
 * OKR 仪表盘工作台（v3-ui-next-org-portfolio-domains W2 · tasks 2.6，
 * spec「OKR 达成仪表盘：周期联动与 sections 分区摘要」）。
 *
 * - 数据 100% 复用既有 `useOkrDashboardSummary`（GET /okrs/dashboard，只读聚合，
 *   sections 白名单收敛为全量分区 + staleThreshold 服务端归一化默认窗）与
 *   `useOkrCycles`（周期选择器）；组织 ID 由页面装配层从有效租户上下文注入；
 * - 周期联动：切换周期 → summary 查询参数 cycleId 变化重查（只读）；
 * - 三态：几何匹配骨架屏（aria-busy）/ 空态（无可见目标与 KR，后端 meta 语义）
 *   / 错误卡（5xx 可重试 refetch）；精确档剥离空间氛围光晕（useImmersionTier）；
 * - 分区矩阵（KPI/分布/关注/对齐/证据/回流/数据源/警告）由 OkrDashboardSections
 *   纯展示呈现，含受限指标中性「不可见」（RL-05）。
 */
export interface OkrDashboardWorkspaceProps {
  organizationId: number
}

export function OkrDashboardWorkspace({ organizationId }: OkrDashboardWorkspaceProps) {
  const tier = useImmersionTier()
  const [selectedCycleId, setSelectedCycleId] = React.useState<number | undefined>()

  const query: OkrDashboardQuery = React.useMemo(
    () => ({
      cycleId: selectedCycleId,
      sections: [...OKR_DASHBOARD_SECTION_VALUES],
    }),
    [selectedCycleId],
  )

  const cyclesQuery = useOkrCycles(organizationId, {})
  const summaryQuery = useOkrDashboardSummary({
    organizationId,
    query,
    enabled: organizationId > 0,
  })

  const summary = summaryQuery.data
  const cycles = okrCycleListOf(cyclesQuery.data)
  const loading =
    summaryQuery.isLoading ||
    summaryQuery.isPending ||
    (summaryQuery.isFetching && summary === undefined)

  if (loading) {
    return <OkrDashboardSkeleton />
  }

  if (summaryQuery.isError || summary === undefined) {
    const status = (summaryQuery.error as { status?: number } | null)?.status
    const restricted = status === 403 || status === 404
    return (
      <div
        data-okr-dash-error
        role="alert"
        aria-label="OKR 仪表盘加载错误"
        className={cn(
          'flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-8 text-center',
          tier === 'precise'
            ? 'bg-[var(--nx-workspace-bg)]'
            : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
        )}
      >
        {restricted ? (
          <>
            <Gauge className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
            <h3
              data-okr-dash-restricted
              className="text-base font-medium text-[var(--nx-text-primary)]"
            >
              当前角色无查看 OKR 仪表盘的权限
            </h3>
            <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
              部分分区可能因权限受限未展示。请联系组织管理员。
            </p>
          </>
        ) : (
          <>
            <Gauge className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
            <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
              OKR 仪表盘加载失败
            </h3>
            <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
              {(summaryQuery.error as { message?: string } | null)?.message ?? '请稍后重试。'}
            </p>
            <button
              type="button"
              data-okr-dash-retry
              onClick={() => void summaryQuery.refetch()}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              重新加载
            </button>
          </>
        )}
      </div>
    )
  }

  const isEmpty =
    summary.meta.visibleObjectiveCount === 0 && summary.meta.visibleKeyResultCount === 0

  const cycleContext = summary.cycleContext
  const cycleContextLine =
    cycleContext && cycleContext.title
      ? `${cycleContext.title} · ${cycleContext.status ?? '未知状态'}`
      : '未指定周期（服务端自动解析活跃/最近周期）'

  return (
    <div
      data-okr-dash-workspace
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头 + 周期联动 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Gauge className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1 data-okr-dash-title className="text-lg font-semibold text-[var(--nx-text-primary)]">
              OKR 仪表盘
            </h1>
            <p
              data-okr-dash-cycle-context
              className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]"
            >
              {cycleContextLine}
            </p>
          </div>
        </div>
        <OkrCyclePicker
          cycles={cycles}
          value={selectedCycleId}
          onChange={setSelectedCycleId}
          loading={cyclesQuery.isLoading}
        />
      </header>

      {isEmpty ? (
        <div
          data-okr-dash-empty
          className="flex min-h-[40vh] flex-col items-center justify-center gap-2.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
        >
          <p className="text-sm text-[var(--nx-text-secondary)]">当前周期暂无可见 OKR 数据</p>
          <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            可切换周期查看；受限目标与关键结果不计入可见数，创建与回填由具备组织管理权限的成员完成。
          </p>
        </div>
      ) : (
        <OkrDashboardSections summary={summary} />
      )}
    </div>
  )
}

// ── 骨架屏 ─────────────────────────────────────────────────────────────────

function OkrDashboardSkeleton() {
  return (
    <div
      data-okr-dash-skeleton
      role="status"
      aria-label="正在加载 OKR 仪表盘"
      aria-busy="true"
      className="flex min-h-[70vh] flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-9 w-48 animate-pulse rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
        <div className="h-8 w-44 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            aria-hidden
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div
          className="h-40 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
          aria-hidden
        />
        <div
          className="h-40 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
          aria-hidden
        />
      </div>
      <div
        className="h-56 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
        aria-hidden
      />
    </div>
  )
}

export default OkrDashboardWorkspace
