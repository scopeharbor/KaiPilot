import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-risk-management-full — risk_matrix_configs table.
 * Project-level risk matrix configuration.
 * Falls back to V1 5x5 default when no config exists.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('risk_matrix_configs', (table) => {
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

      // 概率等级数（默认 5）
      table.integer('probability_levels').unsigned().notNullable().defaultTo(5)

      // 影响等级数（默认 5）
      table.integer('impact_levels').unsigned().notNullable().defaultTo(5)

      // 风险等级分区定义（JSON：区域名称、概率范围、影响范围、颜色、等级映射）
      table.json('zones').notNullable()

      // 默认基线
      table.string('default_basis', 20).notNullable().defaultTo('inherent')
      table.check("default_basis IN ('inherent','residual')")

      // 每格展示上限（默认 5）
      table.integer('cell_limit').unsigned().notNullable().defaultTo(5)

      // 是否启用
      table.boolean('is_active').notNullable().defaultTo(true)

      // 审计
      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .bigInteger('updated_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // 唯一约束：一个项目只能有一个矩阵配置
      table.unique(['project_id'], 'uq_risk_matrix_config_project')

      // 索引
      table.index(['organization_id', 'project_id'], 'idx_rmc_org_project')
      table.index(['is_active'], 'idx_rmc_active')
      table.check('probability_levels >= 2 AND probability_levels <= 10')
      table.check('impact_levels >= 2 AND impact_levels <= 10')
      table.check('cell_limit >= 1')
    })
  }

  async down() {
    this.schema.dropTable('risk_matrix_configs')
  }
}
