/**
 * v3-unified-ai-budget-and-quota —— 统一 AI 预算与配额决策层共享契约。
 *
 * 跨全部 AI 能力面的预算与配额决策层，消费统一账本（unified-ai-invocation-ledger）
 * 作为用量事实来源。
 *
 * 核心设计：
 * - Preflight / Postflight 两段式（泛化 Compiler 已验证模型，去掉 run 绑定）
 * - 软硬预算分离（软越界记 warning 不得静默升级为 allow；硬预算阻断）
 * - 四层归属（organization / project / user / capability）叠加取最严格者
 * - 通用问答（global scope）结构性不可扣减项目预算
 * - 降级链必须可见；耗尽明确不可用
 * - 与既有 Compiler/OCR 预算桥接去重，不删不改其数据
 * - 组织隔离只读查询；低敏红线
 * - 记账写入失败可降级；预算判定不可用不得默认放行
 *
 * 非目标：不限流（归 v3-global-ai-rate-limiting）、不做链路追踪、不做成本看板 UI、
 *         不做真实计费、不改写既有 Compiler/OCR budget requirements。
 */

import {
  LEDGER_FORBIDDEN_KEY_CATEGORIES,
  ledgerDetectForbiddenKeys,
  type LedgerForbiddenKeyCategory,
} from './unified-ai-invocation-ledger.js'

// ---------------------------------------------------------------------------
// §2.2 归属维度与作用域枚举
// ---------------------------------------------------------------------------

/** 预算归属维度：四层可各设预算，叠加时取最严格者。 */
export const BUDGET_ATTRIBUTION_SCOPES = ['organization', 'project', 'user', 'capability'] as const
export type BudgetAttributionScope = (typeof BUDGET_ATTRIBUTION_SCOPES)[number]

/** 通用问答的 global scope 标识——结构性不含项目引用。 */
export const BUDGET_GLOBAL_SCOPE = 'global' as const

// ---------------------------------------------------------------------------
// §2.3 软/硬预算字段与周期窗口类型
// ---------------------------------------------------------------------------

/** 预算窗口类型。 */
export const BUDGET_WINDOW_TYPES = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom',
] as const
export type BudgetWindowType = (typeof BUDGET_WINDOW_TYPES)[number]

/** 预算策略：按归属维度设定的软/硬限制与窗口。 */
export interface UnifiedBudgetPolicy {
  /** 策略唯一名称。 */
  name: string
  /** 是否启用。 */
  enabled: boolean
  /** 归属维度。 */
  scope: BudgetAttributionScope
  /** 归属维度对应的值（org id / project id / user id / capability name）。 */
  scopeValue: string
  /** 软预算上限（估算成本）——超限记 warning。 */
  softLimitCost?: number
  /** 硬预算上限（估算成本）——超限阻断。 */
  hardLimitCost?: number
  /** 软预算上限（累计 token）。 */
  softLimitTokens?: number
  /** 硬预算上限（累计 token）——超限阻断。 */
  hardLimitTokens?: number
  /** 币种。 */
  currency: string
  /** 窗口类型。 */
  windowType: BudgetWindowType
  /** custom 窗口时的自定义天数。 */
  customWindowDays?: number
  /** 超出软预算后执行的操作。 */
  onSoftLimit: UnifiedBudgetSoftLimitAction
  /** 超出硬预算后执行的操作。 */
  onHardLimit: UnifiedBudgetHardLimitAction
  /** 降级链声明（按优先级排序，从最贵到最便宜）。 */
  degradationChain?: BudgetDegradationStep[]
  /** 失败姿态：评估器不可用时的处理策略。 */
  failurePosture: BudgetFailurePosture
  /** 策略优先级（数字越大越窄、优先级越高）。 */
  priority: number
}

/** 软预算超出后的操作。 */
export const BUDGET_SOFT_LIMIT_ACTIONS = ['warn', 'require_review', 'continue'] as const
export type UnifiedBudgetSoftLimitAction = (typeof BUDGET_SOFT_LIMIT_ACTIONS)[number]

