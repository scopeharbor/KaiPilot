/**
 * v3-plugin-permission-audit-and-observation — Audit Payload Builder（task 4.5-4.6）。
 *
 * 构建审计 payload：从 decision record 提取低敏引用，使用 allowlist schema，
 * 二次 sanitizer（插件专用 allowlist + 通用 AuditService.sanitize）。
 *
 * 红线：
 * - payload 不含原始 organization/project/user id（server-owned scope 仅在 storage）
 * - 不含 manifest/grant/package/body/URL/secret/token/stack/credential
 * - hash 使用 domain-separated 前缀避免跨域关联
 * - latency bucket 只有稳定 code/counter/bucket，不含 raw 延迟值
 */
import type { PluginPermissionDecisionRecord, PluginPermissionAuditPayload } from '@aiproj/types'
import { pdDomainSeparatedHash } from '@aiproj/types'

// =============================================================================
// Low-Sensitivity Ref Builders
// =============================================================================

/**
 * 生成低敏 actor ref hash。
 */
export function buildActorRefHash(actorId: string | number): string {
  return pdDomainSeparatedHash('actor', String(actorId))
}

/**
 * 生成低敏 plugin ref hash。
 */
export function buildPluginRefHash(pluginId: string): string {
  return pdDomainSeparatedHash('plugin', pluginId)
}

/**
 * 生成低敏 organization scope hash。
 * 仅用于 storage 过滤，不进入 audit payload。
 */
export function buildOrganizationScopeHash(orgId: string | number): string {
  return pdDomainSeparatedHash('org', String(orgId))
}

/**
 * 生成低敏 project scope hash。
 * 仅用于 storage 过滤，不进入 audit payload。
 */
export function buildProjectScopeHash(projectId: string | number): string {
  return pdDomainSeparatedHash('proj', String(projectId))
}

/**
 * 生成低敏 contribution ref hash（compiler contribution 专用）。
 */
export function buildContributionRefHash(contributionId: string): string {
  return pdDomainSeparatedHash('contribution', contributionId)
}

// =============================================================================
// Latency Bucket
// =============================================================================

/**
 * 将延迟毫秒数映射到有界 bucket code。
 * 不存储原始延迟值，只存稳定 bucket 标签。
 *
 * Buckets: <10ms, 10-50ms, 50-200ms, 200-1000ms, 1-5s, >5s
 */
export function computeLatencyBucket(elapsedMs: number): string {
  if (elapsedMs < 10) return 'lt10ms'
  if (elapsedMs < 50) return '10-50ms'
  if (elapsedMs < 200) return '50-200ms'
  if (elapsedMs < 1000) return '200-1000ms'
  if (elapsedMs < 5000) return '1-5s'
  return 'gt5s'
}

// =============================================================================
// Audit Payload Builder
// =============================================================================

/**
 * 从 decision record 构建审计 payload。
 * 使用 allowlist schema：只包含允许持久化的字段。
 *
 * 不包含：
 * - organizationScope / projectScope（server-owned scope）
 * - requestedPermissions / grantedPermissions（可能含敏感 scope binding）
 * - runtimeRef（可能含 seam 内部状态）
 * - observationDegraded（内部状态）
 */
export function buildAuditPayload(
  record: PluginPermissionDecisionRecord,
): PluginPermissionAuditPayload {
  return {
    decisionId: record.decisionId,
    mode: record.mode,
    operation: record.operation,
    outcome: record.outcome,
    reasonCode: record.reasonCode,
    pluginId: record.pluginId,
    pluginVersion: record.pluginVersion,
    targetRef: record.targetRef,
    actorRef: record.actorRef,
    createdAt: record.createdAt,
    idempotencyKey: record.idempotencyKey,
    inputFingerprint: record.inputFingerprint,
  }
}

// =============================================================================
// 二次 Sanitizer
// =============================================================================

/**
 * 插件专用 allowlist sanitizer：只允许特定键通过。
 * 第二层使用通用 AuditService.sanitize。
 */
const ALLOWED_PAYLOAD_KEYS = new Set([
  'decisionId',
  'mode',
  'operation',
  'outcome',
  'reasonCode',
  'pluginId',
  'pluginVersion',
  'targetRef',
  'actorRef',
  'createdAt',
  'idempotencyKey',
  'inputFingerprint',
])

/**
 * 敏感值检测 patterns。
 */
const SENSITIVE_PATTERNS = [
  /secret/i,
  /token/i,
  /password/i,
  /api_key/i,
  /api-key/i,
  /authorization/i,
  /bearer/i,
  /ghp_[a-zA-Z0-9]/,
  /sk-[a-zA-Z0-9]/,
  /:\/\/[^/]+/, // URLs
]

/**
 * 二次 sanitizer：先用 allowlist 过滤键，再检测敏感值。
 */
export function sanitizeAuditPayload(
  payload: PluginPermissionAuditPayload,
): PluginPermissionAuditPayload {
  // Step 1: Allowlist filter — 只保留允许的键
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (ALLOWED_PAYLOAD_KEYS.has(key)) {
      filtered[key] = value
    }
  }

  // Step 2: 敏感值检测 — 递归扫描所有字符串值
  const sanitized = deepSanitize(filtered)

  return sanitized as PluginPermissionAuditPayload
}

/**
 * 递归深度 sanitizer：检测嵌套对象中的敏感值。
 */
function deepSanitize(obj: unknown): unknown {
  if (typeof obj === 'string') {
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(obj)) {
        return '[REDACTED]'
      }
    }
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepSanitize(item))
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase()
      if (
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('password') ||
        lowerKey.includes('credential')
      ) {
        result[key] = '[REDACTED]'
      } else {
        result[key] = deepSanitize(value)
      }
    }
    return result
  }

  return obj
}

/**
 * 断言审计 payload 不包含禁止内容（测试用）。
 */
export function assertAuditPayloadLowSensitive(payload: PluginPermissionAuditPayload): void {
  const serialized = JSON.stringify(payload)
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new Error(`Audit payload contains forbidden pattern: ${pattern}`)
    }
  }
}

/**
 * 断言 payload 不含 server-owned scope（测试用）。
 */
export function assertNoServerOwnedScope(payload: Record<string, unknown>): void {
  const forbidden = ['organizationId', 'organizationScope', 'projectId', 'projectScope']
  for (const key of forbidden) {
    if (key in payload) {
      throw new Error(`Audit payload must not contain server-owned scope: ${key}`)
    }
  }
}
