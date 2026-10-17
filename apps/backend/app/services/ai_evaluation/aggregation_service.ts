/**
 * v3-ai-automated-evaluation §7 — 评分聚合、调和与失败姿态服务。
 *
 * 核心约束：
 * - 只读聚合查询：按组织、能力面、维度、时间窗的分布与趋势
 * - 趋势查询按 judge 模型与 prompt 版本分组，保证可比性
 * - 组织隔离：全部读路径附加 organization_id 过滤
 * - 跨组织访问返回非泄露错误
 * - Skill 评测结果到统一评分视图的映射与去重
 * - 评测失败降级：不得阻断生成、不得阻断人工确认、不得改变业务终态
 *
 * @aiproj/backend services — 零网络零 provider
 */

import type {
  EvaluationDimension,
  EvaluationAggregationQuery,
  EvaluationAggregationEntry,
  EvaluationAggregationResult,
  SkillEvaluationMapping,
  ScoreLabel,
} from '@aiproj/types'
import { computeSkillEvalDedupKey } from '@aiproj/types'

// ═══════════════════════════════════════════════════════════════════════════════
// §7.1–7.4 只读评分聚合
// ═══════════════════════════════════════════════════════════════════════════════

/** 评分记录内存存储（生产环境对接数据库查询）。 */
export class EvaluationScoreStore {
  private scores: Array<{
    organizationId: number
    evaluationName: string
    scoreValue: number
    scoreLabel: ScoreLabel
    evaluatorKind: string
    judgeModel?: string
    judgePromptVersion?: string
    createdAt: string
    id: string
  }> = []

  addScore(score: (typeof this.scores)[number]): void {
    this.scores.push(score)
  }

  query(params: {
    organizationId: number
    dimension?: string
    windowStart: string
    windowEnd: string
  }): typeof this.scores {
    return this.scores.filter(
      (s) =>
        s.organizationId === params.organizationId &&
        (!params.dimension || s.evaluationName === params.dimension) &&
        s.createdAt >= params.windowStart &&
        s.createdAt <= params.windowEnd,
    )
  }

  clear(): void {
    this.scores = []
  }
}

/**
 * §7.1 只读评分聚合服务。
 * 按组织、能力面、维度、时间窗聚合评分分布与趋势。
 */
export class EvaluationAggregationService {
  private store: EvaluationScoreStore

  constructor(store: EvaluationScoreStore = new EvaluationScoreStore()) {
    this.store = store
  }

  /**
   * §7.1 聚合查询：按组织、维度、时间窗。
   */
  aggregate(query: EvaluationAggregationQuery): EvaluationAggregationResult {
    const scores = this.store.query({
      organizationId: query.organizationId,
      dimension: query.dimension,
      windowStart: query.windowStart,
      windowEnd: query.windowEnd,
    })

    if (scores.length === 0) {
      return {
        entries: [],
        total: 0,
        window: { start: query.windowStart, end: query.windowEnd },
        isEmptyWindow: true,
      }
    }

    // 按维度分组聚合
    const grouped = new Map<string, typeof scores>()
    for (const score of scores) {
      const key = score.evaluationName
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(score)
    }

    const entries: EvaluationAggregationEntry[] = []
    for (const [dimension, groupScores] of grouped) {
      const passCount = groupScores.filter((s) => s.scoreLabel === 'pass').length
      const failCount = groupScores.filter((s) => s.scoreLabel === 'fail').length
      const notEvaluatedCount = groupScores.filter((s) => s.scoreLabel === 'not-evaluated').length
      const total = groupScores.length
      const avgScore = total > 0 ? groupScores.reduce((sum, s) => sum + s.scoreValue, 0) / total : 0

      entries.push({
        groupKey: { dimension },
        count: total,
        passCount,
        failCount,
        notEvaluatedCount,
        averageScoreValue: avgScore,
        passRate: total > 0 ? passCount / total : 0,
      })
    }

    return {
      entries,
      total: scores.length,
      window: { start: query.windowStart, end: query.windowEnd },
      isEmptyWindow: false,
    }
  }

