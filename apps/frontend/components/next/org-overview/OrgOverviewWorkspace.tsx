'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  Building2,
  ChevronDown,
  Clock,
  EyeOff,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  RefreshCw,
  ShieldAlert,
  Users,
} from 'lucide-react'
import { useOrganizationDashboard } from '@/hooks/use-organization-dashboard'
import { useCurrentLayout } from '@/hooks/use-organization-dashboard-layout'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS,
  ORGANIZATION_DASHBOARD_LAYOUT_SIZE_COLUMNS,
  ORGANIZATION_DASHBOARD_MODULE_REGISTRY,
  ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT,
  type OrganizationDashboardLayoutDensity,
  type OrganizationDashboardLayoutModuleInstance,
  type OrganizationDashboardTarget,
} from '@aiproj/types'
import {
  ORG_OVERVIEW_REDACTED_HINT,
  ORG_OVERVIEW_REDACTED_TEXT,
  ORGANIZATION_ATTENTION_REASON_LABELS,
  ORGANIZATION_HEALTH_LABELS,
  ORGANIZATION_METRIC_LABELS,
  ORGANIZATION_PROJECT_STATUS_LABELS,
  ORGANIZATION_REMINDER_LABELS,
  formatOrganizationMetricValue,
  formatOrganizationWarning,
  formatRelativeTime,
  isEmptyOrganizationDashboard,
  isMetricRedacted,
  selectKpiStrip,
  staleSources,
} from '@/lib/next/org-overview/org-overview-adapter'
import type {
  OrganizationActivityItem,
  OrganizationAttentionItem,
  OrganizationDashboardMetric,
  OrganizationDashboardSummary,
  OrganizationMemberOverview,
  OrganizationPmoEntry,
  OrganizationResourceOverview,
  OrganizationRiskReminder,
} from '@aiproj/types'

/**
 * 组织概览主工作台（v3-ui-next-org-portfolio-domains W1 · tasks 1.3，
 * spec「组织概览工作台与指标级脱敏」）。
 *
 * - 数据 100% 复用既有 `useOrganizationDashboard`（GET /organizations/:orgId/dashboard，
 *   sections/attentionLimit/activityLimit/freshness 收敛为服务端归一化默认窗口）与
 *   `useCurrentLayout`（GET /dashboard/layouts/current，同一 query key 与布局编排器
 *   去重共享）；页面渲染顺序/可见性/密度由当前布局模块实例驱动，未取得布局时按
 *   系统默认布局降级（与后端 SYSTEM default 常量同源，绝不自行发明顺序）；
 * - 暗黑仪器感分区：组织身份（页头，模块不可隐藏）、KPI 条、状态分布、待关注队列、
 *   成员/资源概览、风险提醒、活动流、PMO 入口；各分区可折叠（aria-expanded）；
 * - RL-05 指标级脱敏：受限数值（成员数/资源/风险计数等）一律由后端受限布尔驱动
 *   `EyeOff` + 中性「数据不可见」卡，界面不出现任何猜测数值文本；
 * - 三态：几何匹配骨架屏（aria-busy）/ 空组织语义横幅（后端 EMPTY warning 驱动，
 *   不自行推断）/ 错误态区分中性受限（403/404 无重试）与可重试（5xx/网络）；
 * - 精确档（precise）剥离空间层氛围光晕降级纯色仪器面板（useImmersionTier）。
 */

/** 概览可渲染模块（数据均出自组织 dashboard 单一端点契约）。 */
const RENDERABLE_MODULE_KEYS = new Set<string>([
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.STATUS_DISTRIBUTION,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ATTENTION_PROJECTS,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.MEMBER_OVERVIEW,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RESOURCE_OVERVIEW,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RISK_REMINDERS,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ACTIVITY,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.PMO_ENTRY,
])

/** 各 section 的 12 列 span（size token → 网格列数，与布局契约列宽一致）。 */
function moduleColSpan(module: OrganizationDashboardLayoutModuleInstance): number {
  const span = ORGANIZATION_DASHBOARD_LAYOUT_SIZE_COLUMNS[module.size]
  return Math.max(1, Math.min(12, span ?? 4))
}

export interface OrgOverviewWorkspaceProps {
  /** 呼出布局编排抽屉（页面装配层持有打开状态）。 */
  onOpenLayoutEditor: () => void
}

