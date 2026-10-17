/**
 * v3-plugin-permission-audit-and-observation — Plugin-Runtime Profile Evaluator（task 5.5-5.6）。
 *
 * 评估 plugin-runtime 模式操作的权限。
 * 复用 validateGrantSubset / seam helpers from @aiproj/types。
 *
 * 组合条件：valid install + grant + RBAC/Policy + scope + host readiness +
 *            confirmation/network gates。
 *
 * 红线：
 * - 所有判定来自 server-owned context
 * - grant 校验使用 @aiproj/types 中的确定性 helpers
 * - 不写数据库、不发 HTTP
 */
import type {
  PluginPermissionTrustedContext,
  PluginPermissionRequestedRef,
  PluginPermissionGrantedRef,
  PluginPermissionRuntimeRef,
  PluginPermissionPrerequisiteCheck,
  PluginPermissionDecisionOperation,
  PluginPermissionReasonCode,
} from '@aiproj/types'
import { pdEvaluatePrerequisites } from '@aiproj/types'

// =============================================================================
// Types
// =============================================================================

export interface RuntimeProfileInput {
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
  /** Runtime state (seam, install, confirmation). */
  runtimeRef: PluginPermissionRuntimeRef
  /** Whether audit storage is available. */
  auditAvailable?: boolean
  /** Whether network gate is required. */
  networkRequired?: boolean
}

export interface RuntimeProfileResult {
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
// Runtime Operation Classification
// =============================================================================

/**
 * 读操作：不需要 confirmation，不需要 audit。
 */
const RUNTIME_READ_OPERATIONS: Set<PluginPermissionDecisionOperation> = new Set([
  'resolve-query',
  'ui-slot',
])

/**
 * 正式写操作：需要 confirmation + audit + full grant。
 */
const RUNTIME_FORMAL_WRITE_OPERATIONS: Set<PluginPermissionDecisionOperation> = new Set([
  'execute',
  'command-proposal',
  'skill-adapter',
  'compiler-contribution',
])

function isRuntimeReadOperation(operation: PluginPermissionDecisionOperation): boolean {
  return RUNTIME_READ_OPERATIONS.has(operation)
}

function isRuntimeFormalWriteOperation(operation: PluginPermissionDecisionOperation): boolean {
  return RUNTIME_FORMAL_WRITE_OPERATIONS.has(operation)
}

// =============================================================================
// Grant Subset Validation
// =============================================================================

/**
 * 验证 granted permissions 是否覆盖 requested permissions。
 * 使用确定性比较，不查库。
 *
 * 规则：
 * - 每个 requested permission key 必须有对应的 granted permission
 * - granted permission 不能过期或撤销
 * - scope binding 必须匹配
 */
function validateGrantSubset(
  requested: PluginPermissionRequestedRef[],
  granted: PluginPermissionGrantedRef[],
  organizationScope: string,
  projectScope?: string,
): { valid: boolean; reasonCode?: PluginPermissionReasonCode } {
  for (const req of requested) {
    const matchingGrant = granted.find((g) => g.permissionKey === req.permissionKey)

    if (!matchingGrant) {
      return { valid: false, reasonCode: 'grant-missing' }
    }

    if (matchingGrant.expired) {
      return { valid: false, reasonCode: 'grant-expired' }
    }

    if (matchingGrant.revoked) {
      return { valid: false, reasonCode: 'grant-revoked' }
    }

    // Check scope binding
    if (matchingGrant.scopeBinding.organizationScope !== organizationScope) {
      return { valid: false, reasonCode: 'cross-tenant-denied' }
    }

    if (projectScope && matchingGrant.scopeBinding.projectScope !== projectScope) {
      return { valid: false, reasonCode: 'scope-mismatch' }
    }

    // Check for grant escalation: granted scope must not exceed requested scope
    if (
      !req.scopeKind.includes('global') &&
      matchingGrant.scopeBinding.projectScope === undefined
    ) {
      return { valid: false, reasonCode: 'grant-escalation' }
    }
  }

  return { valid: true }
}

// =============================================================================
// Evaluator
// =============================================================================

/**
 * 评估 plugin-runtime 模式操作的权限。
 *
 * Prerequisite profiles:
 * - 读操作 → plugin-runtime-read
 * - 正式写操作 → plugin-runtime-formal-write
 *
 * 组合条件：
 * 1. Valid install state
 * 2. Valid grant (覆盖 requested permissions)
 * 3. RBAC/Policy passed
 * 4. Scope matches
 * 5. Seam host ready
 * 6. Confirmation confirmed (formal write)
 * 7. Audit available (formal write)
 */
export function evaluateRuntimeProfile(input: RuntimeProfileInput): RuntimeProfileResult {
  const {
    trustedContext,
    operation,
    requestedPermissions,
    grantedPermissions,
    runtimeRef,
    auditAvailable = true,
  } = input
  const evaluatedAt = new Date().toISOString()

  // 1. 选择 prerequisite profile
  const profile = isRuntimeReadOperation(operation)
    ? 'plugin-runtime-read'
    : isRuntimeFormalWriteOperation(operation)
      ? 'plugin-runtime-formal-write'
      : 'plugin-runtime-read'

  // 2. 验证 grant subset
  const grantValidation = validateGrantSubset(
    requestedPermissions,
    grantedPermissions,
    trustedContext.organizationScope,
    trustedContext.projectScope,
  )

  // 3. 构建 prerequisite state
  const hasValidInstall = runtimeRef.installState === 'installed'
  const hasValidGrant = grantValidation.valid
  const rbacAuthorized = Object.values(trustedContext.policyResults).some((p) => p.allowed)
  const policyPasses = Object.values(trustedContext.policyResults).every((p) => p.allowed)
  const seamHostReady = runtimeRef.seamAvailability === 'host-ready'

  const state = {
    hasValidInstall,
    hasValidGrant,
    rbacAuthorized,
    scopeMatches: true, // 由 trusted context + grant validation 保证
    seamHostReady,
    policyPasses,
    confirmationConfirmed: !runtimeRef.confirmationPending,
    auditAvailable,
  }

  // 4. 评估 prerequisites
  const checks = pdEvaluatePrerequisites(profile, state)

  // 5. 如果 grant validation 失败，添加对应的 check
  if (!grantValidation.valid) {
    checks.push({
      profile,
      name: 'grant-valid',
      passed: false,
      reasonCode: grantValidation.reasonCode,
    })
  }

  const firstFailure = checks.find((c) => !c.passed)

  return {
    allowed: !firstFailure,
    reasonCode: firstFailure?.reasonCode,
    reasonMessage: firstFailure
      ? `Plugin-runtime prerequisite failed: ${firstFailure.name}`
      : undefined,
    prerequisiteChecks: checks,
    evaluatedAt,
  }
}
