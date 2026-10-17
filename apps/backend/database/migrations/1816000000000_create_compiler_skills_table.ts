import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-skill-registry-and-lifecycle —— compiler_skills 迁移（D1/D5/D8）。
 *
 * 组织级 Skill 实体持久化。JSON 列以 text 存储，应用层解析（规避 SQLite/PG 方言差异）。
 * 内容冻结语义：draft 可编辑；eval/active/deprecated 内容不可直接修改（由 Service 层校验）。
 *
 * SQLite + PG 兼容、可回滚。
 */
export default class extends BaseSchema {
  protected tableName = 'compiler_skills'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // 组织隔离（强制过滤，红线）
      table.integer('organization_id').unsigned().notNullable()

      // 标识与版本
      table.string('skill_key', 128).notNullable()
      table.string('name', 255).notNullable()
      table.string('version', 32).notNullable()
      table.text('description').notNullable().defaultTo('')

      // 生命周期（D3 五状态）
      table.string('status', 32).notNullable().defaultTo('draft')

      // 分类、标签、依赖、激活规则、知识包、来源（均 JSON text 列）
      table.text('category').notNullable().defaultTo('{}')
      table.text('tags').notNullable().defaultTo('[]')
      table.text('dependencies').notNullable().defaultTo('[]')
      table.text('activation').notNullable().defaultTo('{}')
      table.text('knowledge').notNullable().defaultTo('{}')
      table.text('provenance').nullable()

      // 基础优先级（匹配评分用，默认 100）
      table.integer('base_priority').unsigned().notNullable().defaultTo(100)

      // 审计
      table.integer('created_by').unsigned().notNullable()
      table.integer('updated_by').unsigned().notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 索引
      table.index(['organization_id', 'status'], 'idx_cs_org_status')
      table.index(['organization_id', 'skill_key'], 'idx_cs_org_key')
      table.index(['organization_id', 'updated_at'], 'idx_cs_org_updated')

      // 唯一约束：同一组织内 skill_key 唯一
      table.unique(['organization_id', 'skill_key'], 'idx_cs_org_key_unique')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
