// @aiproj/types — V3 Copilot MCP 外部工具契约（copilot-mcp-tools）
//
// v3-copilot-mcp-external-tools —— MCP 工具的清单声明复用、权限不升级、授权门、
// 结果安全与低敏落账的共享类型与确定性纯函数。
//
// 依赖轻量约束：仅依赖本包 copilot-shared-contracts 与 plugin-manifest（纯类型 + 确定性 helpers），
// 无 AdonisJS / React / 数据库客户端 / 网络请求。
//
// 核心裁决（D1-D7，见 design.md）：
// - D1: MCP 工具复用插件族的清单、权限声明、权限不升级、注册表与审计
// - D2: 未在清单中声明的调用一律拒绝；不接受运行时动态能力扩展
// - D3: 工具返回当数据不当指令，复用外部内容安全的检测
// - D4: 落账不含工具参数与返回全文
// - D5: 可写类工具的产出一律为待确认草案
// - D6: 授权门短路点在建立连接之前
// - D7: 工具调用的权限在每次调用时判定

import type {
  ManifestPermissionSideEffect,
  ManifestPermissionNetworkPolicy,
  ManifestPermissionConfirmationPolicy,
  ManifestScopeKind,
} from './plugin-manifest.js'

// ===========================================================================
// 枚举 — 工具能力类型（复用插件清单范式，D1）
// ===========================================================================

/** 工具能力类型：复用 PluginContributionDeclaration 的 contributionKey 范式。 */
export const MCP_TOOL_CAPABILITY_TYPES = [
  /** 只读查询（如查询 issue 状态、PR 信息）。 */
  'read_only',
  /** 建议型（如建议创建 issue，产出为待确认草案）。 */
  'advisory',
  /** 可写型（如创建 issue、更新状态，产出为待确认草案，D5）。 */
  'write_capable',
] as const
export type McpToolCapabilityType = (typeof MCP_TOOL_CAPABILITY_TYPES)[number]

export function isMcpToolCapabilityType(v: string): v is McpToolCapabilityType {
  return (MCP_TOOL_CAPABILITY_TYPES as readonly string[]).includes(v)
}

// ===========================================================================
// 枚举 — 工具调用状态
// ===========================================================================

/** 工具调用结果状态（低敏，D4）。 */
export const MCP_TOOL_INVOCATION_STATUSES = [
  /** 调用成功。 */
  'success',
  /** 调用失败（工具端错误）。 */
  'error',
  /** 调用超时。 */
  'timeout',
  /** 调用被授权门拦截。 */
  'blocked_unauthorized',
  /** 调用被权限校验拦截。 */
  'blocked_permission',
  /** 调用被清单校验拦截（未声明的能力）。 */
  'blocked_undeclared',
  /** 调用被注入检测拦截。 */
  'blocked_injection',
  /** 调用被上下文预算截断。 */
  'truncated',
] as const
export type McpToolInvocationStatus = (typeof MCP_TOOL_INVOCATION_STATUSES)[number]

export function isMcpToolInvocationStatus(v: string): v is McpToolInvocationStatus {
  return (MCP_TOOL_INVOCATION_STATUSES as readonly string[]).includes(v)
}

// ===========================================================================
// 枚举 — 授权决策
// ===========================================================================

/** 组织级 MCP 授权决策。 */
export const MCP_AUTHORIZATION_DECISIONS = [
  /** 已授权：允许建立连接。 */
  'authorized',
  /** 未授权：短路在连接前。 */
  'unauthorized',
  /** 已撤销：曾经授权但现在已撤销。 */
  'revoked',
] as const
export type McpAuthorizationDecision = (typeof MCP_AUTHORIZATION_DECISIONS)[number]

export function isMcpAuthorizationDecision(v: string): v is McpAuthorizationDecision {
  return (MCP_AUTHORIZATION_DECISIONS as readonly string[]).includes(v)
}

// ===========================================================================
// 枚举 — 拒绝原因码
// ===========================================================================

