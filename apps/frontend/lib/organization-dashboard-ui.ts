import {
  ORGANIZATION_ATTENTION_REASONS,
  ORGANIZATION_DASHBOARD_METRIC_KEYS,
  ORGANIZATION_DASHBOARD_SOURCES,
  ORGANIZATION_DASHBOARD_STATUSES,
  ORGANIZATION_DASHBOARD_WARNING_CODES,
  ORGANIZATION_REMINDER_CODES,
  type OrganizationAttentionReason,
  type OrganizationDashboardMetric,
  type OrganizationDashboardSource,
  type OrganizationDashboardSummary,
  type OrganizationDashboardWarning,
} from '@aiproj/types'

/**
 * 组织 Dashboard 展示层辅助（v3-organization-dashboard §5）。
 *
 * 纯展示映射与格式化，不做任何业务判定：所有口径、脱敏与降级均由后端下发，
 * 前端只负责把稳定 key 翻译成简体中文文案。
 */

// ─── 文案映射 ──────────────────────────────────────────────────────────────────

export const ORGANIZATION_METRIC_LABELS: Record<string, string> = {
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS]: '项目总数',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS]: '进行中',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.ON_HOLD_PROJECTS]: '暂停',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.COMPLETED_PROJECTS]: '已完成',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.ARCHIVED_PROJECTS]: '已归档',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.ATTENTION_PROJECTS]: '待关注',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERDUE_PROJECTS]: '已延期',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.DUE_SOON_PROJECTS]: '临近截止',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG]: '平均进度',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.MEMBER_TOTAL]: '成员总数',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_MEMBER_TOTAL]: '活跃成员',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.RESOURCE_ALLOCATED_PROJECTS]: '已分配资源项目',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.RESOURCE_OVERLOAD_COUNT]: '资源超载',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.OPEN_RISK_COUNT]: '未关闭风险',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT]: '高风险',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.RECENT_ACTIVITY_COUNT]: '近期活动',
  [ORGANIZATION_DASHBOARD_METRIC_KEYS.STALE_SOURCE_COUNT]: '过期数据源',
}

export const ORGANIZATION_WARNING_LABELS: Record<string, string> = {
  [ORGANIZATION_DASHBOARD_WARNING_CODES.EMPTY_ORGANIZATION_DASHBOARD]: '组织暂无可见项目',
  [ORGANIZATION_DASHBOARD_WARNING_CODES.PMO_SUMMARY_FORBIDDEN]: 'PMO 摘要无查看权限',
  [ORGANIZATION_DASHBOARD_WARNING_CODES.PMO_SUMMARY_UNAVAILABLE]: 'PMO 摘要暂不可用',
  [ORGANIZATION_DASHBOARD_WARNING_CODES.PERMISSION_REDACTED]: '部分维度因权限已脱敏',
  [ORGANIZATION_DASHBOARD_WARNING_CODES.SOURCE_STALE]: '数据源已过期',
  [ORGANIZATION_DASHBOARD_WARNING_CODES.SOURCE_PARTIAL]: '仅返回采样结果',
  [ORGANIZATION_DASHBOARD_WARNING_CODES.SOURCE_UNAVAILABLE]: '数据源不可用',
  [ORGANIZATION_DASHBOARD_WARNING_CODES.FINANCIAL_UNSUPPORTED]: '财务指标不在当前范围',
  [ORGANIZATION_DASHBOARD_WARNING_CODES.CACHE_DEGRADED]: '缓存不可用，已直连读取',
}

export const ORGANIZATION_SOURCE_LABELS: Record<OrganizationDashboardSource, string> = {
  [ORGANIZATION_DASHBOARD_SOURCES.ORGANIZATION]: '组织',
  [ORGANIZATION_DASHBOARD_SOURCES.PROJECT]: '项目',
  [ORGANIZATION_DASHBOARD_SOURCES.PROJECT_DASHBOARD]: '项目仪表盘',
  [ORGANIZATION_DASHBOARD_SOURCES.MEMBERSHIP]: '组织成员',
  [ORGANIZATION_DASHBOARD_SOURCES.RESOURCE_SUMMARY]: '资源',
  [ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY]: '风险',
  [ORGANIZATION_DASHBOARD_SOURCES.ACTIVITY_LOG]: '活动日志',
  [ORGANIZATION_DASHBOARD_SOURCES.PMO_PORTFOLIO]: 'PMO 组合',
  [ORGANIZATION_DASHBOARD_SOURCES.COMPUTED]: '实时计算',
}

