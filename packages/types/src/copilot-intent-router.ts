/**
 * v3-copilot-intent-catalog-and-router —— 工具路由器（任务组 4 / 5 / 6 / 7）。
 *
 * 纯函数：意图分类结果 + 上下文包 + 权限 + 可用性 → 有序 destination 列表 + 路由决策记录。
 * 零 Adonis/React/数据库/网络/时钟/随机依赖。
 *
 * 职责（design D2 / D4 / D5 / D6 / D8）：
 * - 可复现性：相同输入元组 → 相同排序、action id、confidence、告警
 * - 歧义检测：置信度在边距内 → 确定性候选集合 + 判别问题
 * - 三类不可用：无权限（缺席）、未启用（可见不可用）、授权门（可见不可用+原因）
 * - 通用问答/外部检索分流：显式路由结果，非兜底
 * - 低敏路由决策记录产出（本 change 不落库）
 */
import {
  COPILOT_DESTINATION_REGISTRY,
  COPILOT_INTENT_CLASS_RULES,
  type CopilotConfidenceBand,
  type CopilotDestination,
  type CopilotIntentClass,
  type CopilotScope,
  type CopilotWarningCode,
} from './copilot-shared-contracts.js'
import {
  COPILOT_INTENT_AMBIGUITY_MARGIN,
  COPILOT_INTENT_CATALOG_VERSION,
  COPILOT_INTENT_DESTINATION_RANK_PENALTY,
  COPILOT_INTENT_MAX_CLARIFICATION_ROUNDS,
  COPILOT_INTENT_SAFE_FALLBACK_CONFIDENCE,
  COPILOT_SUB_INTENT_REGISTRY,
  type CopilotDestinationAvailability,
  type CopilotEntityReference,
  type CopilotExtractedSlot,
  type CopilotSubIntentEntry,
} from './copilot-intent-catalog.js'
import { type CopilotClassifierResult } from './copilot-intent-classifier.js'

// ===========================================================================
// 结构类型 — 路由输入
// ===========================================================================

export interface CopilotRouterInput {
  readonly normalizedInput: string
  readonly classifierResult: CopilotClassifierResult | null
  readonly contextScope: CopilotScope
  readonly permissions: readonly string[]
  readonly availability: readonly CopilotDestinationAvailability[]
  readonly currentRoute?: string
  readonly entityRefs?: readonly CopilotEntityReference[]
  readonly extractedSlots?: readonly CopilotExtractedSlot[]
  /** 已完成的澄清轮数（用于上界判定）。 */
  readonly clarificationRounds?: number
}

// ===========================================================================
// 结构类型 — 路由输出
// ===========================================================================

export interface CopilotRouterDestination {
  readonly destination: CopilotDestination
  readonly confidence: number
  readonly confidenceBand: CopilotConfidenceBand
  readonly evidenceRefs: readonly string[]
  readonly parameterHints: readonly string[]
  readonly reason: string
  readonly requiresUserConfirmation: boolean
}

export interface CopilotRouterAmbiguity {
  readonly candidates: readonly CopilotRouterDestination[]
  readonly discriminatingQuestion: string
}

export interface CopilotClarificationItem {
  readonly slotId: string
  readonly label: string
  readonly tier: 'critical' | 'recommended' | 'optional'
  readonly question: string
  readonly quickOptions?: readonly string[]
  readonly defaultValue?: {
    readonly value: string
    readonly confidence: number
    readonly reason: string
  }
}

export interface CopilotRouterResult {
  readonly destinations: readonly CopilotRouterDestination[]
  readonly ambiguity: CopilotRouterAmbiguity | null
  readonly clarificationRequired: boolean
  readonly clarificationItems: readonly CopilotClarificationItem[]
  readonly assumptionEntries: readonly CopilotAssumptionEntrySimple[]
  readonly warnings: readonly CopilotWarningCode[]
  readonly scope: CopilotScope
  readonly routingRecord: CopilotRoutingDecisionRecordSimple
  readonly stats: CopilotRoutingStats
}

export interface CopilotAssumptionEntrySimple {
  readonly slotId: string
  readonly statement: string
  readonly source: string
  readonly confidence: number
  readonly needsConfirmation: boolean
}

export interface CopilotRoutingDecisionRecordSimple {
  readonly recordId: string
  readonly catalogVersion: string
  readonly intentClass: CopilotIntentClass | null
  readonly subIntentId: string | null
  readonly intentSummary: string
  readonly destinationOrder: readonly string[]
  readonly confidences: readonly number[]
  readonly clarificationRoundCount: number
  readonly ambiguous: boolean
  readonly unavailabilityKinds: readonly ('not-enabled' | 'authorization-gated')[]
  readonly ruleHitCount: number
  readonly fallbackCount: number
  readonly userRerouted: boolean
  readonly scope: CopilotScope
}