/** 工具调用拒绝原因码（低敏，不泄露实现细节）。 */
export const MCP_DENIAL_REASON_CODES = [
  /** 组织未授权 MCP 工具连接。 */
  'organization_not_authorized',
  /** 工具未在清单中声明。 */
  'capability_not_declared',
  /** 工具声明的权限超过安装者权限。 */
  'declaration_escalation',
  /** 当前使用者无该工具所需权限。 */
  'invoker_permission_denied',
  /** 工具属于其他组织。 */
  'cross_organization',
  /** 清单变更后旧授权失效。 */
  'manifest_changed_requires_reauthorization',
  /** 工具返回含注入内容。 */
  'injection_detected',
  /** 工具返回超上下文预算。 */
  'context_budget_exceeded',
] as const
export type McpDenialReasonCode = (typeof MCP_DENIAL_REASON_CODES)[number]

export function isMcpDenialReasonCode(v: string): v is McpDenialReasonCode {
  return (MCP_DENIAL_REASON_CODES as readonly string[]).includes(v)
}

// ===========================================================================
// 结构类型 — 工具声明（复用插件清单范式，D1）
// ===========================================================================

/**
 * MCP 工具声明：复用 PluginContributionDeclaration 的形状。
 * 工具通过插件清单范式声明其能力与所需权限，不新建声明格式。
 */
export interface McpToolDeclaration {
  /** 工具唯一标识（小写命名空间格式，如 "org.tool-name"）。 */
  readonly toolId: string
  /** 工具显示名称。 */
  readonly toolName: string
  /** 工具能力描述（低敏）。 */
  readonly description: string
  /** 工具能力类型。 */
  readonly capabilityType: McpToolCapabilityType
  /** 所需权限列表（必须属于插件清单的 permission vocabulary）。 */
  readonly requiredPermissions: readonly McpToolPermissionRef[]
  /** 是否可写（D5：可写类工具的产出一律为待确认草案）。 */
  readonly writable: boolean
  /** 工具来源（低敏）。 */
  readonly source: McpToolSource
  /** 工具超时（毫秒，默认由宿主决定）。 */
  readonly timeoutMs?: number
  /** 重试策略（默认关闭，D7）。 */
  readonly retryPolicy?: McpToolRetryPolicy
}

/** 工具权限引用（复用 PluginPermissionRequest 的子集）。 */
export interface McpToolPermissionRef {
  /** 权限 key（必须属于宿主拥有的封闭词表）。 */
  readonly permissionKey: string
  /** 关联 seam key。 */
  readonly seamKey: string
  /** scope kind。 */
  readonly scopeKind: ManifestScopeKind
  /** side-effect class。 */
  readonly sideEffect: ManifestPermissionSideEffect
  /** confirmation policy。 */
  readonly confirmation: ManifestPermissionConfirmationPolicy
  /** network policy。 */
  readonly network: ManifestPermissionNetworkPolicy
}

/** 工具来源（低敏标注）。 */
export interface McpToolSource {
  /** 来源类型。 */
  readonly kind: 'registry' | 'manual' | 'builtin'
  /** 来源引用（如注册表条目 ID）。 */
  readonly ref: string
}

/** 重试策略（默认关闭）。 */
export interface McpToolRetryPolicy {
  /** 是否启用重试（默认 false）。 */
  readonly enabled: boolean
  /** 最大重试次数（仅当 enabled=true 时有效）。 */
  readonly maxRetries?: number
  /** 重试间隔（毫秒）。 */
  readonly backoffMs?: number
}

// ===========================================================================
// 结构类型 — 调用记录（D4：不含参数与返回全文）
// ===========================================================================

/**
 * 工具调用记录：仅含工具名、状态与耗时。
 * **不含**工具参数、返回全文、prompt、模型输出、token 与 secret（D4 禁存约束）。
 */
