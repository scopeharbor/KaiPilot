'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  Gauge,
  Gavel,
  LayoutDashboard,
  Layers,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Users,
} from 'lucide-react'
import { usePortfolioSummary } from '@/hooks/use-portfolio-dashboard'
import { usePermissions } from '@/hooks/use-permissions'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import { PmoKpiCardGrid } from './PmoKpiCardGrid'
import { PmoTrafficSummaryCard } from './PmoTrafficSummaryCard'
import { PmoPortfolioAlertsCard } from './PmoPortfolioAlertsCard'
import { PmoInvestmentDistributionSection } from './PmoInvestmentDistributionSection'

/**
 * PMO 组合仪表盘工作台（/next/pmo，v3-ui-next-pmo-domain W1 · tasks 1.1，
 * spec「PMO 组合仪表盘新轨主页与组织层信息架构」）。
 *
 * - 数据 100% 复用既有 `usePortfolioSummary`（GET /pmo/portfolio-dashboard，
 *   includeTrafficLight + includeFreshness 双通道开启；RL-04 缓存同源），
 *   摘要数据由本容器唯一订阅并经 props 下推 KPI/交通灯/告警纯展示组件；
 * - 「组合总览 / 分组视图」Tab：分组视图 Tab 路由跳转独立主页
 *   `/next/pmo/grouping-views`（URL 可回退，等价旧页 Tab 动线）；子导航
 *   优先级评分/决策工作台/组织资源池与旧页一致，决策按钮仅对持有
 *   `pmo_decision:view` 的用户呈现；页头提供「← 返回角色首页」统一回退；
 * - 三态：几何匹配骨架屏（aria-busy）/ 内容空态（各区块自带语义空态）/
 *   错误卡（403/404 中性受限态不泄露线索，5xx 可重试）；
 * - 沉浸阶梯：precise 下剥离氛围光晕，纯色工作面 + 1px 发丝线
 *   （useImmersionTier，D18 Layer 2 暗黑仪器感）。
 */
export function PmoPortfolioOverviewWorkspace() {
  const router = useRouter()
  const tier = useImmersionTier()
  const { canAny } = usePermissions()
  const summaryQuery = usePortfolioSummary({ includeTrafficLight: true, includeFreshness: true })

  const summary = summaryQuery.data
  const loading =
    summaryQuery.isLoading || summaryQuery.isPending || (summaryQuery.isFetching && !summary)

  if (loading) {
    return <PmoPortfolioOverviewSkeleton tier={tier} />
  }

  if (summaryQuery.isError || summary === undefined) {
    const status = (summaryQuery.error as { status?: number } | null)?.status
    const restricted = status === 403 || status === 404
    return (
      <PmoPortfolioOverviewError
        tier={tier}
        restricted={restricted}
        onRetry={() => void summaryQuery.refetch()}
      />
    )
  }

  const kpis = summary.kpis ?? []
  const trafficLight = summary.trafficLight ?? null
  const isEmptyContent =
    kpis.length === 0 && trafficLight === null && (summary.warnings ?? []).length === 0

  return (
    <div
      data-pmo-portfolio-workspace
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头：返回角色首页 + 标题 + 可见项目口径 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            data-pmo-back-home
            onClick={() => router.push('/next')}
            className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回角色首页
          </button>
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <LayoutDashboard className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1
              data-pmo-portfolio-title
              className="text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              PMO 组合总览
            </h1>
            <p data-pmo-portfolio-meta className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              共 {summary.meta?.visibleProjectCount ?? '—'} 个可见项目 · 组织组合层
            </p>
          </div>
        </div>
        {summary.meta?.calculatedAt ? (
          <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 font-mono text-[10px] text-[var(--nx-text-muted)]">
            计算于 {formatStamp(summary.meta.calculatedAt)}
          </span>
        ) : null}
      </header>

      {/* Tab + 子导航（镜像旧页动线，目标全部换新轨路由） */}
      <nav
        aria-label="组合总览页面导航"
        className="flex flex-wrap items-center gap-2 border-b border-[var(--nx-border-hairline)] pb-3"
      >
        <button
          type="button"
          data-pmo-tab-overview
          aria-current="page"
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)]"
        >
          <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
          组合总览
        </button>
        <button
          type="button"
          data-pmo-tab-grouping
          onClick={() => router.push('/next/pmo/grouping-views')}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden />
          分组视图
        </button>
        <span className="mx-1 h-4 w-px bg-[var(--nx-border-hairline)]" aria-hidden />
        <button
          type="button"
          data-pmo-nav-priority-scoring
          onClick={() => router.push('/next/pmo/priority-scoring')}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          <TrendingUp className="h-3.5 w-3.5" aria-hidden />
          优先级评分
        </button>
        {canAny(['pmo_decision:view']) && (
          <button
            type="button"
            data-pmo-nav-decisions
            onClick={() => router.push('/next/pmo/decisions')}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <Gavel className="h-3.5 w-3.5" aria-hidden />
            决策工作台
          </button>
        )}
        <button
          type="button"
          data-pmo-nav-resource-pool
          onClick={() => router.push('/next/organization/resource-pool')}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          <Users className="h-3.5 w-3.5" aria-hidden />
          组织资源池
        </button>
        <button
          type="button"
          data-pmo-nav-reports
          onClick={() => router.push('/next/pmo/reports')}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          <BarChart3 className="h-3.5 w-3.5" aria-hidden />
          组合报表
        </button>
        <button
          type="button"
          data-pmo-nav-change-queue
          onClick={() => router.push('/next/pmo/change-queue')}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          <ClipboardList className="h-3.5 w-3.5" aria-hidden />
          变更队列
        </button>
      </nav>

      {/* 内容：KPI / 交通灯摘要 / 告警与新鲜度 / 投入分布 */}
      <div className="flex flex-col gap-4">
        {isEmptyContent ? (
          <div
            data-pmo-overview-empty
            className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
          >
            <Gauge className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
            <p className="text-sm text-[var(--nx-text-secondary)]">当前没有可见的组合态势数据</p>
            <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
              组合摘要未返回 KPI、交通灯或告警内容；受限指标不计入可见数。
            </p>
          </div>
        ) : (
          <>
            <PmoKpiCardGrid kpis={kpis} />
            {trafficLight !== null ? <PmoTrafficSummaryCard trafficLight={trafficLight} /> : null}
            <PmoPortfolioAlertsCard
              warnings={summary.warnings ?? []}
              freshness={summary.freshness ?? []}
            />
          </>
        )}
      </div>

      {/* 投入分布区块（只读，独立数据链） */}
      <PmoInvestmentDistributionSection />
    </div>
  )
}