/** 硬预算超出后的操作。 */
export const BUDGET_HARD_LIMIT_ACTIONS = ['block'] as const
export type UnifiedBudgetHardLimitAction = (typeof BUDGET_HARD_LIMIT_ACTIONS)[number]

// ---------------------------------------------------------------------------
// §2.4 决策结果枚举
// ---------------------------------------------------------------------------

/** 预算决策结果。 */
export const BUDGET_DECISION_OUTCOMES = ['allow', 'warn', 'block', 'degrade'] as const
export type BudgetDecisionOutcome = (typeof BUDGET_DECISION_OUTCOMES)[number]

// ---------------------------------------------------------------------------
// §2.5 越界原因码与降级链声明
// ---------------------------------------------------------------------------

/** 越界原因码——机器可读。 */
export const BUDGET_OVERRUN_REASON_CODES = [
  'soft_limit_cost_exceeded',
  'hard_limit_cost_exceeded',
  'soft_limit_tokens_exceeded',
  'hard_limit_tokens_exceeded',
  'quota_exhausted',
  'evaluator_unavailable',
  'degradation_applied',
] as const
export type BudgetOverrunReasonCode = (typeof BUDGET_OVERRUN_REASON_CODES)[number]

/** 降级链中一步。 */
export interface BudgetDegradationStep {
  /** 降级到的模型标识。 */
  targetModel: string
  /** 降级原因码。 */
  reasonCode: BudgetOverrunReasonCode
  /** 降级是否可见（必须为 true——禁止静默降质）。 */
  visible: true
  /** 降级说明（面向用户的可见文本）。 */
  reason: string
}

// ---------------------------------------------------------------------------
// §2.6 预算决策记录类型
// ---------------------------------------------------------------------------

/** 预算决策记录：完整的一次 preflight 或 postflight 判定。 */
export interface BudgetDecisionRecord {
  /** 决策 ID（自增）。 */
  id: number
  /** 归属：组织 ID。 */
  organizationId: number
  /** 归属：项目 ID（global scope 时为 null）。 */
  projectId: number | null
  /** 归属：用户 ID。 */
  userId: number | null
  /** 归属：能力面名称。 */
  capability: string
  /** 归属：面名称。 */
  surface: string

  /** 预算策略引用（命中策略名称，可能多个叠加）。 */
  policyRefs: string[]
  /** 触发裁决的作用域（最严格者）。 */
  triggeringScope: BudgetAttributionScope
  /** 触发裁决的策略名。 */
  triggeringPolicyName: string

  /** 决策类型：preflight（调用前）或 postflight（调用后）。 */
  decisionType: 'preflight' | 'postflight'
  /** 决策结果。 */
  outcome: BudgetDecisionOutcome
  /** 越界原因码。 */
  reasonCode: BudgetOverrunReasonCode | null
  /** 越界原因说明（面向诊断）。 */
  reason: string | null

  /** 窗口起点（ISO）。 */
  windowStart: string
  /** 窗口终点（ISO）。 */
  windowEnd: string

  /** 本次调用前预估成本（preflight 用）。 */
  estimatedCost: number | null
  /** 本次调用实际成本（postflight 用）。 */
  actualCost: number | null
  /** 本次调用预估 token（preflight 用）。 */
  estimatedTokens: number | null
  /** 本次调用实际 token（postflight 用）。 */
  actualTokens: number | null
  /** 累计成本（窗口内）。 */
  accumulatedCost: number
  /** 累计 token（窗口内）。 */
  accumulatedTokens: number
  /** 币种。 */
  currency: string
  /** 成本状态（沿用账本）。 */
  costStatus: BudgetCostStatus | null

  /** 幂等键（derived from ledger attempt identity）。 */
  idempotencyKey: string
  /** 关联账本 attempt 的 budget_decision_ref。 */
  ledgerAttemptRef: string | null

  /** 降级信息（仅 outcome=degrade 时）。 */
  degradation: BudgetDegradationStep | null

