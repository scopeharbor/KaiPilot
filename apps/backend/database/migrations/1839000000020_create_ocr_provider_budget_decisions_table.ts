/**
 * v3-ocr-provider-observability-cost-controls §3.1 — OCR 预算决策表。
 *
 * 每条预算决策记录组织/项目/作业维度的预算 preflight/postflight 判定结果。
 * 低敏：不存 prompt/output/provider body/API key/full extracted text。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class OcrProviderBudgetDecisionsMigration extends BaseSchema {
  public static readonly tableName = 'ocr_provider_budget_decisions'

  async up() {
    this.schema.createTable(OcrProviderBudgetDecisionsMigration.tableName, (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().notNullable()
      table.integer('ocr_job_id').unsigned().nullable()
      table.integer('page_id').unsigned().nullable()

      table.string('scope', 32).notNullable().defaultTo('job')
      table.string('status', 24).notNullable().defaultTo('allowed')

      table.decimal('estimated_cost', 16, 10).nullable()
      table.string('currency', 8).nullable().defaultTo('USD')
      table.decimal('budget_limit', 16, 10).nullable()
      table.decimal('budget_used', 16, 10).nullable()
      table.string('soft_limit_action', 16).nullable()

      table.json('warning_codes').nullable()
      table.string('idempotency_key', 64).notNullable()
      table.json('metadata').nullable()

      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      // Indexes
      table.index(['organization_id', 'project_id'], 'ocr_budget_decisions_org_proj_idx')
      table.index(['organization_id', 'project_id', 'ocr_job_id'], 'ocr_budget_decisions_job_idx')
      table.index(['status'], 'ocr_budget_decisions_status_idx')
      table.unique(['idempotency_key'], 'ocr_budget_decisions_ik_unique')
    })
  }

  async down() {
    this.schema.dropTableIfExists(OcrProviderBudgetDecisionsMigration.tableName)
  }
}