/** ISO 时间戳 → `YYYY-MM-DD HH:mm`（UTC 切割展示，确定性无时区换算）。 */
function formatStamp(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16)
}

// ── 骨架屏 ──────────────────────────────────────────────────────────────────

function PmoPortfolioOverviewSkeleton({ tier }: { tier: string }) {
  return (
    <div
      data-pmo-portfolio-skeleton
      role="status"
      aria-label="正在加载 PMO 组合总览"
      aria-busy="true"
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-9 w-64 animate-pulse rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
        <div className="h-6 w-32 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
      </div>
      <div className="h-8 w-full animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            aria-hidden
          />
        ))}
      </div>
      <div
        className="h-28 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
        aria-hidden
      />
      <div
        className="h-24 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
        aria-hidden
      />
    </div>
  )
}

// ── 错误态（403/404 中性受限 vs 5xx 可重试）────────────────────────────────

function PmoPortfolioOverviewError({
  tier,
  restricted,
  onRetry,
}: {
  tier: string
  restricted: boolean
  onRetry: () => void
}) {
  const router = useRouter()
  return (
    <div
      data-pmo-portfolio-error
      role="alert"
      aria-label="PMO 组合总览加载错误"
      className={cn(
        'flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-8 text-center',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      <ShieldAlert
        className={cn(
          'h-8 w-8',
          restricted ? 'text-[var(--nx-text-muted)]' : 'text-[var(--nx-status-warning)]',
        )}
        aria-hidden
      />
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
        {restricted ? '组合态势数据不可用' : 'PMO 组合总览加载失败'}
      </h3>
      <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
        {restricted
          ? '数据不存在或当前会话无权访问。请返回角色首页重新选择组织后重试。'
          : '组合摘要暂时无法加载，请稍后重试。'}
      </p>
      <div className="flex items-center gap-3">
        {restricted ? (
          <button
            type="button"
            data-pmo-back-home
            onClick={() => router.push('/next')}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回角色首页
          </button>
        ) : (
          <button
            type="button"
            data-pmo-portfolio-retry
            onClick={onRetry}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新载入
          </button>
        )}
      </div>
    </div>
  )
}

export default PmoPortfolioOverviewWorkspace
