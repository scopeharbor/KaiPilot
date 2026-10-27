import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type {
  WikiEvalBacktestSummary,
  WikiEvalGateStatus,
  WikiEvalKind,
  WikiEvalQaSummary,
} from '@aiproj/types'

/** 每题记录：问题哈希与两条路径的命中、泄露、命中率（不存原文）。 */
export interface WikiEvalQuestionRecord {
  hash: string
  legacy: { hit: boolean; leaked: boolean; recall: number }
  wiki: { hit: boolean; leaked: boolean; recall: number }
}

const json = {
  prepare: (value: unknown) => JSON.stringify(value),
  consume: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
}

/**
 * wiki_eval_runs（v3-llm-wiki-eval-gate）。组织隔离：所有查询必须附加 organization_id。
 * 只存汇总与哈希，不存题目原文与上下文内容。
 */
export default class WikiEvalRun extends BaseModel {
  static table = 'wiki_eval_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare triggeredBy: number | null

  /** retrieval（检索层）/ answer（答案层，v3-llm-wiki-rag-retirement）。 */
  @column()
  declare evalKind: WikiEvalKind

  @column()
  declare status: WikiEvalGateStatus

  @column()
  declare questionsCount: number

  @column({ columnName: 'qa_json', ...json })
  declare qa: WikiEvalQaSummary & { items: WikiEvalQuestionRecord[] }

  @column({ columnName: 'backtest_json', ...json })
  declare backtest: WikiEvalBacktestSummary

  @column({ columnName: 'reasons_json', ...json })
  declare reasons: string[]

  @column()
  declare tokensUsed: number

  @column()
  declare modelName: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
