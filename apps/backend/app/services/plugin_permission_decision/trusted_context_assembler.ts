/**
 * v3-plugin-permission-audit-and-observation — Trusted Context Assembler（task 5.1-5.2）。
 *
 * 从宿主中间件和已验证状态装配可信授权上下文。
 * 扫描并拒绝客户端 authority spoofing：任何来自请求体的
 * organization/project/role/policyPassed/auditPassed 字段只作为不可信输入。
 *
 * 红线：
 * - 只使用 server-owned context
 * - 客户端同名字段触发 redline，不覆盖上下文
 */
import type { PluginPermissionTrustedContext } from '@aiproj/types'
import logger from '@adonisjs/core/services/logger'

// =============================================================================
// Types
// =============================================================================

export interface AssembleContextParams {
  /** Authenticated user ID (from JWT, server-verified). */
  userId: number
  /** User roles (from RBAC, server-verified). */
  userRoles: string[]
  /** Organization ID (from tenant middleware, server-owned). */
  organizationId: number
  /** Project ID (optional, from route param or middleware). */
  projectId?: number
  /** Policy check results (from Policy layer, server-owned). */
  policyResults: Record<string, { allowed: boolean; reasonCode?: string }>
  /** Client-provided fields to SCAN for spoofing (NOT to use). */
  clientClaims?: Record<string, unknown>
}

// =============================================================================
// Authority Spoofing Detection
// =============================================================================

/**
 * Fields that clients may attempt to spoof.
 * If present in clientClaims, they trigger a redline but are NOT used.
 */
const SPOOFED_FIELD_PATTERNS = [
  'organizationId',
  'organization_id',
  'orgId',
  'org_id',
  'projectId',
  'project_id',
  'roleId',
  'role_id',
  'role',
  'policyPassed',
  'policy_passed',
  'auditPassed',
  'audit_passed',
  'isSuperAdmin',
  'is_super_admin',
  'permissions',
  'allowed',
]

/**
 * Scan client claims for authority spoofing attempts.
 * Returns list of spoofed fields (for logging/redline).
 */
function detectAuthoritySpoofing(clientClaims: Record<string, unknown> | undefined): string[] {
  if (!clientClaims) return []

  const detected: string[] = []
  for (const key of Object.keys(clientClaims)) {
    const lowerKey = key.toLowerCase()
    for (const pattern of SPOOFED_FIELD_PATTERNS) {
      if (lowerKey === pattern.toLowerCase() || lowerKey.includes(pattern.toLowerCase())) {
        detected.push(key)
        break
      }
    }
  }
  return detected
}

// =============================================================================
// Context Assembler
// =============================================================================

/**
 * Assemble trusted context from server-owned sources.
 *
 * 只使用经过认证/授权中间件验证的字段。
 * 客户端提供的同名字段仅用于检测 spoofing，不覆盖上下文。
 */
export function assembleTrustedContext(
  params: AssembleContextParams,
): PluginPermissionTrustedContext {
  // ── Step 1: Detect authority spoofing ──
  const spoofedFields = detectAuthoritySpoofing(params.clientClaims)
  if (spoofedFields.length > 0) {
    // 记录 redline 但不阻止（由 decision service 的 prerequisite check 处理）
    logger.warn(
      { spoofedFields, userId: params.userId, organizationId: params.organizationId },
      '[SECURITY] Authority spoofing attempt detected',
    )
  }

  // ── Step 2: Build trusted context from server-owned sources ──
  return {
    organizationScope: `org:${params.organizationId}`,
    projectScope: params.projectId ? `proj:${params.projectId}` : undefined,
    actorRef: `user:${params.userId}`,
    actorRoles: params.userRoles,
    policyResults: params.policyResults,
  }
}

/**
 * Validate that context is server-owned and not tampered.
 * Returns true if context is valid.
 */
export function validateTrustedContext(context: PluginPermissionTrustedContext): boolean {
  // Organization scope must be present
  if (!context.organizationScope || !context.organizationScope.startsWith('org:')) {
    return false
  }

  // Actor ref must be present
  if (!context.actorRef || !context.actorRef.startsWith('user:')) {
    return false
  }

  // Actor roles must be array
  if (!Array.isArray(context.actorRoles)) {
    return false
  }

  // Policy results must be object
  if (typeof context.policyResults !== 'object' || context.policyResults === null) {
    return false
  }

  return true
}
