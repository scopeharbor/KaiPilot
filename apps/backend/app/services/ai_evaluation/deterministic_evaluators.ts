/**
 * v3-ai-automated-evaluation §4 — 确定性评测器集合。
 *
 * 六个维度的确定性评测器，均为纯函数：
 * - draft_structural_compliance: 草案结构合规（规则检查）
 * - anti_hallucination_hit: 反幻觉命中（消费既有检查结果）
 * - routing_destination_changed: 路由被改道（比对决策与最终选择）
 * - clarification_matched_real_gap: 澄清命中真实缺口
 * - narration_cites_out_of_context_fact: 叙述引用上下文外事实
 * - suggestion_adoption: 建议采纳（消费反馈账本，未落地时留接缝）
 *
 * 确定性评测器约束：
 * - 零运行时依赖：不导入 Date.now() / Math.random() / 外部服务
 * - 可复现：相同输入两次评测产出相同分值与标签
 * - 不依赖时钟与随机源
 */

import type {
  DeterministicEvaluatorFn,
  DeterministicEvaluatorInput,
  DeterministicEvaluatorOutput,
  EvaluationDimension,
} from '@aiproj/types'

// ═══════════════════════════════════════════════════════════════════════════════
// §4.1 草案结构合规评测器
// ═══════════════════════════════════════════════════════════════════════════════

