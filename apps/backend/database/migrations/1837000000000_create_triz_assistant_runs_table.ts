import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_assistant_runs 表：AI-TRIZ 助手会话运行记录
 * （v3-ai-triz-assistant §3.1–§3.3）。
 *
 * 组织+项目双隔离；idempotency_key 保证幂等。
 * 只存低敏摘要/refs/hashes/warning/cost/fallback/review 元数据。
 * 不存完整 prompt、完整模型输出、secret/token/Authorization header。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_assistant_runs'

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
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table
        .bigInteger('actor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.string('run_id', 64).notNullable().unique()
      table.string('status', 24).notNullable().defaultTo('active')
      table.check("status IN ('active','completed','completed_with_warnings','failed','archived')")

      table.string('intent', 48).notNullable().defaultTo('general_guidance')
      table.string('intent_summary', 512).notNullable().defaultTo('')

      table.json('route_decisions_json').notNullable().defaultTo('[]')
      table.json('recommended_actions_json').notNullable().defaultTo('[]')
      table.json('clarification_prompts_json').notNullable().defaultTo('[]')

      table.string('input_signature', 128).notNullable().defaultTo('')
      table.string('output_hash', 128).nullable()
      table.string('idempotency_key', 128).notNullable()

      table.json('source_refs_json').notNullable().defaultTo('[]')
      table.json('source_hash_prefixes_json').notNullable().defaultTo('[]')
      table.json('warning_codes_json').notNullable().defaultTo('[]')
      table.json('cost_summary_json').nullable()

      table.boolean('is_fallback').notNullable().defaultTo(false)
      table.string('degraded_reason', 48).nullable()
      table.boolean('review_required').notNullable().defaultTo(true)

      table.integer('message_count').notNullable().defaultTo(0)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.timestamp('completed_at').nullable()

      // 索引（tar = triz assistant run）
      table.index(['organization_id', 'project_id'], 'idx_tar_org_project')
      table.index(['project_id', 'status'], 'idx_tar_project_status')
      table.unique(['organization_id', 'project_id', 'idempotency_key'], 'uq_tar_idempotency')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
