/**
 * v3-multitenant-database-isolation —— 补充 org 首列索引（任务 3.5）。
 *
 * 审计（2026-08-08，全量迁移后 PRAGMA dump）发现两张 tenant-owned 表缺
 * organization_id 首列索引，违反 spec「Tenant-scoped migrations MUST include
 * ownership constraints and indexes」的高频租户过滤要求：
 * - bi_dashboard_versions：仅有 (dashboard_id, version)/(dashboard_id) 索引
 * - comment_mentions：仅有 (mentioned_user_id, organization_id)（org 非首列）
 *
 * SQLite / PostgreSQL 均可安全追加索引（CREATE INDEX 幂等语义由 lucid 保证）。
 * 注：SQLite 无法 ALTER TABLE 补 FK（design Decision 5），69 张 sqlite-deferred
 * 表的 FK 由 1839300000001（PG-only dialect 分支）补齐。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('bi_dashboard_versions', (table) => {
      table.index(['organization_id', 'dashboard_id'], 'idx_bi_dash_ver_org_dash')
    })
    this.schema.alterTable('comment_mentions', (table) => {
      table.index(['organization_id', 'comment_id'], 'idx_comment_mentions_org_comment')
    })
  }

  async down() {
    this.schema.alterTable('comment_mentions', (table) => {
      table.dropIndex(['organization_id', 'comment_id'], 'idx_comment_mentions_org_comment')
    })
    this.schema.alterTable('bi_dashboard_versions', (table) => {
      table.dropIndex(['organization_id', 'dashboard_id'], 'idx_bi_dash_ver_org_dash')
    })
  }
}
