import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-legacy-contract-debt-fixes —— requirement_tasks 补 organization_id 首列索引。
 *
 * 背景：1996030000000 建表时只建了 UNIQUE(requirement_id, task_id) 与
 * idx_requirement_tasks_task_id，两者都不以 organization_id 起首。本表在
 * `DatabaseIsolationCatalog` 中登记为 tenant-owned（同一 change 的补登记）后，
 * 迁移守卫「每张 tenant-owned 表存在 org 首列索引（高频租户过滤）」
 * （tests/functional/db_schema/tenant_isolation_guards.spec.ts）即转红。
 *
 * 只加索引，不动列、不动既有唯一约束：UNIQUE(requirement_id, task_id) 是
 * 「需求边界内绑定去重」语义，按守卫的全局唯一键豁免登记保留原样（见该 spec 的
 * globalUniqueKeyExempt），不能改成含 organization_id 的复合唯一键。
 *
 * 方言兼容：索引显式命名（远低于 PostgreSQL 63 字节上限），不加 `.after()`。
 */
export default class extends BaseSchema {
  protected tableName = 'requirement_tasks'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.index(['organization_id', 'requirement_id'], 'idx_requirement_tasks_org_requirement')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(
        ['organization_id', 'requirement_id'],
        'idx_requirement_tasks_org_requirement',
      )
    })
  }
}
