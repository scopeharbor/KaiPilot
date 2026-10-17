/**
 * v3-plugin-permission-audit-and-observation — Decision Service（task 5.7-5.8）。
 *
 * 权限决策编排器：normalize → evaluate (admin or runtime) → envelope → record → receipt。
 * 任何 exception/timeout/unknown 被稳定归一为 denial。
 * Observation 不在授权依赖图中。
 *
 * 红线：
 * - allowed 仅在可信审计事务提交后返回
 * - 失败 fallback 不绕过权限
 * - denial 永不翻转为 allowed
 * - Any exception → stable denial
 */
import type {
  PluginPermissionDecisionMode,
  PluginPermissionDecisionOperation,
  PluginPermissionDecisionOutcome,
  PluginPermissionDecisionRecord,
  PluginPermissionDecisionReceipt,
  PluginPermissionReasonCode,
  PluginPermissionRequestedRef,
  PluginPermissionGrantedRef,
  PluginPermissionRuntimeRef,
  PluginPermissionTrustedContext,
} from '@aiproj/types'
import {
  PLUGIN_PERMISSION_DECISION_SCHEMA_VERSION,
  pdComputeDecisionId,
  pdComputeInputFingerprint,
} from '@aiproj/types'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { recordDecision, AuditWriteFailedError } from './decision_recorder.js'
import { evaluateHostAdminProfile } from './admin_profile_evaluator.js'
import { evaluateRuntimeProfile } from './runtime_profile_evaluator.js'
import logger from '@adonisjs/core/services/logger'

// =============================================================================
// Types
// =============================================================================

export interface DecideParams {
  /** Server-owned trusted context (from middleware, NOT from client). */
  trustedContext: PluginPermissionTrustedContext
  /** Decision mode. */
  mode: PluginPermissionDecisionMode
  /** Decision operation. */
  operation: PluginPermissionDecisionOperation
  /** Low-sensitive target reference. */
  targetRef: string
  /** Requested permissions snapshot. */
  requestedPermissions: PluginPermissionRequestedRef[]
  /** Granted permissions snapshot. */
  grantedPermissions: PluginPermissionGrantedRef[]
  /** Runtime state (for plugin-runtime mode). */
  runtimeRef?: PluginPermissionRuntimeRef
  /** Idempotency key. */
  idempotencyKey: string
  /** Organization ID (server-owned). */
  organizationId: number
  /** Project ID (optional, server-owned). */
  projectId?: number
  /** Transaction client. */
  trx: TransactionClientContract
  /** Audit service (injected). */
  auditService: any
  /** Whether audit storage is available (default true). */
  auditAvailable?: boolean
}

// =============================================================================
// Decision Orchestrator
// =============================================================================

/**
 * Main entry point: evaluate permission and record decision.
 *
 * Flow:
 * 1. Normalize input (compute decision id, fingerprint)
 * 2. Evaluate prerequisites (admin or runtime profile)
 * 3. Build decision envelope
 * 4. Record (transaction: ledger + audit + receipt backfill)
 * 5. Return receipt
 *
 * Any exception → stable denial. Never allowed on error.
 * Observation is NOT in the authorization dependency graph.
 * Failure fallback does NOT bypass permission.
 */