export interface McpToolInvocationRecord {
  /** 记录 ID。 */
  readonly recordId: string
  /** 工具 ID。 */
  readonly toolId: string
  /** 工具名称（低敏）。 */
  readonly toolName: string
  /** 调用状态。 */
  readonly status: McpToolInvocationStatus
  /** 调用耗时（毫秒）。 */
  readonly durationMs: number
  /** 调用时间（ISO 8601）。 */
  readonly invokedAt: string
  /** 调用者 ID（低敏）。 */
  readonly actorId: string
  /** 组织 ID（组织隔离）。 */
  readonly organizationId: number
  /** 拒绝原因码（仅当 status 为 blocked_* 时存在）。 */
  readonly denialReason?: McpDenialReasonCode
  /** 返回大小（字节，低敏）。 */
  readonly responseSizeBytes?: number
  /** 是否被截断（D7：超上下文预算时截断并标记）。 */
  readonly truncated?: boolean
  /** 截断标记（仅当 truncated=true 时存在）。 */
  readonly truncationMarker?: string
}

// ===========================================================================
// 结构类型 — 授权状态
// ===========================================================================

/**
 * 组织级 MCP 授权状态。
 * 授权门短路点在建立连接之前（D6）。
 */
export interface McpAuthorizationState {
  /** 组织 ID。 */
  readonly organizationId: number
  /** 授权决策。 */
  readonly decision: McpAuthorizationDecision
  /** 授权时间（ISO 8601，仅当 decision=authorized 时存在）。 */
  readonly authorizedAt?: string
  /** 授权者 ID（低敏）。 */
  readonly authorizedBy?: string
  /** 撤销时间（ISO 8601，仅当 decision=revoked 时存在）。 */
  readonly revokedAt?: string
  /** 当前清单 digest（用于检测清单变更，D2）。 */
  readonly manifestDigest: string
  /** 乐观并发版本。 */
  readonly rowVersion: number
}

// ===========================================================================
// 结构类型 — 清单固定状态
// ===========================================================================

/**
 * 清单固定状态：记录安装时的清单摘要，用于检测运行时动态扩展（D2）。
 */
export interface McpManifestFingerprint {
  /** 工具 ID。 */
  readonly toolId: string
  /** 安装时的清单 digest。 */
  readonly installedDigest: string
  /** 安装时的能力列表快照。 */
  readonly installedCapabilities: readonly string[]
  /** 安装时间（ISO 8601）。 */
  readonly installedAt: string
  /** 组织 ID。 */
  readonly organizationId: number
}

// ===========================================================================
// 结构类型 — 注入检测记录（复用外部内容安全，D3）
// ===========================================================================

/**
 * 工具返回注入检测记录：复用 ExternalDetectionRecord 的形状。
 * 不为 MCP 返回开检测旁路。
 */
export interface McpToolDetectionRecord {
  /** 记录 ID。 */
  readonly recordId: string
  /** 工具 ID。 */
  readonly toolId: string
  /** 检测判定。 */
  readonly verdict: 'passed' | 'rejected' | 'unavailable'
  /** 命中的注入类别列表。 */
  readonly hitCategories: readonly string[]
  /** 总命中计数。 */
  readonly totalHits: number
  /** 检测器版本。 */
  readonly detectorVersion: string
  /** 检测时间（ISO 8601）。 */
  readonly detectedAt: string
  /** 组织 ID。 */
  readonly organizationId: number
}

// ===========================================================================
// 确定性纯函数
// ===========================================================================

/**
 * 校验工具声明的权限是否为安装者权限的子集（权限不升级校验，D1）。
 * 复用 validatePermissionSubset 的逻辑。
 *
 * @returns 发现列表，空数组表示通过。
 */
export function validateToolDeclarationPermissions(
  declaration: McpToolDeclaration,
  installerPermissions: readonly string[],
): McpToolDeclarationPermissionFinding[] {
  const findings: McpToolDeclarationPermissionFinding[] = []
  const installerSet = new Set(installerPermissions)

  for (const perm of declaration.requiredPermissions) {
    if (!installerSet.has(perm.permissionKey)) {
      findings.push({
        code: 'tool-permission-exceeds-installer',
        permissionKey: perm.permissionKey,
        toolId: declaration.toolId,
        message: `工具 "${declaration.toolId}" 声明的权限 "${perm.permissionKey}" 超出安装者权限`,
      })
    }
  }

  return findings
}

