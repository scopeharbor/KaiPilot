/**
 * v3-copilot-routing-decision-ledger —— Copilot 路由决策账本共享契约。
 *
 * 消费 `copilot-intent-catalog` 的 `CopilotRoutingDecisionRecord` 形状，
 * 不重定义路由层已定义的字段（归一化意图摘要、destination 排序、confidence、
 * 澄清轮数、歧义标记、不可用类别、目录版本）。
 *
 * 设计要点：
 * - 五类改道分类（采纳首位 / 采纳非首位 / 改到未推荐 / 放弃 / 歧义选择）
 *   「改到未推荐」是最强错误信号，须单独可见
 * - 路由准确率口径写死：首位命中率与前 N 命中率分列、放弃计入分母但单独可见、
 *   歧义选择不计入错误分子、切分维度为组织/意图分类/子意图/目录版本/时间窗
 * - 规则命中率与模型兜底率：兜底率上升是目录健康度先行指标
 * - 输入元组 hash 含目录版本，避免合法目录变更被误判为确定性违规
 * - 禁存原始输入全文、prompt、模型输出、token、secret、Authorization
 * - 记账可降级，不得改变路由结果
 * - 禁止隐式改道推断
 *
 * 依赖约束：纯类型 + 确定性纯函数，只依赖同包 `triz-contradiction.js` 的 `deterministicHash`
 * 和 `copilot-shared-contracts.js` / `copilot-intent-catalog.js` 的共享类型。
 * 禁止依赖 AdonisJS、React、数据库客户端、HTTP 客户端、外部网络、provider 凭证或真实模型 SDK。
 */

import { deterministicHash } from './triz-contradiction.js'
import { LEDGER_FORBIDDEN_KEY_CATEGORIES } from './unified-ai-invocation-ledger.js'
import {
  type CopilotDestination,
  type CopilotIntentClass,
  type CopilotScope,
} from './copilot-shared-contracts.js'
import type {
  CopilotRoutingDecisionRecord,
  CopilotDestinationUnavailabilityKind,
} from './copilot-intent-catalog.js'

// ===========================================================================
// 枚举 — 五类改道分类（§2.3）
// ===========================================================================

/**
 * 五类改道分类。
 * - `accepted_top`：采纳首位推荐（路由正确）
 * - `accepted_non_top`：采纳非首位候选（排序错但候选对）
 * - `went_to_unrecommended`：改到未推荐的 destination（路由真错了，最强错误信号）
 * - `abandoned`：放弃未去任何地方（可能是路由错也可能是用户改主意）
 * - `chose_from_ambiguous`：歧义候选中选择（本来就是让用户选的，不算错）
 */
export const ROUTING_REDIRECT_CLASSES = [
  'accepted_top',
  'accepted_non_top',
  'went_to_unrecommended',
  'abandoned',
  'chose_from_ambiguous',
] as const
export type RoutingRedirectClass = (typeof ROUTING_REDIRECT_CLASSES)[number]

/** 改道分类中文标签。 */
export const ROUTING_REDIRECT_CLASS_LABELS: Record<RoutingRedirectClass, string> = {
  accepted_top: '采纳首位推荐',
  accepted_non_top: '采纳非首位候选',
  went_to_unrecommended: '改到未推荐 destination',
  abandoned: '放弃',
  chose_from_ambiguous: '歧义候选中选择',
}

/** 路由错误的改道分类（不含歧义选择和放弃）。 */
export const ROUTING_ERROR_REDIRECT_CLASSES: readonly RoutingRedirectClass[] = [
  'accepted_non_top',
  'went_to_unrecommended',
]

// ===========================================================================
// 枚举 — 归因置信度（§2.4）
// ===========================================================================

/**
 * 归因置信度：记录导航行为与路由决策之间的归因可信程度。
 * - `direct`：用户直接选择了路由推荐的 destination
 * - `indirect`：用户通过中间导航到达了推荐的 destination
 * - `ambiguous`：导航行为无法明确归因到路由决策
 * - `inferred`：禁止（隐式推断不允许）
 */
export const ROUTING_ATTRIBUTION_CONFIDENCES = ['direct', 'indirect', 'ambiguous'] as const
export type RoutingAttributionConfidence = (typeof ROUTING_ATTRIBUTION_CONFIDENCES)[number]

