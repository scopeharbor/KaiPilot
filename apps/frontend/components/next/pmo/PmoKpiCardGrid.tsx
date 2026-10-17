'use client'

import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Circle,
  Clock,
  Gauge,
  ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PortfolioDashboardMetric, PortfolioDashboardMetricKey } from '@aiproj/types'

/**
 * 组合 KPI 统计卡（/next/pmo，v3-ui-next-pmo-domain W1 · tasks 1.3，
 * spec「PMO 组合仪表盘新轨主页与组织层信息架构 · 组合态势呈现」）。
 *
 * - 纯展示层：kpis 由 PmoPortfolioOverviewWorkspace 从
 *   `usePortfolioSummary({ includeTrafficLight, includeFreshness })` 下推，
 *   本组件零网络（RL-04 同源缓存，避免平行订阅二次取数）；
 * - KPI key → 中文标签映射与旧页一致（含 traffic_light_*_count）；
 *   `unit='percent'` 拼 %；`value === null` 显示 —；`forbidden` 项降透明
 *   并在告警行回显服务端脱敏文案（状态文字/图标双通道，RL-15）；
 * - 每卡同时输出图标色阶 + 语义文案，不单靠颜色传达健康/风险档位。
 */
export interface PmoKpiCardGridProps {
  kpis: PortfolioDashboardMetric[]
}

export function PmoKpiCardGrid({ kpis }: PmoKpiCardGridProps) {
  if (kpis.length === 0) {
    return (
      <div
        data-pmo-kpi-empty
        className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-8 text-center text-xs text-[var(--nx-text-muted)]"
      >
        当前没有可见的组合指标
      </div>
    )
  }
  return (
    <section
      data-pmo-kpi-grid
      aria-label="组合关键指标"
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4"
    >
      {kpis.map((kpi) => (
        <PmoKpiCard key={kpi.key} kpi={kpi} />
      ))}
    </section>
  )
}

function PmoKpiCard({ kpi }: { kpi: PortfolioDashboardMetric }) {
  const forbidden = kpi.status === 'forbidden'
  const tone = kpiTone(kpi.key)
  return (
    <div data-pmo-kpi={kpi.key} className={cnForbidden(forbidden)}>
      <div className="flex items-center gap-2">
        <span data-pmo-kpi-icon className={toneClass(tone)}>
          {kpiIcon(kpi.key)}
        </span>
        <span className="truncate text-xs text-[var(--nx-text-secondary)]">
          {kpiLabel(kpi.key)}
        </span>
        {forbidden ? (
          <span
            data-pmo-kpi-forbidden
            className="shrink-0 rounded border border-[var(--nx-border-hairline)] px-1 py-px text-[9px] leading-none text-[var(--nx-text-muted)]"
          >
            受限
          </span>
        ) : null}
      </div>
      <div
        data-pmo-kpi-value
        className={cn(
          'mt-1.5 font-mono text-2xl font-semibold leading-none',
          forbidden
            ? 'text-[var(--nx-text-muted)]'
            : tone === 'danger'
              ? 'text-[var(--nx-status-danger)]'
              : tone === 'warning'
                ? 'text-[var(--nx-status-warning)]'
                : 'text-[var(--nx-text-primary)]',
        )}
      >
        {formatKpiValue(kpi)}
      </div>
      {kpi.warnings && kpi.warnings.length > 0 ? (
        <p
          data-pmo-kpi-warning
          className="mt-2 flex items-start gap-1 text-[10px] leading-relaxed text-[var(--nx-text-muted)]"
        >
          <AlertTriangle
            className="mt-px h-3 w-3 shrink-0 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          <span>{kpi.warnings[0]?.message ?? '数据不可用'}</span>
        </p>
      ) : null}
    </div>
  )
}

function cnForbidden(forbidden: boolean): string {
  return [
    'flex flex-col rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3',
    forbidden ? 'opacity-45' : '',
  ].join(' ')
}

/** KPI 档位色阶（双通道第一通道：图标/数值色，第二通道：文字标签本身）。 */
type KpiTone = 'neutral' | 'success' | 'warning' | 'danger'

