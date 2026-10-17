/**
 * v3-copilot-action-and-preview-boundary —— 确认前校验器纯核心（任务 4.x）。
 *
 * 纯函数层：权限复核、source 签名重校验（含捕获时间戳）、stale 判定与阻断、
 * 幂等去重判定、组织隔离校验、dry-run 门禁与「确认的 diff 即写入的 diff」一致性判定。
 * **零 Adonis/Lucid/数据库依赖**，可被 vitest 直跑。
 *
 * 红线（spec Requirement 2/3/4/6）：
 * - 失配阻断而非静默刷新：stale 情况下禁止重算后落库；
 * - 幂等键派生而非客户端自定义：同派生键 + 来源未变 → 返回既有结果；
 * - 跨组织动作恒被拒且不泄露存在。
 */
import type { CopilotActionSourceSignature } from '@aiproj/types'
import {
  deriveCopilotActionIdempotencyKey,
  isCopilotActionSourceSignatureFresh,
} from '@aiproj/types'

// ===========================================================================
// 4.1 权限复核
// ===========================================================================

export interface CopilotPermissionCheck {
  readonly granted: boolean
  /** 缺失的权限清单（调用方只用于审计计数，不得回显到无权限者）。 */
  readonly missing: readonly string[]
}

/** 动作所需权限是否全部在 actor 权限集内。 */
export function evaluateCopilotActionPermission(
  requiredPermissions: readonly string[],
  actorPermissions: readonly string[],
): CopilotPermissionCheck {
  const actorSet = new Set(actorPermissions)
  const missing = requiredPermissions.filter((p) => !actorSet.has(p))
  return { granted: missing.length === 0, missing }
}

// ===========================================================================
// 4.2/4.3 source 签名重校验与 stale 判定
// ===========================================================================

export interface CopilotSourceRevalidation {
  readonly fresh: boolean
  /** 失配的签名下标（低敏：只给下标，不给来源内容）。 */
  readonly mismatchedIndexes: readonly number[]
  readonly blockedReason: string | null
}

/**
 * 确认前重校验：请求携带的签名与动作记录/当前签名逐一比对
 * （内容 hash + 捕获时间戳，二者都须一致才算 fresh）。
 * 失配 → fresh=false + 阻断原因；禁止静默刷新后落库。
 */
export function revalidateCopilotActionSources(
  current: readonly CopilotActionSourceSignature[],
  recorded: readonly CopilotActionSourceSignature[],
): CopilotSourceRevalidation {
  const mismatchedIndexes: number[] = []
  const length = Math.max(current.length, recorded.length)
  for (let i = 0; i < length; i++) {
    const cur = current[i]
    const rec = recorded[i]
    if (!cur || !rec || !isCopilotActionSourceSignatureFresh(cur, rec)) {
      mismatchedIndexes.push(i)
    }
  }
  if (mismatchedIndexes.length === 0) {
    return { fresh: true, mismatchedIndexes: [], blockedReason: null }
  }
  return {
    fresh: false,
    mismatchedIndexes,
    blockedReason: '建议来源已过期，请刷新后重新审查（禁止静默重算后落库）',
  }
}

// ===========================================================================
// 4.5 确认的 diff 即写入的 diff（一致性判定）
// ===========================================================================

/**
 * 确认对象与最终写入对象一致性：请求的目标引用集合与 change set 的目标引用集合
 * 必须完全一致（稳定排序后逐项相等），防止确认后偷偷换写别的目标。
 */
export function assertConfirmedDiffEqualsWrite(
  confirmedTargetRefs: readonly string[],
  writeTargetRefs: readonly string[],
): boolean {
  if (confirmedTargetRefs.length !== writeTargetRefs.length) return false
  const a = [...confirmedTargetRefs].sort()
  const b = [...writeTargetRefs].sort()
  return a.every((ref, i) => ref === b[i])
}

// ===========================================================================
// 4.6 dry-run 门禁
// ===========================================================================

export function evaluateCopilotDryRunGate(dryRunCanApply: boolean): boolean {
  return dryRunCanApply
}

// ===========================================================================
// 4.8/4.9 幂等去重判定
// ===========================================================================

export interface CopilotIdempotencyCheck {
  readonly replay: boolean
  readonly reason: string | null
}

/**
 * 幂等判定：请求的派生幂等键与既有结果键一致且来源未变 → 重放既有结果，不重复写入。
 * 网络重试场景下同一派生键 + 同一来源签名命中同一结果。
 */
