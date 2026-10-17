/**
 * plugin-install-lifecycle —— V3 组织内插件安装生命周期共享契约
 * （纯类型 + 常量 + 确定性状态机 + digest/binding 校验 + 类型守卫 + 低敏 sanitization，
 * 零运行时依赖，零网络/IO/时间/随机数依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块（同 @aiproj/types 其他模块）。
 * 测试见 `plugin-install-lifecycle.test.ts`，fixtures 见 `plugin-install-lifecycle-fixtures.ts`。
 *
 * # 语义要点（对应 design.md D1~D3 与 specs/plugin-install-lifecycle/spec.md）
 * - 安装态按组织严格隔离（organization_id 强过滤）。
 * - 确定性状态机：installed（未启用）/ enabled（已启用）/ uninstalled（已卸载）。
 * - 合法转移：installed -> enabled / enabled -> installed(disable) / installed -> uninstalled / enabled -> uninstalled。
 * - 启用必须在同一事务内显式确认权限清单摘要并记录审计。
 * - 卸载不删除宿主资源（如 Skill 条目），仅存句柄与低敏审计。
 * - 预览-确认两步边界，确认必须绑定预览摘要。
 */

import type { PluginCompatibilityReasonCode } from './plugin-compatibility-matrix.js'

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** 安装态枚举（封闭集）。 */
export const PLUGIN_INSTALLATION_STATUSES = ['installed', 'enabled', 'uninstalled'] as const
export type PluginInstallationStatus = (typeof PLUGIN_INSTALLATION_STATUSES)[number]

/** 转移动作枚举。 */
export const PLUGIN_INSTALL_ACTIONS = [
  'install',
  'enable',
  'disable',
  'uninstall',
  'upgrade',
] as const
export type PluginInstallAction = (typeof PLUGIN_INSTALL_ACTIONS)[number]

/** 状态转移表（D1/spec Requirement 1：确定性状态机）。 */
export const PLUGIN_INSTALL_TRANSITIONS: Record<
  PluginInstallationStatus,
  readonly PluginInstallationStatus[]
> = {
  installed: ['enabled', 'uninstalled', 'installed'], // installed -> installed 为同态升级
  enabled: ['installed', 'uninstalled', 'enabled'], // enabled -> installed 为停用；enabled -> enabled 为升级
  uninstalled: [], // terminal 终态，不允许再次转移
}

/** 错误码（稳定、非泄露）。 */
export const PLUGIN_INSTALL_ERROR_CODES = [
  // 状态机与转移
  'plugin-install-illegal-transition',
  'plugin-install-not-found',
  'plugin-install-already-exists',
  'plugin-install-already-uninstalled',
  // 来源与完整性
  'plugin-install-release-not-approved',
  'plugin-install-release-withdrawn',
  'plugin-install-digest-mismatch',
  'plugin-install-source-incompatible',
  // 权限与确认
  'plugin-install-permission-unconfirmed',
  'plugin-install-permission-digest-mismatch',
  // 预览与确认
  'plugin-install-preview-digest-mismatch',
  'plugin-install-preview-expired',
  'plugin-install-preview-stale',
  'plugin-install-preview-action-mismatch',
  'plugin-install-preview-target-mismatch',
  // 多租户与权限
  'plugin-install-cross-org',
  'plugin-install-permission-denied',
  // 负载与接缝校验
  'plugin-install-payload-invalid',
  'plugin-install-seam-validation-failed',
  'plugin-install-secret-rejected',
  'plugin-install-parallel-recreation-blocked',
  // 通用
  'plugin-install-tool-error',
  'plugin-install-network-forbidden',
] as const
export type PluginInstallErrorCode = (typeof PLUGIN_INSTALL_ERROR_CODES)[number]

/** RBAC 权限码。 */
export const PLUGIN_INSTALL_PERMISSIONS = ['plugin_install:view', 'plugin_install:manage'] as const
export type PluginInstallPermission = (typeof PLUGIN_INSTALL_PERMISSIONS)[number]

/** 低敏审计动作码。 */
export const PLUGIN_INSTALL_AUDIT_ACTIONS = [
  'plugin_installed',
  'plugin_enabled',
  'plugin_disabled',
  'plugin_uninstalled',
  'plugin_upgraded',
] as const
export type PluginInstallAuditAction = (typeof PLUGIN_INSTALL_AUDIT_ACTIONS)[number]

// =============================================================================
// 2. 核心类型与 DTO
// =============================================================================

/** 权限确认摘要（记录于安装记录与审计，D3）。 */
export interface PluginPermissionConfirmationSummary {
  /** 确认者（actorRef / userId hash）。 */
  confirmedBy: string
  /** 确认的权限清单摘要（哈希值）。 */
  permissionDigest: string
  /** 确认的具体权限 key 列表（低敏，排序）。 */
  permissionKeys: readonly string[]
  /** 确认时间戳（ISO 字符串）。 */
  confirmedAt: string
}