  /** 桥接引用（标记是否同时存在于 Compiler/OCR 预算记录）。 */
  bridgeRef: BudgetBridgeRef | null

  /** 决策时间（ISO）。 */
  decidedAt: string
}

// ---------------------------------------------------------------------------
// §2.7 失败姿态枚举
// ---------------------------------------------------------------------------

/**
 * 成本状态口径（预算判定与调用账本共用同一组取值）。
 * 原先在 unified-ai-budget 与 unified-ai-invocation-ledger 各写了一遍内联联合，
 * 两处一旦漂移就会出现"账本说 estimated、预算说 unknown"的不一致。
 */
export const BUDGET_COST_STATUSES = [
  'estimated',
  'fallback_estimate',
  'cost_unknown',
  'unavailable',
  'zero',
  'unknown',
] as const
export type BudgetCostStatus = (typeof BUDGET_COST_STATUSES)[number]

/** 失败姿态：评估器不可用时的处理策略。**不含默认放行。 */
export const BUDGET_FAILURE_POSTURES = [
  /** 保守拒绝：评估器不可用时一律阻断。 */
  'conservative_deny',
  /** 上次已知状态加警告：使用最近一次的累计状态做裁决并附 warning。 */
  'last_known_state_with_warning',
] as const
export type BudgetFailurePosture = (typeof BUDGET_FAILURE_POSTURES)[number]

// ---------------------------------------------------------------------------
// §6 桥接引用
// ---------------------------------------------------------------------------

/** 桥接引用：标记决策是否同时存在于 Compiler 或 OCR 预算记录。 */
export interface BudgetBridgeRef {
  /** 来源预算系统。 */
  source: 'compiler' | 'ocr'
  /** 来源系统中的决策 ID 或记录标识。 */
  sourceDecisionId: string
  /** 来源系统中的幂等键（用于聚合去重）。 */
  sourceIdempotencyKey: string | null
}

// ---------------------------------------------------------------------------
// §2.8–2.9 策略解析与叠加裁决
// ---------------------------------------------------------------------------

/** 逐作用域的有效策略（继承后的结果）。 */
export interface EffectiveBudgetPolicy {
  /** 策略名称（最窄层级的策略名）。 */
  name: string
  scope: BudgetAttributionScope
  scopeValue: string
  /** 从最具体到最宽逐层继承后的最终值。 */
  softLimitCost: number | undefined
  hardLimitCost: number | undefined
  softLimitTokens: number | undefined
  hardLimitTokens: number | undefined
  currency: string
  onSoftLimit: UnifiedBudgetSoftLimitAction
  onHardLimit: UnifiedBudgetHardLimitAction
  failurePosture: BudgetFailurePosture
  degradationChain: BudgetDegradationStep[]
  /** 已应用的策略列表（从最宽到最具体）。 */
  appliedPolicies: string[]
}

/** 叠加裁决结果：取全部有效策略中最严格者。 */
export interface BudgetEnforcementResult {
  /** 最终决策结果。 */
  outcome: BudgetDecisionOutcome
  /** 触发裁决的作用域（最严格者）。 */
  triggeringScope: BudgetAttributionScope
  /** 触发裁决的策略名。 */
  triggeringPolicyName: string
  /** 越界原因码。 */
  reasonCode: BudgetOverrunReasonCode | null
  /** 越界原因说明。 */
  reason: string | null
  /** 是否允许通过（硬预算阻断时为 false）。 */
  allowed: boolean
  /** 所有已应用策略名。 */
  appliedPolicies: string[]
}

// ---------------------------------------------------------------------------
// §4.1–4.2 Preflight 与 Postflight
// ---------------------------------------------------------------------------

/** Preflight 输入。 */
export interface BudgetPreflightInput {
  organizationId: number
  projectId: number | null
  userId: number | null
  capability: string
  surface: string
  /** 本次调用预估成本。 */
  estimatedCost: number
  /** 本次调用预估 token。 */
  estimatedTokens: number
  /** 幂等键（derived from ledger attempt identity）。 */
  idempotencyKey: string
  /** 账本 attempt 引用。 */
  ledgerAttemptRef: string | null
  /** 当前时间（可注入测试时钟）。 */
  now?: Date
}

