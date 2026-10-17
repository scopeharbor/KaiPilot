import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-risk-management-full — risk_knowledge_templates table.
 * System built-in and organization-specific risk templates.
 * Used by the rule engine and risk stage of Project Compiler.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('risk_knowledge_templates', (table) => {
      table.bigIncrements('id')

      // NULL = 系统内置模板
      table
        .bigInteger('organization_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('title', 255).notNullable()
      table.text('description').notNullable()
      table.string('category', 20).notNullable()
      table.check(
        "category IN ('technical','schedule','cost','resource','external','organizational','legal','other')",
      )

      // 适用项目类型（JSON）
      table.json('applicable_project_types').nullable()

      // 触发条件（JSON）
      table.json('trigger_conditions').nullable()

      // 建议概率/影响
      table.integer('suggested_probability').nullable()
      table.integer('suggested_impact').nullable()

      // 建议应对（JSON）
      table.json('suggested_response').nullable()

      // 来源说明
      table.string('source', 100).notNullable().defaultTo('system')

      // 启停状态
      table.boolean('is_active').notNullable().defaultTo(true)

      // 模板类型
      table.string('template_type', 20).notNullable().defaultTo('system')
      table.check("template_type IN ('system','organization')")

      // 审计
      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .bigInteger('updated_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // 索引
      table.index(['organization_id'], 'idx_rkt_org')
      table.index(['template_type', 'is_active'], 'idx_rkt_type_active')
      table.index(['category'], 'idx_rkt_category')
      table.index(['created_at'], 'idx_rkt_created')
    })
  }

  async down() {
    this.schema.dropTable('risk_knowledge_templates')
  }
}
