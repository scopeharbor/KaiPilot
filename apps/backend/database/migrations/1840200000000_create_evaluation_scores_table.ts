/**
 * v3-ai-automated-evaluation §3.1–3.3 — 评测评分记录表。
 *
 * 对齐 OTel GenAI 已发布约定（gen_ai.evaluation.*）的评分记录持久化。
 * 列名与 `packages/types/src/ai-automated-evaluation.ts` 契约一致。
 *
 * 低敏红线：
 * - explanation 有长度约束（VARCHAR 1024），禁存被评 prompt/模型输出全文；
 * - 被评内容以 hash/ref 表达，不存原文。
 *
 * 索引：
 * - 组织隔离 + 维度 + 时间窗：`(organization_id, evaluation_name, created_at)`
 * - 被评对象引用：`(evaluated_artifact_kind, evaluated_artifact_ref)`
 * - 幂等键：`(idempotency_key)` UNIQUE
 *
 * 方言兼容：全部使用 Lucid/knex 可移植 API（无 SQLite 专有语法），PG 迁移路径保留。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'evaluation_scores'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()

      // ── 归属 ──
      table.integer('organization_id').unsigned().notNullable()

      // ── 评测维度（gen_ai.evaluation.name 对齐） ──
      table.string('evaluation_name', 64).notNullable()

      // ── 评分值（gen_ai.evaluation.score.value 对齐） ──
      table.float('score_value').notNullable().defaultTo(0)

      // ── 评分标签（gen_ai.evaluation.score.label 对齐） ──
      table.string('score_label', 16).notNullable().defaultTo('not-evaluated')

      // ── 有界解释（gen_ai.evaluation.explanation 对齐，长度约束） ──
      table.string('explanation', 1024).notNullable().defaultTo('')

      // ── 被评对象引用 ──
      table.string('evaluated_artifact_kind', 32).notNullable()
      table.string('evaluated_artifact_ref', 256).notNullable()
      table.string('evaluated_artifact_hash', 128).notNullable()

      // ── 评测器身份 ──
      table.string('evaluator_kind', 16).notNullable()
      table.string('evaluator_name', 128).notNullable()
      table.string('evaluator_version', 64).notNullable()
      table.string('judge_model', 128).nullable()
      table.string('judge_prompt_version', 64).nullable()

      // ── 采样决策 ──
      table.string('sampling_strategy', 16).notNullable().defaultTo('all')
      table.float('sampling_ratio').notNullable().defaultTo(1)
      table.string('sampling_decision', 16).notNullable().defaultTo('evaluated')
      table.string('sampling_skip_reason', 256).nullable()
      table.boolean('low_confidence_override').notNullable().defaultTo(false)

      // ── 关联引用 ──
      table.string('ledger_attempt_ref', 128).nullable()
      table.string('trace_span_ref', 128).nullable()

      // ── 幂等键 ──
      table.string('idempotency_key', 128).notNullable()

      // ── 审计 ──
      table.timestamp('created_at', { useTz: true }).notNullable()

      // ── 索引 ──
      // 组织隔离 + 维度 + 时间窗
      table.index(
        ['organization_id', 'evaluation_name', 'created_at'],
        'idx_evalscore_org_dim_created',
      )
      // 被评对象引用
      table.index(
        ['evaluated_artifact_kind', 'evaluated_artifact_ref'],
        'idx_evalscore_artifact_ref',
      )
      // 幂等键唯一
      // 同上：唯一索引必须走 unique()，index() 的第三参不接受 { unique: true }。
      table.unique(['idempotency_key'], 'uq_evalscore_idempotency')
      // 组织隔离基础
      table.index(['organization_id'], 'idx_evalscore_organization')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
