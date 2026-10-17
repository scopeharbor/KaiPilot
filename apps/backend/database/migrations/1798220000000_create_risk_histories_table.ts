import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-risk-management-full — risk_histories table.
 * Records risk field changes, status transitions, reviews, response plan
 * changes, and candidate accept/reject events.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('risk_histories', (table) => {
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
        .bigInteger('risk_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('risks')
        .onDelete('CASCADE')

      // 事件类型
      table.string('event_type', 40).notNullable()
      table.check(
        "event_type IN ('created','field_changed','status_changed','risk_level_changed','reviewed','response_plan_created','response_plan_updated','response_plan_completed','candidate_accepted','candidate_rejected','closed','reopened')",
      )

      // 操作者
      table
        .bigInteger('actor_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      // 低敏摘要（JSON）
      table.json('summary').nullable()

      // 来源类型
      table.string('source_type', 30).notNullable().defaultTo('manual')
      table.check("source_type IN ('manual','ai_suggestion','rule_engine','ai_draft','system')")

      // 来源引用
      table.string('source_ref', 120).nullable()

      // 发生时间
      table.timestamp('occurred_at', { useTz: false }).notNullable()

      // 自动创建时间
      table.timestamp('created_at', { useTz: false }).notNullable()

      // 索引
      table.index(['organization_id', 'project_id'], 'idx_rh_org_project')
      table.index(['risk_id', 'occurred_at'], 'idx_rh_risk_occurred')
      table.index(['project_id', 'event_type'], 'idx_rh_project_event')
      table.index(['project_id', 'occurred_at'], 'idx_rh_project_occurred')
      table.index(['actor_id'], 'idx_rh_actor')
    })
  }

  async down() {
    this.schema.dropTable('risk_histories')
  }
}
