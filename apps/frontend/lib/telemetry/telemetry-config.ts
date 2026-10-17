/**
 * v3-frontend-ai-usage-telemetry —— 埋点配置。
 *
 * 组织级默认值可配置，个人选择优先于组织默认值。
 */

/** 组织级默认埋点状态（默认启用）。 */
const ORGANIZATION_DEFAULT_KEY = 'aiproj-telemetry-org-default'

/**
 * 获取组织级默认埋点状态。
 * 默认为 true（启用）。
 */
export function getOrganizationTelemetryDefault(): boolean {
  if (typeof window === 'undefined') return true
  const stored = localStorage.getItem(ORGANIZATION_DEFAULT_KEY)
  if (stored === null) return true
  return stored === 'true'
}

/**
 * 设置组织级默认埋点状态。
 */
export function setOrganizationTelemetryDefault(enabled: boolean): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(ORGANIZATION_DEFAULT_KEY, String(enabled))
}

/**
 * 解析最终的埋点开关状态。
 * 个人选择优先于组织默认值。
 *
 * @param personalChoice - 个人选择（null 表示未显式选择）
 * @param orgDefault - 组织默认值（默认 true）
 * @returns 最终的埋点开关状态
 */
export function resolveTelemetryEnabled(
  personalChoice: boolean | null,
  orgDefault: boolean = getOrganizationTelemetryDefault(),
): boolean {
  // 个人选择优先
  if (personalChoice !== null) {
    return personalChoice
  }
  // 回退到组织默认值
  return orgDefault
}
