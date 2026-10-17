import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * task_external_links 表：任务与 GitHub/GitLab Issue/PR/MR 的轻量关联。
 *
 * 所有查询必须同时限定 organization_id、project_id、task_id。
 * external_status 只作为链接快照，不驱动任务事实变化。
 * metadata 字段为可选 JSON，用于 future-proof（如存放原始响应摘要）。
 *
 * 本 migration 不含外键约束（task_id 可能跨 schema 且项目软删除），
 * 通过 Service + Policy 层保障引用完整性。
 */
export default class extends BaseSchema {
  protected tableName = 'task_external_links'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      // Primary key
      table.bigIncrements('id')

      // 组织/项目/任务三层隔离
      table.bigInteger('organization_id').unsigned().notNullable()
      table.bigInteger('project_id').unsigned().notNullable()
      table.bigInteger('task_id').unsigned().notNullable()

      // Provider 信息
      table.string('provider', 32).notNullable() // 'github' | 'gitlab'
      table.string('link_type', 32).notNullable() // 'issue' | 'pull_request' | 'merge_request'

      // 仓库信息
      table.string('repository_owner', 255).notNullable()
      table.string('repository_name', 255).notNullable()

      // 外部标识
      table.bigInteger('external_number').unsigned().notNullable()
      table.string('external_id', 255).nullable()
      table.string('external_title', 500).nullable()

      // 状态快照（轻量枚举，不驱动任务事实）
      table.string('external_status', 32).notNullable().defaultTo('unknown')
      table.string('status_source', 32).notNullable().defaultTo('manual')

      // URL 与备注
      table.string('external_url', 2048).notNullable()
      table.string('note', 2000).nullable()

      // 可选元数据（JSON，如原始响应摘要、future-proof）
      table.json('metadata').nullable()

      // 最近一次观察到外部状态的时间
      table.timestamp('last_observed_at', { useTz: false }).nullable()

      // 创建人/更新人
      table.bigInteger('created_by').unsigned().notNullable()
      table.bigInteger('updated_by').unsigned().notNullable()

      // 审计时间戳
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // ----------------------------------------------------------
      // 索引（Task 2.2）
      // ----------------------------------------------------------

      // 按组织/项目/任务列表查询
      table.index(['organization_id', 'project_id', 'task_id'], 'idx_ext_links_org_proj_task')

      // 按 provider/repository/number 查找（同任务内防重复）
      table.index(
        ['task_id', 'provider', 'repository_owner', 'repository_name', 'external_number'],
        'idx_ext_links_task_provider_repo_num',
      )

      // 搜索友好：按 provider 和状态检索
      table.index(['provider', 'external_status'], 'idx_ext_links_provider_status')

      // 按仓库名称搜索
      table.index(['repository_owner', 'repository_name'], 'idx_ext_links_repo_owner_name')

      // 按外部编号搜索
      table.index(['external_number'], 'idx_ext_links_external_number')

      // 按外部 ID 搜索（GitLab IID ≠ ID）
      table.index(['external_id'], 'idx_ext_links_external_id')

      // 更新人查询
      table.index(['updated_by'], 'idx_ext_links_updated_by')

      // 组织级审计查询
      table.index(['organization_id', 'updated_at'], 'idx_ext_links_org_updated')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
