/**
 * v3-plugin-private-registry-lifecycle — StatusOrchestration 纯核心（tasks 5.9–5.10）。
 *
 * 纯函数层：submit/approve/reject/deprecate/withdraw/restore-request 状态编排，
 * withdrawn 恢复强制重新验证 receipt/integrity/compatibility 并创建新 review cycle。
 * **零 Adonis/Lucid/数据库依赖**，可被 vitest 直跑。
 *
 * 红线：本核心只产出状态转换指令/校验结果，绝不包含数据库写入。
 */

import {
  type PrivateRegistryRelease,
  type PrivateRegistryReview,
  type RegistryCommandAction,
  type RegistryErrorCode,
  type RegistryReleaseStatus,
  isValidStatusTransition,
} from '@aiproj/types'

// =============================================================================
// 1. Status Transition Instruction
// =============================================================================

export interface TransitionInstruction {
  readonly action: RegistryCommandAction
  readonly currentStatus: RegistryReleaseStatus
  readonly targetStatus: RegistryReleaseStatus
  readonly requiresNewReviewCycle: boolean
  readonly requiresRevalidation: boolean
  readonly requiresMakerChecker: boolean
}

/**
 * Map action to transition instruction.
 */
export function getTransitionInstruction(
  action: RegistryCommandAction,
): TransitionInstruction | null {
  switch (action) {
    case 'submit-for-review':
      return {
        action,
        currentStatus: 'draft',
        targetStatus: 'pending_review',
        requiresNewReviewCycle: false,
        requiresRevalidation: false,
        requiresMakerChecker: false,
      }
    case 'approve':
      return {
        action,
        currentStatus: 'pending_review',
        targetStatus: 'approved',
        requiresNewReviewCycle: false,
        requiresRevalidation: false,
        requiresMakerChecker: true,
      }
    case 'reject':
      return {
        action,
        currentStatus: 'pending_review',
        targetStatus: 'rejected',
        requiresNewReviewCycle: false,
        requiresRevalidation: false,
        requiresMakerChecker: true,
      }
    case 'deprecate':
      return {
        action,
        currentStatus: 'approved',
        targetStatus: 'deprecated',
        requiresNewReviewCycle: false,
        requiresRevalidation: false,
        requiresMakerChecker: false,
      }
    case 'undeprecate':
      return {
        action,
        currentStatus: 'deprecated',
        targetStatus: 'approved',
        requiresNewReviewCycle: false,
        requiresRevalidation: false,
        requiresMakerChecker: false,
      }
    case 'withdraw':
      return {
        action,
        currentStatus: 'approved',
        targetStatus: 'withdrawn',
        requiresNewReviewCycle: false,
        requiresRevalidation: false,
        requiresMakerChecker: true,
      }
    case 'restore-request':
      // D4: withdrawn → must re-enter through new review cycle
      return {
        action,
        currentStatus: 'withdrawn',
        targetStatus: 'draft', // goes to draft, not directly to approved
        requiresNewReviewCycle: true,
        requiresRevalidation: true, // must re-verify receipt/integrity/compatibility
        requiresMakerChecker: false,
      }
    default:
      return null
  }
}

// =============================================================================
// 2. Transition Validation
// =============================================================================

export type TransitionValidationResult =
  | {
      readonly valid: true
      readonly instruction: TransitionInstruction
    }
  | {
      readonly valid: false
      readonly errorCode: RegistryErrorCode
      readonly message: string
    }

/**
 * Validate whether a transition is legal for the current status.
 * Combines state machine check with business rules.
 */
export function validateTransition(
  action: RegistryCommandAction,
  currentStatus: RegistryReleaseStatus,
): TransitionValidationResult {
  const instruction = getTransitionInstruction(action)
  if (!instruction) {
    return {
      valid: false,
      errorCode: 'registry-invalid-action',
      message: `Unknown action: ${action}`,
    }
  }

  if (instruction.currentStatus !== currentStatus) {
    return {
      valid: false,
      errorCode: 'registry-illegal-status-transition',
      message: `Cannot ${action} from status ${currentStatus} (expected ${instruction.currentStatus})`,
    }
  }

  if (!isValidStatusTransition(currentStatus, instruction.targetStatus)) {
    return {
      valid: false,
      errorCode: 'registry-illegal-status-transition',
      message: `Transition ${currentStatus} → ${instruction.targetStatus} is not allowed`,
    }
  }

  return { valid: true, instruction }
}

// =============================================================================
// 3. Restore-Request Business Rules (task 5.9)
// =============================================================================

export interface RestoreValidationInput {
  readonly release: PrivateRegistryRelease
  readonly latestReview: PrivateRegistryReview | null
  readonly receiptValid: boolean
  readonly integrityValid: boolean
  readonly compatibilityValid: boolean
}

export type RestoreValidationResult =
  | {
      readonly allowed: true
    }
  | {
      readonly allowed: false
      readonly errorCode: RegistryErrorCode
      readonly message: string
    }

