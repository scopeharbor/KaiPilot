// apps/frontend/components/bi-aggregation/status-helpers.ts
// v3-bi-data-aggregation-service §7.3：freshness/warning/redaction 状态 helper。
// 供趋势、报表、Dashboard 或后续 BI 页面渲染 loading、empty、forbidden、
// redacted、stale、degraded、unsupported 和 error 状态。

import type {
  BiAggregationRedactionState,
  BiAggregationFreshnessState,
  BiAggregationWarning,
} from '@aiproj/types'

/**
 * BI 聚合渲染状态枚举。
 */
export type BiAggregationRenderState =
  | 'loading'
  | 'empty'
  | 'forbidden'
  | 'redacted'
  | 'stale'
  | 'degraded'
  | 'unsupported'
  | 'error'
  | 'success'

/**
 * 根据 redaction 和 freshness 状态确定 UI 渲染状态。
 */
export function getBiAggregationRenderState(params: {
  isLoading: boolean
  isError: boolean
  data?: {
    warnings?: BiAggregationWarning[]
    provenance?: { redaction: { state: BiAggregationRedactionState } }
  } | null
}): BiAggregationRenderState {
  if (params.isLoading) return 'loading'
  if (params.isError) return 'error'
  if (!params.data) return 'empty'

  const { warnings, provenance } = params.data

  // 检查 unsupported warnings
  if (warnings?.some((w) => w.code === 'UNSUPPORTED_METRIC' && w.level === 'blocking')) {
    return 'unsupported'
  }

  // 检查 source forbidden
  if (warnings?.some((w) => w.code === 'SOURCE_FORBIDDEN')) {
    return 'forbidden'
  }

  // 检查 redaction
  if (provenance?.redaction?.state === 'full') return 'redacted'

  // 检查 stale
  if (warnings?.some((w) => w.code === 'STALE_SOURCE')) return 'stale'

  // 检查 degraded
  if (warnings?.some((w) => w.code === 'CACHE_DEGRADED' || w.code === 'SOURCE_UNAVAILABLE')) {
    return 'degraded'
  }

  return 'success'
}

/**
 * 获取 freshness badge 中文文本。
 */
export function getBiAggregationFreshnessLabel(state: BiAggregationFreshnessState): string {
  switch (state) {
    case 'fresh':
      return '实时'
    case 'stale':
      return '已过期'
    case 'unavailable':
      return '不可用'
    case 'degraded':
      return '降级'
    case 'unknown':
      return '未知'
    default:
      return '未知'
  }
}

/**
 * 获取 freshness badge 颜色。
 */
export function getBiAggregationFreshnessColor(state: BiAggregationFreshnessState): string {
  switch (state) {
    case 'fresh':
      return '#22c55e' // green
    case 'stale':
      return '#f59e0b' // amber
    case 'unavailable':
      return '#ef4444' // red
    case 'degraded':
      return '#f59e0b' // amber
    case 'unknown':
      return '#9ca3af' // gray
    default:
      return '#9ca3af'
  }
}

/**
 * 获取 warning 中文摘要。
 */
export function getBiAggregationWarningSummary(warnings: BiAggregationWarning[]): string {
  if (warnings.length === 0) return ''
  const codes = warnings.map((w) => w.code)
  const uniq = [...new Set(codes)]
  const labels: Record<string, string> = {
    STALE_SOURCE: '部分来源已过期',
    SOURCE_UNAVAILABLE: '部分来源不可用',
    SOURCE_FORBIDDEN: '部分来源权限不足',
    SOURCE_TIMEOUT: '部分来源超时',
    CACHE_DEGRADED: '缓存降级',
    UNSUPPORTED_METRIC: '不支持的指标',
    INSUFFICIENT_SAMPLE: '样本不足',
    MISSING_BUCKET: '缺少时间桶',
    PARTIAL_REDACTION: '部分数据已脱敏',
    TRUNCATED_RESULT: '结果已截断',
  }
  return uniq.map((c) => labels[c] ?? c).join('；')
}

/**
 * 过滤不安全的 drill-down 链接。
 */
export function filterAuthorizedBiAggregationLinks(
  evidence: Array<{ authorized: boolean; targetType: string; refId: string }>,
): Array<{ targetType: string; refId: string }> {
  return evidence
    .filter((e) => e.authorized && e.refId)
    .map((e) => ({ targetType: e.targetType, refId: e.refId }))
}