// ===========================================================================
// 枚举 — 不可用类别分布（§2.8）
// ===========================================================================

/**
 * 三类不可用：无权限缺席、未启用、授权门。
 * 路由层只暴露 not-enabled 和 authorization-gated；
 * missing-permission 由账本从权限比较中计算得出。
 */
export const ROUTING_UNAVAILABILITY_KINDS = [
  'missing_permission',
  'not_enabled',
  'authorization_gated',
] as const
export type RoutingUnavailabilityKind = (typeof ROUTING_UNAVAILABILITY_KINDS)[number]

// ===========================================================================
// 枚举 — 兜底率健康状态（§6.6）
// ===========================================================================

/**
 * 兜底率阈值三段式健康状态。
 * - `healthy`：兜底率在阈值内
 * - `warning`：兜底率接近阈值
 * - `critical`：兜底率超过阈值
 *
 * 健康状态变更**禁止自动动作**（不得修改目录或触发任何业务动作）。
 */
export const ROUTING_FALLBACK_HEALTH_STATUSES = ['healthy', 'warning', 'critical'] as const
export type RoutingFallbackHealthStatus = (typeof ROUTING_FALLBACK_HEALTH_STATUSES)[number]

// ===========================================================================
// 结构类型 — 路由决策账本记录（§2.1–2.2）
// ===========================================================================

/**
 * 路由决策账本记录。
 * 消费 `CopilotRoutingDecisionRecord` 的字段，不重定义。
 * 额外添加组织归属、trace 引用、输入元组 hash、幂等键与改道分类。
 *
 * 禁存原始用户输入全文（只存归一化意图摘要）。
 */
export interface CopilotRoutingLedgerRecord {
  /** 数据库主键。 */
  readonly dbId: number
  /** 组织 ID（组织隔离必填）。 */
  readonly organizationId: number
  /** 路由决策记录 ID（稳定唯一标识）。 */
  readonly recordId: string
  /** 目录版本。 */
  readonly catalogVersion: string
  /** 意图分类。 */
  readonly intentClass: CopilotIntentClass | null
  /** 子意图 ID。 */
  readonly subIntentId: string | null
  /** 归一化意图摘要（有界低敏，非原始输入全文）。 */
  readonly intentSummary: string
  /** destination 排序（有序结果里的 destination id）。 */
  readonly destinationOrder: readonly string[]
  /** 各 destination 的 confidence 值。 */
  readonly confidences: readonly number[]
  /** 澄清轮数。 */
  readonly clarificationRoundCount: number
  /** 是否存在歧义候选集。 */
  readonly ambiguous: boolean
  /** 不可用类别（路由层可见的两类）。 */
  readonly unavailabilityKinds: readonly CopilotDestinationUnavailabilityKind[]
  /** 规则命中次数。 */
  readonly ruleHitCount: number
  /** 模型兜底次数。 */
  readonly fallbackCount: number
  /** 路由层 scope。 */
  readonly scope: CopilotScope

  // ── 账本增量字段 ──

  /** 用户最终到达的 destination（null = 尚未归因/放弃）。 */
  readonly userDestination: CopilotDestination | null
  /** 五类改道分类。 */
  readonly redirectClass: RoutingRedirectClass
  /** 归因置信度。 */
  readonly attributionConfidence: RoutingAttributionConfidence
  /** 输入元组 hash（含目录版本）。 */
  readonly inputTupleHash: string
  /** 幂等键。 */
  readonly idempotencyKey: string
  /** trace 引用（未落地时为 null 占位）。 */
  readonly traceId: string | null
  /** 记录创建时间。 */
  readonly createdAt: Date
}

// ===========================================================================
// 结构类型 — 准确率指标（§2.5）
// ===========================================================================

/**
 * 路由准确率聚合指标（口径写死）。
 *
 * 口径规则：
 * - 首位命中率与前 N 命中率分列
 * - 放弃计入分母但单独可见
 * - 歧义选择不计入错误分子
 * - 切分维度为组织/意图分类/子意图/目录版本/时间窗
 */
