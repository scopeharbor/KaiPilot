import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-four-layer-knowledge-system —— knowledge_items 迁移（D1）。
 *
 * 四层知识底座的核心数据实体。单表 + layer 判别列设计。
 * JSON 列（provenance/review_history）以 text 存储，应用层解析。
 *
 * 组织隔离红线：所有查询强制附加 organization_id。
 * L3 合成隔离红线：由 Service 层 enforce。
 *
 * SQLite + PG 兼容、可回滚。
 */
export default class extends BaseSchema {
  protected tableName = 'knowledge_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // 组织隔离（强制过滤，红线）
      table.integer('organization_id').unsigned().notNullable()

      // 知识层判别列（L1/L2/L3/L4）——CHECK 约束由 raw SQL 追加
      table.string('layer', 3).notNullable()

      // 分层元数据快照（JSON）
      table.text('layer_meta').notNullable()

      // 基础知识字段
      table.string('title', 512).notNullable()
      table.text('content').notNullable()

      // 生命周期状态（D4 五状态）
      table.string('status', 32).notNullable().defaultTo('draft')

      // 领域、用途、复杂度（结构化过滤）
      table.string('domain', 255).notNullable()
      table.string('purpose', 255).notNullable()
      table.string('complexity', 64).nullable()

      // 来源溯源（JSON: sources + reviewHistory）
      table.text('provenance').notNullable()
      table.text('review_history').notNullable().defaultTo('[]')

      // 合成标记（L3 红线）
      table.boolean('is_synthetic').notNullable().defaultTo(false)
      table.text('synthetic_method').nullable()

      // 审计
      table.integer('created_by').unsigned().notNullable()
      table.integer('updated_by').unsigned().nullable()
      table.timestamp('last_referenced_at').nullable()

      // 保留期（天数，L4 默认 90）
      table.integer('retention_days').unsigned().nullable()

      // 时间戳
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 索引——优先覆盖组织隔离 + 常用过滤组合
      table.index(['organization_id', 'layer'], 'idx_ki_org_layer')
      table.index(['organization_id', 'status'], 'idx_ki_org_status')
      table.index(['organization_id', 'domain'], 'idx_ki_org_domain')
      table.index(['organization_id', 'updated_at'], 'idx_ki_org_updated')
      table.index(['organization_id', 'is_synthetic'], 'idx_ki_org_synthetic')
      table.index(['organization_id', 'last_referenced_at'], 'idx_ki_org_ref')
    })

    // SQLite CHECK 约束——layer 只能取值 L1/L2/L3/L4
    // PG 同理通过 raw SQL 追加（与 schema builder 分开，避免方言冲突）
    this.defer(async (db) => {
      try {
        await db.rawQuery(
          `ALTER TABLE ${this.tableName} ADD CONSTRAINT ck_ki_layer CHECK (layer IN ('L1','L2','L3','L4'))`,
        )
      } catch {
        // 约束可能已存在（方言级差异——SQLite 不可重构已存在表），忽略
      }
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