export interface CopilotRoutingStats {
  readonly ruleHitCount: number
  readonly fallbackCount: number
}

// ===========================================================================
// 路由器主函数（4.1）
// ===========================================================================

let routerCallCounter = 0

export function copilotRoute(input: CopilotRouterInput): CopilotRouterResult {
  routerCallCounter++
  const { classifierResult, contextScope, permissions, availability } = input

  const warnings: CopilotWarningCode[] = []
  const unavailabilityKinds: ('not-enabled' | 'authorization-gated')[] = []

  // ── 安全兜底判定（6.9）──
  if (!classifierResult || !classifierResult.subIntentId) {
    return buildSafeFallback(input, warnings, unavailabilityKinds)
  }

  const entry = COPILOT_SUB_INTENT_REGISTRY.find(
    (e) => e.subIntentId === classifierResult.subIntentId,
  )
  if (!entry) {
    return buildSafeFallback(input, warnings, unavailabilityKinds)
  }

  // ── 通用问答分流（6.6）──
  if (entry.intentClass === 'meta' && entry.subIntentId === 'meta.cost_usage') {
    // 元类意图不走通用问答分流
  }

  // ── 槽位与澄清判定（5.1–5.8）──
  const clarificationResult = evaluateSlotCompleteness(entry, input)
  if (clarificationResult.requiredBlocked) {
    return buildClarificationResult(
      input,
      entry,
      clarificationResult,
      warnings,
      unavailabilityKinds,
    )
  }

  // ── Destination 映射与权限/可用性过滤（4.1 / 6.1–6.5）──
  const filteredDestinations = filterAndMapDestinations(
    entry,
    classifierResult,
    permissions,
    availability,
    warnings,
    unavailabilityKinds,
  )

  // ── 歧义检测（4.5）──
  const ambiguity = detectAmbiguity(filteredDestinations)

  // ── 构建路由记录（7.1–7.4）──
  const routingRecord = buildRoutingRecord(
    classifierResult,
    filteredDestinations,
    ambiguity,
    clarificationResult.assumptions.length,
    warnings,
    unavailabilityKinds,
    contextScope,
  )

  return {
    destinations: filteredDestinations,
    ambiguity,
    clarificationRequired: false,
    clarificationItems: [],
    assumptionEntries: clarificationResult.assumptions,
    warnings,
    scope: contextScope,
    routingRecord,
    stats: {
      ruleHitCount: classifierResult.isRuleHit ? 1 : 0,
      fallbackCount: classifierResult.isRuleHit ? 0 : 1,
    },
  }
}

// ===========================================================================
// Destination 过滤与映射（4.1 / 4.2 / 6.1–6.5）
// ===========================================================================

function filterAndMapDestinations(
  entry: CopilotSubIntentEntry,
  classifierResult: CopilotClassifierResult,
  permissions: readonly string[],
  availability: readonly CopilotDestinationAvailability[],
  warnings: CopilotWarningCode[],
  unavailabilityKinds: ('not-enabled' | 'authorization-gated')[],
): CopilotRouterDestination[] {
  const results: CopilotRouterDestination[] = []
  let rank = 0

  for (const destination of entry.candidateDestinations) {
    const metadata = COPILOT_DESTINATION_REGISTRY[destination]
    if (!metadata) continue

    // 6.1 无权限 → 缺席（不泄露存在）
    const hasPermission = metadata.requiredPermissions.every((p) => permissions.includes(p))
    if (!hasPermission) {
      warnings = [...warnings, 'PERMISSION_DENIED']
      continue
    }

    // 6.3 未启用 → 可见不可用
    const availEntry = availability.find((a) => a.destination === destination)
    if (availEntry?.kind === 'not-enabled') {
      unavailabilityKinds.push('not-enabled')
      results.push({
        destination,
        confidence: 0,
        confidenceBand: 'fallback',
        evidenceRefs: [],
        parameterHints: [availEntry.hint ?? '该能力未启用'],
        reason: availEntry.hint ?? '该能力未启用',
        requiresUserConfirmation: false,
      })
      continue
    }

    // 6.4 授权门 → 可见不可用 + 原因
    if (availEntry?.kind === 'authorization-gated') {
      unavailabilityKinds.push('authorization-gated')
      results.push({
        destination,
        confidence: 0,
        confidenceBand: 'fallback',
        evidenceRefs: [],
        parameterHints: [availEntry.hint ?? '需要用户授权'],
        reason: availEntry.hint ?? '需要用户授权',
        requiresUserConfirmation: false,
      })
      continue
    }

    // 可用 destination
    const confidence = classifierResult.confidence - rank * COPILOT_INTENT_DESTINATION_RANK_PENALTY
    const confidenceBand = mapConfidenceToBand(confidence)
    const classRule = COPILOT_INTENT_CLASS_RULES[classifierResult.intentClass!]
    const requiresConfirmation = classRule?.persistenceReachable
      ? metadata.persistenceReachable
      : false

    results.push({
      destination,
      confidence: Math.max(confidence, 0),
      confidenceBand,
      evidenceRefs: [classifierResult.matchedRuleId ?? 'classifier'],
      parameterHints: deriveParameterHints(entry, destination),
      reason: `规则命中：${classifierResult.matchedRuleStrength ?? '模型候选'}`,
      requiresUserConfirmation: requiresConfirmation,
    })
    rank++
  }

  return results
}