/** 草案结构合规评测器：检查草案是否包含所有必需结构字段。 */
export const draftStructuralComplianceEvaluator: DeterministicEvaluatorFn = (
  input: DeterministicEvaluatorInput,
): DeterministicEvaluatorOutput => {
  const { features } = input

  // 检查必需字段是否存在
  const requiredFields = ['wbsNodes', 'taskDependencies', 'acceptanceCriteria']
  const missingFields: string[] = []

  for (const field of requiredFields) {
    const value = features[field]
    if (value === undefined || value === null) {
      missingFields.push(field)
    } else if (Array.isArray(value) && value.length === 0) {
      missingFields.push(field)
    }
  }

  if (missingFields.length === 0) {
    return {
      scoreValue: 1,
      scoreLabel: 'pass',
      explanation: 'Draft structure complies with all required fields',
    }
  }

  return {
    scoreValue: 0,
    scoreLabel: 'fail',
    explanation: `Draft missing required fields: ${missingFields.join(', ')}`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4.2 反幻觉命中评测器
// ═══════════════════════════════════════════════════════════════════════════════

/** 反幻觉评测结果接口。 */
export interface AntiHallucinationCheckResult {
  /** 是否通过反幻觉检查。 */
  passed: boolean
  /** 检查项数量。 */
  totalChecks: number
  /** 通过的检查项数量。 */
  passedChecks: number
  /** 失败的检查项列表。 */
  failedChecks: string[]
}

/** 反幻觉命中评测器：消费既有反幻觉检查结果。 */
export const antiHallucinationHitEvaluator: DeterministicEvaluatorFn = (
  input: DeterministicEvaluatorInput,
): DeterministicEvaluatorOutput => {
  const { features } = input

  // 消费既有反幻觉检查结果
  const antiHallucinationResult = features.antiHallucination as
    AntiHallucinationCheckResult | undefined

  if (!antiHallucinationResult) {
    // 无反幻觉检查结果 → 不可评
    return {
      scoreValue: 0,
      scoreLabel: 'not-evaluated',
      explanation: 'No anti-hallucination check result available',
    }
  }

  if (antiHallucinationResult.passed) {
    return {
      scoreValue: 1,
      scoreLabel: 'pass',
      explanation: `All ${antiHallucinationResult.totalChecks} anti-hallucination checks passed`,
    }
  }

  return {
    scoreValue: 0,
    scoreLabel: 'fail',
    explanation: `Anti-hallucination check failed: ${antiHallucinationResult.failedChecks.length} of ${antiHallucinationResult.totalChecks} checks failed`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4.3 路由被改道评测器
// ═══════════════════════════════════════════════════════════════════════════════

/** 路由决策接口。 */
export interface RoutingDecision {
  /** 路由器推荐的目的地。 */
  recommendedDestination: string
  /** 用户最终选择的目的地。 */
  userChosenDestination: string
}

/** 路由被改道评测器：比对路由决策与用户最终选择。 */
export const routingDestinationChangedEvaluator: DeterministicEvaluatorFn = (
  input: DeterministicEvaluatorInput,
): DeterministicEvaluatorOutput => {
  const { features } = input

  const routing = features.routing as RoutingDecision | undefined

  if (!routing) {
    return {
      scoreValue: 0,
      scoreLabel: 'not-evaluated',
      explanation: 'No routing decision available for comparison',
    }
  }

  if (routing.recommendedDestination === routing.userChosenDestination) {
    return {
      scoreValue: 1,
      scoreLabel: 'pass',
      explanation: 'User accepted the recommended routing destination',
    }
  }

  return {
    scoreValue: 0,
    scoreLabel: 'fail',
    explanation: `Routing destination changed: recommended=${routing.recommendedDestination}, chosen=${routing.userChosenDestination}`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4.4 澄清命中真实缺口评测器
// ═══════════════════════════════════════════════════════════════════════════════

/** 澄清结果接口。 */
export interface ClarificationResult {
  /** 澄清是否命中真实缺口。 */
  matchedRealGap: boolean
  /** 命中的缺口数量。 */
  matchedGaps: number
  /** 总澄清数量。 */
  totalClarifications: number
}

/** 澄清命中真实缺口评测器。 */
export const clarificationMatchedRealGapEvaluator: DeterministicEvaluatorFn = (
  input: DeterministicEvaluatorInput,
): DeterministicEvaluatorOutput => {
  const { features } = input

  const clarification = features.clarification as ClarificationResult | undefined

  if (!clarification) {
    return {
      scoreValue: 0,
      scoreLabel: 'not-evaluated',
      explanation: 'No clarification result available',
    }
  }

  if (clarification.matchedRealGap) {
    return {
      scoreValue: 1,
      scoreLabel: 'pass',
      explanation: `Clarification matched ${clarification.matchedGaps} of ${clarification.totalClarifications} real gaps`,
    }
  }

  return {
    scoreValue: 0,
    scoreLabel: 'fail',
    explanation: 'Clarification did not match any real gaps',
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4.5 叙述引用上下文外事实评测器
// ═══════════════════════════════════════════════════════════════════════════════

/** 叙述检查结果接口。 */
export interface NarrationCheckResult {
  /** 是否引用了上下文外事实。 */
  citesOutOfContext: boolean
  /** 引用的上下文外事实数量。 */
  outOfContextCount: number
  /** 上下文内事实总数。 */
  totalFacts: number
}

/** 叙述引用上下文外事实评测器。 */
export const narrationCitesOutOfContextFactEvaluator: DeterministicEvaluatorFn = (
  input: DeterministicEvaluatorInput,
): DeterministicEvaluatorOutput => {
  const { features } = input

  const narration = features.narration as NarrationCheckResult | undefined

  if (!narration) {
    return {
      scoreValue: 0,
      scoreLabel: 'not-evaluated',
      explanation: 'No narration check result available',
    }
  }

  if (!narration.citesOutOfContext) {
    return {
      scoreValue: 1,
      scoreLabel: 'pass',
      explanation: 'Narration stays within context facts',
    }
  }

  return {
    scoreValue: 0,
    scoreLabel: 'fail',
    explanation: `Narration cites ${narration.outOfContextCount} facts outside context`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4.6 建议采纳评测器（留接缝）
// ═══════════════════════════════════════════════════════════════════════════════

/** 建议采纳结果接口。 */
export interface SuggestionAdoptionResult {
  /** 建议是否被采纳。 */
  adopted: boolean
  /** 采纳的建议数量。 */
  adoptedCount: number
  /** 总建议数量。 */
  totalCount: number
}

/**
 * 建议采纳评测器。
 * 反馈账本未落地时留接缝并记录 fallback。
 */
export const suggestionAdoptionEvaluator: DeterministicEvaluatorFn = (
  input: DeterministicEvaluatorInput,
): DeterministicEvaluatorOutput => {
  const { features } = input

  const adoption = features.suggestionAdoption as SuggestionAdoptionResult | undefined

  if (!adoption) {
    // 反馈账本未落地时的 fallback
    return {
      scoreValue: 0,
      scoreLabel: 'not-evaluated',
      explanation: 'Feedback ledger not available; suggestion adoption cannot be evaluated',
    }
  }

  if (adoption.adopted) {
    return {
      scoreValue: 1,
      scoreLabel: 'pass',
      explanation: `${adoption.adoptedCount} of ${adoption.totalCount} suggestions adopted`,
    }
  }

  return {
    scoreValue: 0,
    scoreLabel: 'fail',
    explanation: `No suggestions adopted out of ${adoption.totalCount}`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4.7–4.9 评测器注册表与确定性保证
// ═══════════════════════════════════════════════════════════════════════════════

/** 确定性评测器注册表：维度 → 评测器函数。 */
export const DETERMINISTIC_EVALUATORS: Record<EvaluationDimension, DeterministicEvaluatorFn> = {
  draft_structural_compliance: draftStructuralComplianceEvaluator,
  anti_hallucination_hit: antiHallucinationHitEvaluator,
  routing_destination_changed: routingDestinationChangedEvaluator,
  clarification_matched_real_gap: clarificationMatchedRealGapEvaluator,
  narration_cites_out_of_context_fact: narrationCitesOutOfContextFactEvaluator,
  suggestion_adoption: suggestionAdoptionEvaluator,
}

/**
 * 运行确定性评测（纯函数入口）。
 * 相同输入两次评测产出相同分值与标签——可复现性由纯函数保证。
 * 不依赖时钟与随机源——零运行时依赖。
 */
export function runDeterministicEvaluation(
  input: DeterministicEvaluatorInput,
): DeterministicEvaluatorOutput {
  const evaluator = DETERMINISTIC_EVALUATORS[input.dimension]
  if (!evaluator) {
    return {
      scoreValue: 0,
      scoreLabel: 'not-evaluated',
      explanation: `No deterministic evaluator registered for dimension: ${input.dimension}`,
    }
  }
  return evaluator(input)
}
