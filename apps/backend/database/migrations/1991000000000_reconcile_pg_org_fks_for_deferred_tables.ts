/**
 * v3-docker-compose-runtime-foundation —— fresh PostgreSQL FK reconciliation。
 *
 * `1839300000001_add_pg_org_fk_for_deferred_tables` 的清单后来扩充了多张时间戳更晚的表。
 * 旧迁移在 fresh PG 执行到 183930... 时只能处理当时已经存在的表；本迁移位于当前迁移
 * 序列末尾，在所有建表完成后补齐其余 FK。helper 本身检查表与 constraint，故对既有 PG
 * 数据库、部分迁移数据库及重复运行均安全。
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
    // reconciliation 不拥有约束生命周期。回滚本迁移时保留 FK，避免把已经由
    // 183930... 或既有部署建立的组织隔离约束误删；原迁移 down 仍是唯一删除入口。
  }
}
