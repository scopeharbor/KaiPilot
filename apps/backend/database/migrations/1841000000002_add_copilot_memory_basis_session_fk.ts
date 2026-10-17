/**
 * v3-docker-compose-runtime-foundation（第八轮）—— 补齐
 * copilot_memory_entries.basis_session_db_id 的 PostgreSQL 外键（deferred FK）。
 *
 * 背景（真实 GCP fresh PG 证据，MIGRATE_EXIT=1）：
 * 1840100000000 创建 copilot_memory_entries 时 inline FK 引用 copilot_sessions，
 * 但父表由更晚的 1841000000000 创建，PG 建约束即报
 * `relation "copilot_sessions" does not exist`。历史 migration 时间戳保持稳定，
 * 采用 deferred FK 模式：1840100000000 在 PG 下仅建列，本迁移位于父表
 * （1841000000000 copilot_sessions / 1841000000001 copilot_messages）之后，
 * 补齐最终 FK 完整性。
 *
 * - PG：ALTER TABLE 补 `fk_cme_basis_session`（显式短名，远离 63-byte 截断问题），
 *   ON DELETE CASCADE，语义与原 inline 声明完全一致。
 * - SQLite：1840100000000 已保留 inline FK（SQLite CREATE TABLE 不校验被引用表
 *   存在性），本迁移空跑，双端最终 schema 等价。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'
import { isPgDialect } from './1839300000001_add_pg_org_fk_for_deferred_tables.js'

/**
 * 显式稳定约束名（项目 fk_* 惯例，20 字节，远离 63-byte 截断问题）。
 * 迁移体内使用字符串字面量，使静态审计（fk_dependency_audit）可直接读取约束名。
 */
export const CME_BASIS_SESSION_FK = 'fk_cme_basis_session'

export default class extends BaseSchema {
  async up() {
    if (!isPgDialect(this.db.dialect.name)) {
      // SQLite：inline FK 已在 1840100000000 建立，无需补充
      return
    }
    this.schema.alterTable('copilot_memory_entries', (table) => {
      table
        .foreign('basis_session_db_id', 'fk_cme_basis_session')
        .references('id')
        .inTable('copilot_sessions')
        .onDelete('CASCADE')
    })
  }

  async down() {
    if (!isPgDialect(this.db.dialect.name)) return
    // 回滚序列中本迁移 down 先于 1840100000000 down 执行，表与约束此刻必然存在，
    // 直接按名删除，不用 IF EXISTS 掩盖状态。
    this.schema.alterTable('copilot_memory_entries', (table) => {
      table.dropForeign(['basis_session_db_id'], 'fk_cme_basis_session')
    })
  }
}
