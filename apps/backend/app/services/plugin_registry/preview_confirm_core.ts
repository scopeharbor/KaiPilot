/**
 * v3-plugin-private-registry-lifecycle — PreviewConfirm 纯核心（tasks 5.3–5.8）。
 *
 * 纯函数层：preview 生成、confirm 校验、maker-checker 规则、stale/replay 检测。
 * **零 Adonis/Lucid/数据库依赖**，可被 vitest 直跑。
 *
 * 红线：本核心只产出 preview DTO / confirm 校验结果，绝不包含数据库写入。
 */

import {
  type PrivateRegistryCommandPreview,
  type PrivateRegistryRelease,
  type RegistryCommandAction,
  type RegistryErrorCode,
  type RegistryReleaseStatus,
  isValidStatusTransition,
  checkMakerChecker,
  computeRegistrySourceHash,
  makePreviewHandle,
} from '@aiproj/types'

// =============================================================================
// 1. Preview Generation (task 5.3)
// =============================================================================

export interface GeneratePreviewInput {
  readonly action: RegistryCommandAction
  readonly release: PrivateRegistryRelease
  readonly actorRef: string
  readonly organizationId: string
  readonly stateVersion: number
  readonly ttlSeconds?: number
  readonly affectedInstanceIds?: readonly string[]
}

export type GeneratePreviewResult =
  | {
      readonly ok: true
      readonly preview: PrivateRegistryCommandPreview
      readonly diff: string
      readonly impactSummary: string[]
    }
  | {
      readonly ok: false
      readonly errorCode: RegistryErrorCode
      readonly message: string
    }

const DEFAULT_TTL_SECONDS = 300

/**
 * Generate a command preview for a registry action.
 * D5: All mutations go through preview/confirm boundary.
 */
export function generatePreview(input: GeneratePreviewInput): GeneratePreviewResult {
  const now = new Date().toISOString()
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_TTL_SECONDS

  // Validate action is legal for current status
  const targetStatus = getTargetStatus(input.action)
  if (targetStatus && !isValidStatusTransition(input.release.status, targetStatus)) {
    return {
      ok: false,
      errorCode: 'registry-illegal-status-transition',
      message: `Cannot ${input.action} from status ${input.release.status}`,
    }
  }

  const diff = buildDiffDescription(input.action, input.release, input.affectedInstanceIds)
  const impactSummary = buildImpactSummary(input.action, input.release, input.affectedInstanceIds)

  const sourceHash = computeRegistrySourceHash({
    action: input.action,
    releaseId: input.release.id,
    stateVersion: input.stateVersion,
    status: input.release.status,
  })

  const handle = makePreviewHandle(
    input.organizationId,
    input.action,
    input.release.id,
    input.stateVersion,
    now,
  )

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()

  const preview: PrivateRegistryCommandPreview = {
    handle,
    organizationId: input.organizationId,
    actorRef: input.actorRef,
    action: input.action,
    targetReleaseId: input.release.id,
    stateVersion: input.stateVersion,
    sourceHash,
    diff,
    impactSummary,
    ttlSeconds,
    createdAt: now,
    expiresAt,
  }

  return { ok: true, preview, diff, impactSummary }
}

// =============================================================================
// 2. Confirm Validation (task 5.5)
// =============================================================================

export interface ConfirmInput {
  readonly preview: PrivateRegistryCommandPreview
  readonly currentRelease: PrivateRegistryRelease
  readonly currentActorRef: string
  readonly currentOrganizationId: string
  readonly currentStateVersion: number
  readonly hasPermission: boolean
  readonly submitterRef?: string
}

export type ConfirmResult =
  | {
      readonly ok: true
      readonly action: RegistryCommandAction
      readonly targetReleaseId: string
      readonly orgId: string
      readonly actorRef: string
    }
  | {
      readonly ok: false
      readonly errorCode: RegistryErrorCode
      readonly message: string
    }

/**
 * Validate a confirm request against the preview.
 * D5: Re-validates organization, actor, action, target, state version, digest,
 * source hash, TTL, and permissions. Rejects expired, replayed, cross-org, or stale.
 */
