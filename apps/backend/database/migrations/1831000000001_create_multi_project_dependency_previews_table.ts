import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * multi_project_dependency_previews 表：跨项目依赖预览快照
 * v3-multi-project-dependency-model / §2.2
 *
 * 存储服务端生成的预览快照，用于预览/确认/幂等流程。
 * 预览有过期时间，过期后不可确认。
 */
export default class extends BaseSchema {
  protected tableName = 'multi_project_dependency_previews'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 预览 ID（公开，前端使用）
      table.string('preview_id', 64).notNullable().unique()

      // 组织隔离
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // 操作类型
      table.string('operation', 10).notNullable()
      table.check("operation IN ('create','update','archive','restore')")

      // 对应的依赖 ID（create 时为 null）
      table
        .bigInteger('dependency_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('multi_project_dependencies')
        .onDelete('CASCADE')

      // 权限指纹
      table.string('permission_fingerprint', 64).notNullable()

      // 提议的差异（JSON）
      table.json('proposed_diff').notNullable()

      // 校验结果（JSON）
      table.json('duplicate_check').nullable()
      table.json('cycle_check').nullable()
      table.json('lifecycle_check').nullable()
      table.json('self_dependency_check').nullable()

      // 新鲜度签名
      table.string('freshness_signature', 64).notNullable()

      // 警告码（JSON）
      table.json('warning_codes').nullable()

      // 确认哈希
      table.string('confirmation_hash', 64).notNullable()

      // 幂等键
      table.string('idempotency_key', 64).notNullable()

      // 来源签名
      table.string('source_signature', 64).notNullable()

      // 操作者
      table.bigInteger('actor_user_id').unsigned().notNullable().references('id').inTable('users')

      // 过期时间
      table.timestamp('expires_at').notNullable()

      // 是否已使用
      table.boolean('consumed').notNullable().defaultTo(false)

      // 时间戳
      table.timestamp('created_at').notNullable()

      // 索引
      table.index(['organization_id'])
      table.index(['preview_id', 'confirmation_hash'])
      table.index(['organization_id', 'expires_at'])
      table.index(['idempotency_key', 'actor_user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
