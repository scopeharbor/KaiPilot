import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'link_candidates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table.string('provider', 20).notNullable().defaultTo('github')
      table.string('repository_full_name', 255).notNullable()
      table.string('repository_external_id', 60).notNullable()
      table.string('event_type', 30).notNullable()
      table.string('delivery_id', 255).notNullable()
      table.string('object_type', 30).notNullable()
      table.string('object_id', 255).notNullable()
      table.string('task_reference', 100).notNullable()
      table.integer('task_id').unsigned().nullable()
      table.string('task_title', 255).nullable()
      table.string('confidence_class', 20).notNullable().defaultTo('medium')
      table.string('status', 20).notNullable().defaultTo('pending')
      table.integer('rule_version').unsigned().notNullable().defaultTo(1)
      table.text('evidences_json').nullable()
      table.timestamp('expires_at').notNullable()
      table.timestamp('settled_at').nullable()
      table.integer('settled_by').unsigned().nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 双层幂等：事件对象+任务+规则版本
      table.unique(
        [
          'organization_id',
          'delivery_id',
          'object_type',
          'object_id',
          'task_reference',
          'rule_version',
        ],
        'link_candidates_idempotency_unique',
      )
      table.index(
        ['organization_id', 'provider', 'status'],
        'link_candidates_org_provider_status_idx',
      )
      table.index(['organization_id', 'task_id'], 'link_candidates_org_task_idx')
      table.index(['expires_at'], 'link_candidates_expires_at_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
