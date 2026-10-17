import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'okr_key_results'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .integer('objective_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('okr_objectives')
        .onDelete('CASCADE')
      table.string('title', 500).notNullable()
      table.text('description').nullable()
      table
        .enum('measurement_type', ['number', 'percent', 'currency_like', 'milestone', 'binary'])
        .notNullable()
        .defaultTo('percent')
      table.string('unit_label', 50).nullable()
      table.decimal('baseline_value', 15, 4).notNullable().defaultTo(0)
      table.decimal('target_value', 15, 4).notNullable().defaultTo(100)
      table.decimal('current_value', 15, 4).notNullable().defaultTo(0)
      table.enum('confidence', ['low', 'medium', 'high']).notNullable().defaultTo('medium')
      table
        .enum('status', ['draft', 'active', 'paused', 'completed', 'archived'])
        .notNullable()
        .defaultTo('draft')
      table.decimal('weight', 5, 2).notNullable().defaultTo(1)
      table.timestamp('last_updated_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      table.index(['organization_id', 'objective_id'], 'okr_krs_org_obj_idx')
      table.index(['objective_id', 'status'], 'okr_krs_obj_status_idx')
      // 唯一约束：同一 objective 下 KR 标题不重复
      // 注意：SQLite 不支持 partial unique indexes（WHERE deleted_at IS NULL），
      // 此处暂用普通唯一索引；软删除后重建同名 KR 由应用层校验
      table.unique(['objective_id', 'title'], {
        indexName: 'okr_krs_obj_title_unique',
      })
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
