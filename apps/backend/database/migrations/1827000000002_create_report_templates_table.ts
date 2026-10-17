import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-bi-report-template-library §2.3
 *
 * 创建 report_templates 表，支持组织将内置 BI 模板「另存为」自定义副本。
 *
 * 字段：
 *   - id / organization_id（索引，组织隔离）
 *   - source_template_id / source_version（追踪来源内置模板）
 *   - name / description（可编辑元数据）
 *   - config（JSON，筛选默认值覆盖与图表开关，只改元数据不改构成）
 *   - status（active / archived）
 *   - concurrency_version（乐观并发控制）
 *   - created_by / created_at / updated_at（审计列）
 *
 * SQLite 本机优先，字段类型兼容 PostgreSQL（DEBT-01，VARCHAR(255) → text）。
 */
export default class extends BaseSchema {
  protected tableName = 'report_templates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()

      // 组织隔离
      table.integer('organization_id').unsigned().notNullable()
      table.index(['organization_id'], 'report_templates_org_idx')

      // 来源内置模板追踪
      table.string('source_template_id', 128).notNullable()
      table.integer('source_version').unsigned().notNullable().defaultTo(1)

      // 可编辑元数据
      table.string('name', 255).notNullable()
      table.text('description').defaultTo('')

      // 配置 JSON（筛选默认值覆盖、图表开关）
      table.json('config').nullable()

      // 状态
      table.string('status', 32).notNullable().defaultTo('active')

      // 乐观并发控制
      table.integer('concurrency_version').unsigned().notNullable().defaultTo(1)

      // 审计列
      table.integer('created_by').unsigned().nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('updated_at').notNullable().defaultTo(this.now())

      // 组织 + 来源模板唯一约束（同一组织同一内置模板只能有一个活跃副本）
      table.unique(['organization_id', 'source_template_id'], 'report_templates_org_source_unique')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
