import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // ── 跨项目调配草案 ──
    this.schema.createTable('cross_project_allocation_drafts', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('name', 255).notNullable()

      table.string('status', 20).notNullable().defaultTo('draft')
      table.check(
        "status IN ('draft','previewed','confirmed','applied','cancelled','expired','failed')",
      )

      table.json('query_shape').notNullable()
      table.json('source_signatures').nullable()
      table.string('preview_hash', 64).nullable()
      table.timestamp('preview_expires_at').nullable()
      table.string('idempotency_key_hash', 64).nullable()
      table.json('warnings').nullable()

      table
        .bigInteger('actor_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.timestamp('deleted_at').nullable()

      table.index(['organization_id', 'status'])
      table.index(['actor_id'])
    })

    // ── 跨项目调配变更项 ──
    this.schema.createTable('cross_project_allocation_items', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('draft_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('cross_project_allocation_drafts')
        .onDelete('CASCADE')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('item_type', 20).notNullable().defaultTo('allocate')
      table.check("item_type IN ('allocate','reallocate','remove','map_resource')")

      table.string('item_status', 20).notNullable().defaultTo('pending')
      table.check("item_status IN ('pending','conflict','ready','applied','failed','skipped')")

      // Target project/task
      table
        .bigInteger('target_project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      table
        .bigInteger('target_task_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('tasks')
        .onDelete('SET NULL')

      // Candidate resource
      table
        .bigInteger('candidate_resource_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('resources')
        .onDelete('SET NULL')

      table.json('demand_snapshot').notNullable()
      table.json('candidate_snapshot').nullable()
      table.decimal('allocation_percent', 5, 2).notNullable().defaultTo(0)
      table.date('start_date').notNullable()
      table.date('end_date').notNullable()

      table.json('conflicts').nullable()
      table.string('source', 20).notNullable().defaultTo('rule')
      table.check("source IN ('rule','ai','manual','imported')")

      table.integer('advisory_only').notNullable().defaultTo(0)
      table.integer('confirmation_required').notNullable().defaultTo(1)
      table.integer('applied').notNullable().defaultTo(0)

      table.string('source_signature', 128).nullable()
      table.json('redaction_state').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['draft_id', 'item_status'])
      table.index(['organization_id', 'target_project_id'])
      table.index(['candidate_resource_id'])
    })

    // ── 跨项目调配确认/提交 ──
    this.schema.createTable('cross_project_allocation_commits', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('draft_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('cross_project_allocation_drafts')
        .onDelete('CASCADE')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table
        .bigInteger('actor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.json('visible_target_project_ids').notNullable()
      table.json('item_ids').notNullable()
      table.string('preview_hash', 64).notNullable()
      table.json('query_shape_hash').nullable()
      table.json('warnings').nullable()
      table.string('idempotency_key_hash', 64).notNullable()

      table.string('status', 20).notNullable().defaultTo('confirmed')
      table.check("status IN ('confirmed','applied','failed','partial','cancelled')")

      table.json('apply_result').nullable()
      table.json('audit_references').nullable()

      table.timestamp('confirmed_at').notNullable()
      table.timestamp('applied_at').nullable()

      table.index(['draft_id'])
      table.index(['organization_id'])
      table.index(['idempotency_key_hash'])
    })
  }

  async down() {
    this.schema.dropTableIfExists('cross_project_allocation_commits')
    this.schema.dropTableIfExists('cross_project_allocation_items')
    this.schema.dropTableIfExists('cross_project_allocation_drafts')
  }
}
