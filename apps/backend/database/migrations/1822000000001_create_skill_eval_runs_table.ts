import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-skill-eval-system —— skill_eval_runs 迁移（D9）。
 *
 * 组织级 Skill 评测运行持久化。JSON 列以 text 存储。
 * SQLite + PG 兼容、可回滚。
 */
export default class extends BaseSchema {
  protected tableName = 'skill_eval_runs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // 组织隔离
      table.integer('organization_id').unsigned().notNullable()

      // Skill 关联
      table.integer('skill_id').unsigned().notNullable()

      // 评测来源
      table.string('benchmark_source', 16).notNullable().defaultTo('fixture') // L3|fixture

      // 评测输入/结果（JSON）
      table.text('inputs').notNullable().defaultTo('[]') // JSON: BenchmarkInput[]
      table.text('activation_decisions').notNullable().defaultTo('[]') // JSON: ActivationDecision[]
      table.text('coverage_hits').notNullable().defaultTo('[]') // JSON: number[]

      // 统计
      table.integer('total_inputs').notNullable().defaultTo(0)
      table.float('coverage_rate').notNullable().defaultTo(0)
      table.integer('dropped_conflicts_count').notNullable().defaultTo(0)
      table.integer('dropped_duplicates_count').notNullable().defaultTo(0)

      // Evidence
      table.string('evidence_digest', 64).notNullable()

      // 参考时间
      table.string('reference_time', 64).notNullable()

      // 审计
      table.integer('created_by').unsigned().notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 索引
      table.index(['organization_id', 'skill_id'], 'idx_serun_org_skill')
      table.index(['organization_id', 'created_at'], 'idx_serun_org_created')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
