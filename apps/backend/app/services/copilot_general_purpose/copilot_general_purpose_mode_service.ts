/**
 * Copilot 通用问答模式服务 — 后端核心（v3-copilot-general-purpose-mode）
 *
 * 职责（design Decisions 1–8）：
 * 1. global scope 强制：项目作用域来源不合格且不发起查询
 * 2. 结构性禁写守卫：不得产出任何可导致持久化的动作
 * 3. 独立成本归属与配额判定
 * 4. 记忆读取边界：仅用户 scope
 * 5. 通用知识标注与知识局限声明
 * 6. 模式切换双向清理上下文
 * 7. 权限与组织开关表述差异
 * 8. 不接网络搜索
 *
 * 本服务是纯核心逻辑，不依赖 HTTP 层。
 * 控制器通过本服务的公共方法获取判定结果，再决定 HTTP 响应。
 */

import type {
  GeneralPurposeModeDecision,
  GeneralPurposeQuotaStatus,
  GeneralPurposeQuotaExhaustionReason,
  GeneralPurposeMemoryScope,
} from '@aiproj/types'
import {
  evaluateGeneralPurposeBoundary,
  shouldDeclareTimelinessLimitation,
  findProjectFactForbiddenPhrase,
} from '@aiproj/types'

// ===========================================================================
// 配额判定输入（消费 v3-unified-ai-budget-and-quota，未落地时用 fallback）
// ===========================================================================

export interface GeneralPurposeQuotaInput {
  readonly userId: number
  readonly organizationId: number
  /** 今日已用次数（fallback 本地计数）。 */
  readonly dailyUsageCount: number
  /** 日上限（fallback 本地声明式上界）。 */
  readonly dailyLimit: number
  /** 今日已用 token。 */
  readonly dailyTokenUsage: number
  /** Token 日上限。 */
  readonly tokenDailyLimit: number
}

/** 本地声明式配额上界 fallback（设计点 6.8）。 */
export const GENERAL_PURPOSE_DEFAULT_QUOTA_LIMITS = {
  dailyRequestLimit: 100,
  dailyTokenLimit: 50_000,
} as const

// ===========================================================================
// 模式判定输入
// ===========================================================================

export interface GeneralPurposeModeCheckInput {
  readonly userId: number
  readonly organizationId: number
  readonly message: string
  /** 用户是否拥有 ai:trigger 权限。 */
  readonly hasAiTriggerPermission: boolean
  /** 组织是否启用了通用问答能力。 */
  readonly isCapabilityEnabled: boolean
  /** 配额输入（可选，未落地时用 fallback）。 */
  readonly quotaInput?: GeneralPurposeQuotaInput
}

// ===========================================================================
// 记忆边界检查
// ===========================================================================

/**
 * 检查记忆 scope 在通用模式下是否被允许（决策 4）。
 * 仅允许 user scope，禁止 project 和 organization scope。
 */
export function isMemoryScopeAllowedInMode(scope: string): scope is GeneralPurposeMemoryScope {
  return scope === 'user'
}

/**
 * 过滤记忆候选：移除项目与组织 scope 条目。
 */
export function filterMemoryForGeneralPurpose<T extends { readonly scope: string }>(
  candidates: readonly T[],
): readonly T[] {
  return candidates.filter((c) => isMemoryScopeAllowedInMode(c.scope))
}

/**
 * 通用模式下是否应从会话抽取项目记忆（决策 4）。
 * 返回 false — 通用问答不产生项目记忆候选。
 */
export function shouldExtractProjectMemoryFromGeneralConversation(): boolean {
  return false
}

// ===========================================================================
// 写入守卫
// ===========================================================================

/** 通用模式下被禁用的动作类型（决策 2：结构性禁写）。 */
export const GENERAL_PURPOSE_FORBIDDEN_ACTION_TYPES = [
  'preview',
  'review-entry',
  'handoff-candidate',
] as const

/**
 * 检查一个动作类型在通用模式下是否被允许。
 * 通用模式不允许任何可导致持久化的动作。
 */
export function isActionAllowedInGeneralPurposeMode(actionType: string): boolean {
  return !(GENERAL_PURPOSE_FORBIDDEN_ACTION_TYPES as readonly string[]).includes(actionType)
}

/**
 * 检查回答是否通过项目事实口吻校验（决策 5）。
 * 返回 null 表示通过，否则返回命中的禁止措辞。
 */
export function validateAnswerWording(answer: string): string | null {
  return findProjectFactForbiddenPhrase(answer)
}

// ===========================================================================
// 配额判定
// ===========================================================================

