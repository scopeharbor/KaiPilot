/**
 * v3-triz-ifr-visualization —— IFR 审查会话与阶段快照表（tasks 3.1 P0）。
 *
 * 纯 additive：不修改既有 TRIZ 表，不影响现有流程。
 * Rollback: 隐藏导航/feature flag + 保留表不删（数据无损回滚）。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class CreateTrizIfrVisualizationsTable extends BaseSchema {
  public static tableName = 'triz_ifr_review_sessions' as const
  public static stageTableName = 'triz_ifr_stage_snapshots' as const

  async up() {
    // ── IFR 审查会话 ──
    this.schema.createTable(CreateTrizIfrVisualizationsTable.tableName, (table) => {
      table.increments('id').primary()
      table.string('ifr_id', 64).notNullable().unique()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().notNullable()
      table.integer('actor_id').unsigned().notNullable()

      // 当前/理想态
      table.text('current_state').notNullable()
      table.text('ideal_state').notNullable()

      // 审查状态
      table.string('review_status', 32).notNullable().defaultTo('draft')

      // 版本元数据
      table.integer('schema_version').notNullable().defaultTo(1)
      table.integer('score_version').notNullable().defaultTo(1)

      // 理想度评分 JSON
      table.text('ideality_score_json').notNullable()
      table.text('trend_summary_json').notNullable()

      // 来源 refs JSON
      table.text('source_refs_json').notNullable()

      // Warning 摘要 JSON
      table.text('warning_summary_json').nullable()

      // AI 草稿状态
      table.string('ai_draft_state', 32).nullable()

      // 输出 hash
      table.string('output_hash', 64).notNullable()

      // 来源总 hash（用于 stale 检测）
      table.string('source_hash', 64).notNullable()

      // 时间戳
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 索引
      table.index(['organization_id', 'project_id'], 'ifr_sessions_org_proj_idx')
      table.index(
        ['organization_id', 'project_id', 'review_status'],
        'ifr_sessions_org_proj_status_idx',
      )
      table.index(['ifr_id'], 'ifr_sessions_ifr_id_idx')
    })

    // ── IFR 阶段快照 ──
    this.schema.createTable(CreateTrizIfrVisualizationsTable.stageTableName, (table) => {
      table.increments('id').primary()
      table
        .integer('session_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable(CreateTrizIfrVisualizationsTable.tableName)
        .onDelete('CASCADE')

      table.string('stage_id', 64).notNullable()
      table.string('kind', 32).notNullable() // current / intermediate / target
      table.string('label', 512).notNullable()
      table.text('description').notNullable()

      // 趋势预期
      table.string('expected_useful_function_change', 256).notNullable().defaultTo('+0%')
      table.string('expected_cost_change', 256).notNullable().defaultTo('-0%')
      table.string('expected_harm_change', 256).notNullable().defaultTo('-0%')

      // 关联 TRIZ 原理/矛盾 refs（JSON 数组）
      table.text('related_principle_refs_json').nullable()
      table.text('related_contradiction_refs_json').nullable()

      // Warning codes（JSON 数组）
      table.text('warning_codes_json').nullable()

      // 审查状态
      table.string('review_state', 32).notNullable().defaultTo('pending')

      // 阶段 hash
      table.string('stage_hash', 64).notNullable()

      // 陈旧标记
      table.boolean('stale').notNullable().defaultTo(false)

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 索引
      table.index(['session_id'], 'ifr_stages_session_idx')
      table.index(['session_id', 'stage_id'], 'ifr_stages_session_stage_idx')
    })
  }

  async down() {
    this.schema.dropTableIfExists(CreateTrizIfrVisualizationsTable.stageTableName)
    this.schema.dropTableIfExists(CreateTrizIfrVisualizationsTable.tableName)
  }
}
