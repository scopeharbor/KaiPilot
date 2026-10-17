import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-ai-context-and-retrieval-observability —— copilot_context_observations 表。
 *
 * 上下文与检索观测记录：落库装配结果的逐来源元数据、截断标记、不确定三分、
 * 检索质量聚合，供事后排查「为什么 AI 不知道这件事」。
 *
 * 禁存：不含检索词原文、来源正文、prompt、模型输出、token 与 secret。
 * 组织隔离：organization_id 必填。
 * 保留期：由 v3-observability-data-retention 统一管理。
 */
export default class extends BaseSchema {
  protected tableName = 'copilot_context_observations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // ── 组织隔离（必填）──
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // ── 组装标识 ──
      table.string('assembly_id', 64).notNullable()

      // ── 项目（可选）──
      table.bigInteger('project_id').unsigned().nullable()

      // ── 操作者 ──
      table.bigInteger('actor_id').unsigned().notNullable()

      // ── 逐来源观测（JSON 数组，禁存原文）──
      table.json('sources').notNullable().defaultTo('[]')

      // ── 截断观测 ──
      table.json('truncation').notNullable()

      // ── 不确定三分 ──
      table.json('uncertainty').notNullable()

      // ── 检索质量聚合（按来源种类 + 查询类别）──
      table.json('retrieval_quality').notNullable().defaultTo('[]')

      // ── 路由输入保护 ──
      table.boolean('routing_inputs_preserved').notNullable().defaultTo(true)

      // ── 耗时 ──
      table.integer('total_ms').notNullable().defaultTo(0)

      // ── 降级标记 ──
      table.boolean('degraded').notNullable().defaultTo(false)
      table.string('degraded_reason', 255).nullable()

      // ── 时间戳 ──
      table.timestamp('observed_at', { useTz: false }).notNullable()
      table.timestamp('created_at', { useTz: false }).notNullable()

      // ── 索引 ──
      // 组织隔离 + 时间范围查询
      table.index(['organization_id', 'observed_at'], 'idx_cco_org_time')
      // 组织 + 项目
      table.index(['organization_id', 'project_id'], 'idx_cco_org_project')
      // 组装 ID 查询
      table.index(['assembly_id'], 'idx_cco_assembly_id')
      // 组织 + actor
      table.index(['organization_id', 'actor_id'], 'idx_cco_org_actor')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
