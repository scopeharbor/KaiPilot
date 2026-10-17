/**
 * plugin-server-hook-runtime —— V3 服务端 hook 运行时共享契约
 * （纯类型 + 常量 + 封闭字段集 + 平行重造阻断 + 校验纯函数 + 类型守卫，
 * 零运行时依赖，零网络/IO/时间/随机数依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块。
 * 测试见 `plugin-server-hook-runtime.test.ts`，fixtures 见 `plugin-server-hook-runtime-fixtures.ts`。
 *
 * # 语义要点（对应 design.md D2~D9 与 specs/plugin-server-hook-runtime/spec.md）
 * - 两个合法接缝：'server-query.readonly-provider' 与 'server-command-proposal.proposal-only'。
 * - 负载契约采用封闭字段集：显式列出允许字段，差集出现非法/自建字段立即阻断。
 * - 平行重造阻断：严禁自有 RBAC 判定、事务提交、审计写入、状态转移语义。
 * - 网络策略必须为 'none'（networkPolicy: none）。
 * - 宿主 preflight（组织匹配、RBAC、可见性）先于插件回调执行。
 * - 提案摘要绑定校验（确定性 hash）。
 * - 所有贡献定位为 advisory / 非数据权威，核心保留事务、审计与最终确认。
 */

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** 两个官方 hook 接缝 key */
export const PLUGIN_SEAM_SERVER_QUERY = 'server-query.readonly-provider' as const
export const PLUGIN_SEAM_SERVER_COMMAND_PROPOSAL = 'server-command-proposal.proposal-only' as const

export const PLUGIN_SERVER_HOOK_SUPPORTED_SEAMS = [
  PLUGIN_SEAM_SERVER_QUERY,
  PLUGIN_SEAM_SERVER_COMMAND_PROPOSAL,
] as const
export type PluginServerHookSupportedSeam = (typeof PLUGIN_SERVER_HOOK_SUPPORTED_SEAMS)[number]

/** Finding 错误码（封闭集） */
export const PLUGIN_SERVER_HOOK_FINDING_CODES = [
  'plugin-server-hook-schema-invalid',
  'plugin-server-hook-unknown-seam',
  'plugin-server-hook-incompatible-seam-version',
  'plugin-server-hook-unallowed-field',
  'plugin-server-hook-network-policy-violation',
  'plugin-server-hook-parallel-rbac-recreation',
  'plugin-server-hook-parallel-transaction-recreation',
  'plugin-server-hook-parallel-audit-recreation',
  'plugin-server-hook-parallel-state-transfer-recreation',
  'plugin-server-hook-secret-detected',
  'plugin-server-hook-missing-callback-handle',
  'plugin-server-hook-invalid-callback-handle',
] as const
export type PluginServerHookFindingCode = (typeof PLUGIN_SERVER_HOOK_FINDING_CODES)[number]

/** server-query 允许的字段集（封闭集） */
export const SERVER_QUERY_ALLOWED_FIELDS = [
  'callbackHandle',
  'description',
  'requiredPermissions',
  'visibilityFilter',
] as const

/** server-command-proposal 允许的字段集（封闭集） */
export const SERVER_COMMAND_PROPOSAL_ALLOWED_FIELDS = [
  'callbackHandle',
  'description',
  'requiredPermissions',
  'visibilityFilter',
  'confirmationRequired',
] as const

/** 网络策略违规黑名单字段模式（parallel recreation detection） */
export const NETWORK_VIOLATION_PATTERNS = [
  'networkpolicy',
  'networkaccess',
  'http',
  'fetch',
  'request',
  'webhook',
  'external',
  'remote',
] as const

/** 自有 RBAC 判定违规黑名单字段模式 */
export const PARALLEL_RBAC_PATTERNS = [
  'rbac',
  'permissionpolicy',
  'authorizationengine',
  'accesscontrol',
  'granttable',
  'rolemapping',
] as const

/** 自有事务提交违规黑名单字段模式 */
export const PARALLEL_TRANSACTION_PATTERNS = [
  'transaction',
  'commit',
  'rollback',
  'savepoint',
  'transactionmanager',
] as const

/** 自有审计写入违规黑名单字段模式 */
export const PARALLEL_AUDIT_PATTERNS = [
  'auditlog',
  'auditwrite',
  'audittrail',
  'auditengine',
] as const