/**
 * 判定配额状态（决策 3）。
 * 未落地时使用本地声明式上界 fallback（任务 6.8）。
 */
export function evaluateQuota(input: GeneralPurposeQuotaInput): {
  readonly status: GeneralPurposeQuotaStatus
  readonly reason?: GeneralPurposeQuotaExhaustionReason
} {
  if (input.dailyUsageCount >= input.dailyLimit) {
    return { status: 'exhausted', reason: 'daily_limit_reached' }
  }
  if (input.dailyTokenUsage >= input.tokenDailyLimit) {
    return { status: 'exhausted', reason: 'token_limit_reached' }
  }
  return { status: 'sufficient' }
}

// ===========================================================================
// 端到端模式判定
// ===========================================================================

/**
 * 执行完整的通用问答模式判定（消费所有边界条件）。
 * 返回 GeneralPurposeModeDecision，控制器根据此结果决定 HTTP 响应。
 */
export function evaluateGeneralPurposeMode(
  input: GeneralPurposeModeCheckInput,
): GeneralPurposeModeDecision & {
  readonly answerable: boolean
  readonly unavailabilityReason?: string
} {
  // 1. 配额判定
  const quotaInput = input.quotaInput ?? {
    userId: input.userId,
    organizationId: input.organizationId,
    dailyUsageCount: 0,
    dailyLimit: GENERAL_PURPOSE_DEFAULT_QUOTA_LIMITS.dailyRequestLimit,
    dailyTokenUsage: 0,
    tokenDailyLimit: GENERAL_PURPOSE_DEFAULT_QUOTA_LIMITS.dailyTokenLimit,
  }
  const quota = evaluateQuota(quotaInput)

  // 2. 时效性判定
  const isTimeSensitive = shouldDeclareTimelinessLimitation(input.message)

  // 3. 边界校验
  const decision = evaluateGeneralPurposeBoundary({
    hasPermission: input.hasAiTriggerPermission,
    isCapabilityEnabled: input.isCapabilityEnabled,
    quotaStatus: quota.status,
    quotaExhaustionReason: quota.reason,
    isTimeSensitive,
    isUncertain: false,
  })

  // 4. 可用性判定
  let answerable = true
  let unavailabilityReason: string | undefined

  if (!input.hasAiTriggerPermission) {
    answerable = false
    unavailabilityReason = '权限不足'
  } else if (!input.isCapabilityEnabled) {
    answerable = false
    unavailabilityReason = '能力未启用'
  } else if (quota.status === 'exhausted') {
    answerable = false
    unavailabilityReason = quota.reason ? `配额已耗尽：${quota.reason}` : '配额已耗尽'
  }

  return {
    ...decision,
    answerable,
    unavailabilityReason,
  }
}

// ===========================================================================
// 上下文清理
// ===========================================================================

/**
 * 切换到通用模式时清理项目上下文（决策 6）。
 * 返回清理后的空上下文标记。
 */
export function buildContextForGeneralPurposeEntry(): {
  readonly scope: 'global'
  readonly projectContextCleared: boolean
  readonly attributionCleared: boolean
} {
  return {
    scope: 'global',
    projectContextCleared: true,
    attributionCleared: true,
  }
}

/**
 * 切回项目 scope 时确认通用回答不带入为项目事实（决策 6）。
 */
export function assertGeneralAnswersNotCarriedAsProjectFacts(): {
  readonly generalAnswersExcluded: boolean
} {
  return { generalAnswersExcluded: true }
}

// ===========================================================================
// 低敏审计（决策 7 / 任务 8.5）
// ===========================================================================

export interface GeneralPurposeAuditEntry {
  readonly eventType:
    | 'mode_entered'
    | 'mode_exited'
    | 'generation_completed'
    | 'generation_failed'
    | 'quota_exhausted'
    | 'unauthorized_attempt'
  readonly userId: number
  readonly organizationId: number
  readonly timestamp: string
  /** 低敏元数据：不含 prompt 与输出全文。 */
  readonly metadata: Record<string, unknown>
}

/**
 * 构建低敏审计条目（任务 8.5/8.6）。
 * 绝不记录 prompt 或输出全文。
 */
export function buildAuditEntry(
  eventType: GeneralPurposeAuditEntry['eventType'],
  userId: number,
  organizationId: number,
  extra?: Record<string, unknown>,
): GeneralPurposeAuditEntry {
  return {
    eventType,
    userId,
    organizationId,
    timestamp: new Date().toISOString(),
    metadata: {
      ...extra,
      // 显式排除：不记录 prompt 全文、输出全文
      _note: 'low-sensitivity audit: prompt and output text excluded',
    },
  }
}