function deriveParameterHints(
  entry: CopilotSubIntentEntry,
  destination: CopilotDestination,
): readonly string[] {
  const hints: string[] = []
  const metadata = COPILOT_DESTINATION_REGISTRY[destination]
  if (metadata) {
    hints.push(`需要权限：${metadata.requiredPermissions.join(', ')}`)
  }
  if (entry.requiredSlots.length > 0) {
    hints.push(`必需槽位：${entry.requiredSlots.map((s) => s.label).join(', ')}`)
  }
  return hints
}

// ===========================================================================
// 歧义检测（4.5–4.7）
// ===========================================================================

function detectAmbiguity(
  destinations: readonly CopilotRouterDestination[],
): CopilotRouterAmbiguity | null {
  if (destinations.length < 2) return null
  const sorted = [...destinations].sort((a, b) => b.confidence - a.confidence)
  const first = sorted[0]
  const second = sorted[1]
  if (!first || !second) return null
  const diff = first.confidence - second.confidence
  if (diff <= COPILOT_INTENT_AMBIGUITY_MARGIN) {
    return {
      candidates: [first, second],
      discriminatingQuestion: `您想要的是「${first.destination}」还是「${second.destination}」？`,
    }
  }
  return null
}

// ===========================================================================
// 槽位完整性判定（5.1–5.8）
// ===========================================================================

interface SlotEvaluationResult {
  readonly requiredBlocked: boolean
  readonly clarificationItems: readonly CopilotClarificationItem[]
  readonly assumptions: readonly CopilotAssumptionEntrySimple[]
}

function evaluateSlotCompleteness(
  entry: CopilotSubIntentEntry,
  input: CopilotRouterInput,
): SlotEvaluationResult {
  const clarificationItems: CopilotClarificationItem[] = []
  const assumptions: CopilotAssumptionEntrySimple[] = []
  let requiredBlocked = false

  // 5.1 必需槽位
  for (const slot of entry.requiredSlots) {
    const extracted = input.extractedSlots?.find((e) => e.slotId === slot.slotId)
    if (!extracted || !extracted.value) {
      requiredBlocked = true
      clarificationItems.push({
        slotId: slot.slotId,
        label: slot.label,
        tier: 'critical',
        question: `请提供${slot.label}的信息`,
        quickOptions: slot.patterns,
      })
    }
  }

  // 5.4 recommended 档默认值替代
  for (const slot of entry.optionalSlots) {
    if (slot.tier === 'recommended' && slot.defaultValue) {
      const extracted = input.extractedSlots?.find((e) => e.slotId === slot.slotId)
      if (!extracted || !extracted.value) {
        assumptions.push({
          slotId: slot.slotId,
          statement: `使用默认值「${slot.defaultValue.value}」作为${slot.label}`,
          source: 'default',
          confidence: slot.defaultValue.confidence,
          needsConfirmation: true,
        })
      }
    } else if (slot.tier === 'critical') {
      // critical 可选槽位（不应出现在 optional 但防御性检查）
      const extracted = input.extractedSlots?.find((e) => e.slotId === slot.slotId)
      if (!extracted || !extracted.value) {
        clarificationItems.push({
          slotId: slot.slotId,
          label: slot.label,
          tier: 'critical',
          question: `请提供${slot.label}的信息`,
        })
      }
    }
  }

  // 5.6 澄清轮数上界
  if (
    input.clarificationRounds !== undefined &&
    input.clarificationRounds >= COPILOT_INTENT_MAX_CLARIFICATION_ROUNDS
  ) {
    // 达到上界：不再阻断，使用已记录的默认值继续
    requiredBlocked = false
  }

  return { requiredBlocked, clarificationItems, assumptions }
}

// ===========================================================================
// 澄清结果构建（5.3 / 5.8）
// ===========================================================================

