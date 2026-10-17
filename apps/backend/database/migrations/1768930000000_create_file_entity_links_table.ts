import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * file_entity_links 表：附件/文档与项目实体的多对多关联（D5）。
 * 支持 task / milestone / risk / document / change_request / comment /
 * report_version / compiler_artifact 等实体类型。
 */
export default class extends BaseSchema {
  protected tableName = 'file_entity_links'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 文件类型：attachment / document
      table.string('file_type', 20).notNullable().defaultTo('attachment')
      table.bigInteger('file_id').unsigned().notNullable()

      // 关联实体多态
      table.string('entity_type', 50).notNullable()
      table.bigInteger('entity_id').unsigned().notNullable()

      // 链接类型：related / reference / attachment
      table.string('link_type', 30).notNullable().defaultTo('attachment')

      // 组织和项目归属（用于隔离校验）
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
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // 创建者
      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at').notNullable()

      // 唯一约束：同一文件与同一实体的关联唯一
      table.unique(['file_type', 'file_id', 'entity_type', 'entity_id'], 'idx_file_links_unique')

      // 索引
      table.index(['file_type', 'file_id'], 'idx_file_links_file')
      table.index(['entity_type', 'entity_id'], 'idx_file_links_entity')
      table.index(['organization_id'])
      table.index(['project_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