/** 自有状态转移违规黑名单字段模式 */
export const PARALLEL_STATE_TRANSFER_PATTERNS = [
  'statemachine',
  'lifecyclestate',
  'transitions',
  'transitionrules',
  'status',
  'state',
] as const

// =============================================================================
// 2. 类型定义
// =============================================================================

/** 通用 hook finding */
export interface PluginServerHookFinding {
  code: PluginServerHookFindingCode
  severity: 'blocking' | 'warning'
  path?: string
  message: string
}

/** 校验结果 */
export interface PluginServerHookValidationResult {
  valid: boolean
  findings: PluginServerHookFinding[]
  normalizedPayload?: Record<string, unknown>
}

/** 通用请求上下文（宿主传递给回调的已过滤视图） */
export interface PluginServerHookRequestContext {
  organizationId: number
  projectId?: number
  userId: number
  userRoles: string[]
  requestedPermissions: string[]
  scope: 'organization' | 'project'
}

/** server-query 请求 */
export interface PluginServerHookQueryRequest {
  seamKey: typeof PLUGIN_SEAM_SERVER_QUERY
  contributionKey: string
  pluginId: string
  pluginVersion: string
  context: PluginServerHookRequestContext
  payload: Record<string, unknown>
}

/** server-query 结果 */
export interface PluginServerHookQueryResult {
  contributionKey: string
  pluginId: string
  data: Record<string, unknown>
  advisory: true // 必须为 true，标记非数据权威
  source: string // 来源标注（贡献标识）
  timestamp: string // ISO 8601
}

/** server-command-proposal 请求 */
export interface PluginServerHookProposalRequest {
  seamKey: typeof PLUGIN_SEAM_SERVER_COMMAND_PROPOSAL
  contributionKey: string
  pluginId: string
  pluginVersion: string
  context: PluginServerHookRequestContext
  payload: Record<string, unknown>
}

/** server-command-proposal 结果（提案） */
export interface PluginServerHookProposalResult {
  contributionKey: string
  pluginId: string
  proposal: Record<string, unknown> // 提案负载
  summary: string // 提案摘要（确定性 hash）
  description?: string
  source: string // 来源标注
  timestamp: string // ISO 8601
}

/** 回调句柄类型（确定性函数句柄注册表类型） */
export type PluginServerHookCallbackHandle = string

/** 回调函数签名 */
export type PluginServerHookQueryCallback = (
  request: PluginServerHookQueryRequest,
) => Promise<PluginServerHookQueryResult>

export type PluginServerHookProposalCallback = (
  request: PluginServerHookProposalRequest,
) => Promise<PluginServerHookProposalResult>

/** 回调注册表条目 */
export interface PluginServerHookCallbackEntry {
  handle: PluginServerHookCallbackHandle
  seamKey: PluginServerHookSupportedSeam
  pluginId: string
  contributionKey: string
  callback: PluginServerHookQueryCallback | PluginServerHookProposalCallback
}

/** 降级计数 */
export interface PluginServerHookDegradationCount {
  totalAttempts: number
  successes: number
  failures: number
  timeouts: number
  skipped: number
}

/** 提案确认请求 */
export interface PluginServerHookProposalConfirmRequest {
  proposalSummary: string // 必须匹配提案摘要
  pluginId: string
  contributionKey: string
  confirmedBy: number // 用户 ID
}

/** 提案确认结果 */
export interface PluginServerHookProposalConfirmResult {
  accepted: boolean
  reason?: string
  executedAt?: string
}

// =============================================================================
// 3. 纯函数：封闭字段集负载校验
// =============================================================================

/**
 * 检查负载是否包含敏感材料（secret/token/私钥）
 */
function checkSecretMaterial(
  raw: Record<string, unknown>,
  currentPath = '',
): PluginServerHookFinding[] {
  const findings: PluginServerHookFinding[] = []
  const SENSITIVE_KEY_PATTERNS = [
    /^secret$/i,
    /^token$/i,
    /^privatekey$/i,
    /^private_key$/i,
    /^apikey$/i,
    /^api_key$/i,
    /^password$/i,
    /^credential$/i,
  ]
  const SENSITIVE_VALUE_PATTERNS = [
    /^Bearer\s/i,
    /^sk-[a-zA-Z0-9]{32,}$/,
    /^-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
  ]

  for (const [key, value] of Object.entries(raw)) {
    if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(key))) {
      findings.push({
        code: 'plugin-server-hook-secret-detected',
        severity: 'blocking',
        path: currentPath ? `${currentPath}.${key}` : key,
        message: `Secret material key detected in contribution payload: ${key}`,
      })
    }
    if (typeof value === 'string') {
      if (SENSITIVE_VALUE_PATTERNS.some((p) => p.test(value))) {
        findings.push({
          code: 'plugin-server-hook-secret-detected',
          severity: 'blocking',
          path: currentPath ? `${currentPath}.${key}` : key,
          message: `Secret token pattern detected in contribution payload value at ${currentPath}.${key}`,
        })
      }
    } else if (typeof value === 'object' && value !== null) {
      findings.push(
        ...checkSecretMaterial(
          value as Record<string, unknown>,
          currentPath ? `${currentPath}.${key}` : key,
        ),
      )
    }
  }

  return findings
}

