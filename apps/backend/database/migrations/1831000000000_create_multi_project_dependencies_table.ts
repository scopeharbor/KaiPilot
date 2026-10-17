import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * multi_project_dependencies 表：组织级跨项目依赖事实
 * v3-multi-project-dependency-model / §2.1
 *
 * - organization_id 强制组织隔离
 * - provider 和 consumer 端点可以是 project/milestone/task/external
 * - 独立于 task_dependencies，不改变项目内依赖行为
 * - 写入走预览/确认流程
 */
export default class extends BaseSchema {
  protected tableName = 'multi_project_dependencies'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织隔离
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // === provider 端点（上游/前置） ===
      table.string('provider_endpoint_type', 20).notNullable()
      table.check("provider_endpoint_type IN ('project','milestone','task','external')")
      table
        .bigInteger('provider_project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')
      table
        .bigInteger('provider_milestone_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('milestones')
        .onDelete('SET NULL')
      table
        .bigInteger('provider_task_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('tasks')
        .onDelete('SET NULL')
      table.string('provider_external_label', 255).nullable()
      table.string('provider_external_key', 255).nullable()

      // === consumer 端点（下游/后继） ===
      table.string('consumer_endpoint_type', 20).notNullable()
      table.check("consumer_endpoint_type IN ('project','milestone','task','external')")
      table
        .bigInteger('consumer_project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')
      table
        .bigInteger('consumer_milestone_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('milestones')
        .onDelete('SET NULL')
      table
        .bigInteger('consumer_task_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('tasks')
        .onDelete('SET NULL')
      table.string('consumer_external_label', 255).nullable()
      table.string('consumer_external_key', 255).nullable()

      // === 依赖核心属性 ===
      table.string('category', 30).notNullable().defaultTo('deliverable')
      table.check("category IN ('deliverable','milestone','technical','resource','external')")
      table.string('type', 2).notNullable().defaultTo('fs')
      table.check("type IN ('fs','ss','ff','sf')")
      table.integer('lag_days').notNullable().defaultTo(0)
      table.string('strength', 10).notNullable().defaultTo('hard')
      table.check("strength IN ('hard','soft','advisory')")
      table.integer('buffer_days').notNullable().defaultTo(0)

      // === 生命周期与风险 ===
      table.string('status', 20).notNullable().defaultTo('draft')
      table.check("status IN ('draft','active','at_risk','blocked','resolved','archived')")
      table.string('risk_level', 10).notNullable().defaultTo('medium')
      table.check("risk_level IN ('critical','high','medium','low','none')")

      // === 负责人与来源 ===
      table
        .bigInteger('owner_user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('source_mode', 20).notNullable().defaultTo('manual')
      table.check("source_mode IN ('manual','rule_suggestion','ai_suggestion')")
      table.bigInteger('source_suggestion_id').unsigned().nullable()

      // === 低敏证据（JSON） ===
      table.json('evidence_refs').nullable()

      // === 新鲜度 ===
      table.string('freshness_signature', 64).notNullable()
      table.timestamp('freshness_checked_at').nullable()
      table.string('freshness_status', 10).notNullable().defaultTo('fresh')
      table.check("freshness_status IN ('fresh','stale','unknown')")

      // === 审计与幂等 ===
      table.string('confirmation_hash', 64).nullable()
      table.string('idempotency_key', 64).nullable()

      // === 时间戳 ===
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.timestamp('archived_at').nullable()

      // === 索引与约束 ===
      // 组织级查询
      table.index(['organization_id'])
      // 按项目查找相关依赖（provider 或 consumer）
      table.index(['organization_id', 'provider_project_id'])
      table.index(['organization_id', 'consumer_project_id'])
      // 端点类型组合索引（显式短名：自动名 71 字节超 PG 63-byte 上限，且与下方
      // provider/consumer 组合索引截断后撞名——v3-docker-compose-runtime-foundation 第七轮审计）
      table.index(['organization_id', 'provider_endpoint_type'], 'idx_mpd_org_provider_ep')
      table.index(['organization_id', 'consumer_endpoint_type'], 'idx_mpd_org_consumer_ep')
      // 状态和风险查询
      table.index(['organization_id', 'status'])
      table.index(['organization_id', 'risk_level'])
      // 新鲜度查询
      table.index(['organization_id', 'freshness_status'])
      // 组织内去重：同一对端点+类型+类别的活跃依赖
      // （自动名 233 字节，截断后与端点类型索引撞名 → 显式短名）
      table.index(
        [
          'organization_id',
          'provider_endpoint_type',
          'provider_project_id',
          'provider_task_id',
          'provider_external_key',
          'consumer_endpoint_type',
          'consumer_project_id',
          'consumer_task_id',
          'consumer_external_key',
          'type',
          'category',
          'status',
        ],
        'idx_mpd_dedupe_full',
      )
      // 图谱遍历：按 provider/consumer 快速查找（自动名 98 字节，同上显式短名）
      table.index(
        ['organization_id', 'provider_endpoint_type', 'provider_project_id', 'status'],
        'idx_mpd_provider_lookup',
      )
      table.index(
        ['organization_id', 'consumer_endpoint_type', 'consumer_project_id', 'status'],
        'idx_mpd_consumer_lookup',
      )
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
