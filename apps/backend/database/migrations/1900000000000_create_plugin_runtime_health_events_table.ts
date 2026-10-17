import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_runtime_health_events', (table) => {
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
      table.string('plugin_version', 50).nullable()
      table.string('contribution_key', 300).nullable()
      table.string('seam_key', 300).nullable()

      table.string('outcome', 30).notNullable()
      table.check(
        "outcome IN ('success','crash','timeout','quota_exceeded','permission_denied','incompatible','isolation_failed','host_degraded','unknown')",
      )

      table.string('reason_code', 30).notNullable()
      table.check(
        "reason_code IN ('crash','timeout','cpu_quota','memory_quota','call_quota','permission_denied','incompatible','isolation_failed','circuit_open','stale','unknown','tool_error','host_degraded','rate_limited')",
      )

      table.string('quota_kind', 20).notNullable().defaultTo('none')
      table.check("quota_kind IN ('cpu','memory','call','none')")

      table.string('duration_bucket', 20).notNullable().defaultTo('lt_100ms')
      table.check("duration_bucket IN ('lt_100ms','100_500ms','500_1000ms','1_5s','gt_5s')")

      table.integer('latency_ms').nullable()

      table.string('circuit_state', 20).notNullable().defaultTo('closed')
      table.check("circuit_state IN ('closed','open','half_open')")

      table.string('invocation_id', 200).notNullable()

      table.timestamp('occurred_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.integer('row_version').notNullable().defaultTo(1)

      table.unique(['organization_id', 'invocation_id'])
      table.index(['organization_id', 'installation_id'])
      table.index(['organization_id', 'plugin_id'])
      table.index(['organization_id', 'occurred_at'])
      table.index(['installation_id', 'contribution_key'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_runtime_health_events')
  }
}
