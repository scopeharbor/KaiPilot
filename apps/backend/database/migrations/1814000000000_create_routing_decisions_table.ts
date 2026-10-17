import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-5-compiler-dynamic-routing-management-ui（切片 A, task 3.1）—— routing_decisions 表。
 *
 * 把 per-run routing decision 证据从易失进程内存（routing_decision_service 的 Map）提升为
 * 可查询的低敏持久证据。写入前经 routingDecisionContainsSensitiveFields() 守卫，只存
 * refs/enums/counts/hash + 稳定 stage id 枚举，绝不存 prompt/output/artifact/secret。
 *
 * 组织隔离、SQLite + PG 兼容、可回滚（down 删表即回到进程内存现状行为）。
 * decision 绑定 run；resume/replay 经 runId 复用原 decision；registry 变化以 drift diagnostic 呈现。
 */
export default class extends BaseSchema {
  protected tableName = 'routing_decisions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // ── 组织隔离 + run 绑定 ──
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('compiler_run_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('compiler_runs')
        .onDelete('CASCADE')

      // ── 低敏决策摘要（仅 refs/enums/counts/hash） ──
      table.string('input_hash', 64).notNullable()
      table.string('rule_id', 80).nullable()
      table.string('rule_version', 20).nullable()
      table.string('scenario_kind', 40).notNullable()
      table.string('reason_code', 40).notNullable()
      table.integer('selected_stage_count').notNullable().defaultTo(0)
      table.integer('original_stage_count').notNullable().defaultTo(0)
      table.boolean('is_fallback').notNullable().defaultTo(false)

      // 稳定 stage id 枚举（JSON array of string），非 artifact 正文
      table.json('selected_stage_ids').notNullable().defaultTo('[]')
      table.json('skipped_stage_ids').notNullable().defaultTo('[]')

      // 审计 refs（仅数字 ID）
      table.bigInteger('actor_user_id').unsigned().nullable()

      table.timestamp('created_at', { useTz: false }).notNullable()

      // ── 索引（按 run + 组织检索） ──
      table.unique(['compiler_run_id'], 'idx_rdec_run_unique')
      table.index(['organization_id', 'compiler_run_id'], 'idx_rdec_org_run')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