export interface RoutingAccuracyMetrics {
  /** 总记录数（分母）。 */
  readonly totalDecisions: number
  /** 首位命中数（用户采纳首位推荐）。 */
  readonly topOneHits: number
  /** 前 N 命中数（用户采纳任一推荐候选，含首位）。 */
  readonly topNHits: number
  /** 放弃数（单独可见，计入分母）。 */
  readonly abandonedCount: number
  /** 歧义选择数（不计入错误分子）。 */
  readonly ambiguousSelectionCount: number
  /** 首位命中率（topOneHits / totalDecisions）。 */
  readonly topOneHitRate: number
  /** 前 N 命中率（topNHits / totalDecisions）。 */
  readonly topNHitRate: number
  /** 改到未推荐 destination 数（最强错误信号）。 */
  readonly wentToUnrecommendedCount: number
  /** 采纳非首位候选数。 */
  readonly acceptedNonTopCount: number
}

// ===========================================================================
// 结构类型 — 规则命中率与模型兜底率（§2.6）
// ===========================================================================

/**
 * 规则命中率与模型兜底率聚合。
 * 兜底率上升意味着目录需要补子意图。
 */
export interface RoutingRuleHitMetrics {
  /** 总路由决策数。 */
  readonly totalDecisions: number
  /** 规则命中总数。 */
  readonly totalRuleHits: number
  /** 模型兜底总数。 */
  readonly totalFallbacks: number
  /** 规则命中率（totalRuleHits / totalDecisions）。 */
  readonly ruleHitRate: number
  /** 模型兜底率（totalFallbacks / totalDecisions）。 */
  readonly fallbackRate: number
  /** 兜底率健康状态。 */
  readonly fallbackHealthStatus: RoutingFallbackHealthStatus
}

// ===========================================================================
// 结构类型 — 澄清效率（§2.7）
// ===========================================================================

/**
 * 澄清效率聚合。
 * 回答「澄清是在帮忙还是在骚扰」。
 */
export interface RoutingClarificationEfficiency {
  /** 总决策数。 */
  readonly totalDecisions: number
  /** 各轮数分布（key = 轮数，value = 该轮数的决策数）。 */
  readonly roundDistribution: Readonly<Record<number, number>>
  /** 澄清后成功路由数（clarificationRoundCount > 0 且 redirectClass ∈ {accepted_top, accepted_non_top}）。 */
  readonly postClarificationSuccessCount: number
  /** 澄清后总决策数（clarificationRoundCount > 0）。 */
  readonly postClarificationTotalCount: number
  /** 澄清后成功率（postClarificationSuccessCount / postClarificationTotalCount）。 */
  readonly postClarificationSuccessRate: number
}

// ===========================================================================
// 结构类型 — 不可用类别分布（§2.8）
// ===========================================================================

/**
 * 三类不可用的频次分布。
 * 回答「用户最常撞到哪种墙」。
 */
export interface RoutingUnavailabilityDistribution {
  /** 无权限缺席次数。 */
  readonly missingPermissionCount: number
  /** 未启用次数。 */
  readonly notEnabledCount: number
  /** 授权门次数。 */
  readonly authorizationGatedCount: number
  /** 总不可用事件数。 */
  readonly totalUnavailabilityEvents: number
}

// ===========================================================================
// 结构类型 — 确定性违规（§5.2）
// ===========================================================================

/**
 * 确定性违规记录：同 inputTupleHash 出现不同 destination 排序或 confidence。
 */
export interface ReproducibilityViolation {
  /** 违规的 inputTupleHash。 */
  readonly inputTupleHash: string
  /** 不同的 destination 排序集合。 */
  readonly distinctDestinationOrders: readonly string[][]
  /** 不同的 confidence 集合数。 */
  readonly distinctConfidenceSets: number
  /** 出现次数。 */
  readonly occurrenceCount: number
  /** 涉及的目录版本（同 hash 不同版本是合法差异，不应报违规）。 */
  readonly catalogVersions: readonly string[]
}

// ===========================================================================
// 结构类型 — 聚合切分维度（§2.5）
// ===========================================================================

/**
 * 聚合查询的切分维度。
 */
export interface RoutingAggregateFilter {
  /** 组织 ID（必填，组织隔离）。 */
  readonly organizationId: number
  /** 意图分类切分。 */
  readonly intentClass?: CopilotIntentClass
  /** 子意图 ID 切分。 */
  readonly subIntentId?: string
  /** 目录版本切分。 */
  readonly catalogVersion?: string
  /** 时间窗起始（ISO 8601）。 */
  readonly startTime?: string
  /** 时间窗结束（ISO 8601）。 */
  readonly endTime?: string
}

