/**
 * v3-frontend-ai-usage-telemetry —— 事件保留期声明。
 *
 * 事件需要保留期，实现归 v3-observability-data-retention。
 */

/**
 * 前端 AI 使用事件保留期配置。
 *
 * 保留期策略：
 * - 事件默认保留 90 天
 * - 聚合数据保留 1 年
 * - 超过保留期的事件将被自动清理
 *
 * 注意：实际实现归 v3-observability-data-retention change。
 * 本文件仅声明保留期配置，不实现清理逻辑。
 */
export const FRONTEND_TELEMETRY_RETENTION_CONFIG = {
  /** 事件保留期（天）。 */
  eventRetentionDays: 90,

  /** 聚合数据保留期（天）。 */
  aggregationRetentionDays: 365,

  /** 清理任务执行频率（小时）。 */
  cleanupFrequencyHours: 24,
}

/**
 * 获取事件保留期配置。
 */
export function getRetentionConfig() {
  return FRONTEND_TELEMETRY_RETENTION_CONFIG
}

/**
 * 计算事件过期时间。
 *
 * @param createdAt - 事件创建时间
 * @returns 过期时间
 */
export function getEventExpirationDate(createdAt: Date): Date {
  const expirationDate = new Date(createdAt)
  expirationDate.setDate(
    expirationDate.getDate() + FRONTEND_TELEMETRY_RETENTION_CONFIG.eventRetentionDays,
  )
  return expirationDate
}

/**
 * 计算聚合数据过期时间。
 *
 * @param createdAt - 聚合数据创建时间
 * @returns 过期时间
 */
export function getAggregationExpirationDate(createdAt: Date): Date {
  const expirationDate = new Date(createdAt)
  expirationDate.setDate(
    expirationDate.getDate() + FRONTEND_TELEMETRY_RETENTION_CONFIG.aggregationRetentionDays,
  )
  return expirationDate
}
