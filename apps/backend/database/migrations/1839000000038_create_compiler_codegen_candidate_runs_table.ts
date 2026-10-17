import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'compiler_codegen_candidate_runs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('organization_id').notNullable().index()
      table.integer('project_id').notNullable().index()
      table.integer('created_by').notNullable().references('id').inTable('users')
      table.string('runtime_session_id', 128).notNullable().unique()
      table.string('catalog_version', 32).notNullable()
      table.string('provider', 32).notNullable() // openai_responses | openai_chat_compat | anthropic_messages
      table.string('execution_mode', 16).notNullable().defaultTo('fixture') // fixture only（真实模型属授权门）
      table.string('status', 40).notNullable().defaultTo('pending') // pending | running | candidate_ready_pending_review | halted
      table.integer('stage_count').notNullable().defaultTo(34)
      table.integer('completed_stage_count').notNullable().defaultTo(0)
      table.string('current_stage_id', 64).nullable()
      table.string('failure_stage_id', 64).nullable()
      table.string('failure_reason_code', 64).nullable()
      table.text('failure_violations_json').nullable() // string[]，低敏 violation 文案
      table.text('review_packet_json').nullable() // CodeGenerationHumanReviewPacket，仅 refs/摘要
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('updated_at').nullable()
      table.timestamp('completed_at').nullable()

      table.index(['organization_id', 'project_id'])
      table.index(['organization_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
