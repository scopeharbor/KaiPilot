/**
 * v3-ai-quality-console-experiments-real D3 —— AI 实验与版本域持久化表（5 张）。
 *
 * 用户 2026-09-17 授权真实建设（废止「设计性延期」）：
 * - ai_prompt_versions：Prompt 版本注册表（同 promptKey 至多一个 active，由服务层事务保证）；
 * - ai_offline_regression_cases / ai_offline_regression_runs：离线回归案例与运行记录；
 * - ai_shadow_experiments / ai_shadow_runs：影子/AB 实验与单次对比运行记录。
 *
 * 纪律：
 * - 全部表 organization_id 组织隔离 + 常用查询索引；
 * - 低敏红线沿用统一账本约定：不存 API key/Authorization/完整对话载荷；输出以摘要/hash 表达；
 * - 方言兼容：Lucid/knex 可移植 API（SQLite 与 PG 双跑）。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class AiExperimentTables extends BaseSchema {
  async up() {
    // ── Prompt 版本注册表 ──
    this.schema.createTable('ai_prompt_versions', (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.string('prompt_key', 128).notNullable()
      table.integer('version').unsigned().notNullable()
      table.text('content').notNullable()
      table.string('status', 16).notNullable().defaultTo('draft')
      table.text('changelog').nullable()
      table.integer('created_by').unsigned().nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.unique(['organization_id', 'prompt_key', 'version'], {
        indexName: 'prompt_versions_org_key_version_unique',
      })
      table.index(['organization_id', 'prompt_key'], 'prompt_versions_org_key_idx')
    })

    // ── 离线回归案例 ──
    this.schema.createTable('ai_offline_regression_cases', (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.string('prompt_key', 128).notNullable()
      table.string('case_key', 128).notNullable()
      table.text('input').notNullable()
      table.text('expected_contains').nullable()
      table.text('expected_pattern').nullable()
      table.boolean('enabled').notNullable().defaultTo(true)
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.unique(['organization_id', 'prompt_key', 'case_key'], {
        indexName: 'regression_cases_org_key_case_unique',
      })
      table.index(['organization_id', 'prompt_key'], 'regression_cases_org_key_idx')
    })

    // ── 离线回归运行 ──
    this.schema.createTable('ai_offline_regression_runs', (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.string('prompt_key', 128).notNullable()
      table.integer('prompt_version_id').unsigned().nullable()
      table.string('model', 128).nullable()
      table.string('status', 16).notNullable().defaultTo('running')
      table.boolean('dry_run').notNullable().defaultTo(true)
      table.integer('total').unsigned().notNullable().defaultTo(0)
      table.integer('passed').unsigned().notNullable().defaultTo(0)
      table.integer('failed').unsigned().notNullable().defaultTo(0)
      table.float('pass_rate').nullable()
      table.integer('duration_ms').unsigned().nullable()
      table.integer('created_by').unsigned().nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.index(
        ['organization_id', 'prompt_key', 'created_at'],
        'regression_runs_org_key_created_idx',
      )
    })

    // ── 影子/AB 实验 ──
    this.schema.createTable('ai_shadow_experiments', (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.string('name', 128).notNullable()
      table.string('capability', 64).notNullable().defaultTo('general')
      table.integer('control_prompt_version_id').unsigned().nullable()
      table.string('control_model', 128).nullable()
      table.integer('variant_prompt_version_id').unsigned().nullable()
      table.string('variant_model', 128).nullable()
      table.integer('traffic_percent').unsigned().notNullable().defaultTo(0)
      table.string('status', 16).notNullable().defaultTo('draft')
      table.integer('created_by').unsigned().nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.index(['organization_id', 'status'], 'shadow_experiments_org_status_idx')
    })

    // ── 影子运行记录 ──
    this.schema.createTable('ai_shadow_runs', (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('experiment_id').unsigned().notNullable()
      table.string('input_hash', 64).nullable()
      table.text('control_output_summary').nullable()
      table.text('variant_output_summary').nullable()
      table.integer('control_latency_ms').unsigned().nullable()
      table.integer('variant_latency_ms').unsigned().nullable()
      table.decimal('control_cost', 16, 10).nullable()
      table.decimal('variant_cost', 16, 10).nullable()
      table.boolean('dry_run').notNullable().defaultTo(true)
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.index(
        ['organization_id', 'experiment_id', 'created_at'],
        'shadow_runs_org_exp_created_idx',
      )
    })
  }

  async down() {
    this.schema.dropTableIfExists('ai_shadow_runs')
    this.schema.dropTableIfExists('ai_shadow_experiments')
    this.schema.dropTableIfExists('ai_offline_regression_runs')
    this.schema.dropTableIfExists('ai_offline_regression_cases')
    this.schema.dropTableIfExists('ai_prompt_versions')
  }
}