export async function decide(params: DecideParams): Promise<PluginPermissionDecisionReceipt> {
  try {
    // ── Step 1: Normalize ──
    const normalized = normalizeInput(params)

    // ── Step 2: Evaluate prerequisites (admin or runtime) ──
    const evaluation =
      params.mode === 'host-administration'
        ? evaluateHostAdminProfile({
            trustedContext: params.trustedContext,
            operation: params.operation,
            targetRef: params.targetRef,
            requestedPermissions: params.requestedPermissions,
            grantedPermissions: params.grantedPermissions,
          })
        : evaluateRuntimeProfile({
            trustedContext: params.trustedContext,
            operation: params.operation,
            targetRef: params.targetRef,
            requestedPermissions: params.requestedPermissions,
            grantedPermissions: params.grantedPermissions,
            runtimeRef: params.runtimeRef ?? {
              seamKey: '',
              seamAvailability: 'cataloged',
              installState: 'pending',
              confirmationPending: true,
            },
            auditAvailable: params.auditAvailable ?? true,
          })

    // ── Step 3: Build decision envelope ──
    const outcome: PluginPermissionDecisionOutcome = evaluation.allowed ? 'allowed' : 'denied'
    const primaryReason = evaluation.allowed
      ? undefined
      : (evaluation.reasonCode ?? 'unknown-error')

    const record: PluginPermissionDecisionRecord = {
      decisionId: normalized.decisionId,
      schemaVersion: PLUGIN_PERMISSION_DECISION_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      mode: params.mode,
      operation: params.operation,
      outcome,
      reasonCode: primaryReason,
      organizationScope: params.trustedContext.organizationScope,
      projectScope: params.trustedContext.projectScope,
      pluginId: normalized.pluginId,
      pluginVersion: normalized.pluginVersion,
      targetRef: params.targetRef,
      requestedPermissions: params.requestedPermissions,
      grantedPermissions: params.grantedPermissions,
      runtimeRef: params.runtimeRef,
      evaluation: {
        outcome,
        reasonCode: primaryReason,
        prerequisiteChecks: evaluation.prerequisiteChecks,
        evaluatedAt: evaluation.evaluatedAt,
      },
      idempotencyKey: params.idempotencyKey,
      inputFingerprint: normalized.fingerprint,
      actorRef: params.trustedContext.actorRef,
      observationDegraded: false,
    }

    // ── Step 4: Record (transaction) ──
    const result = await recordDecision({
      record,
      organizationId: params.organizationId,
      projectId: params.projectId,
      trx: params.trx,
      auditService: params.auditService,
    })

    // ── Step 5: Return receipt ──
    return result.receipt
  } catch (error) {
    // Any exception → stable denial. Never allowed on error.
    if (error instanceof AuditWriteFailedError) {
      return buildErrorReceipt(params, 'audit-unavailable')
    }

    logger.error(
      { err: error, operation: params.operation, mode: params.mode },
      'plugin_permission decide failed',
    )
    return buildErrorReceipt(params, 'unknown-error')
  }
}

// =============================================================================
// Normalization
// =============================================================================

interface NormalizedInput {
  decisionId: string
  fingerprint: string
  pluginId: string
  pluginVersion: string
}

function normalizeInput(params: DecideParams): NormalizedInput {
  // Generate deterministic decision id
  const decisionId = pdComputeDecisionId({
    schemaVersion: PLUGIN_PERMISSION_DECISION_SCHEMA_VERSION,
    organizationScope: params.trustedContext.organizationScope,
    projectScope: params.trustedContext.projectScope,
    mode: params.mode,
    operation: params.operation,
    targetRef: params.targetRef,
    requested: params.requestedPermissions,
    granted: params.grantedPermissions,
    idempotencyKey: params.idempotencyKey,
  })

  const fingerprint = pdComputeInputFingerprint({
    schemaVersion: PLUGIN_PERMISSION_DECISION_SCHEMA_VERSION,
    organizationScope: params.trustedContext.organizationScope,
    projectScope: params.trustedContext.projectScope,
    mode: params.mode,
    operation: params.operation,
    targetRef: params.targetRef,
    requested: params.requestedPermissions,
    granted: params.grantedPermissions,
    idempotencyKey: params.idempotencyKey,
  })

  // Extract plugin info from target ref (low-sensitive)
  const pluginId = params.targetRef.split(':')[0] ?? 'unknown'
  const pluginVersion = params.grantedPermissions[0]?.grantId ?? 'unknown'

  return { decisionId, fingerprint, pluginId, pluginVersion }
}

// =============================================================================
// Error Receipt Builder
// =============================================================================

/**
 * 构建错误 receipt（denied + reason code）。
 * 用于任何异常情况下的稳定降级。
 */
function buildErrorReceipt(
  params: DecideParams,
  reasonCode: PluginPermissionReasonCode,
): PluginPermissionDecisionReceipt {
  return {
    decisionId: pdComputeDecisionId({
      schemaVersion: PLUGIN_PERMISSION_DECISION_SCHEMA_VERSION,
      organizationScope: params.trustedContext.organizationScope,
      projectScope: params.trustedContext.projectScope,
      mode: params.mode,
      operation: params.operation,
      targetRef: params.targetRef,
      requested: params.requestedPermissions,
      granted: params.grantedPermissions,
      idempotencyKey: params.idempotencyKey,
    }),
    outcome: 'denied',
    reasonCode,
    createdAt: new Date().toISOString(),
    idempotencyKey: params.idempotencyKey,
  }
}
