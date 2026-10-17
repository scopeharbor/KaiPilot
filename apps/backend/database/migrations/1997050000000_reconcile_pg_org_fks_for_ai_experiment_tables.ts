/**
 * 实验与版本域 —— PostgreSQL 组织外键对账。
 *
 * `1997040000000_create_ai_experiment_tables` 建了 5 张租户表但未声明 organization_id 外键，
 * 违反「PG 上全部 tenant-owned 表带 organization FK」契约（tenant_isolation_guards 3.6）。
 * 这 5 张表已登记进 `DEFERRED_TABLES`；本迁移位于其建表之后，复用同一幂等 helper 补齐 FK。
 * helper 自行检查表与约束是否存在，对既有 PG 库、部分迁移库与重复执行均安全；SQLite 空跑。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'
import {
  addMissingDeferredOrganizationFks,
  isPgDialect,
} from './1839300000001_add_pg_org_fk_for_deferred_tables.js'

export default class extends BaseSchema {
  async up() {
    if (!isPgDialect(this.db.dialect.name)) return
    await addMissingDeferredOrganizationFks(this.db)
  }

  async down() {
    // 与 1991000000000 对账迁移一致：对账不拥有约束生命周期，回滚时保留 FK；
    // 1839300000001 的 down 仍是唯一删除入口。
  }
}