/**
 * 检测平行重造违规（自有 RBAC、事务、审计、状态转移）
 */
function detectParallelRecreation(
  raw: Record<string, unknown>,
  allowedFields: readonly string[],
): PluginServerHookFinding[] {
  const findings: PluginServerHookFinding[] = []
  const keys = Object.keys(raw)

  for (const key of keys) {
    const lowerKey = key.toLowerCase()

    // 检查自有 RBAC 判定
    if (PARALLEL_RBAC_PATTERNS.some((p) => lowerKey === p || lowerKey.includes(p))) {
      findings.push({
        code: 'plugin-server-hook-parallel-rbac-recreation',
        severity: 'blocking',
        path: key,
        message: `Parallel RBAC declaration forbidden in payload: "${key}". RBAC is reserved by core.`,
      })
    }

    // 检查自有事务提交
    if (PARALLEL_TRANSACTION_PATTERNS.some((p) => lowerKey === p || lowerKey.includes(p))) {
      findings.push({
        code: 'plugin-server-hook-parallel-transaction-recreation',
        severity: 'blocking',
        path: key,
        message: `Parallel transaction declaration forbidden in payload: "${key}". Transaction is reserved by core.`,
      })
    }

    // 检查自有审计写入
    if (PARALLEL_AUDIT_PATTERNS.some((p) => lowerKey === p || lowerKey.includes(p))) {
      findings.push({
        code: 'plugin-server-hook-parallel-audit-recreation',
        severity: 'blocking',
        path: key,
        message: `Parallel audit declaration forbidden in payload: "${key}". Audit is reserved by core.`,
      })
    }

    // 检查自有状态转移
    if (PARALLEL_STATE_TRANSFER_PATTERNS.some((p) => lowerKey === p || lowerKey.includes(p))) {
      findings.push({
        code: 'plugin-server-hook-parallel-state-transfer-recreation',
        severity: 'blocking',
        path: key,
        message: `Parallel state transfer declaration forbidden in payload: "${key}". State transfer is reserved by core.`,
      })
    }

    // 封闭字段集差集检查
    if (!allowedFields.includes(key as any)) {
      findings.push({
        code: 'plugin-server-hook-unallowed-field',
        severity: 'blocking',
        path: key,
        message: `Unallowed field in contribution payload: "${key}". Allowed fields: [${allowedFields.join(', ')}]`,
      })
    }
  }

  return findings
}

/**
 * 校验 server-query 负载
 */
export function validateServerQueryPayload(
  payload: unknown,
  seamVersion = '1.0.0',
): PluginServerHookValidationResult {
  const findings: PluginServerHookFinding[] = []

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      findings: [
        {
          code: 'plugin-server-hook-schema-invalid',
          severity: 'blocking',
          message: 'Payload must be a valid JSON object',
        },
      ],
    }
  }

  // 检查 seam 版本兼容（首期 1.x 同主版本兼容）
  const major = seamVersion.split('.')[0]
  if (major !== '1') {
    findings.push({
      code: 'plugin-server-hook-incompatible-seam-version',
      severity: 'blocking',
      message: `Incompatible seam version: ${seamVersion}. Expected 1.x`,
    })
  }

  const raw = payload as Record<string, unknown>

  // 敏感材料检查
  findings.push(...checkSecretMaterial(raw))

  // 网络策略检查（必须为 none）
  if (raw.networkPolicy && raw.networkPolicy !== 'none') {
    findings.push({
      code: 'plugin-server-hook-network-policy-violation',
      severity: 'blocking',
      path: 'networkPolicy',
      message: `Network policy must be "none", got "${raw.networkPolicy}"`,
    })
  }

  // 平行重造阻断与封闭字段检查
  findings.push(...detectParallelRecreation(raw, SERVER_QUERY_ALLOWED_FIELDS))

  // 必需字段检查
  if (typeof raw.callbackHandle !== 'string' || !raw.callbackHandle.trim()) {
    findings.push({
      code: 'plugin-server-hook-missing-callback-handle',
      severity: 'blocking',
      path: 'callbackHandle',
      message: 'callbackHandle is required and must be a non-empty string',
    })
  }

  const hasBlocking = findings.some((f) => f.severity === 'blocking')
  if (hasBlocking) {
    return { valid: false, findings }
  }

  // 规范化 payload
  const normalized = {
    callbackHandle: String(raw.callbackHandle).trim(),
    ...(typeof raw.description === 'string' ? { description: raw.description.trim() } : {}),
    ...(Array.isArray(raw.requiredPermissions)
      ? {
          requiredPermissions: raw.requiredPermissions.filter(
            (p: unknown) => typeof p === 'string',
          ),
        }
      : {}),
    ...(typeof raw.visibilityFilter === 'object' && raw.visibilityFilter !== null
      ? { visibilityFilter: raw.visibilityFilter }
      : {}),
  }

  return { valid: true, findings, normalizedPayload: normalized }
}

