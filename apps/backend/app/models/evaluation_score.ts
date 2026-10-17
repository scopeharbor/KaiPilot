/**
 * v3-ai-automated-evaluation §3.4 — 评测评分记录 Lucid 模型。
 *
 * 组织隔离默认作用域约定：
 * - 所有查询必须经 `filterOrganization(organizationId)` 或显式 `.where('organization_id', …)`
 *   首列过滤；模型本身不注入全局作用域（与 `UnifiedAiInvocationLedger` 等账本模型一致，
 *   由 service/controller 层保证组织隔离）。
 * - 列名与 `packages/types/src/ai-automated-evaluation.ts` 契约一致。
 *
 * 低敏红线：不存被评 prompt/模型输出全文。explanation 有长度约束（VARCHAR 1024）。
 */

import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type {
  EvaluationDimension,
  ScoreLabel,
  EvaluatorKind,
  SamplingStrategy,
  SamplingDecision,
} from '@aiproj/types'

export default class EvaluationScore extends BaseModel {
  public static readonly table = 'evaluation_scores'

  @column({ isPrimary: true })
  declare id: number

  // ── 归属 ──
  @column()
  declare organizationId: number

  // ── 评测维度 ──
  @column({ columnName: 'evaluation_name' })
  declare evaluationName: EvaluationDimension

  // ── 评分值 ──
  @column()
  declare scoreValue: number

  // ── 评分标签 ──
  @column()
  declare scoreLabel: ScoreLabel

  // ── 有界解释 ──
  @column()
  declare explanation: string

  // ── 被评对象引用 ──
  @column()
  declare evaluatedArtifactKind: string

  @column()
  declare evaluatedArtifactRef: string

  @column()
  declare evaluatedArtifactHash: string

  // ── 评测器身份 ──
  @column()
  declare evaluatorKind: EvaluatorKind

  @column()
  declare evaluatorName: string

  @column()
  declare evaluatorVersion: string

  @column()
  declare judgeModel: string | null

  @column()
  declare judgePromptVersion: string | null

  // ── 采样决策 ──
  @column()
  declare samplingStrategy: SamplingStrategy

  @column()
  declare samplingRatio: number

  @column()
  declare samplingDecision: SamplingDecision

  @column()
  declare samplingSkipReason: string | null

  @column()
  declare lowConfidenceOverride: boolean

  // ── 关联引用 ──
  @column()
  declare ledgerAttemptRef: string | null

  @column()
  declare traceSpanRef: string | null

  // ── 幂等键 ──
  @column()
  declare idempotencyKey: string

  // ── 审计 ──
  @column({ columnName: 'created_at' })
  declare createdAt: DateTime

  // ── 组织隔离查询范围 ──

  /**
   * 按组织 ID 过滤查询。
   * 所有读路径必须调用此方法或等价的 `.where('organization_id', …)`。
   */
  static filterOrganization(query: any, organizationId: number) {
    return query.where('organization_id', organizationId)
  }

  /**
   * 按维度与时间窗过滤查询。
   */
  static filterByDimensionAndWindow(
    query: any,
    dimension: EvaluationDimension,
    windowStart: string,
    windowEnd: string,
  ) {
    return query
      .where('evaluation_name', dimension)
      .where('created_at', '>=', windowStart)
      .where('created_at', '<=', windowEnd)
  }

  /**
   * 按被评对象引用过滤查询。
   */
  static filterByArtifact(query: any, artifactKind: string, artifactRef: string) {
    return query
      .where('evaluated_artifact_kind', artifactKind)
      .where('evaluated_artifact_ref', artifactRef)
  }
}