/** Preflight 结果。 */
export interface BudgetPreflightResult {
  /** 是否允许通过。 */
  allowed: boolean
  /** 决策结果。 */
  outcome: BudgetDecisionOutcome
  /** 越界原因码。 */
  reasonCode: BudgetOverrunReasonCode | null
  /** 越界原因说明。 */
  reason: string | null
  /** 触发裁决的作用域。 */
  triggeringScope: BudgetAttributionScope | null
  /** 触发裁决的策略名。 */
  triggeringPolicyName: string | null
  /** 已应用策略名。 */
  appliedPolicies: string[]
  /** 降级信息（仅 outcome=degrade 时）。 */
  degradation: BudgetDegradationStep | null
  /** 决策记录（待持久化）。 */
  decisionRecord: Omit<BudgetDecisionRecord, 'id'>
}

/** Postflight 输入。 */
export interface BudgetPostflightInput {
  organizationId: number
  projectId: number | null
  userId: number | null
  capability: string
  surface: string
  /** 本次调用实际成本（来自账本）。 */
  actualCost: number
  /** 本次调用实际 token（来自账本）。 */
  actualTokens: number
  /** 幂等键（与 preflight 相同）。 */
  idempotencyKey: string
  /** 账本 attempt 引用。 */
  ledgerAttemptRef: string | null
  /** 当前时间（可注入测试时钟）。 */
  now?: Date
}

/** Postflight 结果。 */
export interface BudgetPostflightResult {
  /** 决策结果。 */
  outcome: BudgetDecisionOutcome
  /** 是否产生告警。 */
  warnings: string[]
  /** 越界原因码。 */
  reasonCode: BudgetOverrunReasonCode | null
  /** 触发裁决的作用域。 */
  triggeringScope: BudgetAttributionScope | null
  /** 已应用策略名。 */
  appliedPolicies: string[]
  /** 决策记录（待持久化）。 */
  decisionRecord: Omit<BudgetDecisionRecord, 'id'>
}

// ---------------------------------------------------------------------------
// §7 只读查询
// ---------------------------------------------------------------------------

/** 预算状态查询结果。 */
export interface BudgetStatusResponse {
  organizationId: number
  projectId: number | null
  userId: number | null
  capability: string | null
  /** 当前窗口信息。 */
  window: {
    type: BudgetWindowType
    start: string
    end: string
  }
  /** 累计用量。 */
  accumulated: {
    cost: number
    tokens: number
    currency: string
  }
  /** 策略限制（null = 未设限）。 */
  limits: {
    softCost: number | null
    hardCost: number | null
    softTokens: number | null
    hardTokens: number | null
  } | null
  /** 剩余余量（null = 未设限）。 */
  remaining: {
    cost: number | null
    tokens: number | null
  } | null
  /** 最近 N 条决策。 */
  recentDecisions: BudgetDecisionRecord[]
  /** 成本标注（必须标明为估算）。 */
  costLabel: 'estimate'
  /** 策略是否已设置。 */
  policySet: boolean
}

// ---------------------------------------------------------------------------
// §2.10–2.13 低敏红线（复用账本禁止键类别）
// ---------------------------------------------------------------------------

/** 预算决策记录的禁止键类别——复用账本既有定义，不重定义。 */
export const BUDGET_FORBIDDEN_KEY_CATEGORIES: ReadonlyArray<LedgerForbiddenKeyCategory> =
  LEDGER_FORBIDDEN_KEY_CATEGORIES

/** 结构化 DTO 允许键集合。预算决策记录只允许低敏字段。 */
export const BUDGET_DTO_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'id',
  'organizationId',
  'projectId',
  'userId',
  'capability',
  'surface',
  'policyRefs',
  'triggeringScope',
  'triggeringPolicyName',
  'decisionType',
  'outcome',
  'reasonCode',
  'reason',
  'windowStart',
  'windowEnd',
  'estimatedCost',
  'actualCost',
  'estimatedTokens',
  'actualTokens',
  'accumulatedCost',
  'accumulatedTokens',
  'currency',
  'costStatus',
  'idempotencyKey',
  'ledgerAttemptRef',
  'degradation',
  'bridgeRef',
  'decidedAt',
])

