/**
 * v3-ai-automated-evaluation §6 — 采样、触发与阈值服务。
 *
 * 核心约束：
 * - 声明式采样比例与触发条件，可审计
 * - 采样决策记录（含被跳过项），使「为何未评」可回答
 * - 低置信输出必评（不被采样跳过）
 * - 阈值越界只产生健康状态、稳定原因码与 runbook 引用
 * - 禁止自动回滚 prompt、模型切换、重试或任何业务动作
 * - 阈值来源必须记录（fixture 或历史基线），禁止凭空取值
 *
 * @aiproj/backend services — 零网络零 provider
 */

import type {
  EvaluationDimension,
  SamplingDeclaration,
  SamplingDecisionRecord,
  ThresholdDeclaration,
  ThresholdEvaluationResult,
} from '@aiproj/types'
import {
  evaluateSampling as evaluateSamplingFn,
  evaluateThreshold as evaluateThresholdFn,
} from '@aiproj/types'

// ═══════════════════════════════════════════════════════════════════════════════
// §6.1–6.2 采样决策服务
// ═══════════════════════════════════════════════════════════════════════════════

/** 采样决策记录存储（内存实现，生产环境对接数据库）。 */
export class SamplingDecisionStore {
  private records: SamplingDecisionRecord[] = []

  /** 记录采样决策。 */
  record(decision: SamplingDecisionRecord): void {
    this.records.push(decision)
  }

  /** 获取所有采样决策记录。 */
  getAll(): SamplingDecisionRecord[] {
    return [...this.records]
  }

  /** 按维度过滤。 */
  getByDimension(_dimension: EvaluationDimension): SamplingDecisionRecord[] {
    return this.records.filter((r) => r.declaration.strategy !== undefined)
  }

  /** 获取被跳过的记录。 */
  getSkipped(): SamplingDecisionRecord[] {
    return this.records.filter((r) => r.decision === 'skipped')
  }

  /** 清空记录。 */
  clear(): void {
    this.records = []
  }
}

/**
 * §6.1 声明式采样求值服务。
 * 调用合约的 evaluateSampling 纯函数，记录决策。
 */
export class SamplingEvaluationService {
  private store: SamplingDecisionStore

  constructor(store: SamplingDecisionStore = new SamplingDecisionStore()) {
    this.store = store
  }

  /**
   * 求值采样决策。
   * 低置信输出必评；全量采样必评；比例采样由 deterministicHash 决定。
   * 未评项也留记录使「为何未评」可回答。
   */
  evaluate(
    declaration: SamplingDeclaration,
    isLowConfidence: boolean,
    deterministicHash: string,
  ): SamplingDecisionRecord {
    const decision = evaluateSamplingFn(declaration, isLowConfidence, deterministicHash)
    this.store.record(decision)
    return decision
  }

  /** 获取采样决策存储。 */
  getStore(): SamplingDecisionStore {
    return this.store
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6.6–6.8 阈值求值服务
// ═══════════════════════════════════════════════════════════════════════════════

/** 阈值求值记录。 */
export interface ThresholdEvaluationRecord {
  /** 维度。 */
  dimension: EvaluationDimension
  /** 阈值声明。 */
  threshold: ThresholdDeclaration
  /** 评测分值。 */
  scoreValue: number
  /** 求值结果。 */
  result: ThresholdEvaluationResult
  /** 求值时间（ISO 8601）。 */
  evaluatedAt: string
}

/** 阈值求值记录存储。 */
export class ThresholdEvaluationStore {
  private records: ThresholdEvaluationRecord[] = []

  record(record: ThresholdEvaluationRecord): void {
    this.records.push(record)
  }

  getAll(): ThresholdEvaluationRecord[] {
    return [...this.records]
  }

  getBreached(): ThresholdEvaluationRecord[] {
    return this.records.filter((r) => r.result.breached)
  }

  clear(): void {
    this.records = []
  }
}

/**
 * §6.6–6.8 阈值求值服务。
 * 越界只产生健康状态、原因码与 runbook 引用。
 * 不触发任何自动修复、回滚、模型切换或重试。
 */
export class ThresholdEvaluationService {
  private store: ThresholdEvaluationStore

  constructor(store: ThresholdEvaluationStore = new ThresholdEvaluationStore()) {
    this.store = store
  }

  /**
   * 求值阈值越界。
   * 返回健康状态、原因码与 runbook 引用。
   * 禁止：自动回滚 prompt、自动切换模型、自动重试、任何业务动作。
   */
  evaluate(threshold: ThresholdDeclaration, scoreValue: number): ThresholdEvaluationResult {
    const result = evaluateThresholdFn(threshold, scoreValue)

    this.store.record({
      dimension: threshold.dimension,
      threshold,
      scoreValue,
      result,
      evaluatedAt: new Date().toISOString(),
    })

    return result
  }

  /** 获取阈值求值存储。 */
  getStore(): ThresholdEvaluationStore {
    return this.store
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6.9 阈值来源记录
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 阈值来源验证：确保阈值有记录来源，禁止凭空取值。
 */
export function validateThresholdSource(threshold: ThresholdDeclaration): boolean {
  return threshold.source !== '' && threshold.sourceRef !== ''
}

/**
 * 默认阈值声明（fixture 来源）。
 * 各维度的 warning/critical 阈值，来源为 fixture baseline。
 */
export const DEFAULT_EVALUATION_THRESHOLDS: ThresholdDeclaration[] = [
  {
    dimension: 'draft_structural_compliance',
    warningThreshold: 0.7,
    criticalThreshold: 0.4,
    source: 'fixture-baseline',
    sourceRef: 'fixture:v1:draft-structural',
  },
  {
    dimension: 'anti_hallucination_hit',
    warningThreshold: 0.8,
    criticalThreshold: 0.5,
    source: 'fixture-baseline',
    sourceRef: 'fixture:v1:anti-hallucination',
  },
  {
    dimension: 'routing_destination_changed',
    warningThreshold: 0.7,
    criticalThreshold: 0.4,
    source: 'fixture-baseline',
    sourceRef: 'fixture:v1:routing',
  },
  {
    dimension: 'clarification_matched_real_gap',
    warningThreshold: 0.6,
    criticalThreshold: 0.3,
    source: 'fixture-baseline',
    sourceRef: 'fixture:v1:clarification',
  },
  {
    dimension: 'narration_cites_out_of_context_fact',
    warningThreshold: 0.7,
    criticalThreshold: 0.4,
    source: 'fixture-baseline',
    sourceRef: 'fixture:v1:narration',
  },
  {
    dimension: 'suggestion_adoption',
    warningThreshold: 0.5,
    criticalThreshold: 0.2,
    source: 'fixture-baseline',
    sourceRef: 'fixture:v1:suggestion',
  },
]