/** 工具声明权限校验发现。 */
export interface McpToolDeclarationPermissionFinding {
  /** 发现代码。 */
  readonly code: 'tool-permission-exceeds-installer'
  /** 超权的权限 key。 */
  readonly permissionKey: string
  /** 工具 ID。 */
  readonly toolId: string
  /** 人类可读描述。 */
  readonly message: string
}

/**
 * 校验调用目标是否在已安装清单的能力范围内（清单固定，D2）。
 *
 * @returns 拒绝原因码，null 表示通过。
 */
export function validateToolCapabilityInManifest(
  toolId: string,
  installedCapabilities: readonly string[],
): McpDenialReasonCode | null {
  if (!installedCapabilities.includes(toolId)) {
    return 'capability_not_declared'
  }
  return null
}

/**
 * 校验清单变更是否需要重新授权（D2）。
 *
 * @returns 是否需要重新授权。
 */
export function requiresReauthorization(oldDigest: string, newDigest: string): boolean {
  return oldDigest !== newDigest
}

/**
 * 构造截断标记（D7：超上下文预算时截断并标记）。
 */
export function buildTruncationMarker(originalSizeBytes: number, maxBudgetBytes: number): string {
  return `[TRUNCATED: ${originalSizeBytes} bytes exceeds budget ${maxBudgetBytes} bytes]`
}

/**
 * 校验调用记录是否满足禁存约束（D4）。
 * 记录不含工具参数、返回全文、prompt、模型输出、token 与 secret。
 *
 * @returns 违规字段列表，空数组表示通过。
 */
export function validateInvocationRecordNoSensitiveData(record: Record<string, unknown>): string[] {
  const forbiddenKeys = [
    'arguments',
    'params',
    'parameters',
    'result',
    'resultFull',
    'fullResult',
    'response',
    'responseBody',
    'prompt',
    'modelOutput',
    'token',
    'tokens',
    'secret',
    'apiKey',
    'authorization',
  ]
  const violations: string[] = []
  for (const key of forbiddenKeys) {
    if (key in record && record[key] !== undefined && record[key] !== null) {
      violations.push(key)
    }
  }
  return violations
}

/**
 * 生成低敏工具摘要（不含参数与返回全文）。
 */
export function buildToolSummary(declaration: McpToolDeclaration): string {
  return `${declaration.toolName} (${declaration.capabilityType})`
}

/**
 * 校验工具声明是否声称可写但未标记 writable（D5）。
 *
 * @returns 发现列表，空数组表示通过。
 */
export function validateWriteCapabilityConsistency(
  declaration: McpToolDeclaration,
): McpToolDeclarationPermissionFinding[] {
  const findings: McpToolDeclarationPermissionFinding[] = []

  // 可写能力类型必须标记 writable
  if (declaration.capabilityType === 'write_capable' && !declaration.writable) {
    findings.push({
      code: 'tool-permission-exceeds-installer',
      permissionKey: declaration.toolId,
      toolId: declaration.toolId,
      message: `工具 "${declaration.toolId}" 声明 write_capable 但未标记 writable`,
    })
  }

  return findings
}

/**
 * 校验调用记录是否包含截断标记（D7）。
 */
export function isTruncationMarked(record: McpToolInvocationRecord): boolean {
  if (!record.truncated) return true // 未截断不需要标记
  return record.truncationMarker !== undefined && record.truncationMarker.length > 0
}

/**
 * 校验工具声明的权限引用是否符合插件清单范式（D1）。
 * 不新建第二套第三方能力声明。
 */
export function validateToolDeclarationUsesManifestShape(declaration: McpToolDeclaration): boolean {
  // 工具声明必须包含 requiredPermissions（复用 PluginPermissionRequest 的子集）
  // 且每个权限引用必须包含 permissionKey、seamKey、scopeKind、sideEffect、confirmation、network
  for (const perm of declaration.requiredPermissions) {
    if (
      !perm.permissionKey ||
      !perm.seamKey ||
      !perm.scopeKind ||
      !perm.sideEffect ||
      !perm.confirmation ||
      !perm.network
    ) {
      return false
    }
  }
  return true
}
