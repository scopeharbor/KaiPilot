/**
 * v3-skill-knowledge-authoring —— skill_knowledge_drafts 迁移（D2）。
 *
 * 组织隔离的知识草稿表：一个 Skill 同时至多一个 pending 草稿。
 * 存 sections(JSON) + base_version + status + ai_assisted 标记。
 * SQLite 优先，经 Lucid 迁移预留 PG 类型映射。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'skill_knowledge_drafts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()

      // 组织隔离（红线）
      table
        .integer('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table.index('organization_id')

      // 目标 Skill（FK）
      table
        .integer('skill_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('compiler_skills')
        .onDelete('CASCADE')
      table.index('skill_id')

      // sections (JSON)
      table.text('sections').notNullable()

      // 基准版本（Skill.version 快照）
      table.string('base_version', 64).notNullable()

      // 草稿状态：pending | committed | discarded
      table.string('status', 32).notNullable().defaultTo('pending')

      // AI 辅助标记
      table.boolean('ai_assisted').notNullable().defaultTo(false)

      // 审计/权限字段
      table.integer('created_by').unsigned().notNullable()
      table.integer('updated_by').unsigned().notNullable()

      // 时间戳
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      // 单 pending 约束：一个 (organization_id, skill_id) 只能有一个 pending
      // SQLite 不支持部分索引，约束由应用层 Service 保证；
      // PostgreSQL 环境下可通过 WHERE status = 'pending' 部分唯一索引增强
      table.unique(['organization_id', 'skill_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