export function validateConfirm(input: ConfirmInput): ConfirmResult {
  const { preview } = input

  // 1. Check TTL (expired)
  if (new Date(preview.expiresAt).getTime() < Date.now()) {
    return { ok: false, errorCode: 'registry-preview-expired', message: 'Preview has expired' }
  }

  // 2. Check organization match (cross-org)
  if (preview.organizationId !== input.currentOrganizationId) {
    return {
      ok: false,
      errorCode: 'registry-preview-cross-org',
      message: 'Preview belongs to a different organization',
    }
  }

  // 3. Check actor match
  if (preview.actorRef !== input.currentActorRef) {
    return {
      ok: false,
      errorCode: 'registry-preview-target-mismatch',
      message: 'Actor does not match preview',
    }
  }

  // 4. Check target release match
  if (preview.targetReleaseId !== input.currentRelease.id) {
    return {
      ok: false,
      errorCode: 'registry-preview-target-mismatch',
      message: 'Target release has changed',
    }
  }

  // 5. Check action match
  // 注：原写法外层是 `preview.action !== input.currentRelease.status`——action 与 status 是
  // 两个不相交的联合类型，该比较恒为 true，外层 if 没有任何筛选作用（TS2367）。
  // 真正的校验是「该 action 从当前状态出发是否仍合法」，直接执行即可。
  const targetStatus = getTargetStatus(preview.action)
  if (targetStatus && !isValidStatusTransition(input.currentRelease.status, targetStatus)) {
    return {
      ok: false,
      errorCode: 'registry-preview-action-mismatch',
      message: 'Release status has changed since preview',
    }
  }

  // 6. Check state version (stale)
  if (preview.stateVersion !== input.currentStateVersion) {
    return {
      ok: false,
      errorCode: 'registry-preview-stale',
      message: 'Release state has changed since preview',
    }
  }

  // 7. Check source hash (stale)
  const expectedHash = computeRegistrySourceHash({
    action: preview.action,
    releaseId: preview.targetReleaseId,
    stateVersion: input.currentStateVersion,
    status: input.currentRelease.status,
  })
  if (preview.sourceHash !== expectedHash) {
    return {
      ok: false,
      errorCode: 'registry-preview-stale',
      message: 'Source state has changed since preview',
    }
  }

  // 8. Check permissions
  if (!input.hasPermission) {
    return {
      ok: false,
      errorCode: 'registry-permission-denied',
      message: 'Insufficient permissions',
    }
  }

  // 9. Maker-checker (tasks 5.7–5.8)
  if (input.submitterRef) {
    const makerCheckerViolation = checkMakerChecker(
      preview.action,
      input.submitterRef,
      input.currentActorRef,
    )
    if (makerCheckerViolation) {
      return {
        ok: false,
        errorCode: makerCheckerViolation,
        message: 'Maker-checker violation: reviewer must differ from submitter',
      }
    }
  }

  return {
    ok: true,
    action: preview.action,
    targetReleaseId: preview.targetReleaseId,
    orgId: preview.organizationId,
    actorRef: preview.actorRef,
  }
}

// =============================================================================
// 3. Maker-Checker Rules (tasks 5.7–5.8)
// =============================================================================

/**
 * Determine which actions require maker-checker separation.
 */
export function requiresMakerChecker(action: RegistryCommandAction): boolean {
  return action === 'approve' || action === 'reject' || action === 'rollback'
}

/**
 * Check if the given actor is the submitter of a review.
 */
export function isSubmitter(submitterRef: string, reviewerRef: string): boolean {
  return submitterRef === reviewerRef
}

// =============================================================================
// 4. Diff & Impact Building
// =============================================================================

function getTargetStatus(action: RegistryCommandAction): RegistryReleaseStatus | null {
  switch (action) {
    case 'submit-for-review':
      return 'pending_review'
    case 'approve':
      return 'approved'
    case 'reject':
      return 'rejected'
    case 'deprecate':
      return 'deprecated'
    case 'undeprecate':
      return 'approved'
    case 'withdraw':
      return 'withdrawn'
    default:
      return null
  }
}

function buildDiffDescription(
  action: RegistryCommandAction,
  release: PrivateRegistryRelease,
  instanceIds?: readonly string[],
): string {
  const targetStatus = getTargetStatus(action)
  const parts: string[] = []

  if (targetStatus) {
    parts.push(`Status: ${release.status} → ${targetStatus}`)
  }

  if (action === 'rollback' && instanceIds && instanceIds.length > 0) {
    parts.push(`Rollback ${instanceIds.length} instance(s) to version ${release.version}`)
  } else if (action === 'rollback') {
    parts.push('Update recommended pointer only (no instance changes)')
  }

  if (action === 'create-release') {
    parts.push(`Register new release v${release.version} for ${release.pluginIdentity}`)
  }

  return parts.join('; ') || `${action} on release ${release.id}`
}

function buildImpactSummary(
  action: RegistryCommandAction,
  /** 影响集合只按 action 与实例数派生，暂不读取 release 字段；保留形参以对齐调用点。 */
  _release: PrivateRegistryRelease,
  instanceIds?: readonly string[],
): string[] {
  const impacts: string[] = []

  if (action === 'approve') {
    impacts.push('Release will become discoverable')
    impacts.push('Recommended pointer unchanged')
  } else if (action === 'withdraw') {
    impacts.push('Release will be excluded from resolution')
    impacts.push('Existing installations will not be affected')
  } else if (action === 'rollback') {
    if (instanceIds && instanceIds.length > 0) {
      impacts.push(`${instanceIds.length} installation(s) will be downgraded`)
    } else {
      impacts.push('Only recommended pointer will change')
    }
  }

  return impacts
}
