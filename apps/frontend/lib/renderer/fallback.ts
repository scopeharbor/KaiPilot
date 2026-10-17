/**
 * fallback —— 安全 fallback 层级（§4.5 P0）。
 *
 * 优先级：最后有效配置 > 系统默认 Dashboard/List > 本地化可恢复错误状态
 *
 * 确保 renderer 不会导致空白页或无限重定向。
 */
import type { FallbackState, FallbackLevel } from '@aiproj/types'

// ─── Fallback 中文消息 ───────────────────────────────
export const FALLBACK_MESSAGES: Record<string, string> = {
  SCHEMA_VALIDATION_ERROR: '视图配置格式有误，已恢复为系统默认视图',
  MIGRATION_FAILED: '视图配置版本过旧且无法自动升级，已恢复为系统默认视图',
  MIGRATION_RESULT_INVALID: '视图配置升级后格式不正确，已恢复为系统默认视图',
  COMPONENT_NOT_FOUND: '视图组件暂不可用，已切换为系统默认视图',
  ADAPTER_FAILED: '视图数据解析异常，已恢复为安全视图',
  PERMISSION_DENIED: '当前用户权限不足以查看此视图，已切换为默认视图',
  UNSUPPORTED_VIEW: '此视图类型尚未支持，将使用系统默认仪表盘',
  DEFAULT_VIEW_NOT_FOUND: '默认视图配置无效，将使用系统默认视图',
  UNKNOWN: '视图加载异常，已恢复为系统默认状态',
  NETWORK_ERROR: '网络异常，视图数据加载失败',
}

/**
 * 生成 fallback 状态。
 */
export function createFallback(
  level: FallbackLevel,
  reason: string,
  originalConfigRef?: string,
): FallbackState {
  return {
    level,
    reason,
    message:
      FALLBACK_MESSAGES[reason] ??
      FALLBACK_MESSAGES.UNKNOWN ??
      '视图加载异常，已恢复为系统默认状态',
    originalConfigRef,
  }
}

/**
 * 根据异常生成 fallback。
 */
export function fallbackFromError(
  err: Error,
  level: FallbackLevel = 'system_default',
): FallbackState {
  return createFallback(level, err.name || 'UNKNOWN')
}

/**
 * 获取系统默认 Dashboard 配置的简化标识。
 */
export function getSystemDefaultDashboardRef(): string {
  return 'system:default:dashboard'
}

/**
 * 获取系统默认 List 配置的简化标识。
 */
export function getSystemDefaultListRef(): string {
  return 'system:default:list'
}
