import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'multi_project_impact_snapshots'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('actor_id').unsigned().notNullable()
      table.string('scope_hash', 64).notNullable()
      table.string('source_freshness_hash', 64).notNullable()
      table.string('dependency_graph_signature', 64).notNullable()
      table.string('rule_version', 32).notNullable()
      table.string('permission_fingerprint', 64).notNullable()
      table.string('input_hash', 64).notNullable()
      table.string('output_hash', 64).nullable()
      table
        .string('status', 16)
        .notNullable()
        .defaultTo('pending')
        .comment('pending|running|completed|failed|stale')
      table.text('source_summary_json').nullable() // 低敏源点摘要
      table.text('propagation_summary_json').nullable() // 低敏传播摘要（含端点 hash）
      table.text('warnings_json').nullable() // 低敏 warning codes + messages
      table.text('what_if_outputs_json').nullable() // what-if 对比结果
      table.text('evidence_references_json').nullable() // 低敏证据 hash 列表
      table.boolean('is_stale').notNullable().defaultTo(false)
      table.string('stale_reason', 64).nullable()
      table.timestamp('generated_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('expires_at', { useTz: true }).notNullable()
      table.integer('created_by').unsigned().notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).nullable()

      table.index(['organization_id'])
      table.index(['organization_id', 'status'])
      table.index(['organization_id', 'is_stale'])
      table.index(['created_at'])
      table.index(['expires_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