export function evaluateCopilotIdempotencyReplay(params: {
  readonly requestIdempotencyKey: string
  readonly existingResultIdempotencyKey: string | null
  readonly requestSources: readonly CopilotActionSourceSignature[]
  readonly existingSources: readonly CopilotActionSourceSignature[]
}): CopilotIdempotencyCheck {
  if (
    params.existingResultIdempotencyKey &&
    params.requestIdempotencyKey === params.existingResultIdempotencyKey &&
    params.requestSources.length === params.existingSources.length &&
    params.requestSources.every((sig, i) =>
      isCopilotActionSourceSignatureFresh(sig, params.existingSources[i]),
    )
  ) {
    return { replay: true, reason: '该确认已处理过，返回既有结果（幂等）' }
  }
  return { replay: false, reason: null }
}

/** 派生键重算：服务端必须重算请求键，不接受客户端键直接作为权威（防伪造）。 */
export function deriveServerSideIdempotencyKey(params: {
  readonly normalizedActionInput: string
  readonly targetEntityRefs: readonly string[]
  readonly sourceSignatures: readonly CopilotActionSourceSignature[]
}): string {
  return deriveCopilotActionIdempotencyKey({
    normalizedActionInput: params.normalizedActionInput,
    targetEntityRefs: params.targetEntityRefs,
    sourceSignatures: params.sourceSignatures,
  })
}

// ===========================================================================
// 4.10 组织隔离校验
// ===========================================================================

export interface CopilotOrganizationCheck {
  readonly allowed: boolean
  /** 非泄露错误：不透露目标组织是否存在或内容。 */
  readonly reason: string | null
}

/** 跨组织动作恒被拒；错误信息不泄露目标组织存在性。 */
export function evaluateCopilotOrganizationIsolation(params: {
  readonly actionOrganizationId: number
  readonly actorOrganizationId: number
}): CopilotOrganizationCheck {
  if (params.actionOrganizationId !== params.actorOrganizationId) {
    return { allowed: false, reason: '无法处理该请求' }
  }
  return { allowed: true, reason: null }
}

// ===========================================================================
// 4.x 综合判定（供端点组装）
// ===========================================================================

export interface CopilotConfirmationPreflight {
  readonly canConfirm: boolean
  readonly status:
    | 'ok'
    | 'permission_denied'
    | 'stale_blocked'
    | 'organization_denied'
    | 'diff_mismatch'
    | 'dry_run_failed'
    | 'idempotent_replay'
  readonly message: string
  readonly revalidation: CopilotSourceRevalidation | null
}

/**
 * 确认前综合校验：组织 → 权限 → stale → diff 一致 → dry-run。
 * 任一失败即阻断；幂等重放单独给出（调用方据此返回既有结果）。
 */
export function evaluateCopilotConfirmationPreflight(params: {
  readonly actorOrganizationId: number
  readonly actionOrganizationId: number
  readonly requiredPermissions: readonly string[]
  readonly actorPermissions: readonly string[]
  readonly requestSources: readonly CopilotActionSourceSignature[]
  readonly recordedSources: readonly CopilotActionSourceSignature[]
  readonly confirmedTargetRefs: readonly string[]
  readonly writeTargetRefs: readonly string[]
  readonly dryRunCanApply: boolean
}): CopilotConfirmationPreflight {
  const org = evaluateCopilotOrganizationIsolation({
    actionOrganizationId: params.actionOrganizationId,
    actorOrganizationId: params.actorOrganizationId,
  })
  if (!org.allowed) {
    return {
      canConfirm: false,
      status: 'organization_denied',
      message: org.reason ?? '无法处理该请求',
      revalidation: null,
    }
  }

  const perm = evaluateCopilotActionPermission(params.requiredPermissions, params.actorPermissions)
  if (!perm.granted) {
    return {
      canConfirm: false,
      status: 'permission_denied',
      message: '没有执行该操作的权限',
      revalidation: null,
    }
  }

  const revalidation = revalidateCopilotActionSources(params.requestSources, params.recordedSources)
  if (!revalidation.fresh) {
    return {
      canConfirm: false,
      status: 'stale_blocked',
      message: revalidation.blockedReason ?? '建议来源已过期',
      revalidation,
    }
  }

  if (!assertConfirmedDiffEqualsWrite(params.confirmedTargetRefs, params.writeTargetRefs)) {
    return {
      canConfirm: false,
      status: 'diff_mismatch',
      message: '确认的变更与将写入的变更不一致，已阻断',
      revalidation,
    }
  }

  if (!evaluateCopilotDryRunGate(params.dryRunCanApply)) {
    return {
      canConfirm: false,
      status: 'dry_run_failed',
      message: '试运行校验失败，已阻断应用',
      revalidation,
    }
  }

  return { canConfirm: true, status: 'ok', message: '可以确认', revalidation }
}