/**
 * 校验 server-command-proposal 负载
 */
export function validateServerCommandProposalPayload(
  payload: unknown,
  seamVersion = '1.0.0',
): PluginServerHookValidationResult {
  const findings: PluginServerHookFinding[] = []

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      findings: [
        {
          code: 'plugin-server-hook-schema-invalid',
          severity: 'blocking',
          message: 'Payload must be a valid JSON object',
        },
      ],
    }
  }

  // 检查 seam 版本兼容（首期 1.x 同主版本兼容）
  const major = seamVersion.split('.')[0]
  if (major !== '1') {
    findings.push({
      code: 'plugin-server-hook-incompatible-seam-version',
      severity: 'blocking',
      message: `Incompatible seam version: ${seamVersion}. Expected 1.x`,
    })
  }

  const raw = payload as Record<string, unknown>

  // 敏感材料检查
  findings.push(...checkSecretMaterial(raw))

  // 网络策略检查（必须为 none）
  if (raw.networkPolicy && raw.networkPolicy !== 'none') {
    findings.push({
      code: 'plugin-server-hook-network-policy-violation',
      severity: 'blocking',
      path: 'networkPolicy',
      message: `Network policy must be "none", got "${raw.networkPolicy}"`,
    })
  }

  // 平行重造阻断与封闭字段检查
  findings.push(...detectParallelRecreation(raw, SERVER_COMMAND_PROPOSAL_ALLOWED_FIELDS))

  // 必需字段检查
  if (typeof raw.callbackHandle !== 'string' || !raw.callbackHandle.trim()) {
    findings.push({
      code: 'plugin-server-hook-missing-callback-handle',
      severity: 'blocking',
      path: 'callbackHandle',
      message: 'callbackHandle is required and must be a non-empty string',
    })
  }

  const hasBlocking = findings.some((f) => f.severity === 'blocking')
  if (hasBlocking) {
    return { valid: false, findings }
  }

  // 规范化 payload
  const normalized = {
    callbackHandle: String(raw.callbackHandle).trim(),
    ...(typeof raw.description === 'string' ? { description: raw.description.trim() } : {}),
    ...(Array.isArray(raw.requiredPermissions)
      ? {
          requiredPermissions: raw.requiredPermissions.filter(
            (p: unknown) => typeof p === 'string',
          ),
        }
      : {}),
    ...(typeof raw.visibilityFilter === 'object' && raw.visibilityFilter !== null
      ? { visibilityFilter: raw.visibilityFilter }
      : {}),
    ...(typeof raw.confirmationRequired === 'boolean'
      ? { confirmationRequired: raw.confirmationRequired }
      : {}),
  }

  return { valid: true, findings, normalizedPayload: normalized }
}

/**
 * 按 seamKey 分派的统一贡献负载校验入口
 */
export function validatePluginServerHookPayload(
  seamKey: string,
  payload: unknown,
  seamVersion = '1.0.0',
): PluginServerHookValidationResult {
  switch (seamKey) {
    case PLUGIN_SEAM_SERVER_QUERY:
      return validateServerQueryPayload(payload, seamVersion)
    case PLUGIN_SEAM_SERVER_COMMAND_PROPOSAL:
      return validateServerCommandProposalPayload(payload, seamVersion)
    default:
      return {
        valid: false,
        findings: [
          {
            code: 'plugin-server-hook-unknown-seam',
            severity: 'blocking',
            message: `Unsupported or unknown seamKey for server hook: ${seamKey}`,
          },
        ],
      }
  }
}

