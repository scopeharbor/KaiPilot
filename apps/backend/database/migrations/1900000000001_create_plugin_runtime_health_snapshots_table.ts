import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_runtime_health_snapshots', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('installation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('plugin_installations')
        .onDelete('CASCADE')

      table.string('plugin_id', 200).notNullable()
      table.string('contribution_key', 300).nullable()

      table.string('status', 20).notNullable().defaultTo('unknown')
      table.check("status IN ('healthy','degraded','unhealthy','unknown')")

      table.string('reason_code', 30).notNullable().defaultTo('unknown')
      table.check(
        "reason_code IN ('crash','timeout','cpu_quota','memory_quota','call_quota','permission_denied','incompatible','isolation_failed','circuit_open','stale','unknown','tool_error','host_degraded','rate_limited')",
      )

      table.string('circuit_state', 20).notNullable().defaultTo('closed')
      table.check("circuit_state IN ('closed','open','half_open')")

      table.timestamp('first_seen_at').notNullable()
      table.timestamp('last_seen_at').notNullable()
      table.timestamp('last_success_at').nullable()
      table.timestamp('last_failure_at').nullable()
      table.timestamp('recovered_at').nullable()

      table.integer('total_success').notNullable().defaultTo(0)
      table.integer('total_crash').notNullable().defaultTo(0)
      table.integer('total_timeout').notNullable().defaultTo(0)
      table.integer('total_quota').notNullable().defaultTo(0)
      table.integer('total_permission_denied').notNullable().defaultTo(0)
      table.integer('total_incompatible').notNullable().defaultTo(0)
      table.integer('total_isolation_failed').notNullable().defaultTo(0)
      table.integer('consecutive_failures').notNullable().defaultTo(0)

      table.boolean('is_stale').notNullable().defaultTo(false)

      table.json('warning_codes').nullable()

      table.integer('row_version').notNullable().defaultTo(1)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['organization_id', 'installation_id', 'contribution_key'])
      table.index(['organization_id'])
      table.index(['organization_id', 'status'])
      table.index(['organization_id', 'plugin_id'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_runtime_health_snapshots')
  }
}