/** 插件安装记录。 */
export interface PluginInstallationRecord {
  /** 记录 ID (UUID)。 */
  id: string
  /** 归属组织 ID。 */
  organizationId: string
  /** 插件唯一标识 (pluginId)。 */
  pluginId: string
  /** 当前安装的 SemVer 版本。 */
  version: string
  /** 关联私有目录 release ID。 */
  releaseId: string
  /** 当前状态。 */
  status: PluginInstallationStatus
  /** 权限确认摘要（已启用时必填，未启用时为 null）。 */
  permissionConfirmation: PluginPermissionConfirmationSummary | null
  /** 包内容摘要。 */
  packageDigest: string
  /** Manifest 摘要。 */
  manifestDigest: string
  /** 兼容性摘要。 */
  compatibilityDigest: string
  /** 乐观锁行版本。 */
  rowVersion: number
  /** 创建时间。 */
  createdAt: string
  /** 更新时间。 */
  updatedAt: string
  /** 卸载时间（仅 uninstalled 状态时有值）。 */
  uninstalledAt: string | null
}

/** 预览中贡献影响面项。 */
export interface PluginInstallContributionImpact {
  contributionKey: string
  seamKey: string
  seamVersion: string
  title?: string
  skillKeyRef?: string
}

/** 预览中权限请求项。 */
export interface PluginInstallPermissionImpact {
  permissionKey: string
  seamKey: string
  sideEffect: string
  network: string
  purpose?: string
}

/** 命令预览（由预览接口产出，确认接口消费）。 */
export interface PluginInstallCommandPreview {
  /** 预览句柄（一次性使用，TTL 约束）。 */
  previewHandle: string
  /** 归属组织 ID。 */
  organizationId: string
  /** 操作者标识。 */
  actorRef: string
  /** 目标动作。 */
  action: PluginInstallAction
  /** 插件标识。 */
  pluginId: string
  /** 插件名称。 */
  pluginName: string
  /** 当前版本（未安装为空）。 */
  currentVersion?: string
  /** 目标版本。 */
  targetVersion: string
  /** 关联 release ID。 */
  releaseId: string
  /** 当前状态。 */
  currentStatus: PluginInstallationStatus | 'not_installed'
  /** 预期目标状态。 */
  targetStatus: PluginInstallationStatus
  /** 状态源 hash（防并发陈旧）。 */
  sourceHash: string
  /** 预览绑定 digest。 */
  previewDigest: string
  /** 贡献影响面列表。 */
  affectedContributions: readonly PluginInstallContributionImpact[]
  /** 声明的权限清单。 */
  requestedPermissions: readonly PluginInstallPermissionImpact[]
  /** 权限清单摘要。 */
  permissionDigest: string
  /** 当前宿主矩阵判定摘要；存在时确认阶段必须重验。 */
  compatibilityDigest?: string
  /** 低敏稳定 reason code，不包含 manifest 原文。 */
  compatibilityReasonCodes?: readonly PluginCompatibilityReasonCode[]
  /** TTL 秒数。 */
  ttlSeconds: number
  /** 创建时间。 */
  createdAt: string
  /** 过期时间。 */
  expiresAt: string
}

/** 确认请求 DTO。 */
export interface PluginInstallConfirmRequest {
  /** 预览句柄。 */
  previewHandle: string
  /** 客户端提交的预览绑定摘要（必须与服务端一致）。 */
  previewDigest: string
  /** 是否显式确认权限清单（enable 动作时必须为 true）。 */
  permissionConfirmed?: boolean
  /** 确认的权限清单摘要（enable 动作时必须与预览一致）。 */
  permissionDigest?: string
}

// =============================================================================
// 3. 确定性纯函数与状态机
// =============================================================================

/** 确定性 FNV-1a 32-bit 哈希。 */
export function fnv1a32Install(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 确定性稳定 JSON 序列化。 */
export function installStableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => installStableSerialize(v)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([k, v]) => JSON.stringify(k) + ':' + installStableSerialize(v)).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * 校验状态转移是否合法。
 */
export function isValidInstallTransition(
  from: PluginInstallationStatus | 'not_installed',
  action: PluginInstallAction,
): boolean {
  if (from === 'not_installed') {
    return action === 'install'
  }
  if (from === 'uninstalled') {
    return false // terminal state
  }
  switch (action) {
    case 'install':
      return false // 已经存在安装记录时不能重复 install
    case 'enable':
      return from === 'installed'
    case 'disable':
      return from === 'enabled'
    case 'uninstall':
      return from === 'installed' || from === 'enabled'
    case 'upgrade':
      return from === 'installed' || from === 'enabled'
    default:
      return false
  }
}

/**
 * 纯函数计算下一状态（离线可复算）。
 */