/**
 * 决策记录 sanitizer：拒绝或 redact 含禁止内容的字段。
 * 复用账本的 `ledgerDetectForbiddenKeys` 作为低敏红线。
 * 返回 sanitized 对象或 null（如果输入无效）。
 */
export function sanitizeBudgetDecisionRecord(
  record: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!record || typeof record !== 'object') return null

  // 允许键白名单过滤
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (BUDGET_DTO_ALLOWED_KEYS.has(key)) {
      safe[key] = value
    }
  }

  // 深度扫描禁止内容
  const forbidden = ledgerDetectForbiddenKeys(safe as Record<string, unknown>)
  if (forbidden.length > 0) {
    // 移除包含禁止内容的键
    for (const key of Object.keys(safe)) {
      const val = safe[key]
      if (val && typeof val === 'object') {
        const subForbidden = ledgerDetectForbiddenKeys(val as Record<string, unknown>)
        if (subForbidden.length > 0) {
          delete safe[key]
        }
      }
    }
  }

  return safe
}

// ---------------------------------------------------------------------------
// §5.9 记账失败 vs 预算判定不可用的显式区分
// ---------------------------------------------------------------------------

/**
 * 两种不同的失败语义：
 * 1. 记账写入失败（instrumentation failure）：可降级，不改变业务终态
 * 2. 预算判定不可用（budget adjudication failure）：按声明的 failurePosture 处理，禁止默认放行
 *
 * 这两者并存但不冲突：
 * - 记账失败 = 决策已经做出，只是记录写不进去 → 可降级
 * - 预算不可用 = 决策根本做不出来 → 必须按 failurePosture 处理
 */
export interface BudgetFailureContext {
  /** 失败类型。 */
  type: 'recording_failure' | 'evaluator_unavailable'
  /** 失败原因。 */
  reason: string
  /** 失败时间。 */
  failedAt: string
}

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

export function isBudgetAttributionScope(value: string): value is BudgetAttributionScope {
  return BUDGET_ATTRIBUTION_SCOPES.includes(value as BudgetAttributionScope)
}

export function isBudgetDecisionOutcome(value: string): value is BudgetDecisionOutcome {
  return BUDGET_DECISION_OUTCOMES.includes(value as BudgetDecisionOutcome)
}

export function isBudgetFailurePosture(value: string): value is BudgetFailurePosture {
  return BUDGET_FAILURE_POSTURES.includes(value as BudgetFailurePosture)
}

export function isBudgetWindowType(value: string): value is BudgetWindowType {
  return BUDGET_WINDOW_TYPES.includes(value as BudgetWindowType)
}

export function isBudgetOverrunReasonCode(value: string): value is BudgetOverrunReasonCode {
  return BUDGET_OVERRUN_REASON_CODES.includes(value as BudgetOverrunReasonCode)
}

// ---------------------------------------------------------------------------
// §2.8 策略解析纯函数
// ---------------------------------------------------------------------------

/** 作用域粒度分数（数字越大越窄、优先级越高）。 */
const SCOPE_GRANULARITY: Record<BudgetAttributionScope, number> = {
  capability: 4,
  project: 3,
  user: 2,
  organization: 1,
}

/**
 * 从最具体到最宽逐层继承未设字段，产出逐作用域有效策略。
 * 策略按 scope 从最具体（capability）到最宽（organization）排列。
 * 缺失层的字段继承自上层；全缺时走声明式默认。
 */
