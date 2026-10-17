/**
 * v3-global-ai-rate-limiting —— 全局限流共享契约。
 *
 * 定义窗口与维度类型、决策结果、决策记录、多层叠加、重试建议、
 * 失败姿态、actor 公平占比、TPM 预估—结算、低敏 sanitizer。
 *
 * 设计约束：
 * - 以统一账本为唯一计数来源，不引入第二计数源；
 * - RPM/TPM 两维度；TPM 走预估—结算两段；
 * - 多层限额取最严格者并记录触发层；
 * - 超限返回明确错误与确定性重试建议；
 * - 计数不可用不得默认放行；
 * - 与 OCR 既有限流调和，不改写其行为；
 * - 组织隔离只读查询；
 * - 低敏红线：决策记录只存归属 ID、窗口、限额、计数、结果与原因码。
 */

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// §2.1 窗口与维度类型
// ---------------------------------------------------------------------------

/** 窗口类型：滚动窗口（1 分钟）。 */
export const RATE_LIMIT_WINDOW_TYPE = 'rolling' as const
export type RateLimitWindowType = typeof RATE_LIMIT_WINDOW_TYPE

/** 窗口时长（毫秒）。 */
export const RATE_LIMIT_WINDOW_MS = 60_000

/** 维度枚举：RPM（请求速率）与 TPM（token 速率）。 */
export const RATE_LIMIT_DIMENSIONS = ['rpm', 'tpm'] as const
export type RateLimitDimension = (typeof RATE_LIMIT_DIMENSIONS)[number]

// ---------------------------------------------------------------------------
// §2.2 限额层枚举
// ---------------------------------------------------------------------------

/** 限额层枚举：连接级 / 模型级 / 组织级 / actor 级。 */
export const RATE_LIMIT_LAYERS = ['connection', 'model', 'organization', 'actor'] as const
export type RateLimitLayer = (typeof RATE_LIMIT_LAYERS)[number]

// ---------------------------------------------------------------------------
// §2.3 决策结果枚举
// ---------------------------------------------------------------------------

/** 决策结果枚举：allow / throttle / reject。 */
export const RATE_LIMIT_DECISIONS = ['allow', 'throttle', 'reject'] as const
export type RateLimitDecision = (typeof RATE_LIMIT_DECISIONS)[number]

// ---------------------------------------------------------------------------
// §2.4 失败姿态枚举
// ---------------------------------------------------------------------------

/** 失败姿态枚举：保守拒绝 / 上次已知计数加警告。不含默认放行。 */
export const RATE_LIMIT_FAILURE_POSTURES = [
  'conservative_reject',
  'last_known_with_warning',
] as const
export type RateLimitFailurePosture = (typeof RATE_LIMIT_FAILURE_POSTURES)[number]

// ---------------------------------------------------------------------------
// §2.5 决策记录类型
// ---------------------------------------------------------------------------

/** 决策记录类型：窗口、维度、限额、当前计数、预估增量、结果、重试建议、触发层、幂等键。 */
export interface RateLimitDecisionRecord {
  /** 决策 ID（幂等键）。 */
  decisionId: string
  /** 组织 ID。 */
  organizationId: number
  /** 连接 ID（可选）。 */
  connectionId: number | null
  /** 模型 ID（可选）。 */
  modelId: number | null
  /** Actor ID（可选，用于公平性）。 */
  actorId: number | null
  /** 窗口开始时间（ISO）。 */
  windowStart: string
  /** 窗口结束时间（ISO）。 */
  windowEnd: string
  /** 维度。 */
  dimension: RateLimitDimension
  /** 限额层。 */
  layer: RateLimitLayer
  /** 限额值（null 表示未设限）。 */
  limit: number | null
  /** 当前计数。 */
  currentCount: number
  /** 预估增量（仅 TPM）。 */
  estimatedDelta: number | null
  /** 决策结果。 */
  decision: RateLimitDecision
  /** 重试建议（秒后重试，仅 throttle/reject）。 */
  retryAfterSeconds: number | null
  /** 触发层（多层叠加时取最严格者）；各层均未设限时为 null。 */
  triggeringLayer: RateLimitLayer | null
  /** 幂等键（防止同一 attempt 重复结算）。 */
  idempotencyKey: string
  /** 创建时间（ISO）。 */
  createdAt: string
}

// ---------------------------------------------------------------------------
// §2.6 TPM 预估—结算字段
// ---------------------------------------------------------------------------

/** TPM 预估—结算结果。 */
export interface TpmSettlement {
  /** 预估值。 */
  estimated: number
  /** 实际值（从账本结算）。 */
  actual: number
  /** 偏差（实际 - 预估）。 */
  deviation: number
}

// ---------------------------------------------------------------------------
// §2.7 Actor 公平占比上限
// ---------------------------------------------------------------------------

