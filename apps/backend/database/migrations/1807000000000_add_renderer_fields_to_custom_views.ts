import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 在 custom_views 表添加 renderer 支持字段（§2.4 P0）。
 *
 * - renderer_type：视图渲染器类型（dashboard/list/gantt 等完整列表，nullable 表示传统视图）
 * - config_hash：配置确定性 SHA-256 哈希
 * - source_artifact_ref：可选的 AI/Compiler artifact 来源引用
 * - migration_status：配置迁移状态（none/pending/migrated/failed）
 */
export default class extends BaseSchema {
  protected tableName = 'custom_views'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table
        .enum('renderer_type', [
          'dashboard',
          'list',
          'kanban',
          'gantt',
          'wbs',
          'calendar',
          'timeline',
          'risk-matrix',
          'resource',
          'dependency',
          'custom',
        ] as const)
        .nullable()
        .defaultTo(null)
      table.string('config_hash', 64).nullable().defaultTo(null)
      table.string('source_artifact_ref', 255).nullable().defaultTo(null)
      table
        .enum('migration_status', ['none', 'pending', 'migrated', 'failed'] as const)
        .notNullable()
        .defaultTo('none')
    })

    // 索引
    this.schema.raw(
      `CREATE INDEX idx_custom_views_renderer ON ${this.tableName} (renderer_type) WHERE renderer_type IS NOT NULL`,
    )
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('renderer_type')
      table.dropColumn('config_hash')
      table.dropColumn('source_artifact_ref')
      table.dropColumn('migration_status')
    })
  }
}
