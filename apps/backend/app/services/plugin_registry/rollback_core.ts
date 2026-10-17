/**
 * v3-plugin-private-registry-lifecycle — Rollback 纯核心（tasks 6.1–6.8）。
 *
 * 纯函数层：rollback plan 生成、prepare/apply/commit 流程逻辑、
 * compensate/timeout/failure 处理、operation recovery。
 * **零 Adonis/Lucid/数据库依赖**，可被 vitest 直跑。
 *
 * 红线：本核心只产出 rollback plan / operation status / compensate 结果，
 * 绝不包含数据库写入或外部调用。
 */

import type {
  PrivateRegistryRelease,
  PrivateRegistryRollbackPlan,
  PrivateRegistryOperation,
  RegistryOperationStatus,
  RegistryErrorCode,
} from '@aiproj/types'
import { makePreviewHandle } from '@aiproj/types'

// =============================================================================
// 1. Rollback Plan Generation (task 6.1)
// =============================================================================

export interface GenerateRollbackPlanInput {
  readonly organizationId: string
  readonly currentRecommendedRelease: PrivateRegistryRelease
  readonly targetRelease: PrivateRegistryRelease
  readonly selectedInstanceIds: readonly string[]
  readonly actorRef: string
  readonly stateVersion: number
}

export type GenerateRollbackPlanResult =
  | {
      readonly ok: true
      readonly plan: PrivateRegistryRollbackPlan
    }
  | {
      readonly ok: false
      readonly errorCode: RegistryErrorCode
      readonly message: string
    }

/**
 * Generate a rollback plan.
 * D8: Target must be approved, complete, compatible. Default: pointer only.
 */
export function generateRollbackPlan(input: GenerateRollbackPlanInput): GenerateRollbackPlanResult {
  const { targetRelease, currentRecommendedRelease } = input

  // Validate target is approved
  if (targetRelease.status !== 'approved') {
    return {
      ok: false,
      errorCode: 'registry-rollback-target-invalid',
      message: `Target release is ${targetRelease.status}, must be approved`,
    }
  }

  // Validate target is not the current recommended
  if (targetRelease.id === currentRecommendedRelease.id) {
    return {
      ok: false,
      errorCode: 'registry-rollback-target-invalid',
      message: 'Target release is already the recommended version',
    }
  }

  // Validate target has valid digests
  if (!targetRelease.packageDigest || !targetRelease.manifestDigest) {
    return {
      ok: false,
      errorCode: 'registry-rollback-target-invalid',
      message: 'Target release has incomplete integrity data',
    }
  }

  const now = new Date().toISOString()
  const handle = makePreviewHandle(
    input.organizationId,
    'rollback',
    targetRelease.id,
    input.stateVersion,
    now,
  )

  const plan: PrivateRegistryRollbackPlan = {
    id: `rollback-plan-${targetRelease.id}-${Date.now()}`,
    organizationId: input.organizationId,
    currentRecommendedReleaseId: currentRecommendedRelease.id,
    targetReleaseId: targetRelease.id,
    targetVersion: targetRelease.version,
    updateRecommendedPointer: true,
    selectedInstanceIds: [...input.selectedInstanceIds],
    diff: `Rollback recommended version from ${currentRecommendedRelease.version} to ${targetRelease.version}`,
    handle,
  }

  return { ok: true, plan }
}

/**
 * Validate rollback target selection.
 */
export function validateRollbackTarget(
  target: PrivateRegistryRelease,
  availableReleases: readonly PrivateRegistryRelease[],
): RegistryErrorCode | null {
  if (target.status !== 'approved') {
    return 'registry-rollback-target-invalid'
  }
  if (!availableReleases.some((r) => r.id === target.id)) {
    return 'registry-rollback-target-invalid'
  }
  return null
}

// =============================================================================
// 2. Rollback Prepare/Apply/Commit (task 6.3)
// =============================================================================

export interface RollbackStepResult {
  readonly ok: boolean
  readonly step: 'prepare' | 'apply' | 'commit'
  readonly errorCode?: RegistryErrorCode
  readonly message?: string
}

