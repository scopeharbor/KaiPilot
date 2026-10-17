/**
 * v2-traceability-source-attribution —— Traceability Links 表（task 2.2）。
 *
 * 组织级隔离：organization_id 必填 + 可索引。
 * 只存储已正式落库实体间的显式追溯关系。
 * 基于名称相似度隐式推断关系被禁止。
 * SQLite 兼容 + PG 兼容（JSON 列、软删除、无 SQLite 专有语法）。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('traceability_links', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // 来源实体
      table.string('source_entity_type', 50).notNullable()
      table.string('source_entity_id', 200).notNullable()

      // 目标实体
      table.string('target_entity_type', 50).notNullable()
      table.string('target_entity_id', 200).notNullable()

      // 关系类型与方向
      table.string('relation_type', 30).notNullable()
      table.check(
        "relation_type IN ('hierarchy_parent','hierarchy_child','depends_on','depended_by','validates','validated_by','milestone_tracks','risk_impacts','risk_mitigated_by','derived_from','generated','confirms')",
      )
      table.string('direction', 20).notNullable().defaultTo('forward')
      table.check("direction IN ('forward','bidirectional')")

      // 关系强度
      table.decimal('strength', 3, 2).notNullable().defaultTo(1)

      // 绑定来源归因
      table
        .bigInteger('source_attribution_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('source_attributions')
        .onDelete('SET NULL')

      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 软删除
      table.timestamp('deleted_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable('traceability_links')
  }
}
