import type { DashboardMetric, DashboardMetricKey, DashboardWarning } from '@aiproj/types'

/** 从 metrics 数组中按 key 查找指标，未找到时返回 null。 */
export function getMetric(
  metrics: DashboardMetric[] | undefined,
  key: DashboardMetricKey,
): DashboardMetric | null {
  return metrics?.find((m) => m.key === key) ?? null
}

/** 从 warnings 数组中筛选指定 code。 */
export function getWarningsByCode(
  warnings: DashboardWarning[] | undefined,
  code: string,
): DashboardWarning[] {
  return warnings?.filter((w) => w.code === code) ?? []
}