export function resolveEffectivePolicies(
  policies: UnifiedBudgetPolicy[],
  target: {
    organizationId: number
    projectId: number | null
    userId: number | null
    capability: string
  },
): EffectiveBudgetPolicy[] {
  const result: EffectiveBudgetPolicy[] = []
  const inherited: {
    softLimitCost?: number
    hardLimitCost?: number
    softLimitTokens?: number
    hardLimitTokens?: number
    currency?: string
    onSoftLimit?: UnifiedBudgetSoftLimitAction
    onHardLimit?: UnifiedBudgetHardLimitAction
    failurePosture?: BudgetFailurePosture
    degradationChain?: BudgetDegradationStep[]
    appliedPolicies?: string[]
  } = {}

  // 从最宽（organization）到最具体（capability）处理，使继承自然向下传递
  const sorted = [...policies]
    .filter((p) => p.enabled)
    .sort((a, b) => (SCOPE_GRANULARITY[a.scope] ?? 0) - (SCOPE_GRANULARITY[b.scope] ?? 0))

  for (const policy of sorted) {
    // 检查 scope 是否匹配目标
    if (!policyMatchesTarget(policy, target)) continue

    // 继承：从 inherited 继承未设字段，再用当前策略覆盖已设字段
    const effective: EffectiveBudgetPolicy = {
      name: policy.name,
      scope: policy.scope,
      scopeValue: policy.scopeValue,
      softLimitCost: policy.softLimitCost ?? inherited.softLimitCost,
      hardLimitCost: policy.hardLimitCost ?? inherited.hardLimitCost,
      softLimitTokens: policy.softLimitTokens ?? inherited.softLimitTokens,
      hardLimitTokens: policy.hardLimitTokens ?? inherited.hardLimitTokens,
      currency: policy.currency ?? inherited.currency ?? 'CNY',
      onSoftLimit: policy.onSoftLimit ?? inherited.onSoftLimit ?? 'warn',
      onHardLimit: policy.onHardLimit ?? inherited.onHardLimit ?? 'block',
      failurePosture: policy.failurePosture ?? inherited.failurePosture ?? 'conservative_deny',
      degradationChain: policy.degradationChain ?? inherited.degradationChain ?? [],
      appliedPolicies: [...(inherited.appliedPolicies ?? []), policy.name],
    }

    // 更新 inherited 供下一层继承
    inherited.softLimitCost = effective.softLimitCost
    inherited.hardLimitCost = effective.hardLimitCost
    inherited.softLimitTokens = effective.softLimitTokens
    inherited.hardLimitTokens = effective.hardLimitTokens
    inherited.currency = effective.currency
    inherited.onSoftLimit = effective.onSoftLimit
    inherited.onHardLimit = effective.onHardLimit
    inherited.failurePosture = effective.failurePosture
    inherited.degradationChain = effective.degradationChain
    inherited.appliedPolicies = effective.appliedPolicies

    result.push(effective)
  }

  return result
}