function buildClarificationResult(
  input: CopilotRouterInput,
  entry: CopilotSubIntentEntry,
  slotResult: SlotEvaluationResult,
  warnings: CopilotWarningCode[],
  unavailabilityKinds: ('not-enabled' | 'authorization-gated')[],
): CopilotRouterResult {
  return {
    destinations: [],
    ambiguity: null,
    clarificationRequired: true,
    clarificationItems: slotResult.clarificationItems,
    assumptionEntries: slotResult.assumptions,
    warnings,
    scope: input.contextScope,
    routingRecord: {
      recordId: `router_clarify_${routerCallCounter}`,
      catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
      intentClass: entry.intentClass,
      subIntentId: entry.subIntentId,
      intentSummary: entry.label,
      destinationOrder: [],
      confidences: [],
      clarificationRoundCount: input.clarificationRounds ?? 0,
      ambiguous: false,
      unavailabilityKinds,
      ruleHitCount: input.classifierResult?.isRuleHit ? 1 : 0,
      fallbackCount: input.classifierResult?.isRuleHit ? 0 : 1,
      userRerouted: false,
      scope: input.contextScope,
    },
    stats: {
      ruleHitCount: input.classifierResult?.isRuleHit ? 1 : 0,
      fallbackCount: input.classifierResult?.isRuleHit ? 0 : 1,
    },
  }
}

// ===========================================================================
// 安全兜底（6.9 / 6.10）
// ===========================================================================

function buildSafeFallback(
  input: CopilotRouterInput,
  warnings: CopilotWarningCode[],
  unavailabilityKinds: ('not-enabled' | 'authorization-gated')[],
): CopilotRouterResult {
  warnings = [...warnings, 'AI_FALLBACK']
  return {
    destinations: [
      {
        destination: 'general_qa',
        confidence: COPILOT_INTENT_SAFE_FALLBACK_CONFIDENCE,
        confidenceBand: 'fallback',
        evidenceRefs: ['safe-fallback'],
        parameterHints: ['无法识别明确意图，转通用问答'],
        reason: '安全兜底：无法分类',
        requiresUserConfirmation: false,
      },
    ],
    ambiguity: null,
    // 目录无法识别操作不等于无法对话。由只读模型正常回答或自然追问，
    // 不给未知请求授予任何写入能力。
    clarificationRequired: false,
    clarificationItems: [],
    assumptionEntries: [],
    warnings,
    scope: input.contextScope,
    routingRecord: {
      recordId: `router_fallback_${routerCallCounter}`,
      catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
      intentClass: null,
      subIntentId: null,
      intentSummary: deriveSafeSummary(input.normalizedInput),
      destinationOrder: ['general_qa'],
      confidences: [COPILOT_INTENT_SAFE_FALLBACK_CONFIDENCE],
      clarificationRoundCount: input.clarificationRounds ?? 0,
      ambiguous: false,
      unavailabilityKinds,
      ruleHitCount: 0,
      fallbackCount: 1,
      userRerouted: false,
      scope: input.contextScope,
    },
    stats: {
      ruleHitCount: 0,
      fallbackCount: 1,
    },
  }
}

// ===========================================================================
// 辅助函数
// ===========================================================================

function mapConfidenceToBand(confidence: number): CopilotConfidenceBand {
  if (confidence >= 80) return 'high'
  if (confidence >= 50) return 'medium'
  if (confidence >= 30) return 'low'
  return 'fallback'
}

function deriveSafeSummary(normalizedInput: string): string {
  const maxLen = 40
  if (normalizedInput.length <= maxLen) return normalizedInput
  return normalizedInput.slice(0, maxLen - 3) + '…'
}

function buildRoutingRecord(
  classifierResult: CopilotClassifierResult,
  destinations: readonly CopilotRouterDestination[],
  ambiguity: CopilotRouterAmbiguity | null,
  clarificationRoundCount: number,
  _warnings: CopilotWarningCode[],
  unavailabilityKinds: readonly ('not-enabled' | 'authorization-gated')[],
  scope: CopilotScope,
): CopilotRoutingDecisionRecordSimple {
  return {
    recordId: `router_${routerCallCounter}`,
    catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
    intentClass: classifierResult.intentClass,
    subIntentId: classifierResult.subIntentId,
    intentSummary: classifierResult.intentSummary,
    destinationOrder: destinations.map((d) => d.destination),
    confidences: destinations.map((d) => d.confidence),
    clarificationRoundCount,
    ambiguous: ambiguity !== null,
    unavailabilityKinds: [...unavailabilityKinds],
    ruleHitCount: classifierResult.isRuleHit ? 1 : 0,
    fallbackCount: classifierResult.isRuleHit ? 0 : 1,
    userRerouted: false,
    scope,
  }
}
