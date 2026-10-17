import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'okr_alignments'

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
        .integer('child_objective_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('okr_objectives')
        .onDelete('CASCADE')
      table
        .integer('parent_objective_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('okr_objectives')
        .onDelete('CASCADE')
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      // 一个子目标最多一个活跃父级（应用层校验；SQLite 不支持 partial unique）
      table.unique(['child_objective_id'], {
        indexName: 'okr_alignments_child_unique',
      })
      table.index(['parent_objective_id', 'deleted_at'], 'okr_alignments_parent_idx')
      table.index(['organization_id'], 'okr_alignments_org_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