/** 检查策略是否匹配目标归属。 */
function policyMatchesTarget(
  policy: UnifiedBudgetPolicy,
  target: {
    organizationId: number
    projectId: number | null
    userId: number | null
    capability: string
  },
): boolean {
  switch (policy.scope) {
    case 'organization':
      return policy.scopeValue === String(target.organizationId)
    case 'project':
      return target.projectId !== null && policy.scopeValue === String(target.projectId)
    case 'user':
      return target.userId !== null && policy.scopeValue === String(target.userId)
    case 'capability':
      return policy.scopeValue === target.capability
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// §2.9 叠加裁决纯函数
// ---------------------------------------------------------------------------

/**
 * 对全部有效策略取最严格者并记录触发作用域。
 * Enforcement MUST NOT adopt the most permissive outcome.
 */
export function enforceBudgetPolicies(
  effectivePolicies: EffectiveBudgetPolicy[],
  accumulatedCost: number,
  accumulatedTokens: number,
  estimatedCost: number,
  estimatedTokens: number,
): BudgetEnforcementResult {
  if (effectivePolicies.length === 0) {
    return {
      outcome: 'allow',
      triggeringScope: 'organization',
      triggeringPolicyName: '',
      reasonCode: null,
      reason: null,
      allowed: true,
      appliedPolicies: [],
    }
  }

  let worstOutcome: BudgetDecisionOutcome = 'allow'
  let worstScope: BudgetAttributionScope = 'organization'
  let worstPolicyName = ''
  let worstReasonCode: BudgetOverrunReasonCode | null = null
  let worstReason: string | null = null
  const allApplied: string[] = []
  const totalCost = accumulatedCost + estimatedCost
  const totalTokens = accumulatedTokens + estimatedTokens

  for (const policy of effectivePolicies) {
    allApplied.push(...policy.appliedPolicies)

    // 硬预算检查
    const hardCostExceeded = policy.hardLimitCost !== undefined && totalCost >= policy.hardLimitCost
    const hardTokensExceeded =
      policy.hardLimitTokens !== undefined && totalTokens >= policy.hardLimitTokens

    if (hardCostExceeded || hardTokensExceeded) {
      // 硬阻断是最严格的结果
      worstOutcome = 'block'
      worstScope = policy.scope
      worstPolicyName = policy.name
      worstReasonCode = hardCostExceeded ? 'hard_limit_cost_exceeded' : 'hard_limit_tokens_exceeded'
      worstReason = hardCostExceeded
        ? `硬预算成本超出: ${totalCost.toFixed(4)} >= ${policy.hardLimitCost}`
        : `硬预算 token 超出: ${totalTokens} >= ${policy.hardLimitTokens}`
      continue
    }

    // 软预算检查（仅在尚未 block 时）
    const softCostExceeded = policy.softLimitCost !== undefined && totalCost >= policy.softLimitCost
    const softTokensExceeded =
      policy.softLimitTokens !== undefined && totalTokens >= policy.softLimitTokens

    if (softCostExceeded || softTokensExceeded) {
      // 软越界比 allow 严格
      if (worstOutcome === 'allow') {
        worstOutcome = 'warn'
        worstScope = policy.scope
        worstPolicyName = policy.name
        worstReasonCode = softCostExceeded
          ? 'soft_limit_cost_exceeded'
          : 'soft_limit_tokens_exceeded'
        worstReason = softCostExceeded
          ? `软预算成本超出: ${totalCost.toFixed(4)} >= ${policy.softLimitCost}`
          : `软预算 token 超出: ${totalTokens} >= ${policy.softLimitTokens}`
      }
      // 注意：即使已有 warn，也不升级到 block（硬预算未超）
    }
  }

  return {
    outcome: worstOutcome,
    triggeringScope: worstScope,
    triggeringPolicyName: worstPolicyName,
    reasonCode: worstReasonCode,
    reason: worstReason,
    allowed: worstOutcome !== 'block',
    appliedPolicies: Array.from(new Set(allApplied)),
  }
}

// ---------------------------------------------------------------------------
// §5.1 通用问答 global scope 归属
// ---------------------------------------------------------------------------

/**
 * 通用问答归属：结构性不含项目引用。
 * global scope 调用的 project 始终为 null，使项目累计无从扣减。
 * 这是通过归属形状（attribution shape）而非运行时检查保证的。
 */
export function buildGlobalScopeAttribution(input: {
  organizationId: number
  userId: number | null
  capability: string
  surface: string
}): Omit<
  BudgetPreflightInput,
  'estimatedCost' | 'estimatedTokens' | 'idempotencyKey' | 'ledgerAttemptRef'
> {
  return {
    organizationId: input.organizationId,
    projectId: null, // 结构性不含项目引用
    userId: input.userId,
    capability: input.capability,
    surface: input.surface,
  }
}

/**
 * 防御性检查：拒绝为 global scope 强塞项目归属。
 * 正常流程不会走到这里（buildGlobalScopeAttribution 保证 projectId=null），
 * 但作为防御性测试的断言点。
 */
export function rejectGlobalScopeProjectAttribution(
  scope: string,
  projectId: number | null,
): { rejected: boolean; reason: string } {
  if (scope === 'global' && projectId !== null) {
    return {
      rejected: true,
      reason: 'global scope 不允许携带项目归属（结构性隔离）',
    }
  }
  return { rejected: false, reason: '' }
}
