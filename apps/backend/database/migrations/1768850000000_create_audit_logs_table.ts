import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * audit_logs 表：全系统操作审计唯一入口（sec7.2.3）。
 * - action 枚举 12 类操作（按 sec7 列举值）
 * - entity_type / entity_id 多态关联，无严格外键
 * - organization_id / project_id 冗余存储查询上下文，均不建外键（审计只写不删，需超越业务实体生命周期保留）
 * - changes / metadata JSON；severity 四级；request_id 分布式追踪
 * 不软删除——数据只写入，通过归档策略管理体积（sec7.5）。
 */
export default class extends BaseSchema {
  protected tableName = 'audit_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织 / 项目上下文（冗余，不建外键以保障审计留存）
      table.bigInteger('organization_id').unsigned().nullable()
      table.bigInteger('project_id').unsigned().nullable()
      // 操作人（不建外键：用户删除后审计记录保留）
      table.bigInteger('user_id').unsigned().nullable()

      // 多态被操作对象
      table.string('entity_type', 30).nullable()
      table.bigInteger('entity_id').unsigned().nullable()

      // 操作类型（sec7.2.3 列举值）
      table.string('action', 20).notNullable()
      table.check(
        "action IN ('create','read','update','delete','export','import','login','logout','approve','reject','ai_generate','apply','rollback')",
      )

      // before/after 对比
      table.json('changes').nullable()
      // 操作上下文（IP / UA / 来源页面）
      table.json('metadata').nullable()

      // 严重度
      table.string('severity', 10).notNullable().defaultTo('info')
      table.check("severity IN ('info','warning','error','critical')")

      // 分布式请求追踪
      table.string('request_id', 64).nullable()

      // 注意：本表不含 deleted_at（审计只写不删）
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：审计列表、实体变更历史、项目日志、时间范围查询（sec7.5）
      table.index(['organization_id'])
      table.index(['entity_type', 'entity_id'])
      table.index(['project_id'])
      table.index(['created_at'])
      table.index(['severity'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