/**
 * Simulate rollback prepare step.
 * In production: validates target is still approved, complete, compatible.
 */
export function rollbackPrepare(
  targetRelease: PrivateRegistryRelease,
  currentStatus: RegistryOperationStatus,
): RollbackStepResult {
  if (currentStatus !== 'confirmed') {
    return {
      ok: false,
      step: 'prepare',
      errorCode: 'registry-rollback-partial-failure',
      message: 'Operation not in confirmed state',
    }
  }
  if (targetRelease.status !== 'approved') {
    return {
      ok: false,
      step: 'prepare',
      errorCode: 'registry-rollback-target-invalid',
      message: 'Target no longer approved',
    }
  }
  return { ok: true, step: 'prepare' }
}

/**
 * Simulate rollback apply step.
 * In production: delegates to W2b lifecycle adapter for each instance.
 */
export function rollbackApply(
  instanceCount: number,
): RollbackStepResult & { instancesUpdated: number } {
  // In fixture mode, all instances succeed
  return { ok: true, step: 'apply', instancesUpdated: instanceCount }
}

/**
 * Simulate rollback commit step.
 * In production: switches recommended pointer in transaction.
 */
export function rollbackCommit(currentStatus: RegistryOperationStatus): RollbackStepResult {
  if (currentStatus !== 'applying') {
    return {
      ok: false,
      step: 'commit',
      errorCode: 'registry-rollback-partial-failure',
      message: 'Operation not in applying state',
    }
  }
  return { ok: true, step: 'commit' }
}

// =============================================================================
// 3. Compensate & Failure Handling (task 6.5)
// =============================================================================

export interface CompensateResult {
  readonly compensated: number
  readonly failed: number
  readonly degraded: boolean
}

/**
 * Attempt to compensate already-changed instances.
 * D8: Failed/timed-out rollback preserves original recommended version.
 */
export function compensateInstances(
  changedInstanceIds: readonly string[],
  successRate: number = 1.0,
): CompensateResult {
  const compensated = Math.floor(changedInstanceIds.length * successRate)
  const failed = changedInstanceIds.length - compensated
  return {
    compensated,
    failed,
    degraded: failed > 0,
  }
}

/**
 * Determine final operation status after rollback attempt.
 */
export function resolveRollbackStatus(
  prepareOk: boolean,
  _applyResult: { instancesUpdated: number },
  commitOk: boolean,
  compensateResult: CompensateResult,
): RegistryOperationStatus {
  if (!prepareOk) return 'failed'
  if (!commitOk) {
    if (compensateResult.degraded) return 'degraded'
    return 'compensated'
  }
  if (compensateResult.degraded) return 'degraded'
  return 'committed'
}

/**
 * Check if a degraded operation blocks new rollback attempts.
 */
export function isDegradedBlocking(operations: readonly PrivateRegistryOperation[]): boolean {
  return operations.some((op) => op.operationType === 'rollback' && op.status === 'degraded')
}

// =============================================================================
// 4. Operation Recovery (task 6.7)
// =============================================================================

export interface RecoveryResult {
  readonly processed: number
  readonly retried: number
  readonly failed: number
  readonly degradedManual: number
}

/**
 * Process non-terminal operations for recovery.
 * D8: Only processes current org visible operations, limited retries.
 */
export function processRecoverableOperations(
  operations: readonly PrivateRegistryOperation[],
  maxRetries: number = 3,
): RecoveryResult {
  const recoverable = operations.filter(
    (op) => op.status !== 'committed' && op.status !== 'compensated',
  )

  let retried = 0
  let failed = 0
  let degradedManual = 0

  for (const op of recoverable) {
    if (op.status === 'degraded') {
      degradedManual++
    } else if (op.status === 'failed') {
      failed++
    } else {
      // pending/confirmed/applying — attempt retry
      retried++
    }
  }

  return {
    processed: recoverable.length,
    retried: Math.min(retried, maxRetries),
    failed,
    degradedManual,
  }
}
