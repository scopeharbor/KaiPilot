/**
 * v3-copilot-action-and-preview-boundary —— Copilot 决策翻译纯核心（任务 5.x）。
 *
 * 纯函数层：Copilot 决策 → 草案层五态映射、批量逐条结局判定、部分失败呈现、
 * 有界重试语义。**零 Adonis/Lucid/数据库依赖**，可被 vitest 直跑。
 *
 * 红线（spec Requirement 5/6/7）：
 * - 「修改后应用」必须记为 modified（独立于 accepted），保留用户值与备注；
 * - 批量逐条校验权限与 stale，任一失败不得整批静默通过；
 * - 部分失败不得呈现为完全成功；重试受幂等与 hash 重校验约束。
 */
import type {
  CopilotActionDecisionKind,
  CopilotBulkDecisionItemResult,
  CopilotBulkDecisionResult,
} from '@aiproj/types'

// ===========================================================================
// 5.1 单条决策 → 草案层五态
// ===========================================================================

/** Copilot 决策 → 草案层 review_status 五态映射。 */
export function mapCopilotDecisionToReviewStatus(
  decision: CopilotActionDecisionKind,
): 'accepted' | 'rejected' | 'modified' | 'skipped' {
  switch (decision) {
    case 'accept':
      return 'accepted'
    case 'reject':
      return 'rejected'
    case 'modify':
      return 'modified'
    case 'skip':
      return 'skipped'
  }
}

// ===========================================================================
// 5.5/5.6 批量逐条结局判定
// ===========================================================================

export interface CopilotBulkItemEvaluationInput {
  readonly actionCardId: string
  readonly decision: CopilotActionDecisionKind
  readonly permissionGranted: boolean
  readonly stale: boolean
  readonly dryRunCanApply: boolean
}

/**
 * 逐条结局：权限缺失 → denied；stale → stale_blocked；dry-run 失败 → dry_run_failed；
 * 否则按决策映射为 applied/rejected/skipped/modified。逐条独立，互不吞并。
 */
export function evaluateCopilotBulkItemOutcome(
  input: CopilotBulkItemEvaluationInput,
): CopilotBulkDecisionItemResult {
  if (!input.permissionGranted) {
    return {
      actionCardId: input.actionCardId,
      permission: 'denied',
      stale: input.stale ? 'stale' : 'fresh',
      outcome: 'denied',
      message: '没有执行该操作的权限',
    }
  }
  if (input.stale) {
    return {
      actionCardId: input.actionCardId,
      permission: 'granted',
      stale: 'stale',
      outcome: 'stale_blocked',
      message: '来源已过期，需重新审查',
    }
  }
  if (!input.dryRunCanApply) {
    return {
      actionCardId: input.actionCardId,
      permission: 'granted',
      stale: 'fresh',
      outcome: 'dry_run_failed',
      message: '试运行校验失败',
    }
  }
  const outcome = mapCopilotDecisionToBulkOutcome(input.decision)
  return {
    actionCardId: input.actionCardId,
    permission: 'granted',
    stale: 'fresh',
    outcome,
    message:
      outcome === 'applied'
        ? '已应用'
        : outcome === 'rejected'
          ? '已放弃'
          : outcome === 'modified'
            ? '已按修改值记录'
            : '已跳过',
  }
}

/**
 * Copilot 决策 → 批量结局词汇（applied/rejected/skipped/modified）。
 * 注意：这是 apply 后的结局，与草案层审查状态（accepted/...）是两个词汇面；
 * 决策服务落库仍用 mapCopilotDecisionToReviewStatus 的五态。
 */
export function mapCopilotDecisionToBulkOutcome(
  decision: CopilotActionDecisionKind,
): 'applied' | 'rejected' | 'skipped' | 'modified' {
  switch (decision) {
    case 'accept':
      return 'applied'
    case 'reject':
      return 'rejected'
    case 'modify':
      return 'modified'
    case 'skip':
      return 'skipped'
  }
}

/**
 * 组装批量结果：fullyApplied 恒由逐条结局推导——任一非 applied 即 false，
 * 禁止部分失败呈现为完全成功（spec Requirement 7）。
 */
export function assembleCopilotBulkResult(
  items: readonly CopilotBulkDecisionItemResult[],
): CopilotBulkDecisionResult {
  return {
    results: items,
    fullyApplied: items.every((r) => r.outcome === 'applied'),
  }
}

// ===========================================================================
// 5.7/5.8 部分失败呈现
// ===========================================================================

export interface CopilotPartialApplyEvaluation {
  readonly partialFailure: boolean
  readonly fullyApplied: boolean
  readonly failedCount: number
}

/**
 * apply 结果判定：failed>0 → 部分失败（不得呈现为完全成功）；
 * applied=0 且 failed>0 → 完全失败（亦非成功）。
 */
export function evaluateCopilotPartialApply(params: {
  readonly appliedCount: number
  readonly failedCount: number
}): CopilotPartialApplyEvaluation {
  return {
    partialFailure: params.failedCount > 0 && params.appliedCount > 0,
    fullyApplied: params.failedCount === 0 && params.appliedCount > 0,
    failedCount: params.failedCount,
  }
}

// ===========================================================================
// 5.9 有界重试语义
// ===========================================================================

export interface CopilotBoundedRetryCheck {
  readonly allowed: boolean
  readonly reason: string | null
}

/**
 * 有界重试：attempt（1-based）≤ maxAttempts 且来源未变（fresh）才允许重试；
 * 重试仍受幂等与 hash 重校验约束（spec Requirement 7）。
 */
export function evaluateCopilotBoundedRetry(params: {
  readonly attempt: number
  readonly maxAttempts: number
  readonly sourceFresh: boolean
}): CopilotBoundedRetryCheck {
  if (params.attempt > params.maxAttempts) {
    return { allowed: false, reason: `已达重试上限（${params.maxAttempts} 次）` }
  }
  if (!params.sourceFresh) {
    return { allowed: false, reason: '来源已过期，重试前需重新审查' }
  }
  return { allowed: true, reason: null }
}
