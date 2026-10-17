import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'okr_objective_relations'

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
        .integer('source_objective_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('okr_objectives')
        .onDelete('CASCADE')
      table
        .integer('target_objective_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('okr_objectives')
        .onDelete('CASCADE')
      table.string('relation_type').notNullable() // depends_on / contributes_to / supports / conflicts_with / duplicates
      table.string('status').notNullable().defaultTo('active') // active / resolved / archived
      table.float('impact_weight').notNullable().defaultTo(1)
      table.string('reason_code').nullable()
      table.string('evidence_ref_hash').nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      // 同一对 source-target 不允许重复活跃 relation
      table.unique(['source_objective_id', 'target_objective_id', 'relation_type'], {
        indexName: 'okr_relations_pair_unique',
      })
      table.index(['organization_id', 'deleted_at'], 'okr_relations_org_idx')
      table.index(['source_objective_id', 'deleted_at'], 'okr_relations_source_idx')
      table.index(['target_objective_id', 'deleted_at'], 'okr_relations_target_idx')
      table.index(['relation_type'], 'okr_relations_type_idx')
      table.index(['status'], 'okr_relations_status_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