/**
 * 完整聚合结果。
 */
export interface RoutingAggregateResult {
  /** 准确率指标。 */
  readonly accuracy: RoutingAccuracyMetrics
  /** 规则命中率与模型兜底率。 */
  readonly ruleHit: RoutingRuleHitMetrics
  /** 澄清效率。 */
  readonly clarificationEfficiency: RoutingClarificationEfficiency
  /** 不可用类别分布。 */
  readonly unavailabilityDistribution: RoutingUnavailabilityDistribution
  /** 切分维度。 */
  readonly filter: RoutingAggregateFilter
}

// ===========================================================================
// Helpers — 输入元组 hash（§2.9 / §5.1）
// ===========================================================================

/**
 * 计算输入元组 hash。
 * **必须含目录版本**，避免合法目录变更被误判为确定性违规。
 *
 * 输入元组由以下字段构成：
 * - intentSummary（归一化意图摘要）
 * - destinationOrder（有序 destination 列表）
 * - confidences（对应 confidence 值）
 * - catalogVersion（目录版本）
 * - scope（路由 scope）
 */
export function computeRoutingInputTupleHash(params: {
  readonly intentSummary: string
  readonly destinationOrder: readonly string[]
  readonly confidences: readonly number[]
  readonly catalogVersion: string
  readonly scope: CopilotScope
}): string {
  const parts = [
    params.intentSummary,
    params.destinationOrder.join(','),
    params.confidences.map(String).join(','),
    params.catalogVersion,
    params.scope,
  ]
  return deterministicHash(parts.join('|'))
}

/**
 * 从路由决策记录计算输入元组 hash（便捷封装）。
 */
export function computeRoutingRecordTupleHash(record: CopilotRoutingDecisionRecord): string {
  return computeRoutingInputTupleHash({
    intentSummary: record.intentSummary,
    destinationOrder: [...record.destinationOrder],
    confidences: [...record.confidences],
    catalogVersion: record.catalogVersion,
    scope: record.scope,
  })
}

// ===========================================================================
// Helpers — 幂等键派生（§2.2）
// ===========================================================================

/**
 * 计算幂等键。
 * 由 recordId + 组织 ID + 目录版本派生，保证同一路由决策不重复落库。
 */
export function computeRoutingLedgerIdempotencyKey(params: {
  readonly recordId: string
  readonly organizationId: number
  readonly catalogVersion: string
}): string {
  return deterministicHash(`${params.recordId}|${params.organizationId}|${params.catalogVersion}`)
}

// ===========================================================================
// Helpers — 改道判定（§2.3 / §4.2）
// ===========================================================================

/**
 * 判定改道分类。
 *
 * @param recommendedDestinations - 路由推荐的有序 destination 列表
 * @param userDestination - 用户最终到达的 destination（null = 放弃）
 * @param wasAmbiguous - 路由是否返回了歧义候选集
 * @returns 五类改道分类
 */
export function classifyRedirect(
  recommendedDestinations: readonly string[],
  userDestination: CopilotDestination | null,
  wasAmbiguous: boolean,
): RoutingRedirectClass {
  if (userDestination === null) {
    return 'abandoned'
  }

  // 歧义候选中选择：路由返回了歧义候选集，用户选择了其中一个
  if (wasAmbiguous && recommendedDestinations.includes(userDestination)) {
    return 'chose_from_ambiguous'
  }

  // 首位推荐
  if (recommendedDestinations.length > 0 && recommendedDestinations[0] === userDestination) {
    return 'accepted_top'
  }

  // 非首位候选
  if (recommendedDestinations.includes(userDestination)) {
    return 'accepted_non_top'
  }

  // 改到未推荐的 destination（最强错误信号）
  return 'went_to_unrecommended'
}

// ===========================================================================
// Helpers — 兜底率健康状态判定（§6.6）
// ===========================================================================

/** 兜底率警告阈值（默认 20%）。 */
export const ROUTING_FALLBACK_WARNING_THRESHOLD = 0.2