export const ORGANIZATION_ATTENTION_REASON_LABELS: Record<OrganizationAttentionReason, string> = {
  [ORGANIZATION_ATTENTION_REASONS.HEALTH_CRITICAL]: '健康度严重',
  [ORGANIZATION_ATTENTION_REASONS.HEALTH_AT_RISK]: '健康度风险',
  [ORGANIZATION_ATTENTION_REASONS.OVERDUE]: '已延期',
  [ORGANIZATION_ATTENTION_REASONS.DUE_SOON]: '临近截止',
  [ORGANIZATION_ATTENTION_REASONS.ON_HOLD]: '已暂停',
  [ORGANIZATION_ATTENTION_REASONS.NO_PROGRESS]: '零进度',
}

export const ORGANIZATION_REMINDER_LABELS: Record<string, string> = {
  [ORGANIZATION_REMINDER_CODES.HIGH_RISK]: '高风险',
  [ORGANIZATION_REMINDER_CODES.OPEN_RISK]: '未关闭风险',
  [ORGANIZATION_REMINDER_CODES.OVERDUE_PROJECT]: '已延期项目',
  [ORGANIZATION_REMINDER_CODES.DUE_SOON_PROJECT]: '临近截止项目',
}

export const ORGANIZATION_PROJECT_STATUS_LABELS: Record<string, string> = {
  planning: '规划中',
  active: '进行中',
  on_hold: '暂停',
  completed: '已完成',
  archived: '已归档',
}

export const ORGANIZATION_HEALTH_LABELS: Record<string, string> = {
  healthy: '健康',
  at_risk: '风险',
  critical: '严重',
  unknown: '未知',
}

// ─── 格式化 ────────────────────────────────────────────────────────────────────

/** 指标值格式化。`null`（脱敏/不可用）统一显示为 `--`，绝不显示 0 冒充真值。 */
export function formatOrganizationMetricValue(metric: OrganizationDashboardMetric): string {
  if (metric.value === null) return '--'
  if (metric.unit === 'percent') return `${metric.value}%`
  return String(metric.value)
}

/** 指标是否因权限被脱敏。 */
export function isMetricRedacted(metric: OrganizationDashboardMetric): boolean {
  return metric.status === ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN || metric.value === null
}

/** warning 文案（未知 code 回落到原始 message，避免展示空白）。 */
export function formatOrganizationWarning(warning: OrganizationDashboardWarning): string {
  return ORGANIZATION_WARNING_LABELS[warning.code] ?? warning.message
}

/** 相对时间（简体中文，秒级以下按「刚刚」）。 */
export function formatRelativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '未知'
  const timestamp = new Date(iso).getTime()
  if (!Number.isFinite(timestamp)) return '未知'
  const diffMinutes = Math.floor((now - timestamp) / 60000)
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  return `${Math.floor(diffHours / 24)} 天前`
}

/** 首屏 KPI 条展示顺序——保证不同权限下位置稳定，不因脱敏而跳动。 */
export const ORGANIZATION_KPI_STRIP_ORDER: string[] = [
  ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
  ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS,
  ORGANIZATION_DASHBOARD_METRIC_KEYS.ATTENTION_PROJECTS,
  ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERDUE_PROJECTS,
  ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
  ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT,
]

/** 按固定顺序挑出首屏 KPI，缺失的 key 自动跳过。 */
export function selectKpiStrip(
  summary: OrganizationDashboardSummary | undefined,
): OrganizationDashboardMetric[] {
  if (!summary) return []
  return ORGANIZATION_KPI_STRIP_ORDER.map((key) =>
    summary.kpis.find((metric) => metric.key === key),
  ).filter((metric): metric is OrganizationDashboardMetric => Boolean(metric))
}

/** 是否为空组织（后端已显式标记，前端不自行推断）。 */
export function isEmptyOrganizationDashboard(
  summary: OrganizationDashboardSummary | undefined,
): boolean {
  if (!summary) return false
  return summary.warnings.some(
    (warning) => warning.code === ORGANIZATION_DASHBOARD_WARNING_CODES.EMPTY_ORGANIZATION_DASHBOARD,
  )
}

/** 过期来源列表——首屏 freshness badge 用。 */
export function staleSources(summary: OrganizationDashboardSummary | undefined) {
  return (summary?.sourceFreshness ?? []).filter((item) => item.isStale)
}
