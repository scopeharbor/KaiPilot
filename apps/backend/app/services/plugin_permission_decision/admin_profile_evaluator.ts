/**
 * v3-plugin-permission-audit-and-observation — Host-Admin Profile Evaluator（task 5.3-5.4）。
 *
 * 评估 host-administration 模式操作的权限。
 * 输入：trusted context + operation + target ref。
 * 输出：结构化权限评估结果。
 *
 * 红线：
 * - 不写数据库
 * - 不发起 HTTP 请求
 * - 不伪造 plugin grant
 * - 所有判定来自 server-owned context
 */
import type {
  PluginPermissionTrustedContext,
  PluginPermissionRequestedRef,
  PluginPermissionGrantedRef,
  PluginPermissionPrerequisiteCheck,
  PluginPermissionDecisionOperation,
  PluginPermissionReasonCode,
} from '@aiproj/types'
import { pdEvaluatePrerequisites } from '@aiproj/types'

// =============================================================================
// Types
// =============================================================================

export interface AdminProfileInput {
  /** Server-owned trusted context (from middleware). */
  trustedContext: PluginPermissionTrustedContext
  /** Decision operation. */
  operation: PluginPermissionDecisionOperation
  /** Low-sensitive target reference. */
  targetRef: string
  /** Requested permissions snapshot. */
  requestedPermissions: PluginPermissionRequestedRef[]
  /** Granted permissions snapshot. */
  grantedPermissions: PluginPermissionGrantedRef[]
}

export interface AdminProfileResult {
  /** Whether the operation is allowed. */
  allowed: boolean
  /** Primary reason code if denied. */
  reasonCode?: PluginPermissionReasonCode
  /** Low-sensitive reason message. */
  reasonMessage?: string
  /** Prerequisite check results. */
  prerequisiteChecks: PluginPermissionPrerequisiteCheck[]
  /** Evaluation timestamp. */
  evaluatedAt: string
}

// =============================================================================
// Host-Admin Operation Classification
// =============================================================================

/**
 * 读操作集合：不需要 grant，只需要 RBAC + scope。
 */
const READ_OPERATIONS: Set<PluginPermissionDecisionOperation> = new Set([
  'resolve-query',
  'ui-slot',
])

/**
 * 判断操作是否为只读。
 */
function isReadOperation(operation: PluginPermissionDecisionOperation): boolean {
  return READ_OPERATIONS.has(operation)
}

// =============================================================================
// Evaluator
// =============================================================================

/**
 * 评估 host-administration 模式操作的权限。
 *
 * Prerequisite profiles:
 * - 读操作 → host-admin-read
 * - 变更操作 → host-admin-mutation
 *
 * 所有判定来自 server-owned context（trusted context + RBAC + Policy）。
 * 不写数据库、不发 HTTP、不伪造 grant。
 */
export function evaluateHostAdminProfile(input: AdminProfileInput): AdminProfileResult {
  const { trustedContext, operation, grantedPermissions } = input
  const evaluatedAt = new Date().toISOString()

  // 1. 选择 prerequisite profile
  const profile = isReadOperation(operation) ? 'host-admin-read' : 'host-admin-mutation'

  // 2. 构建 prerequisite state
  const hasValidGrant = grantedPermissions.some((g) => !g.expired && !g.revoked)
  const rbacAuthorized = Object.values(trustedContext.policyResults).some((p) => p.allowed)
  const policyPasses = Object.values(trustedContext.policyResults).every((p) => p.allowed)

  const state = {
    hasValidInstall: true, // host-admin 模式不检查 install state
    hasValidGrant,
    rbacAuthorized,
    scopeMatches: true, // 由 trusted context 保证
    seamHostReady: true, // host-admin 模式不检查 seam
    policyPasses,
    confirmationConfirmed: true, // host-admin 模式不需要用户确认
    auditAvailable: true, // 由调用方保证
  }

  // 3. 评估 prerequisites
  const checks = pdEvaluatePrerequisites(profile, state)
  const firstFailure = checks.find((c) => !c.passed)

  return {
    allowed: !firstFailure,
    reasonCode: firstFailure?.reasonCode,
    reasonMessage: firstFailure
      ? `Host-administration prerequisite failed: ${firstFailure.name}`
      : undefined,
    prerequisiteChecks: checks,
    evaluatedAt,
  }
}