// =============================================================================
// 4. 纯函数：preflight 判定
// =============================================================================

export interface PluginServerHookPreflightResult {
  allowed: boolean
  reasonCode?: string
  reasonMessage?: string
  requiredPermissions: string[]
  missingPermissions: string[]
  visible: boolean
}

/**
 * preflight 判定纯函数（组织匹配 + 必需权限集合判定 + 可见性过滤结果）
 * 注意：实际 RBAC 判定复用既有 Policy 链，此处仅做集合比较。
 */
export function computePreflightResult(
  requestContext: PluginServerHookRequestContext,
  requiredPermissions: string[],
  organizationId: number,
  visibilityFilter?: Record<string, unknown>,
): PluginServerHookPreflightResult {
  // 组织匹配
  if (requestContext.organizationId !== organizationId) {
    return {
      allowed: false,
      reasonCode: 'organization_mismatch',
      reasonMessage: 'Request organization does not match hook organization',
      requiredPermissions,
      missingPermissions: requiredPermissions,
      visible: false,
    }
  }

  // 权限集合判定（简化：检查用户角色是否包含所需权限）
  // 实际 RBAC 判定由宿主 Policy 链完成，这里仅做集合比较
  const missingPermissions = requiredPermissions.filter(
    (perm) => !requestContext.userRoles.includes(perm),
  )

  if (missingPermissions.length > 0) {
    return {
      allowed: false,
      reasonCode: 'missing_permissions',
      reasonMessage: `Missing required permissions: ${missingPermissions.join(', ')}`,
      requiredPermissions,
      missingPermissions,
      visible: true,
    }
  }

  // 可见性过滤（简化：如果有 visibilityFilter，假定通过）
  // 实际可见性过滤由宿主完成
  const visible = !visibilityFilter || Object.keys(visibilityFilter).length === 0

  return {
    allowed: true,
    requiredPermissions,
    missingPermissions: [],
    visible,
  }
}

// =============================================================================
// 5. 纯函数：提案摘要绑定校验
// =============================================================================

/**
 * 确定性 hash 函数（FNV-1a 简化版）
 */
function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0 // FNV prime
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 规范化负载确定性 hash
 */
export function computeProposalSummary(payload: Record<string, unknown>): string {
  const sortedKeys = Object.keys(payload).sort()
  const canonical = sortedKeys.map((key) => `${key}:${JSON.stringify(payload[key])}`).join('|')
  return fnv1aHash(canonical)
}

/**
 * 提案摘要绑定校验纯函数
 */
export function validateProposalSummaryBinding(
  submittedSummary: string,
  expectedPayload: Record<string, unknown>,
): { valid: boolean; expectedSummary: string } {
  const expectedSummary = computeProposalSummary(expectedPayload)
  return {
    valid: submittedSummary === expectedSummary,
    expectedSummary,
  }
}

// =============================================================================
// 6. 类型守卫
// =============================================================================

export function isPluginServerHookSupportedSeam(v: unknown): v is PluginServerHookSupportedSeam {
  return (
    typeof v === 'string' && (PLUGIN_SERVER_HOOK_SUPPORTED_SEAMS as readonly string[]).includes(v)
  )
}

export function isPluginServerHookFindingCode(v: unknown): v is PluginServerHookFindingCode {
  return (
    typeof v === 'string' && (PLUGIN_SERVER_HOOK_FINDING_CODES as readonly string[]).includes(v)
  )
}

/**
 * 类型守卫：检查回调句柄是否为有效格式
 */
export function isValidCallbackHandle(v: unknown): v is PluginServerHookCallbackHandle {
  return typeof v === 'string' && v.trim().length > 0 && /^[a-zA-Z0-9_-]+$/.test(v)
}

/**
 * 类型守卫：检查请求上下文是否完整
 */
export function isPluginServerHookRequestContext(v: unknown): v is PluginServerHookRequestContext {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  return (
    typeof obj.organizationId === 'number' &&
    typeof obj.userId === 'number' &&
    Array.isArray(obj.userRoles) &&
    Array.isArray(obj.requestedPermissions) &&
    (obj.scope === 'organization' || obj.scope === 'project')
  )
}