export function OrgOverviewWorkspace({ onOpenLayoutEditor }: OrgOverviewWorkspaceProps) {
  const tier = useImmersionTier()
  const {
    data: summary,
    isPending,
    isLoading,
    isError,
    error,
    refetch,
  } = useOrganizationDashboard()
  const { data: layoutData } = useCurrentLayout()

  // 折叠分区（本地交互态，不写入 URL / 不落库）。
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set())
  const toggleSection = React.useCallback((moduleKey: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(moduleKey)) next.delete(moduleKey)
      else next.add(moduleKey)
      return next
    })
  }, [])

  const loading = isPending || (isLoading && !summary)

  if (loading) {
    return <OrgOverviewSkeleton />
  }

  if (isError || summary === undefined) {
    const status = (error as { status?: number } | null)?.status
    const restricted = status === 403 || status === 404
    return (
      <div
        data-org-overview-error
        role="alert"
        className={cn(
          'flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-8 text-center',
          tier === 'precise'
            ? 'bg-[var(--nx-workspace-bg)]'
            : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
        )}
      >
        {restricted ? (
          <>
            <EyeOff className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
            <h3
              data-org-overview-restricted
              className="text-base font-medium text-[var(--nx-text-primary)]"
            >
              {ORG_OVERVIEW_REDACTED_TEXT}
            </h3>
            <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
              组织数据当前不可用。非法或跨租户引用统一按中性语义处理，请联系组织管理员确认访问范围。
            </p>
          </>
        ) : (
          <>
            <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
            <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
              加载组织概览失败
            </h3>
            <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
              服务暂时不可用，请稍后重试。
            </p>
            <button
              type="button"
              data-org-overview-retry
              onClick={() => void refetch()}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              重试
            </button>
          </>
        )}
      </div>
    )
  }

  // 布局驱动的模块清单：当前布局未就绪（加载/失败/缺省）时降级系统默认布局。
  const layoutModules =
    layoutData?.layout?.modules && layoutData.layout.modules.length > 0
      ? layoutData.layout.modules
      : ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT.modules
  const density = layoutData?.layout?.density ?? ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE
  const activeModules = layoutModules
    .filter((module) => RENDERABLE_MODULE_KEYS.has(module.moduleKey))
    .sort((a, b) => a.row - b.row || a.col - b.col)
  const stale = staleSources(summary)
  const isEmpty = isEmptyOrganizationDashboard(summary)

  return (
    <div
      data-org-overview-workspace
      data-org-density={density}
      aria-busy={false}
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头 = 组织身份模块（identity 不可隐藏，恒驻） */}
      <OrgOverviewHeader
        summary={summary}
        density={density}
        staleCount={stale.length}
        onOpenLayoutEditor={onOpenLayoutEditor}
      />

      {/* 布局 warning 徽标（渲染期脱敏语义由后端下发文案承载） */}
      {layoutData && layoutData.warnings.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {layoutData.warnings.map((warning, index) => (
            <span
              key={`${warning.code}-${index}`}
              data-org-layout-warning
              className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-0.5 text-[11px] text-[var(--nx-text-secondary)]"
            >
              {warning.message}
            </span>
          ))}
        </div>
      ) : null}

      {/* 组织级 warning 徽标（≤3，稳定 code → 中文文案） */}
      {summary.warnings.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {summary.warnings.slice(0, 3).map((warning, index) => (
            <span
              key={`${warning.code}-${index}`}
              data-org-warning-badge
              className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-0.5 text-[11px] text-[var(--nx-text-secondary)]"
            >
              {formatOrganizationWarning(warning)}
            </span>
          ))}
        </div>
      ) : null}

      {/* 空组织语义横幅（后端 EMPTY warning 驱动，不自行推断） */}
      {isEmpty ? (
        <div
          data-org-overview-empty
          className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-6 py-8 text-center"
        >
          <FolderKanban className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">
            当前组织还没有可见项目
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            创建第一个项目后，这里会显示组织级的运行概览、待关注项目与风险提醒。
          </p>
        </div>
      ) : null}

      {/* 布局网格（模块显隐/排序/密度由当前布局驱动） */}
      <div
        data-org-overview-grid
        className={cn(
          'grid grid-cols-12 items-start',
          density === ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMPACT ? 'gap-2' : 'gap-3',
        )}
      >
        {activeModules.map((module) => {
          const key = module.moduleKey
          const isCollapsed = collapsed.has(key)
          return (
            <section
              key={key}
              data-org-section={key}
              aria-label={orgSectionTitle(key)}
              className={cn(
                'flex min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]',
                isCollapsed && 'self-start',
              )}
              style={{
                gridColumn: `span ${moduleColSpan(module)}`,
                gridRow: `${module.row}`,
              }}
            >
              <OrgSectionHeader
                moduleKey={key}
                icon={orgSectionIcon(key)}
                isCollapsed={isCollapsed}
                onToggle={() => toggleSection(key)}
              />
              {isCollapsed ? null : (
                <div
                  className={cn(
                    'min-w-0',
                    density === ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMPACT ? 'p-2.5' : 'p-3',
                  )}
                >
                  <OrgSectionBody moduleKey={key} summary={summary} density={density} />
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

// ─── 页头（组织身份） ──────────────────────────────────────────────────────────

function OrgOverviewHeader({
  summary,
  density,
  staleCount,
  onOpenLayoutEditor,
}: {
  summary: OrganizationDashboardSummary
  density: OrganizationDashboardLayoutDensity
  staleCount: number
  onOpenLayoutEditor: () => void
}) {
  return (
    <header
      data-org-overview-header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]',
        density === ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMPACT ? 'p-3' : 'p-4',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
          <Building2 className="h-5 w-5 text-[var(--nx-accent)]" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1
              data-org-overview-title
              className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              {summary.organization.name || '当前组织'}
            </h1>
            <span className="shrink-0 rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
              org#{summary.organization.organizationId}
            </span>
          </div>
          <p
            data-org-overview-meta
            className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]"
          >
            组织概览 · {summary.organization.slug ? `@${summary.organization.slug} · ` : ''}
            可见项目 {summary.meta.visibleProjectCount} 个 · 更新于{' '}
            {formatRelativeTime(summary.meta.calculatedAt)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {staleCount > 0 ? (
          <span
            data-org-stale-badge
            className="flex items-center gap-1.5 rounded-sm border border-[var(--nx-status-warning)] bg-[rgba(245,158,11,0.08)] px-2 py-1 text-[11px] text-[var(--nx-status-warning)]"
          >
            <Clock className="h-3 w-3" aria-hidden />
            {staleCount} 个数据源已过期
          </span>
        ) : null}
        <button
          type="button"
          data-org-layout-edit-open
          aria-label="打开布局编排"
          onClick={onOpenLayoutEditor}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
        >
          <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
          布局编排
        </button>
      </div>
    </header>
  )
}

// ─── 分区骨架/头部/图标 ────────────────────────────────────────────────────────

/** 首载骨架屏（几何匹配，防布局抖动）。 */
export function OrgOverviewSkeleton() {
  return (
    <div
      data-org-overview-skeleton
      aria-busy="true"
      className="flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 md:p-5"
    >
      <div className="flex items-center gap-3">
        <span className="h-9 w-9 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
        <span className="h-4 w-44 animate-pulse rounded bg-[var(--nx-bg-1)]" />
      </div>
      <div className="grid grid-cols-6 gap-3">
        {Array.from({ length: 6 }, (_value, index) => (
          <span key={index} className="h-20 animate-pulse rounded-lg bg-[var(--nx-bg-1)]" />
        ))}
      </div>
      <div className="grid flex-1 grid-cols-2 gap-3">
        <span className="h-48 animate-pulse rounded-lg bg-[var(--nx-bg-1)]" />
        <span className="h-48 animate-pulse rounded-lg bg-[var(--nx-bg-1)]" />
      </div>
    </div>
  )
}

function orgSectionTitle(moduleKey: string): string {
  return (
    ORGANIZATION_DASHBOARD_MODULE_REGISTRY[
      moduleKey as keyof typeof ORGANIZATION_DASHBOARD_MODULE_REGISTRY
    ]?.displayName ?? moduleKey
  )
}

function orgSectionIcon(moduleKey: string) {
  switch (moduleKey) {
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP:
      return <Gauge className="h-3.5 w-3.5" aria-hidden />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.STATUS_DISTRIBUTION:
      return <FolderKanban className="h-3.5 w-3.5" aria-hidden />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ATTENTION_PROJECTS:
      return <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.MEMBER_OVERVIEW:
      return <Users className="h-3.5 w-3.5" aria-hidden />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RESOURCE_OVERVIEW:
      return <Gauge className="h-3.5 w-3.5" aria-hidden />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RISK_REMINDERS:
      return <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ACTIVITY:
      return <Activity className="h-3.5 w-3.5" aria-hidden />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.PMO_ENTRY:
      return <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
    default:
      return <Building2 className="h-3.5 w-3.5" aria-hidden />
  }
}

function OrgSectionHeader({
  moduleKey,
  icon,
  isCollapsed,
  onToggle,
}: {
  moduleKey: string
  icon: React.ReactNode
  isCollapsed: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2">
      <h2 className="flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--nx-text-secondary)]">
        <span className="text-[var(--nx-accent)]">{icon}</span>
        <span className="truncate">{orgSectionTitle(moduleKey)}</span>
      </h2>
      <button
        type="button"
        data-org-section-toggle={moduleKey}
        aria-label={`${isCollapsed ? '展开' : '折叠'}${orgSectionTitle(moduleKey)}`}
        aria-expanded={!isCollapsed}
        onClick={onToggle}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]"
      >
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', isCollapsed && '-rotate-90')}
          aria-hidden
        />
      </button>
    </div>
  )
}

// ─── 受限「不可见」占位（RL-05：零数值、零猜测） ───────────────────────────────

export function OrgOverviewRedactedNotice({ className }: { className?: string }) {
  return (
    <div
      data-org-overview-redacted
      className={cn('flex items-center gap-2 text-xs text-[var(--nx-text-muted)]', className)}
    >
      <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {ORG_OVERVIEW_REDACTED_TEXT}
        <span className="ml-1.5 text-[var(--nx-text-muted)]">· {ORG_OVERVIEW_REDACTED_HINT}</span>
      </span>
    </div>
  )
}

// ─── 分区正文 ──────────────────────────────────────────────────────────────────

function OrgSectionBody({
  moduleKey,
  summary,
  density,
}: {
  moduleKey: string
  summary: OrganizationDashboardSummary
  density: OrganizationDashboardLayoutDensity
}) {
  switch (moduleKey) {
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP:
      return <KpiStripSection summary={summary} density={density} />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.STATUS_DISTRIBUTION:
      return <StatusDistributionSection summary={summary} />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ATTENTION_PROJECTS:
      return <AttentionProjectsSection summary={summary} />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.MEMBER_OVERVIEW:
      return <MemberOverviewSection overview={summary.memberOverview} />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RESOURCE_OVERVIEW:
      return <ResourceOverviewSection overview={summary.resourceOverview} />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RISK_REMINDERS:
      return <RiskRemindersSection reminders={summary.riskReminders} />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ACTIVITY:
      return <ActivitySection items={summary.recentActivity} />
    case ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.PMO_ENTRY:
      return <PmoEntrySection entry={summary.pmoEntry} />
    default:
      return null
  }
}

/** KPI 指标条：固定顺序选区（selectKpiStrip），受限卡 EyeOff + 中性文案。 */
function KpiStripSection({
  summary,
  density,
}: {
  summary: OrganizationDashboardSummary
  density: OrganizationDashboardLayoutDensity
}) {
  const strip = selectKpiStrip(summary)
  if (strip.length === 0) {
    return <p className="text-xs text-[var(--nx-text-muted)]">暂无 KPI 数据</p>
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {strip.map((metric) => (
        <KpiMetricCard key={metric.key} metric={metric} density={density} />
      ))}
    </div>
  )
}

function KpiMetricCard({
  metric,
  density,
}: {
  metric: OrganizationDashboardMetric
  density: OrganizationDashboardLayoutDensity
}) {
  const redacted = isMetricRedacted(metric)
  return (
    <div
      data-org-kpi-card={metric.key}
      data-org-kpi-redacted={redacted ? 'true' : 'false'}
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]',
        density === ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMPACT ? 'p-2' : 'p-2.5',
      )}
    >
      <span className="truncate text-[10px] text-[var(--nx-text-muted)]">
        {ORGANIZATION_METRIC_LABELS[metric.key] ?? metric.key}
      </span>
      {redacted ? (
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]">
          <EyeOff className="h-3 w-3 shrink-0" aria-hidden />
          {ORG_OVERVIEW_REDACTED_TEXT}
        </span>
      ) : (
        <span className="truncate text-lg font-semibold tabular-nums text-[var(--nx-text-primary)]">
          {formatOrganizationMetricValue(metric)}
        </span>
      )}
    </div>
  )
}

