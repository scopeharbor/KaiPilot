/**
 * v3-multitenant-database-isolation —— PG-only 补齐 69 张 sqlite-deferred 表
 * organization_id 外键（任务 3.5 / 3.6）。
 *
 * 背景（design Decision 5）：SQLite ALTER TABLE 不支持补 FK，故 catalog 中
 * organizationFk='sqlite-deferred' 的表在 SQLite 下保持"列 + org 索引"契约，
 * FK 由本迁移在 PostgreSQL 上补齐，使 PG 达到"全部 tenant-owned 表带 FK"。
 *
 * 本迁移只对 PG 生效（dialect 分支）；SQLite 直接空跑，保证两端迁移兼容。
 * 表清单来自 database_isolation_catalog（catalog 事实源，2026-08-08 dump），
 * 与 catalog 的 69 张 deferred 表一一对应；追加时如与 catalog 失配，guard
 * 测试（3.6 PG opt-in 断言）会失败以强制同步。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/** knex PG dialect 名称判定（'postgres' / 'redshift' 均为 PG 系）。 */
export function isPgDialect(name: string): boolean {
  return name === 'postgres' || name === 'redshift'
}

/**
 * 导出供守卫测试（3.6 PG opt-in 断言）与 catalog 的 sqlite-deferred 集合逐项比对，
 * 任一侧新增/删除未同步即测试失败。Adonis 迁移加载只使用 default export，
 * 额外具名导出不影响迁移执行。
 */
export const DEFERRED_TABLES: ReadonlyArray<string> = [
  'unified_ai_invocation_ledger', // v3-backend-type-debt-closure：创建迁移未声明 org FK，登记为 deferred
  'unified_ai_feedback_events', // 同上：创建迁移未声明 org FK
  'evaluation_scores', // 同上
  'ai_trace_spans', // 同上
  'budget_decisions', // 同上
  'rate_limit_decisions', // 同上
  'copilot_session_retention_policies', // 同上
  'copilot_session_retention_tombstones', // 同上
  'copilot_session_retention_deletion_records', // 同上
  'copilot_session_retention_cleanup_runs', // 同上
  'audit_logs',
  'bi_custom_report_definitions',
  'bi_custom_report_versions',
  'bi_dashboard_definitions',
  'bi_dashboard_versions',
  'compiler_codegen_candidate_runs',
  'compiler_codegen_stage_records',
  'compiler_config_profiles',
  'compiler_skills',
  'custom_views',
  'document_search_entries',
  'knowledge_items',
  'multi_project_impact_plans',
  'multi_project_impact_snapshots',
  'notifications',
  'ocr_document_batch_sources',
  'ocr_document_batches',
  'ocr_document_jobs',
  'ocr_document_search_index_entries',
  'ocr_document_search_index_runs',
  'ocr_entity_link_candidates',
  'ocr_entity_link_confirmed_links',
  'ocr_entity_link_runs',
  'ocr_privacy_copy_export_runs',
  'ocr_privacy_policy_overrides',
  'ocr_provider_attempts',
  'ocr_provider_budget_decisions',
  'ocr_queue_items',
  'ocr_structured_extraction_profiles',
  'ocr_structured_extraction_runs',
  'ocr_structured_extraction_snapshots',
  'organization_dashboard_layouts',
  'outgoing_webhook_delivery_attempts',
  'pmo_ai_priority_recommendations',
  'pmo_grouping_views',
  'portfolio_traffic_light_review_markers',
  'project_prediction_snapshots',
  'project_recommendation_events',
  'project_recommendations',
  'report_exports',
  'report_jobs',
  'report_templates',
  'report_versions',
  'resource_availability_exceptions',
  'resource_capacity_versions',
  'skill_effect_events',
  'skill_eval_reports',
  'skill_eval_runs',
  'task_external_links',
  'task_resource_requirements',
  'triz_ifr_review_sessions',
  'user_view_overrides',
  // 实验与版本域（1997040000000）：创建迁移未声明 org FK，由 1997050000000 对账迁移在 PG 补齐
  'ai_prompt_versions',
  'ai_offline_regression_cases',
  'ai_offline_regression_runs',
  'ai_shadow_experiments',
  'ai_shadow_runs',
]

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (!result || typeof result !== 'object') return []
  const rows = (result as { rows?: unknown }).rows
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []
}

/**
 * 为当前已经存在的 sqlite-deferred 表补 organization_id FK。
 *
 * 1839300000001 的时间戳早于部分后来追加的建表迁移。fresh PG 按文件名顺序运行时，
 * 这些表此刻尚不存在；`'public.table'::regclass` 会直接抛 relation does not exist，
 * 令整批 migration fail。这里改用不会抛错的 `to_regclass(text)` 先检查表存在性，
 * 缺表安全跳过；迁移序列末尾的 reconciliation migration 会在全部建表完成后补齐。
 */
export async function addMissingDeferredOrganizationFks(
  db: QueryClientContract,
  tables: ReadonlyArray<string> = DEFERRED_TABLES,
): Promise<void> {
  for (const table of tables) {
    if (!/^[a-z0-9_]+$/.test(table)) {
      throw new Error(`Invalid deferred table identifier: ${table}`)
    }

    const relationName = `public.${table}`
    const relation = await db.rawQuery('SELECT to_regclass(?) AS table_oid', [relationName])
    if (!rowsOf(relation)[0]?.table_oid) continue

    const constraint = `fk_${table}_organization`
    const existing = await db.rawQuery(
      'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = to_regclass(?)',
      [constraint, relationName],
    )
    if (rowsOf(existing).length > 0) continue

    await db.rawQuery(
      `ALTER TABLE "public"."${table}"
       ADD CONSTRAINT "${constraint}"
       FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
       ON DELETE CASCADE`,
    )
  }
}

export default class extends BaseSchema {
  async up() {
    // knex 的 PG dialect name 是 'postgres'（不是 'pg'——'pg' 只是 Lucid 连接名）。
    // 原写法 `!== 'pg'` 在 PostgreSQL 上同样成立，导致本迁移在 PG 下也直接 return，
    // 69 张 sqlite-deferred 表的 FK 从未补齐（核准 2026-08-09 修复）。
    if (!isPgDialect(this.db.dialect.name)) {
      // SQLite：ALTER TABLE 不支持补 FK，契约保持 sqlite-deferred
      return
    }

    await addMissingDeferredOrganizationFks(this.db)
  }

  async down() {
    if (!isPgDialect(this.db.dialect.name)) return
    for (const table of DEFERRED_TABLES) {
      // 与 up() 对称：回滚到本迁移时较晚建表可能已被其自身 down 删除，
      // 直接 ALTER 缺失表会抛 relation does not exist，用 to_regclass 先检查后跳过。
      const relation = await this.db.rawQuery('SELECT to_regclass(?) AS table_oid', [
        `public.${table}`,
      ])
      if (!rowsOf(relation)[0]?.table_oid) continue
      await this.db.rawQuery(
        `ALTER TABLE "public"."${table}" DROP CONSTRAINT IF EXISTS "fk_${table}_organization"`,
      )
    }
  }
}
