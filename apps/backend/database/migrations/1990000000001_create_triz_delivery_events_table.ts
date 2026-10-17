import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-triz-to-delivery-closed-loop —— triz_delivery_events（tasks 3.3/3.4）。
 *
 * append-only 事件流：verification_recorded / verification_superseded /
 * reopen_requested / link_superseded。历史事件不可更新或删除；
 * 更正通过 supersedes_event_id 追加新事件。payload 仅结构化摘要与低敏
 * evidence refs（≤20），schema 级无完整内容字段（design D6/D9）。
 *
 * 索引支撑：link 时间线、latest verification、需重审队列扫描与幂等 digest。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_delivery_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // 组织列真实 FK（enforced）；links 本表不 FK——事件历史独立于 link 生命周期保留
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table.integer('project_id').notNullable().index()
      table.integer('link_id').notNullable()

      table.string('event_kind', 40).notNullable()
      table.check(
        "event_kind IN ('verification_recorded','verification_superseded','reopen_requested','link_superseded')",
      )

      // verification payload（结构化摘要，全部有界）
      table.string('conclusion', 20).nullable()
      table.check("conclusion IS NULL OR conclusion IN ('effective','ineffective','inconclusive')")
      table.timestamp('observation_window_from', { useTz: true }).nullable()
      table.timestamp('observation_window_to', { useTz: true }).nullable()
      table.string('baseline_summary', 2000).nullable()
      table.string('target_summary', 2000).nullable()
      table.string('actual_result', 2000).nullable()
      table.string('reason', 2000).nullable()
      table.json('evidence_refs').nullable() // 有界：≤20 个低敏 ref

      // fingerprint 绑定与幂等
      table.string('fingerprint', 64).notNullable()
      table.string('event_digest', 64).notNullable()

      // 更正链
      table.integer('supersedes_event_id').nullable()
      table.integer('actor_user_id').notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.unique(['organization_id', 'event_digest'])
      table.index(['link_id', 'event_kind'], 'tdl_events_timeline_idx')
      table.index(['organization_id', 'project_id', 'event_kind'], 'tdl_events_reopen_queue_idx')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
