import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'okr_evidence_links'

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
        .enum('target_type', [
          'objective',
          'key_result',
          'project',
          'milestone',
          'task',
          'pmo',
          'resource',
          'report',
          'audit',
        ])
        .notNullable()
      table.integer('target_id').unsigned().notNullable()
      table
        .enum('source_kind', ['project', 'milestone', 'task', 'pmo', 'resource', 'report', 'audit'])
        .notNullable()
      table.integer('source_id').unsigned().notNullable()
      table.text('summary').notNullable()
      table.string('hash', 64).notNullable()
      table.timestamp('last_seen_at', { useTz: true }).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      table.index(['target_type', 'target_id'], 'okr_evidence_target_idx')
      table.index(['source_kind', 'source_id'], 'okr_evidence_source_idx')
      table.index(['organization_id'], 'okr_evidence_org_idx')
      // 同一 target 对同一 source 不重复（应用层校验；SQLite 不支持 partial unique）
      table.unique(['target_type', 'target_id', 'source_kind', 'source_id'], {
        indexName: 'okr_evidence_target_source_unique',
      })
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
