// OKR Dashboard 展示层工具（v3-okr-dashboard §5.5–5.6）。
//
// 与 `packages/types/src/okr-dashboard.ts` 的共享契约配合：
//   - 只做纯展示层派生（label / 单位 / 相对时间 / stale 分类等）
//   - 不发请求、不写库、不修改 summary；权限判定留给后端 policy + 页面组件
//   - 中文文案在此单例化，方便测试与文案审查

import type {
  OkrDashboardAttentionReason,
  OkrDashboardMetric,
  OkrDashboardMetricKey,
  OkrDashboardSourceFreshness,
  OkrDashboardSummary,
  OkrDashboardWarning,
  OkrDashboardWarningCode,
  OkrStatus,
} from '@aiproj/types'
import {
  OKR_DASHBOARD_METRIC_KEYS,
  OKR_DASHBOARD_STATUSES,
  OKR_DASHBOARD_WARNING_CODES,
} from '@aiproj/types'

// ─── 指标中文标签（保持稳定，V3 不用国际化） ─────────────────────────────────

export const OKR_METRIC_LABELS: Record<OkrDashboardMetricKey, string> = {
  okr_total_objectives: '目标总数',
  okr_active_objectives: '进行中的目标',
  okr_completed_objectives: '已完成目标',
  okr_at_risk_objectives: '风险目标',
  okr_behind_objectives: '进度落后目标',
  okr_total_key_results: '关键结果总数',
  okr_behind_key_results: '进度落后关键结果',
  okr_stale_key_results: '新鲜度过期关键结果',
  okr_missing_evidence_key_results: '缺证据关键结果',
  okr_overall_progress_avg: '平均进度',
  okr_confidence_avg: '平均信心分',
  okr_alignment_health_score: '对齐健康度',
  okr_orphan_objective_count: '孤立目标',
  okr_weak_alignment_count: '弱对齐',
  okr_stale_evidence_count: '过期证据',
  okr_recent_progress_count: '最近进度事件',
  okr_backflow_candidate_count: '回流候选',
  okr_backflow_conflict_count: '回流冲突',
}

// ─── Warning code 中文文案 ───────────────────────────────────────────────────

export const OKR_WARNING_LABELS: Record<OkrDashboardWarningCode, string> = {
  EMPTY_OKR_DASHBOARD: '当前周期内暂无可见目标',
  PERMISSION_REDACTED: '部分指标因权限被脱敏',
  SOURCE_STALE: '数据来源已过期',
  SOURCE_PARTIAL: '数据来源仅返回部分结果',
  SOURCE_UNAVAILABLE: '数据来源不可用',
  BACKFLOW_SUMMARY_UNAVAILABLE: '进度回流摘要暂不可用',
  BACKFLOW_SUMMARY_FORBIDDEN: '当前角色无进度回流查看权限',
  RESTRICTED_EVIDENCE: '存在受限证据未展示',
  ATTENTION_TRUNCATED: '关注项已按上限截断',
  ORPHAN_OBJECTIVE: '存在孤立目标（未挂载对齐关系）',
  WEAK_ALIGNMENT: '存在弱对齐关系',
  DISABLED_SCOPE_REFERENCED: '有指向已禁用范围的对齐',
  CACHE_DEGRADED: '缓存降级读取',
}

// ─── Attention reason 中文文案 ───────────────────────────────────────────────

export const OKR_ATTENTION_REASON_LABELS: Record<OkrDashboardAttentionReason, string> = {
  behind_target: '进度落后目标',
  stale_evidence: '证据过期',
  missing_key_results: '缺少关键结果',
  weak_alignment: '弱对齐',
  blocked_progress: '进度受阻',
  low_confidence: '信心不足',
  backflow_unavailable: '回流不可用',
}

// ─── OKR 周期状态标签 ────────────────────────────────────────────────────────

export const OKR_STATUS_LABELS: Record<OkrStatus, string> = {
  draft: '草稿',
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
}

// ─── 状态判定 ────────────────────────────────────────────────────────────────

/** 指标是否因权限或来源被隐藏。 */
export function isMetricRedacted(metric: OkrDashboardMetric): boolean {
  return (
    metric.value === null ||
    metric.status === OKR_DASHBOARD_STATUSES.FORBIDDEN ||
    metric.status === OKR_DASHBOARD_STATUSES.UNAVAILABLE
  )
}

