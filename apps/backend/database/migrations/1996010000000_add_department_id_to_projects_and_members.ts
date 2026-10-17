import { BaseSchema } from '@adonisjs/lucid/schema'
import { isPgDialect } from './1839300000001_add_pg_org_fk_for_deferred_tables.js'

/**
 * v3-chart-gallery-data-foundation —— projects / organization_members 关联部门（W1.1）。
 *
 * 为 projects 与 organization_members 增加 department_id（BIGINT UNSIGNED NULL）。
 *
 * SQLite 兼容性铁律（design D1-§3）：
 * - 不加 `.after()`；
 * - SQLite 的 ALTER TABLE ADD COLUMN 不支持补外键（v3-multitenant-database-isolation
 *   Design Decision 5），故 SQLite 下仅建裸列 + 索引，组织内完整性由服务层保证；
 * - PostgreSQL 支持 ALTER ADD COLUMN REFERENCES，按方言分支补齐
 *   `ON DELETE SET NULL` 外键（软删除为主，部门物理删除时项目/成员归属置空）。
 */
export default class AddDepartmentIdToProjectsAndMembers extends BaseSchema {
  async up() {
    const isPg = isPgDialect(this.db.dialect.name)

    this.schema.alterTable('projects', (table) => {
      if (isPg) {
        table
          .bigInteger('department_id')
          .unsigned()
          .nullable()
          .references('id')
          .inTable('departments')
          .onDelete('SET NULL')
      } else {
        table.bigInteger('department_id').unsigned().nullable()
      }
      table.index(['department_id'], 'idx_projects_dept')
    })

    this.schema.alterTable('organization_members', (table) => {
      if (isPg) {
        table
          .bigInteger('department_id')
          .unsigned()
          .nullable()
          .references('id')
          .inTable('departments')
          .onDelete('SET NULL')
      } else {
        table.bigInteger('department_id').unsigned().nullable()
      }
      table.index(['department_id'], 'idx_org_members_dept')
    })
  }

  async down() {
    this.schema.alterTable('projects', (table) => {
      table.dropIndex(['department_id'], 'idx_projects_dept')
      table.dropColumn('department_id')
    })
    this.schema.alterTable('organization_members', (table) => {
      table.dropIndex(['department_id'], 'idx_org_members_dept')
      table.dropColumn('department_id')
    })
  }
}
