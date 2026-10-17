import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-skill-eval-system —— skill_effect_events 迁移（D9）。
 *
 * 组织级 Skill 激活效果事件持久化。供 Skill 注入 Compiler Stage 的独立 change 调用。
 * SQLite + PG 兼容、可回滚。
 */
export default class extends BaseSchema {
  protected tableName = 'skill_effect_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // 组织隔离
      table.integer('organization_id').unsigned().notNullable()

      // Skill 关联
      table.integer('skill_id').unsigned().notNullable()

      // 关联上下文
      table.integer('run_id').unsigned().nullable()
      table.integer('project_id').unsigned().nullable()

      // 事件时间
      table.string('activated_at', 64).notNullable()

      // 质量评分（可选，供 avgScore 聚合）
      table.float('quality_score').nullable()

      // 参考时间
      table.string('reference_time', 64).notNullable()

      // 审计
      table.timestamp('created_at', { useTz: true }).notNullable()

      // 索引
      table.index(['organization_id', 'skill_id'], 'idx_see_org_skill')
      table.index(['organization_id', 'created_at'], 'idx_see_org_created')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
