/**
 * v3-initial-skill-software-development —— 新增 is_builtin 列 + 索引（D1）。
 *
 * up: 加 is_builtin boolean notNull default 0 + 索引 idx_cs_org_builtin
 * down: drop column + index
 * SQLite/PG 兼容、可回滚。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class AddIsBuiltinToCompilerSkills extends BaseSchema {
  protected tableName = 'compiler_skills'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_builtin').notNullable().defaultTo(0)
      table.index(['organization_id', 'is_builtin'], 'idx_cs_org_builtin')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['organization_id', 'is_builtin'], 'idx_cs_org_builtin')
      table.dropColumn('is_builtin')
    })
  }
}
