import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * ai-draft-generation / T036·T037 —— 草案区四表（design D1 双阶段边界）。
 *
 * 只在生成/审查阶段写草案区；正式项目/WBS/任务/依赖仅在 confirm 端点写入。
 * 红线（design D7 / spec「敏感正文不落库」）：
 *   - 会话表**不存** rawInput / 澄清回答正文，只留 project_type 与结构化元数据；
 *   - 版本表存派生的草案 JSON（AI 输出，非用户敏感原文）；
 *   - 确认表只存选择/校验摘要与 project_id，不存草案全文或输入原文。
 * draft_uid 为对外不透明 ID（避免顺序 id 泄露跨组织资源存在性）。
 * 兼容 SQLite / PostgreSQL（DEBT-01）。
 */
export default class extends BaseSchema {
  async up() {
    // ── 会话 ──
    this.schema.createTable('ai_project_drafts', (table) => {
      table.bigIncrements('id')
      table.string('draft_uid', 40).notNullable().unique()

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.string('project_type', 20).notNullable()
      table.string('status', 20).notNullable().defaultTo('drafting')
      table.check(
        "status IN ('drafting','reviewing','editing','applying','confirmed','saved','rejected','error','failed')",
      )
      table.string('schema_version', 10).notNullable()
      table.integer('current_version').notNullable().defaultTo(0)

      // 结构化保证元数据
      table.string('structured_strategy', 10).nullable()
      table.string('consistency', 12).nullable()
      table.boolean('fallback_used').notNullable().defaultTo(false)
      table.string('provider', 60).nullable()
      table.string('model', 200).nullable()
      table.boolean('using_real_adapter').notNullable().defaultTo(false)

      // 确认导入后回填正式项目 id
      table
        .bigInteger('project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['organization_id'])
      table.index(['organization_id', 'user_id'])
    })

    // ── 版本快照 ──
    this.schema.createTable('ai_project_draft_versions', (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('draft_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ai_project_drafts')
        .onDelete('CASCADE')
      table.integer('version').notNullable()
      table.string('origin', 16).notNullable().defaultTo('generated')
      table.check("origin IN ('generated','auto_fixed','modified')")
      table.string('status', 16).notNullable().defaultTo('active')
      table.check("status IN ('active','superseded','rejected')")

      table.json('draft').notNullable()
      table.json('meta').nullable()
      table.json('validation').nullable()

      table.timestamp('created_at').notNullable()

      table.unique(['draft_id', 'version'])
      table.index(['draft_id'])
    })

    // ── SSE 事件（sequence 幂等恢复）──
    this.schema.createTable('ai_project_draft_events', (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('draft_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ai_project_drafts')
        .onDelete('CASCADE')
      table.integer('sequence').notNullable()
      table.integer('version').notNullable().defaultTo(0)
      table.string('type', 32).notNullable()
      table.json('payload').notNullable()
      table.timestamp('created_at').notNullable()

      table.unique(['draft_id', 'sequence'])
      table.index(['draft_id'])
    })

    // ── 确认记录（只存摘要）──
    this.schema.createTable('ai_project_draft_confirmations', (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('draft_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ai_project_drafts')
        .onDelete('CASCADE')
      table.integer('version').notNullable()
      table.string('mode', 10).notNullable()
      table.check("mode IN ('all','partial')")
      table.json('selection_summary').nullable()
      table.json('validation_summary').nullable()
      table
        .bigInteger('project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')
      table
        .bigInteger('confirmed_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.timestamp('created_at').notNullable()

      table.index(['draft_id'])
    })
  }

  async down() {
    this.schema.dropTable('ai_project_draft_confirmations')
    this.schema.dropTable('ai_project_draft_events')
    this.schema.dropTable('ai_project_draft_versions')
    this.schema.dropTable('ai_project_drafts')
  }
}
