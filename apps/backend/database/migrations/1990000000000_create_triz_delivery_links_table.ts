import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-triz-to-delivery-closed-loop —— triz_delivery_links（tasks 3.1/3.2）。
 *
 * 宿主拥有的闭环关联层：TRIZ decision ↔ 正式交付实体（task/milestone required、
 * risk/change_request context）的可追溯低敏关联。只存 refs/hash/枚举/短摘要，
 * 不缓存任务标题或完整证据（design D1/D9）。
 *
 * 幂等：link_digest 唯一约束（digest 内嵌组织/项目/决策/refs 规范化输入）。
 * 更正只允许通过 supersedes/superseded_by 追加新行，禁止 update/delete 历史语义。
 * 列类型沿用仓库先例：json = SQLite TEXT / PG JSONB；CHECK 约束双方言可迁移。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_delivery_links'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // 租户与项目 scope（闭环是项目级能力，两者都必填）
      // 组织列沿用 PMO 先例：真实 FK（enforced），组织删除随之清理；
      // 正式实体表（tasks/milestones 等）与 decision log 不建 FK——
      // 删除正式实体不得级联删除闭环历史（design D9）。
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table.integer('project_id').notNullable().index()

      // 决策链 refs（append-only decision log 的数值主键）
      table.integer('decision_log_id').notNullable()

      // reviewed-import receipt 链（existing_entity 模式可空）
      table.integer('draft_session_id').nullable()
      table.integer('apply_result_id').nullable()
      table.string('scheme_id', 100).nullable()
      table.json('option_ids').nullable() // 有界：≤10 个 optionId 字符串

      // 来源归因 hashes（低敏前缀摘要，非全文）
      table.json('source_hashes').nullable()

      // 交付/上下文 refs（JSON 数组：{kind, entityId, revisionHint?}）
      // kind 封闭词表在应用层校验；required=task/milestone，context=risk/change_request
      table.json('delivery_refs').notNullable()
      table.json('context_refs').notNullable().defaultTo('[]')

      // 关联模式与幂等/指纹
      table.string('link_mode', 20).notNullable()
      table.check("link_mode IN ('apply_receipt','existing_entity')")
      table.string('preview_fingerprint', 64).nullable()
      table.string('link_digest', 64).notNullable()

      // 追加式更正链：不 update/delete 旧行
      table.integer('supersedes_link_id').nullable()
      table.integer('superseded_by_link_id').nullable()

      // 显式人工确认的 actor
      table.integer('actor_user_id').notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    // 幂等唯一键 + 读取索引（唯一键含 organization_id：跨租分域；
    // digest 输入另内嵌 org/project/decision/mode/canonical refs，双重保险）
    this.schema.alterTable(this.tableName, (table) => {
      table.unique(['organization_id', 'link_digest'])
      table.index(['organization_id', 'project_id', 'decision_log_id'], 'tdl_links_list_idx')
      table.index(
        ['organization_id', 'project_id', 'superseded_by_link_id'],
        'tdl_links_superseded_idx',
      )
      table.index(['draft_session_id'], 'tdl_links_session_idx')
      table.index(['apply_result_id'], 'tdl_links_apply_result_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