/** 兜底率临界阈值（默认 50%）。 */
export const ROUTING_FALLBACK_CRITICAL_THRESHOLD = 0.5

/**
 * 判定兜底率健康状态。
 * **禁止自动动作**——健康状态变更只产出状态与 reason code，不触发任何业务动作。
 */
export function evaluateFallbackHealthStatus(fallbackRate: number): {
  status: RoutingFallbackHealthStatus
  reasonCode: string
  runbookRef: string
} {
  if (fallbackRate >= ROUTING_FALLBACK_CRITICAL_THRESHOLD) {
    return {
      status: 'critical',
      reasonCode: 'ROUTING_FALLBACK_CRITICAL',
      runbookRef: 'docs/runbooks/routing-fallback-critical.md',
    }
  }
  if (fallbackRate >= ROUTING_FALLBACK_WARNING_THRESHOLD) {
    return {
      status: 'warning',
      reasonCode: 'ROUTING_FALLBACK_WARNING',
      runbookRef: 'docs/runbooks/routing-fallback-warning.md',
    }
  }
  return {
    status: 'healthy',
    reasonCode: 'ROUTING_FALLBACK_HEALTHY',
    runbookRef: '',
  }
}

// ===========================================================================
// Helpers — 不可用类别归一化（§2.8）
// ===========================================================================

/**
 * 从路由层的 unavailabilityKinds 和缺失权限计算三类不可用分布。
 *
 * 路由层只暴露 `not-enabled` 和 `authorization-gated`；
 * `missing-permission` 由账本从权限比较中计算得出。
 *
 * @param routingUnavailabilityKinds - 路由层报告的不可用类别
 * @param missingPermissionDestinations - 因无权限被过滤的 destination 数量
 */
export function computeUnavailabilityDistribution(
  routingUnavailabilityKinds: readonly CopilotDestinationUnavailabilityKind[],
  missingPermissionDestinations: number,
): RoutingUnavailabilityDistribution {
  let notEnabledCount = 0
  let authorizationGatedCount = 0

  for (const kind of routingUnavailabilityKinds) {
    if (kind === 'not-enabled') notEnabledCount++
    else if (kind === 'authorization-gated') authorizationGatedCount++
  }

  return {
    missingPermissionCount: missingPermissionDestinations,
    notEnabledCount,
    authorizationGatedCount,
    totalUnavailabilityEvents:
      missingPermissionDestinations + notEnabledCount + authorizationGatedCount,
  }
}

// ===========================================================================
// Helpers — 确定性违规查询（§5.2）
// ===========================================================================

/**
 * 检测确定性违规：同 inputTupleHash 出现不同 destination 排序或 confidence。
 *
 * @param records - 具有相同 inputTupleHash 的路由决策记录
 * @returns 违规记录（无违规时返回 null）
 */
export function detectReproducibilityViolation(
  records: readonly {
    readonly inputTupleHash: string
    readonly destinationOrder: readonly string[]
    readonly confidences: readonly number[]
    readonly catalogVersion: string
  }[],
): ReproducibilityViolation | null {
  if (records.length < 2) return null

  const first = records[0]
  if (!first) return null
  const hash = first.inputTupleHash
  const distinctOrders = new Set<string>()
  const distinctConfidenceSets = new Set<string>()
  const catalogVersions = new Set<string>()

  for (const r of records) {
    distinctOrders.add(r.destinationOrder.join(','))
    distinctConfidenceSets.add(r.confidences.map(String).join(','))
    catalogVersions.add(r.catalogVersion)
  }

  // 如果所有记录的 catalogVersion 相同但排序不同，才是违规
  // 如果 catalogVersion 不同，差异是合法的
  if (catalogVersions.size > 1) {
    // 不同目录版本的差异是合法的，不报违规
    return null
  }

  if (distinctOrders.size <= 1 && distinctConfidenceSets.size <= 1) {
    return null
  }

  return {
    inputTupleHash: hash,
    distinctDestinationOrders: [...distinctOrders].map((s) => s.split(',')),
    distinctConfidenceSets: distinctConfidenceSets.size,
    occurrenceCount: records.length,
    catalogVersions: [...catalogVersions],
  }
}

// ===========================================================================
// Helpers — 低敏 sanitizer（复用账本禁止键类别）
// ===========================================================================

