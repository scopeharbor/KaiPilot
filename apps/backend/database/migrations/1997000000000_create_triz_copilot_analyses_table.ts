import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-triz-contradiction-copilot W2 任务 2.1 —— `triz_copilot_analyses` 分析记录表（design D5）。
 *
 * 一行 = 一次矛盾求解的分析记录（含改判后的最新结果）。字段族：
 * - 归属与审计：`organization_id` / `project_id` / `created_by` / 时间戳 / 软删（`deleted_at`）；
 * - 映射：`contradiction_type` / `improving_parameter` / `worsening_parameter` /
 *   `candidate_principles`(JSON 编号集合) / `path` / `confidence`；
 * - 方案：`top_solutions`(JSON，低敏投影：序号 / 原则编号 / 有界标题 / 实体引用 / 排序分) /
 *   `entity_binding`；
 * - 溯源与诚实披露：`context_refs`(JSON) / `quality_flags`(JSON) / `fallback_reasons`(JSON) /
 *   `knowledge_pack_version`；
 * - 人工改判：`human_override` / `override_by` / `override_at`（改判前后参数编号落审计）；
 * - Autonomy Budget 计数器（design D7）：澄清轮数 / 度量读取次数 / Token 预算与用量 / 触顶状态；
 * - `source_signal_id`：被动雷达（W3）接线预留列，本期无 FK（`project_signals` 由 W3 建表）。
 *
 * **RL-12（观测禁存全文）**：本表 MUST NOT 存 PM 陈述原文、模型 prompt 或模型输出全文；
 * 陈述只落 `statement_digest`（SHA-256 前 32 位）与 `statement_length`，方案只落有界标题。
 * 静态断言见 `tests/unit/triz_copilot_analyses_schema.spec.ts`。
 *
 * 方言兼容：无 `.after()`；约束与索引显式命名（≤ PostgreSQL 63 字节）；
 * JSON 列不参与 btree 唯一 / 索引（PG `json` 无默认 opclass）。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_copilot_analyses'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')

      // 澄清轮次链：同一分析的后续轮次指向上一轮记录（改判不新建记录，只更新自身）。
      table
        .bigInteger('parent_analysis_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('triz_copilot_analyses')
        .onDelete('SET NULL')

      // 被动雷达接线预留：W3 建 `project_signals` 后才补 FK（本 change 不建该表）。
      table.bigInteger('source_signal_id').unsigned().nullable()

      // ── 映射 ──────────────────────────────────────────────────────────
      table.string('contradiction_type', 20).notNullable().defaultTo('administrative')
      table.check("contradiction_type IN ('administrative','technical','physical')")

      table.integer('improving_parameter').nullable()
      table.check(
        'improving_parameter IS NULL OR (improving_parameter >= 1 AND improving_parameter <= 39)',
      )

      table.integer('worsening_parameter').nullable()
      table.check(
        'worsening_parameter IS NULL OR (worsening_parameter >= 1 AND worsening_parameter <= 39)',
      )

      table.json('candidate_principles').notNullable()
      table.string('path', 10).notNullable().defaultTo('rule')
      table.check("path IN ('ai','rule')")
      table.decimal('confidence', 4, 3).notNullable().defaultTo(0)
      table.check('confidence >= 0 AND confidence <= 1')

      // ── 方案（低敏投影） ───────────────────────────────────────────────
      table.json('top_solutions').notNullable()
      table.string('entity_binding', 10).notNullable().defaultTo('none')
      table.check("entity_binding IN ('bound','partial','none')")

      // ── 溯源与诚实披露（全部为编号 / 枚举码，无正文） ──────────────────
      table.json('context_refs').notNullable()
      table.json('quality_flags').notNullable()
      table.json('fallback_reasons').notNullable()
      table.string('knowledge_pack_version', 32).notNullable()

      // ── 陈述低敏指纹（RL-12：原文不落库） ──────────────────────────────
      table.string('statement_digest', 32).notNullable()
      table.integer('statement_length').notNullable()
      table.boolean('statement_truncated').notNullable().defaultTo(false)

      // ── 人工改判 ──────────────────────────────────────────────────────
      table.boolean('human_override').notNullable().defaultTo(false)
      table
        .bigInteger('override_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('override_at').nullable()

      // ── Autonomy Budget 计数器（design D7 硬上限） ─────────────────────
      table.integer('clarification_rounds').notNullable().defaultTo(0)
      table.integer('metric_read_count').notNullable().defaultTo(0)
      table.integer('token_budget').notNullable().defaultTo(4000)
      table.integer('estimated_tokens').notNullable().defaultTo(0)
      table.integer('actual_tokens').nullable()
      table.string('budget_state', 20).notNullable().defaultTo('within_budget')
      table.check("budget_state IN ('within_budget','exhausted')")
      table.string('budget_reason', 255).nullable()

      // ── 软删与时间戳 ──────────────────────────────────────────────────
      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(
        ['organization_id', 'project_id', 'created_at'],
        'idx_triz_copilot_analyses_org_project_created',
      )
      table.index(['organization_id', 'project_id', 'path'], 'idx_triz_copilot_analyses_org_path')
      table.index(['parent_analysis_id'], 'idx_triz_copilot_analyses_parent')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
