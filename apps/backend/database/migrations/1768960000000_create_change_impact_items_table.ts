import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * change_impact_items 表：影响分析受影响项明细（v2-change-management-impact-analysis D1）。
 * 每条记录对应一个受影响实体（任务/里程碑/资源/风险等），包含传播路径、严重度、证据。
 */
export default class extends BaseSchema {
  protected tableName = 'change_impact_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 归属分析
      table
        .bigInteger('analysis_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('change_impact_analyses')
        .onDelete('CASCADE')

      // 实体引用
      table.string('entity_type', 50).notNullable()
      table.bigInteger('entity_id').unsigned().notNullable()

      // 影响维度与严重度
      table.string('dimension', 30).notNullable()
      table.check(
        "dimension IN ('scope','schedule','resource','risk','quality','assumption','related_object')",
      )
      table.string('severity', 20).notNullable()
      table.check("severity IN ('critical','high','medium','low','none')")

      // 严重度分数（用于排序，越高越严重）
      table.integer('score').notNullable().defaultTo(0)

      // 传播路径 JSON 数组 [{fromEntityType, fromEntityId, toEntityType, toEntityId, relationshipType, relationshipId}]
      table.json('propagation_path').nullable()

      // 传播深度（跳数）
      table.integer('depth').notNullable().defaultTo(0)

      // 规则 ID（R001~R009）
      table.string('rule_id', 10).notNullable()

      // 证据摘要（低敏，不含完整上下文）
      table.text('evidence').nullable()

      // 是否需要人工复核
      table.boolean('requires_review').notNullable().defaultTo(false)

      // 可见性（权限脱敏时设为 false）
      table.boolean('is_visible').notNullable().defaultTo(true)

      // 索引
      table.index(['analysis_id'], 'idx_cii_analysis')
      table.index(['entity_type', 'entity_id'], 'idx_cii_entity')
      table.index(['dimension', 'severity'], 'idx_cii_dimension_severity')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
