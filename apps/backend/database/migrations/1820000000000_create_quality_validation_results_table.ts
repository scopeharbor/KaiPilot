import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('quality_validation_results', (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table.string('artifact_ref', 512).notNullable()
      table.string('capability_surface', 32).notNullable()
      table.string('validator_category', 16).notNullable()
      table.string('validator_version', 128).notNullable()
      table.json('check_results').notNullable()
      table.json('hit_check_ids').notNullable()
      table.integer('confidence_score').notNullable()
      table.string('overall_risk_level', 16).notNullable()
      table.boolean('can_confirm').notNullable().defaultTo(false)
      table.json('auto_fix_trace').nullable()
      table.json('sanitized_report').notNullable()
      table.string('idempotency_key', 256).notNullable()
      table.timestamp('created_at').notNullable()

      // 组织隔离 + 聚合索引（按能力面 + 时间趋势查询）
      table.index(['organization_id', 'capability_surface', 'created_at'])
      // 校验器版本索引（支撑按版本分组的趋势查询）
      table.index(['validator_version'])
      // 被校验产物引用索引
      table.index(['artifact_ref'])
      // 幂等索引（防重复写入）
      // 幂等唯一约束：Knex 的 index() 第三参是 indexType，传 { unique: true } 会被忽略，
      // 唯一性实际不会建立——必须用 unique()。
      table.unique(['idempotency_key'], 'uq_quality_idempotency')
    })
  }

  async down() {
    this.schema.dropTable('quality_validation_results')
  }
}