/** Actor 公平占比上限（0-1，如 0.5 表示单 actor 最多占组织 50%）。 */
export const DEFAULT_ACTOR_FAIRNESS_SHARE = 0.5
export type ActorFairnessShare = number

// ---------------------------------------------------------------------------
// §2.8 确定性重试建议计算
// ---------------------------------------------------------------------------

/**
 * 计算确定性重试建议（由窗口剩余时间推导）。
 * 同一窗口状态产出相同重试建议。
 */
export function computeRetryAfterSeconds(
  /** 保留参数：重试建议只由窗口剩余时间（windowEnd）推导，起点不参与计算。 */
  _windowStart: string,
  windowEnd: string,
  now: string = new Date().toISOString(),
): number {
  const nowMs = new Date(now).getTime()
  const windowEndMs = new Date(windowEnd).getTime()
  const remainingMs = Math.max(0, windowEndMs - nowMs)
  return Math.ceil(remainingMs / 1000)
}

// ---------------------------------------------------------------------------
// §2.9 多层叠加取最严格者
// ---------------------------------------------------------------------------

/**
 * 多层叠加取最严格者并记录触发层。
 * 未设限层不构成约束。
 */
export function resolveStrictestLimit(
  limits: Array<{ layer: RateLimitLayer; limit: number | null }>,
): { limit: number | null; triggeringLayer: RateLimitLayer | null } {
  let strictest: number | null = null
  let triggeringLayer: RateLimitLayer | null = null

  for (const { layer, limit } of limits) {
    if (limit === null) continue // 未设限不构成约束
    if (strictest === null || limit < strictest) {
      strictest = limit
      triggeringLayer = layer
    }
  }

  return { limit: strictest, triggeringLayer }
}

// ---------------------------------------------------------------------------
// §2.10 决策记录 sanitizer（复用账本禁止键类别）
// ---------------------------------------------------------------------------

/** 决策记录允许键（白名单）。 */
export const RATE_LIMIT_DECISION_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'decisionId',
  'organizationId',
  'connectionId',
  'modelId',
  'actorId',
  'windowStart',
  'windowEnd',
  'dimension',
  'layer',
  'limit',
  'currentCount',
  'estimatedDelta',
  'decision',
  'retryAfterSeconds',
  'triggeringLayer',
  'idempotencyKey',
  'createdAt',
])

/** 找出决策记录中白名单之外的键。 */
export function rateLimitDecisionFindDisallowedKeys(record: unknown): string[] {
  if (!record || typeof record !== 'object') return []
  const keys = Object.keys(record as Record<string, unknown>)
  return keys.filter((key) => !RATE_LIMIT_DECISION_ALLOWED_KEYS.has(key))
}

/** 断言决策记录无禁止内容；返回布尔。 */
export function rateLimitDecisionHasForbiddenKeys(record: unknown): boolean {
  return rateLimitDecisionFindDisallowedKeys(record).length > 0
}

// ---------------------------------------------------------------------------
// §2.11 确定性决策 ID 派生
// ---------------------------------------------------------------------------

/**
 * 确定性决策 ID 派生（幂等键）。
 * 相同输入产出相同 ID。
 */
export function computeRateLimitDecisionId(input: {
  organizationId: number
  connectionId: number | null
  modelId: number | null
  actorId: number | null
  dimension: RateLimitDimension
  windowStart: string
  attemptId: string | null
}): string {
  const payload = JSON.stringify({
    o: input.organizationId,
    c: input.connectionId,
    m: input.modelId,
    a: input.actorId,
    d: input.dimension,
    w: input.windowStart,
    t: input.attemptId,
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

// ---------------------------------------------------------------------------
// §2.12 类型守卫
// ---------------------------------------------------------------------------

/** 类型守卫：检查是否为有效的 RateLimitDimension。 */
export function isRateLimitDimension(value: unknown): value is RateLimitDimension {
  return RATE_LIMIT_DIMENSIONS.includes(value as RateLimitDimension)
}

/** 类型守卫：检查是否为有效的 RateLimitLayer。 */
export function isRateLimitLayer(value: unknown): value is RateLimitLayer {
  return RATE_LIMIT_LAYERS.includes(value as RateLimitLayer)
}

/** 类型守卫：检查是否为有效的 RateLimitDecision。 */
export function isRateLimitDecision(value: unknown): value is RateLimitDecision {
  return RATE_LIMIT_DECISIONS.includes(value as RateLimitDecision)
}

/** 类型守卫：检查是否为有效的 RateLimitFailurePosture。 */
export function isRateLimitFailurePosture(value: unknown): value is RateLimitFailurePosture {
  return RATE_LIMIT_FAILURE_POSTURES.includes(value as RateLimitFailurePosture)
}
