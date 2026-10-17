import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * ocr_retention_policies 表：V3 OCR 保留策略——组织/项目级分类保留配置。
 *
 * 每条记录代表一个作用域（organization 或 organization+project）的保留策略覆盖。
 * 默认系统策略不会被持久化——此表只存覆盖。
 * policy_hash 允许确定性检测策略变更。
 *
 * v3-ocr-result-persistence-and-retention §3.1
 */
export default class extends BaseSchema {
  protected tableName = 'ocr_retention_policies'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 作用域：organization-only（project_id=null 表示组织级）或 project-scoped
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

      // 分类配置 JSON（OcrRetentionCategoryPolicy[]）
      table.json('categories_json').notNullable()

      // 策略哈希（确定性，用于比对与审计）
      table.string('policy_hash', 64).notNullable()

      // 来源（organization / project，冗余但方便查询）
      table.string('source', 20).notNullable().defaultTo('organization')
      table.check("source IN ('organization','project')")

      // 操作人
      table.bigInteger('updated_by').unsigned().nullable()

      // 时间戳
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：每个作用域一条策略
      table.unique(['organization_id', 'project_id'], 'idx_ocrp_org_project_unique')
      table.index(['organization_id', 'project_id'], 'idx_ocrp_org_project')
      table.index(['policy_hash'], 'idx_ocrp_policy_hash')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