/** 禁止键类别：复用账本 LEDGER_FORBIDDEN_KEY_CATEGORIES。 */
export const ROUTING_LEDGER_FORBIDDEN_KEY_CATEGORIES = [...LEDGER_FORBIDDEN_KEY_CATEGORIES] as const
export type RoutingLedgerForbiddenKeyCategory =
  (typeof ROUTING_LEDGER_FORBIDDEN_KEY_CATEGORIES)[number]

/**
 * 校验路由决策记录是否包含禁止内容。
 * 只允许归一化摘要、destination 标识、枚举值、计数与 hash。
 * 禁止原始用户输入全文、prompt、模型输出、凭据。
 */
export function validateRoutingLedgerRecordLowSensitivity(record: {
  readonly intentSummary: string
  readonly destinationOrder: readonly string[]
  readonly confidences: readonly number[]
  readonly ruleHitCount: number
  readonly fallbackCount: number
  readonly inputTupleHash: string
  readonly idempotencyKey: string
  readonly traceId: string | null
}): { safe: boolean; issues: string[] } {
  const issues: string[] = []

  // 检查 intentSummary 是否包含禁止内容模式
  const forbiddenPatterns = [
    /password/i,
    /secret/i,
    /apiKey/i,
    /authorization/i,
    /bearer/i,
    /token/i,
  ]
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(record.intentSummary)) {
      issues.push(`intentSummary 命中禁止模式: ${pattern.source}`)
    }
  }

  // 检查 intentSummary 是否过长（归一化摘要应有界）
  if (record.intentSummary.length > 1024) {
    issues.push('intentSummary 超过 1024 字符上界')
  }

  return { safe: issues.length === 0, issues }
}

// ===========================================================================
// Helpers — 从路由记录构建账本记录（§4.1）
// ===========================================================================

/**
 * 从路由决策记录和用户最终 destination 构建账本记录。
 * 消费路由层形状，不重定义。
 */
export function buildRoutingLedgerRecord(params: {
  readonly routingRecord: CopilotRoutingDecisionRecord
  readonly organizationId: number
  readonly userDestination: CopilotDestination | null
  readonly missingPermissionCount: number
  readonly traceId?: string | null
  readonly now?: Date
}): CopilotRoutingLedgerRecord {
  const { routingRecord, organizationId, userDestination } = params
  const now = params.now ?? new Date()

  const redirectClass = classifyRedirect(
    routingRecord.destinationOrder,
    userDestination,
    routingRecord.ambiguous,
  )

  // 归因置信度：有 userDestination 时默认 direct，否则 ambiguous
  const attributionConfidence: RoutingAttributionConfidence =
    userDestination !== null ? 'direct' : 'ambiguous'

  const inputTupleHash = computeRoutingRecordTupleHash(routingRecord)

  const idempotencyKey = computeRoutingLedgerIdempotencyKey({
    recordId: routingRecord.recordId,
    organizationId,
    catalogVersion: routingRecord.catalogVersion,
  })

  return {
    dbId: 0, // 由持久化层填充
    organizationId,
    recordId: routingRecord.recordId,
    catalogVersion: routingRecord.catalogVersion,
    intentClass: routingRecord.intentClass,
    subIntentId: routingRecord.subIntentId,
    intentSummary: routingRecord.intentSummary,
    destinationOrder: [...routingRecord.destinationOrder],
    confidences: [...routingRecord.confidences],
    clarificationRoundCount: routingRecord.clarificationRoundCount,
    ambiguous: routingRecord.ambiguous,
    unavailabilityKinds: [...routingRecord.unavailabilityKinds],
    ruleHitCount: routingRecord.ruleHitCount,
    fallbackCount: routingRecord.fallbackCount,
    scope: routingRecord.scope,
    userDestination,
    redirectClass,
    attributionConfidence,
    inputTupleHash,
    idempotencyKey,
    traceId: params.traceId ?? null,
    createdAt: now,
  }
}

// ===========================================================================
// Helpers — 准确率聚合计算（§6.1–6.3）
// ===========================================================================

/**
 * 计算准确率指标。
 * 口径写死：首位命中率与前 N 命中率分列、放弃计入分母但单独可见、
 * 歧义选择不计入错误分子。
 */