/** 空态判定：可见目标与 KR 数量均为 0。 */
export function isEmptyOkrDashboard(summary: OkrDashboardSummary | undefined): boolean {
  if (!summary) return false
  return summary.meta.visibleObjectiveCount === 0 && summary.meta.visibleKeyResultCount === 0
}

/** 是否存在过期来源。 */
export function hasStaleSource(summary: OkrDashboardSummary | undefined): boolean {
  if (!summary) return false
  return summary.sourceFreshness.some((f) => f.isStale)
}

/** 过滤出被判定为 stale 的来源，供 UI 展示。 */
export function staleSources(
  summary: OkrDashboardSummary | undefined,
): OkrDashboardSourceFreshness[] {
  if (!summary) return []
  return summary.sourceFreshness.filter((f) => f.isStale)
}

// ─── KPI 条 ──────────────────────────────────────────────────────────────────

/**
 * 顶部 KPI 条固定顺序，只取白名单里的 KPI 指标。
 * 语义对齐 §5.5：一屏内先扫「多少活跃 / 多少风险 / 多少落后 / 综合进度」。
 */
export const OKR_DASHBOARD_KPI_ORDER: readonly OkrDashboardMetricKey[] = [
  OKR_DASHBOARD_METRIC_KEYS.ACTIVE_OBJECTIVES,
  OKR_DASHBOARD_METRIC_KEYS.AT_RISK_OBJECTIVES,
  OKR_DASHBOARD_METRIC_KEYS.BEHIND_KEY_RESULTS,
  OKR_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
]

export function selectOkrKpiStrip(summary: OkrDashboardSummary | undefined): OkrDashboardMetric[] {
  if (!summary) return []
  const byKey = new Map(summary.kpis.map((m) => [m.key, m]))
  const out: OkrDashboardMetric[] = []
  for (const key of OKR_DASHBOARD_KPI_ORDER) {
    const metric = byKey.get(key)
    if (metric) out.push(metric)
  }
  return out
}

// ─── Formatters ──────────────────────────────────────────────────────────────

export function formatOkrMetricValue(metric: OkrDashboardMetric): string {
  if (metric.value === null) return '--'
  switch (metric.unit) {
    case 'percent':
      return `${Math.round(metric.value)}%`
    case 'score':
      return metric.value.toFixed(1)
    case 'avg':
      return metric.value.toFixed(1)
    case 'count':
      return String(metric.value)
    default:
      return String(metric.value)
  }
}

export function formatOkrWarning(warning: OkrDashboardWarning): string {
  return OKR_WARNING_LABELS[warning.code] ?? warning.message
}

/** ISO 时间 → 中文相对时间；`null` 回落到 “未知”。 */
export function formatRelativeTime(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return '未知'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '未知'
  const diff = nowMs - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))} 小时前`
  return `${Math.floor(diff / (24 * 60 * 60_000))} 天前`
}

// ─── Backflow 状态推导 ───────────────────────────────────────────────────────

export type BackflowUiState = 'available' | 'forbidden' | 'unavailable'

export function resolveBackflowState(summary: OkrDashboardSummary | undefined): BackflowUiState {
  if (!summary) return 'unavailable'
  const bf = summary.backflow
  if (bf.forbidden) return 'forbidden'
  if (!bf.available) return 'unavailable'
  return 'available'
}

// ─── 综合状态派生 ─────────────────────────────────────────────────────────────

export type OkrDashboardUiStatus = 'loading' | 'error' | 'forbidden' | 'empty' | 'stale' | 'ok'

export function deriveOkrDashboardUiStatus(input: {
  isLoading: boolean
  error: unknown
  summary: OkrDashboardSummary | undefined
  actorCanView: boolean
}): OkrDashboardUiStatus {
  if (!input.actorCanView) return 'forbidden'
  if (input.isLoading) return 'loading'
  if (input.error) {
    const status = (input.error as { status?: number } | null)?.status
    if (status === 403) return 'forbidden'
    return 'error'
  }
  if (!input.summary) return 'error'
  if (isEmptyOkrDashboard(input.summary)) return 'empty'
  if (
    hasStaleSource(input.summary) ||
    input.summary.warnings.some((w) => w.code === OKR_DASHBOARD_WARNING_CODES.SOURCE_STALE)
  ) {
    return 'stale'
  }
  return 'ok'
}