export function transitionPluginInstallStatus(
  from: PluginInstallationStatus | 'not_installed',
  action: PluginInstallAction,
): { nextStatus: PluginInstallationStatus } | { error: PluginInstallErrorCode } {
  if (from === 'uninstalled') {
    return { error: 'plugin-install-already-uninstalled' }
  }

  if (!isValidInstallTransition(from, action)) {
    return { error: 'plugin-install-illegal-transition' }
  }

  switch (action) {
    case 'install':
      return { nextStatus: 'installed' }
    case 'enable':
      return { nextStatus: 'enabled' }
    case 'disable':
      return { nextStatus: 'installed' }
    case 'uninstall':
      return { nextStatus: 'uninstalled' }
    case 'upgrade':
      // upgrade 保持当前是 installed 还是 enabled
      return { nextStatus: from === 'enabled' ? 'enabled' : 'installed' }
  }
}

/**
 * 计算权限清单摘要。
 */
export function computePermissionDigest(
  permissions: readonly (PluginInstallPermissionImpact | { permissionKey: string } | string)[],
): string {
  const keys = permissions
    .map((p) => (typeof p === 'string' ? p : p.permissionKey))
    .filter(Boolean)
    .sort()
  return fnv1a32Install(installStableSerialize(keys))
}

/**
 * 计算预览绑定摘要。
 */
export function computeInstallPreviewDigest(
  preview: Omit<PluginInstallCommandPreview, 'previewDigest' | 'previewHandle'>,
): string {
  const canonical = {
    organizationId: preview.organizationId,
    actorRef: preview.actorRef,
    action: preview.action,
    pluginId: preview.pluginId,
    targetVersion: preview.targetVersion,
    releaseId: preview.releaseId,
    currentStatus: preview.currentStatus,
    targetStatus: preview.targetStatus,
    sourceHash: preview.sourceHash,
    permissionDigest: preview.permissionDigest,
  }
  return fnv1a32Install(installStableSerialize(canonical))
}

/**
 * 校验确认请求与预览的绑定一致性。
 */
export function validateInstallConfirmBinding(
  preview: PluginInstallCommandPreview,
  request: PluginInstallConfirmRequest,
  nowTime: Date = new Date(),
): { valid: true } | { valid: false; error: PluginInstallErrorCode; reason: string } {
  // 1. 检查是否过期
  const expiresAt = new Date(preview.expiresAt)
  if (nowTime.getTime() > expiresAt.getTime()) {
    return {
      valid: false,
      error: 'plugin-install-preview-expired',
      reason: 'Preview handle has expired',
    }
  }

  // 2. 检查 previewDigest 匹配
  if (!request.previewDigest || request.previewDigest !== preview.previewDigest) {
    return {
      valid: false,
      error: 'plugin-install-preview-digest-mismatch',
      reason: 'Preview digest does not match',
    }
  }

  // 3. 针对 enable 动作检查权限显式确认
  if (preview.action === 'enable') {
    if (!request.permissionConfirmed) {
      return {
        valid: false,
        error: 'plugin-install-permission-unconfirmed',
        reason: 'Explicit permission confirmation is required for enabling a plugin',
      }
    }
    if (request.permissionDigest && request.permissionDigest !== preview.permissionDigest) {
      return {
        valid: false,
        error: 'plugin-install-permission-digest-mismatch',
        reason: 'Permission digest in confirmation does not match preview',
      }
    }
  }

  return { valid: true }
}

// =============================================================================
// 4. 低敏审计与脱敏工具
// =============================================================================

const SENSITIVE_KEY_PATTERNS = [
  /secret/i,
  /token/i,
  /password/i,
  /apikey/i,
  /api_key/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /private[_-]?key/i,
]

const SENSITIVE_VALUE_PATTERNS = [
  /(?:^|\s)(?:sk|pk|tk)_[A-Za-z0-9]{20,}/,
  /(?:^|\s)Bearer\s+[A-Za-z0-9._\-]+/,
  /(?:^|\s)(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
]

export function isInstallSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(key))
}

export function containsInstallSensitiveValue(value: string): boolean {
  return SENSITIVE_VALUE_PATTERNS.some((p) => p.test(value))
}

export function sanitizeInstallForAudit<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (isInstallSensitiveKey(key)) continue
    if (typeof value === 'string' && containsInstallSensitiveValue(value)) {
      result[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeInstallForAudit(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result as Partial<T>
}

// =============================================================================
// 5. 类型守卫
// =============================================================================

export function isPluginInstallationStatus(v: unknown): v is PluginInstallationStatus {
  return typeof v === 'string' && (PLUGIN_INSTALLATION_STATUSES as readonly string[]).includes(v)
}

export function isPluginInstallAction(v: unknown): v is PluginInstallAction {
  return typeof v === 'string' && (PLUGIN_INSTALL_ACTIONS as readonly string[]).includes(v)
}

export function isPluginInstallErrorCode(v: unknown): v is PluginInstallErrorCode {
  return typeof v === 'string' && (PLUGIN_INSTALL_ERROR_CODES as readonly string[]).includes(v)
}

export function isPluginInstallPermission(v: unknown): v is PluginInstallPermission {
  return typeof v === 'string' && (PLUGIN_INSTALL_PERMISSIONS as readonly string[]).includes(v)
}