/** 项目状态分布（计数 + 百分比 + 色条双通道）。 */
function StatusDistributionSection({ summary }: { summary: OrganizationDashboardSummary }) {
  if (summary.statusDistribution.length === 0) {
    return <p className="text-xs text-[var(--nx-text-muted)]">暂无数据</p>
  }
  return (
    <div className="flex flex-col gap-2.5">
      {summary.statusDistribution.map((slice) => {
        const label = ORGANIZATION_PROJECT_STATUS_LABELS[slice.key] ?? slice.label
        const color = statusBarColor(slice.key)
        return (
          <div key={slice.key} data-org-status-row={slice.key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-[var(--nx-text-secondary)]">{label}</span>
              <span className="shrink-0 tabular-nums text-[var(--nx-text-muted)]">
                {slice.count} · {slice.percent}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--nx-bg-0)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, slice.percent))}%`,
                  backgroundColor: `var(--${color})`,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function statusBarColor(statusKey: string): string {
  switch (statusKey) {
    case 'active':
      return 'nx-chart-1'
    case 'planning':
      return 'nx-chart-2'
    case 'on_hold':
      return 'nx-status-warning'
    case 'completed':
      return 'nx-status-success'
    default:
      return 'nx-text-muted'
  }
}

/** 待关注项目队列（低敏条目：仅后端授权下发的项目）。 */
function AttentionProjectsSection({ summary }: { summary: OrganizationDashboardSummary }) {
  if (summary.attentionProjects.length === 0) {
    return <p className="text-xs text-[var(--nx-text-muted)]">当前没有需要关注的项目</p>
  }
  return (
    <div className="flex flex-col gap-2">
      {summary.attentionProjects.map((item) => (
        <AttentionItemRow key={item.projectId} item={item} />
      ))}
    </div>
  )
}

function AttentionItemRow({ item }: { item: OrganizationAttentionItem }) {
  return (
    <div
      data-org-attention-item={item.projectId}
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <SafeTargetLink
            target={item.target}
            className="min-w-0 truncate text-xs font-medium text-[var(--nx-text-primary)] hover:text-[var(--nx-accent)]"
          >
            {item.projectName}
          </SafeTargetLink>
          <span className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
            {ORGANIZATION_HEALTH_LABELS[item.healthStatus] ?? item.healthStatus}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {item.reasons.map((reason) => (
            <span
              key={reason}
              data-org-attention-reason={reason}
              className="rounded-sm border border-[var(--nx-status-warning)] bg-[rgba(245,158,11,0.08)] px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)]"
            >
              {ORGANIZATION_ATTENTION_REASON_LABELS[reason] ?? reason}
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-[var(--nx-text-muted)]">
        <span>进度 {item.progressPercent}%</span>
        {item.overdueTaskCount !== null ? <span>逾期任务 {item.overdueTaskCount}</span> : null}
      </div>
    </div>
  )
}

/** 成员概览：forbidden → EyeOff + 中性文案（零数值）。 */
function MemberOverviewSection({ overview }: { overview: OrganizationMemberOverview }) {
  if (overview.forbidden) {
    return <OrgOverviewRedactedNotice />
  }
  if (!overview.available) {
    return <p className="text-xs text-[var(--nx-text-muted)]">成员数据暂不可用</p>
  }
  return (
    <div data-org-member-card className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap gap-3 text-xs text-[var(--nx-text-secondary)]">
        <span className="tabular-nums">
          总数{' '}
          <strong className="font-semibold text-[var(--nx-text-primary)]">
            {overview.totalMembers}
          </strong>
        </span>
        <span className="tabular-nums">
          活跃{' '}
          <strong className="font-semibold text-[var(--nx-text-primary)]">
            {overview.activeMembers}
          </strong>
        </span>
      </div>
      {overview.roleDistribution.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {overview.roleDistribution.map((slice) => (
            <span
              key={slice.key}
              className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
            >
              {slice.label} {slice.count}
            </span>
          ))}
        </div>
      ) : null}
      <SafeTargetLink
        target={overview.target}
        className="inline-flex items-center text-[11px] text-[var(--nx-accent)] hover:underline"
      >
        查看成员 →
      </SafeTargetLink>
    </div>
  )
}

/** 资源概览：forbidden → EyeOff + 中性文案（零数值）。 */
function ResourceOverviewSection({ overview }: { overview: OrganizationResourceOverview }) {
  if (overview.forbidden) {
    return <OrgOverviewRedactedNotice />
  }
  if (!overview.available) {
    return <p className="text-xs text-[var(--nx-text-muted)]">资源数据暂不可用</p>
  }
  return (
    <div data-org-resource-card className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap gap-3 text-xs text-[var(--nx-text-secondary)]">
        <span className="tabular-nums">
          已分配项目{' '}
          <strong className="font-semibold text-[var(--nx-text-primary)]">
            {overview.allocatedProjectCount}
          </strong>
        </span>
        <span className="tabular-nums">
          超载资源{' '}
          <strong className="font-semibold text-[var(--nx-text-primary)]">
            {overview.overloadedResourceCount}
          </strong>
        </span>
        {overview.totalAllocationPercent !== null ? (
          <span className="tabular-nums">
            总分配比例{' '}
            <strong className="font-semibold text-[var(--nx-text-primary)]">
              {overview.totalAllocationPercent}%
            </strong>
          </span>
        ) : null}
      </div>
      <SafeTargetLink
        target={overview.target}
        className="inline-flex items-center text-[11px] text-[var(--nx-accent)] hover:underline"
      >
        查看资源 →
      </SafeTargetLink>
    </div>
  )
}

/** 风险/延期提醒：受限计数（null + forbidden）→ EyeOff 中性呈现。 */
function RiskRemindersSection({ reminders }: { reminders: OrganizationRiskReminder[] }) {
  if (reminders.length === 0) {
    return <p className="text-xs text-[var(--nx-text-muted)]">暂无提醒</p>
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {reminders.map((reminder) => {
        const redacted = reminder.count === null
        return (
          <div
            key={reminder.code}
            data-org-reminder-card={reminder.code}
            className="flex min-w-0 flex-col gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5"
          >
            <span className="truncate text-[10px] text-[var(--nx-text-muted)]">
              {ORGANIZATION_REMINDER_LABELS[reminder.code] ?? reminder.label}
            </span>
            {redacted ? (
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]">
                <EyeOff className="h-3 w-3 shrink-0" aria-hidden />
                {ORG_OVERVIEW_REDACTED_TEXT}
              </span>
            ) : (
              <span className="text-lg font-semibold tabular-nums text-[var(--nx-text-primary)]">
                {reminder.count}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 近期活动流（低敏 envelope，仅展示授权 target）。 */
function ActivitySection({ items }: { items: OrganizationActivityItem[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-[var(--nx-text-muted)]">暂无可见活动</p>
  }
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <div
          key={item.id}
          data-org-activity-item={item.id}
          className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] pb-1.5 last:border-0 last:pb-0"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
              {item.entityType ?? '事件'}
            </span>
            <span className="min-w-0 truncate text-xs text-[var(--nx-text-secondary)]">
              {item.action}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--nx-text-muted)]">
            <span className="tabular-nums">{formatRelativeTime(item.occurredAt)}</span>
            <SafeTargetLink
              target={item.target}
              className="text-[var(--nx-accent)] hover:underline"
            >
              打开
            </SafeTargetLink>
          </div>
        </div>
      ))}
    </div>
  )
}

/** PMO/组织域入口：受限 → 中性；摘要与授权 target 只读呈现。 */
function PmoEntrySection({ entry }: { entry: OrganizationPmoEntry }) {
  if (entry.forbidden) {
    return <OrgOverviewRedactedNotice />
  }
  if (!entry.available || entry.summary === null) {
    return <p className="text-xs text-[var(--nx-text-muted)]">PMO 组合摘要暂不可用</p>
  }
  return (
    <div data-org-pmo-card className="flex min-w-0 flex-col gap-2">
      <dl className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
        <div className="flex justify-between gap-2">
          <dt>组合项目</dt>
          <dd className="tabular-nums text-[var(--nx-text-primary)]">
            {entry.summary.totalProjects ?? '--'}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>风险项目</dt>
          <dd className="tabular-nums text-[var(--nx-text-primary)]">
            {entry.summary.atRiskProjects ?? '--'}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>平均进度</dt>
          <dd className="tabular-nums text-[var(--nx-text-primary)]">
            {entry.summary.overallProgressAvg ?? '--'}%
          </dd>
        </div>
      </dl>
      <div className="flex flex-col gap-1">
        {entry.targets.map((target) => (
          <SafeTargetLink
            key={target.href}
            target={target}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--nx-accent)] hover:underline"
          >
            进入工作台 →
          </SafeTargetLink>
        ))}
      </div>
    </div>
  )
}

/**
 * 安全跳转：只渲染后端标记 `authorized === true` 的 target；
 * 未授权/缺失降级为纯文本，绝不自行拼接链接。
 */
function SafeTargetLink({
  target,
  className,
  children,
}: {
  target: OrganizationDashboardTarget | null
  className?: string
  children: React.ReactNode
}) {
  if (!target || !target.authorized) {
    return <span className={className}>{children}</span>
  }
  return (
    <Link href={target.href} className={cn('hover:underline', className)}>
      {children}
    </Link>
  )
}

export default OrgOverviewWorkspace