const KPI_DANGER_KEYS = new Set<PortfolioDashboardMetricKey>([
  'at_risk_projects',
  'blocked_projects',
  'health_red_percent',
  'risk_high_percent',
  'risk_critical_count',
  'prediction_high_severity_percent',
  'overdue_project_percent',
  'overdue_task_percent',
  'resource_overload_percent',
  'traffic_light_red_count',
  'source_freshness_stale_percent',
  'metric_unavailable_count',
])

const KPI_SUCCESS_KEYS = new Set<PortfolioDashboardMetricKey>([
  'delivery_on_track_percent',
  'health_green_percent',
  'active_projects',
  'traffic_light_green_count',
])

function kpiTone(key: PortfolioDashboardMetricKey): KpiTone {
  if (KPI_DANGER_KEYS.has(key)) return 'danger'
  if (KPI_SUCCESS_KEYS.has(key)) return 'success'
  return 'neutral'
}

function toneClass(tone: KpiTone): string {
  switch (tone) {
    case 'danger':
      return 'text-[var(--nx-status-danger)]'
    case 'warning':
      return 'text-[var(--nx-status-warning)]'
    case 'success':
      return 'text-[var(--nx-status-success)]'
    default:
      return 'text-[var(--nx-text-secondary)]'
  }
}

function kpiIcon(key: PortfolioDashboardMetricKey) {
  if (key === 'at_risk_projects' || key === 'risk_high_percent' || key === 'risk_critical_count') {
    return <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
  }
  if (key === 'blocked_projects') {
    return <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
  }
  if (key === 'active_projects') {
    return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
  }
  if (key === 'overall_progress_avg' || key === 'delivery_on_track_percent') {
    return <Clock className="h-3.5 w-3.5" aria-hidden />
  }
  if (key === 'archived_projects') {
    return <Circle className="h-3.5 w-3.5" aria-hidden />
  }
  if (
    key === 'health_red_percent' ||
    key === 'health_yellow_percent' ||
    key === 'health_green_percent'
  ) {
    return <Activity className="h-3.5 w-3.5" aria-hidden />
  }
  if (key === 'source_freshness_stale_percent' || key === 'metric_unavailable_count') {
    return <Gauge className="h-3.5 w-3.5" aria-hidden />
  }
  if (key.startsWith('traffic_light_')) {
    return <Gauge className="h-3.5 w-3.5" aria-hidden />
  }
  return <Building2 className="h-3.5 w-3.5" aria-hidden />
}

/** 指标值格式化：percent 拼 %；null/非有限数显示 —。 */
export function formatKpiValue(kpi: PortfolioDashboardMetric): string {
  if (kpi.value === null || kpi.value === undefined || !Number.isFinite(kpi.value)) return '—'
  return kpi.unit === 'percent' ? `${kpi.value}%` : String(kpi.value)
}

/** 指标键 → 中文标签（与旧 /pmo 仪表盘语义一致，未知键回落原始 key）。 */
export function kpiLabel(key: string): string {
  const labels: Record<string, string> = {
    total_projects: '项目总数',
    active_projects: '活跃项目',
    archived_projects: '已归档',
    at_risk_projects: '风险项目',
    blocked_projects: '暂停项目',
    delivery_on_track_percent: '按期交付',
    overall_progress_avg: '平均进度',
    overdue_project_percent: '延期项目',
    overdue_task_percent: '延期任务',
    health_red_percent: '健康红色',
    health_yellow_percent: '健康黄色',
    health_green_percent: '健康绿色',
    risk_high_percent: '高风险',
    risk_critical_count: '严重风险',
    resource_overload_percent: '资源超载',
    prediction_high_severity_percent: '预测高压',
    source_freshness_stale_percent: '数据过期',
    metric_unavailable_count: '不可用指标',
    traffic_light_red_count: '红灯',
    traffic_light_yellow_count: '黄灯',
    traffic_light_green_count: '绿灯',
    traffic_light_gray_count: '灰灯',
  }
  return labels[key] ?? key
}

export default PmoKpiCardGrid