  /**
   * §7.2 趋势查询：按 judge 模型与 prompt 版本分组。
   */
  trendByJudgeVersion(query: EvaluationAggregationQuery): EvaluationAggregationResult {
    const scores = this.store.query({
      organizationId: query.organizationId,
      dimension: query.dimension,
      windowStart: query.windowStart,
      windowEnd: query.windowEnd,
    })

    if (scores.length === 0) {
      return {
        entries: [],
        total: 0,
        window: { start: query.windowStart, end: query.windowEnd },
        isEmptyWindow: true,
      }
    }

    // 只取 judge 产生的评分，按 judgeModel + judgePromptVersion 分组
    const judgeScores = scores.filter((s) => s.evaluatorKind === 'judge')
    const grouped = new Map<string, typeof judgeScores>()
    for (const score of judgeScores) {
      const key = `${score.judgeModel || 'unknown'}:${score.judgePromptVersion || 'unknown'}`
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(score)
    }

    const entries: EvaluationAggregationEntry[] = []
    for (const [key, groupScores] of grouped) {
      const [judgeModel, judgePromptVersion] = key.split(':')
      const passCount = groupScores.filter((s) => s.scoreLabel === 'pass').length
      const failCount = groupScores.filter((s) => s.scoreLabel === 'fail').length
      const notEvaluatedCount = groupScores.filter((s) => s.scoreLabel === 'not-evaluated').length
      const total = groupScores.length
      const avgScore = total > 0 ? groupScores.reduce((sum, s) => sum + s.scoreValue, 0) / total : 0

      entries.push({
        groupKey: { judge_model: judgeModel, judge_prompt_version: judgePromptVersion },
        count: total,
        passCount,
        failCount,
        notEvaluatedCount,
        averageScoreValue: avgScore,
        passRate: total > 0 ? passCount / total : 0,
      })
    }

    return {
      entries,
      total: judgeScores.length,
      window: { start: query.windowStart, end: query.windowEnd },
      isEmptyWindow: false,
    }
  }

  /** 获取评分存储。 */
  getStore(): EvaluationScoreStore {
    return this.store
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7.5 跨组织非泄露
// ═══════════════════════════════════════════════════════════════════════════════

/** 跨组织访问非泄露错误。 */
export class CrossOrganizationAccessDeniedError extends Error {
  constructor() {
    super('Permission denied')
    this.name = 'CrossOrganizationAccessDeniedError'
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7.6–7.8 Skill 评测映射去重
// ═══════════════════════════════════════════════════════════════════════════════

/** Skill 评测映射存储。 */
export class SkillEvaluationMappingStore {
  private mappings: SkillEvaluationMapping[] = []

  addMapping(mapping: SkillEvaluationMapping): void {
    // 去重：同一 deduplicationKey 只记录一次
    const existing = this.mappings.find((m) => m.deduplicationKey === mapping.deduplicationKey)
    if (!existing) {
      this.mappings.push(mapping)
    }
  }

  getMappings(): SkillEvaluationMapping[] {
    return [...this.mappings]
  }

  /**
   * §7.7 去重验证：同一 Skill 评测不被重复计。
   */
  countByDedupKey(deduplicationKey: string): number {
    return this.mappings.filter((m) => m.deduplicationKey === deduplicationKey).length
  }

  clear(): void {
    this.mappings = []
  }
}

/**
 * §7.6 Skill 评测到统一评分视图的映射服务。
 * 既有 Skill 评测行为与数据保持不变；定义映射关系并去重。
 */
export class SkillEvaluationMappingService {
  private store: SkillEvaluationMappingStore

  constructor(store: SkillEvaluationMappingStore = new SkillEvaluationMappingStore()) {
    this.store = store
  }

  /**
   * 映射 Skill 评测结果到统一评分视图。
   * 去重键 = skill_eval_run_id + dimension。
   */
  mapSkillEvalToScore(params: {
    skillEvalRunId: number
    dimension: EvaluationDimension
    coverageRate: number
  }): SkillEvaluationMapping {
    const deduplicationKey = computeSkillEvalDedupKey(params.skillEvalRunId, params.dimension)
    const scoreValue = Math.min(1, Math.max(0, params.coverageRate))
    const scoreLabel: ScoreLabel = scoreValue >= 0.5 ? 'pass' : 'fail'

    const mapping: SkillEvaluationMapping = {
      skillEvalRunId: params.skillEvalRunId,
      dimension: params.dimension,
      scoreValue,
      scoreLabel,
      deduplicationKey,
    }

    this.store.addMapping(mapping)
    return mapping
  }

  /** 获取映射存储。 */
  getStore(): SkillEvaluationMappingStore {
    return this.store
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7.9–7.10 评测失败降级
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * §7.9 评测失败降级守卫。
 * 评测属观测：任何失败不得阻断生成、阻断人工确认、改变业务终态。
 */
export class EvaluationDegradationGuard {
  /**
   * 执行评测操作，失败时安全降级。
   * 返回评测结果或降级标记。
   */
  async executeWithDegradation<T>(
    evaluationFn: () => Promise<T>,
    fallback: T,
  ): Promise<{ result: T; degraded: boolean }> {
    try {
      const result = await evaluationFn()
      return { result, degraded: false }
    } catch {
      // 评测失败 → 安全降级，不阻断业务
      return { result: fallback, degraded: true }
    }
  }

  /**
   * §7.10 验证评分写入抛错时业务终态不变。
   * 返回 true 表示业务终态未受影响。
   */
  assertBusinessStateUnchanged(params: {
    scoringError: unknown
    confirmationPendingBefore: boolean
    confirmationPendingAfter: boolean
    generationRunningBefore: boolean
    generationRunningAfter: boolean
  }): boolean {
    // 评测失败不改变业务终态
    return (
      params.confirmationPendingBefore === params.confirmationPendingAfter &&
      params.generationRunningBefore === params.generationRunningAfter
    )
  }
}