/**
 * Validate restore-request for a withdrawn release.
 * D4: Must re-verify receipt/integrity/compatibility and create new review cycle.
 */
export function validateRestoreRequest(input: RestoreValidationInput): RestoreValidationResult {
  const { release } = input

  // Must be withdrawn
  if (release.status !== 'withdrawn') {
    return {
      allowed: false,
      errorCode: 'registry-illegal-status-transition',
      message: 'Restore request is only allowed for withdrawn releases',
    }
  }

  // Must have valid upstream receipt
  if (!input.receiptValid) {
    return {
      allowed: false,
      errorCode: 'registry-receipt-invalid',
      message: 'Upstream receipt is no longer valid for restore',
    }
  }

  // Must pass integrity check
  if (!input.integrityValid) {
    return {
      allowed: false,
      errorCode: 'registry-receipt-integrity-failed',
      message: 'Package integrity check failed for restore',
    }
  }

  // Must pass compatibility check
  if (!input.compatibilityValid) {
    return {
      allowed: false,
      errorCode: 'registry-rollback-target-incompatible',
      message: 'Host/seam compatibility check failed for restore',
    }
  }

  return { allowed: true }
}

// =============================================================================
// 4. Review Cycle Management (task 5.9)
// =============================================================================

/**
 * Determine the next review cycle number for a release.
 */
export function nextCycleNumber(existingReviews: readonly PrivateRegistryReview[]): number {
  if (existingReviews.length === 0) return 1
  return Math.max(...existingReviews.map((r) => r.cycleNumber)) + 1
}

/**
 * Determine if a release needs a new review cycle based on its status history.
 */
export function needsNewReviewCycle(
  action: RegistryCommandAction,
  /** 是否需要新 review cycle 只由 action 决定；保留形参以对齐调用点与未来按状态细分。 */
  _currentStatus: RegistryReleaseStatus,
): boolean {
  const instruction = getTransitionInstruction(action)
  return instruction?.requiresNewReviewCycle ?? false
}

// =============================================================================
// 5. Lifecycle Integration (task 5.10)
// =============================================================================

export interface LifecycleStep {
  readonly name: string
  readonly description: string
  readonly required: boolean
}

/**
 * Get the lifecycle steps for a given action.
 * Used by the service layer to orchestrate the full flow.
 */
export function getLifecycleSteps(action: RegistryCommandAction): LifecycleStep[] {
  const instruction = getTransitionInstruction(action)
  if (!instruction) return []

  const steps: LifecycleStep[] = [
    {
      name: 'validate-transition',
      description: 'Validate state machine transition',
      required: true,
    },
    { name: 'check-permissions', description: 'Verify RBAC permissions', required: true },
  ]

  if (instruction.requiresRevalidation) {
    steps.push({
      name: 'revalidate-receipt',
      description: 'Re-verify upstream receipt',
      required: true,
    })
    steps.push({
      name: 'revalidate-integrity',
      description: 'Re-verify package integrity',
      required: true,
    })
    steps.push({
      name: 'revalidate-compatibility',
      description: 'Re-verify host/seam compatibility',
      required: true,
    })
  }

  if (instruction.requiresMakerChecker) {
    steps.push({
      name: 'maker-checker',
      description: 'Verify reviewer differs from submitter',
      required: true,
    })
  }

  if (instruction.requiresNewReviewCycle) {
    steps.push({
      name: 'create-review-cycle',
      description: 'Create new review cycle record',
      required: true,
    })
  }

  steps.push(
    {
      name: 'generate-preview',
      description: 'Generate command preview with diff/impact',
      required: true,
    },
    {
      name: 'confirm-preview',
      description: 'Confirm preview with handle validation',
      required: true,
    },
    {
      name: 'apply-transition',
      description: 'Apply status transition in transaction',
      required: true,
    },
    { name: 'write-audit', description: 'Write low-sensitive audit event', required: true },
  )

  return steps
}

/**
 * Check if a status transition would affect installation state.
 * D4: directory status MUST NOT affect installation state.
 */
export function wouldAffectInstallations(
  _fromStatus: RegistryReleaseStatus,
  _toStatus: RegistryReleaseStatus,
): boolean {
  // Directory status changes never affect installations
  // Only lifecycle adapter (W2b) can change installation state
  return false
}

/**
 * Get the set of legal actions for a given status.
 */
export function legalActionsForStatus(status: RegistryReleaseStatus): RegistryCommandAction[] {
  const actions: RegistryCommandAction[] = []

  switch (status) {
    case 'draft':
      actions.push('submit-for-review')
      break
    case 'pending_review':
      actions.push('approve', 'reject')
      break
    case 'approved':
      actions.push('deprecate', 'withdraw')
      break
    case 'deprecated':
      actions.push('undeprecate', 'withdraw')
      break
    case 'rejected':
      // Terminal — no actions
      break
    case 'withdrawn':
      actions.push('restore-request')
      break
  }

  return actions
}