export function computeRoutingAccuracyMetrics(
  records: readonly { readonly redirectClass: RoutingRedirectClass }[],
): RoutingAccuracyMetrics {
  const totalDecisions = records.length
  if (totalDecisions === 0) {
    return {
      totalDecisions: 0,
      topOneHits: 0,
      topNHits: 0,
      abandonedCount: 0,
      ambiguousSelectionCount: 0,
      topOneHitRate: 0,
      topNHitRate: 0,
      wentToUnrecommendedCount: 0,
      acceptedNonTopCount: 0,
    }
  }

  let topOneHits = 0
  let topNHits = 0
  let abandonedCount = 0
  let ambiguousSelectionCount = 0
  let wentToUnrecommendedCount = 0
  let acceptedNonTopCount = 0

  for (const r of records) {
    switch (r.redirectClass) {
      case 'accepted_top':
        topOneHits++
        topNHits++
        break
      case 'accepted_non_top':
        topNHits++
        acceptedNonTopCount++
        break
      case 'went_to_unrecommended':
        wentToUnrecommendedCount++
        break
      case 'abandoned':
        abandonedCount++
        break
      case 'chose_from_ambiguous':
        ambiguousSelectionCount++
        break
    }
  }

  return {
    totalDecisions,
    topOneHits,
    topNHits,
    abandonedCount,
    ambiguousSelectionCount,
    topOneHitRate: topOneHits / totalDecisions,
    topNHitRate: topNHits / totalDecisions,
    wentToUnrecommendedCount,
    acceptedNonTopCount,
  }
}

// ===========================================================================
// Helpers — 规则命中率与模型兜底率聚合（§6.5–6.6）
// ===========================================================================

/**
 * 计算规则命中率与模型兜底率。
 */
export function computeRoutingRuleHitMetrics(
  records: readonly {
    readonly ruleHitCount: number
    readonly fallbackCount: number
  }[],
): RoutingRuleHitMetrics {
  const totalDecisions = records.length
  if (totalDecisions === 0) {
    return {
      totalDecisions: 0,
      totalRuleHits: 0,
      totalFallbacks: 0,
      ruleHitRate: 0,
      fallbackRate: 0,
      fallbackHealthStatus: 'healthy',
    }
  }

  let totalRuleHits = 0
  let totalFallbacks = 0

  for (const r of records) {
    totalRuleHits += r.ruleHitCount
    totalFallbacks += r.fallbackCount
  }

  const fallbackRate = totalFallbacks / totalDecisions
  const health = evaluateFallbackHealthStatus(fallbackRate)

  return {
    totalDecisions,
    totalRuleHits,
    totalFallbacks,
    ruleHitRate: totalRuleHits / totalDecisions,
    fallbackRate,
    fallbackHealthStatus: health.status,
  }
}

// ===========================================================================
// Helpers — 澄清效率聚合（§6.8）
// ===========================================================================

/**
 * 计算澄清效率。
 */
export function computeRoutingClarificationEfficiency(
  records: readonly {
    readonly clarificationRoundCount: number
    readonly redirectClass: RoutingRedirectClass
  }[],
): RoutingClarificationEfficiency {
  const totalDecisions = records.length
  if (totalDecisions === 0) {
    return {
      totalDecisions: 0,
      roundDistribution: {},
      postClarificationSuccessCount: 0,
      postClarificationTotalCount: 0,
      postClarificationSuccessRate: 0,
    }
  }

  const roundDistribution: Record<number, number> = {}
  let postClarificationSuccessCount = 0
  let postClarificationTotalCount = 0

  for (const r of records) {
    const rounds = r.clarificationRoundCount
    roundDistribution[rounds] = (roundDistribution[rounds] ?? 0) + 1

    if (rounds > 0) {
      postClarificationTotalCount++
      if (r.redirectClass === 'accepted_top' || r.redirectClass === 'accepted_non_top') {
        postClarificationSuccessCount++
      }
    }
  }

  return {
    totalDecisions,
    roundDistribution,
    postClarificationSuccessCount,
    postClarificationTotalCount,
    postClarificationSuccessRate:
      postClarificationTotalCount > 0
        ? postClarificationSuccessCount / postClarificationTotalCount
        : 0,
  }
}
