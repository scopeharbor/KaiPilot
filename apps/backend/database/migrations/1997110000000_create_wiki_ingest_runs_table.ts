import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-llm-wiki-ingest-pipeline —— 编入运行记录。只存计数与低敏标识，
 * 不存提示词、模型输出或原料正文。游标 = 成功运行的 cursor_to_audit_id。
 */
export default class extends BaseSchema {
  protected tableName = 'wiki_ingest_runs'

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
        .bigInteger('space_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('wiki_spaces')
        .onDelete('CASCADE')
      table.string('trigger_kind', 16).notNullable()
      table.check("trigger_kind IN ('manual','command')")
      table.string('status', 24).notNullable()
      table.check(
        "status IN ('queued','running','succeeded','no_events','budget_exhausted','model_unavailable','failed')",
      )
      table.bigInteger('cursor_from_audit_id').notNullable().defaultTo(0)
      table.bigInteger('cursor_to_audit_id').nullable()
      table.integer('events_count').notNullable().defaultTo(0)
      table.integer('pages_touched').notNullable().defaultTo(0)
      table.integer('proposals_created').notNullable().defaultTo(0)
      table.integer('ops_accepted').notNullable().defaultTo(0)
      table.integer('ops_rejected').notNullable().defaultTo(0)
      table.integer('pages_failed').notNullable().defaultTo(0)
      table.boolean('has_more').notNullable().defaultTo(false)
      table.integer('tokens_used').notNullable().defaultTo(0)
      table.string('model_provider', 64).nullable()
      table.string('model_name', 128).nullable()
      table.string('error_code', 64).nullable()
      table.string('idempotency_key', 64).nullable()
      table
        .bigInteger('triggered_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('started_at', { useTz: true }).nullable()
      table.timestamp('finished_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
      table.index(
        ['organization_id', 'space_id', 'status'],
        'wiki_ingest_runs_org_space_status_index',
      )
      table.index(['organization_id', 'created_at'], 'wiki_ingest_runs_org_created_index')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
