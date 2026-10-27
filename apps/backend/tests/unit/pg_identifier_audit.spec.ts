import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import {
  auditMigrationSource,
  auditMigrationsDir,
  knexAutoName,
  PG_IDENTIFIER_MAX_BYTES,
  stripComments,
  truncatePgIdentifier,
} from './helpers/pg_identifier_audit.js'

/**
 * v3-docker-compose-runtime-foundation（第七轮）—— PG 63-byte 标识符截断回归门禁。
 *
 * 真实证据：fresh GCP PG 在 1815021000001 exit 1——unique 自动名（74B）与普通索引自动名
 * （73B）截断后同为 `outgoing_webhook_delivery_attempts_delivery_event_id_attempt_nu`。
 * 本 spec 锁定：
 *   1. attempts 表契约：unique 显式短名、无同列冗余普通索引、unique 未被删除；
 *   2. 全仓 migrations 不存在任何截断后碰撞（索引命名空间/外键命名空间，零容忍）；
 *   3. 跨迁移同名重建仅限 SAFE_DUPLICATE_ON_PG（逐项有人工核实的方言守卫证据）；
 *   4. 截断（>63B）但未碰撞的存量标识符冻结于 LEGACY_TRUNCATED_NAMES——
 *      新增任何 >63B 自动名立即失败，修复存量后必须同步移除条目（防 stale）。
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../database/migrations/', import.meta.url))

/**
 * 跨迁移同名但**在 PG 上不会共存**的白名单（逐项核实证据）：
 * - comments_*：1799010000000 用 `CREATE INDEX IF NOT EXISTS` 幂等补建，双方言安全。
 * - reports_*：1784500000000 的 CREATE INDEX 仅在 SQLite 表重建分支执行
 *   （DROP TABLE + RENAME 后旧索引已销毁）；PG 分支只 ALTER CHECK。
 * - ai_draft_layer_sessions_*：1839800000000 / 1990000000003 同为 SQLite 重建分支专用。
 * - plugin_change_requests_*：1940000000002 / 1960000000000 同为 SQLite 重建分支专用。
 */
const SAFE_DUPLICATE_ON_PG = new Set([
  'comments_entity_type_entity_id_index',
  'comments_parent_id_index',
  'reports_project_id_report_type_index',
  'reports_generated_at_index',
  'ai_draft_layer_sessions_organization_id_index',
  'ai_draft_layer_sessions_organization_id_status_index',
  'ai_draft_layer_sessions_compiler_run_id_index',
  'ai_draft_layer_sessions_created_by_user_id_index',
  'plugin_change_requests_organization_id_request_uid_unique',
  'plugin_change_requests_organization_id_state_index',
  'plugin_change_requests_organization_id_plugin_id_index',
  'plugin_change_requests_organization_id_created_at_index',
  'plugin_change_requests_organization_id_expires_at_index',
  // multi_project_dependency_previews_*：1993000000000_widen_mpd_preview_operation_for_delete
  //   用 SQLite 表重建（新建+拷贝+换名）重建全部索引；PG 分支在 ALTER CHECK 后直接 return，
  //   绝不重建索引，故 PG 上不共存。三条 >63B 截断名同时冻结于 LEGACY_TRUNCATED_NAMES。
  'multi_project_dependency_previews_organization_id_index',
  'multi_project_dependency_previews_preview_id_confirmation_hash_',
  'multi_project_dependency_previews_organization_id_expires_at_in',
  'multi_project_dependency_previews_idempotency_key_actor_user_id',
  // wbs_nodes_task_id_unique：1994000000000_make_wbs_task_id_unique_ignore_soft_deleted 方言分流——
  //   PG 先 DROP CONSTRAINT 再建活动行条件唯一索引 uq_wbs_nodes_task_id_active；旧同名仅 SQLite up
  //   与 down 重建，PG 上永不与新对象共存。
  'wbs_nodes_task_id_unique',
  // uq_cs_idempotency：1841000000000 建组织级幂等唯一约束；1997090000000_scope_copilot_session_idempotency_to_actor
  //   的 up 先 dropUnique 旧名再建 uq_cs_actor_idempotency，down 先删新约束再按原名重建旧约束（无损回滚）。
  //   两个同名对象在任何时刻都不共存（PG 与 SQLite 皆然）。
  'uq_cs_idempotency',
])

/** 存量截断（>63B）但**截断后互不碰撞**的标识符冻结清单（第七轮审计快照）。 */
const LEGACY_TRUNCATED_NAMES = new Set([
  'bi_custom_report_definitions_organization_id_owner_actor_id_index',
  'bi_custom_report_definitions_organization_id_scope_visibility_index',
  'change_requests_organization_id_project_id_status_updated_at_index',
  'compiler_codegen_candidate_runs_organization_id_project_id_index',
  'compiler_codegen_stage_records_organization_id_runtime_session_id_index',
  'cross_project_allocation_items_organization_id_target_project_id_index',
  'multi_project_dependencies_organization_id_consumer_project_id_index',
  'multi_project_dependencies_organization_id_freshness_status_index',
  'multi_project_dependencies_organization_id_provider_project_id_index',
  'multi_project_dependency_detection_results_organization_id_created_at_index',
  'multi_project_dependency_detection_results_organization_id_fingerprint_index',
  'multi_project_dependency_detection_results_organization_id_index',
  'multi_project_dependency_detection_results_organization_id_rule_id_index',
  'multi_project_dependency_detection_results_organization_id_run_id_index',
  'multi_project_dependency_detection_results_organization_id_status_index',
  'multi_project_dependency_detection_runs_organization_id_created_at_index',
  'multi_project_dependency_detection_runs_organization_id_status_index',
  'multi_project_dependency_previews_idempotency_key_actor_user_id_index',
  'multi_project_dependency_previews_organization_id_expires_at_index',
  'multi_project_dependency_previews_preview_id_confirmation_hash_index',
  'ocr_entity_link_candidates_organization_id_project_id_status_index',
  'ocr_entity_link_confirmed_links_organization_id_project_id_index',
  'ocr_entity_link_confirmed_links_organization_id_project_id_lifecycle_status_index',
  'ocr_entity_link_runs_organization_id_project_id_input_signature_unique',
  'ocr_structured_extraction_field_candidates_run_id_section_key_field_key_index',
  'ocr_structured_extraction_profile_versions_profile_id_status_index',
  'ocr_structured_extraction_profile_versions_profile_id_version_unique',
  'ocr_structured_extraction_profiles_organization_id_project_id_index',
  'ocr_structured_extraction_profiles_organization_id_scope_status_index',
  'ocr_structured_extraction_profiles_schema_key_organization_id_project_id_unique',
  'ocr_structured_extraction_snapshots_organization_id_project_id_index',
  'ocr_structured_extraction_snapshots_profile_id_source_hash_index',
  'ocr_structured_extraction_table_candidates_run_id_table_key_index',
  'outgoing_webhook_batch_deliveries_organization_id_subscription_id_index',
  'outgoing_webhook_delivery_events_organization_id_idempotency_key_unique',
  'outgoing_webhook_delivery_events_organization_id_subscription_id_index',
  'plugin_event_deliveries_installation_id_subscription_digest_index',
  'plugin_event_deliveries_organization_id_delivery_identity_unique',
  'plugin_fixture_seed_records_organization_id_catalog_id_catalog_version_item_id_unique',
  'plugin_fixture_seed_records_organization_id_catalog_version_index',
  'plugin_permission_decisions_organization_id_correlation_ref_index',
  'plugin_permission_decisions_organization_id_operation_created_at_index',
  'plugin_permission_decisions_organization_id_outcome_created_at_index',
  'plugin_permission_decisions_organization_id_primary_reason_created_at_index',
  'plugin_private_registry_operations_organization_id_idempotency_key_unique',
  'plugin_private_registry_operations_organization_id_target_release_id_index',
  'plugin_private_registry_reviews_organization_id_release_id_index',
  'plugin_runtime_health_events_installation_id_contribution_key_index',
  'plugin_runtime_health_events_organization_id_installation_id_index',
  'plugin_runtime_health_events_organization_id_invocation_id_unique',
  'plugin_runtime_health_snapshots_organization_id_installation_id_contribution_key_unique',
  'pmo_decision_evidence_snapshots_organization_id_collected_at_index',
  'pmo_decision_handoff_receipts_organization_id_case_id_target_idempotency_key_unique',
  'pmo_decision_outcomes_organization_id_case_id_outcome_digest_unique',
  'pmo_decision_positions_organization_id_case_id_participant_id_unique',
  'quality_validation_results_organization_id_capability_surface_created_at_index',
  'resource_capacity_baseline_snapshots_organization_id_loop_id_baseline_digest_unique',
  'resource_capacity_baseline_snapshots_organization_id_loop_id_created_at_index',
  'resource_capacity_handoff_receipts_organization_id_idempotency_hash_unique',
  'resource_capacity_handoff_receipts_organization_id_loop_id_created_at_index',
  'resource_capacity_handoff_receipts_organization_id_selection_id_index',
  'resource_capacity_observation_snapshots_organization_id_loop_id_created_at_index',
  'resource_capacity_reviews_organization_id_loop_id_created_at_index',
  'resource_capacity_reviews_organization_id_observation_snapshot_id_unique',
  'resource_capacity_scenarios_organization_id_loop_id_active_index',
  'resource_capacity_selections_organization_id_loop_id_created_at_index',
  'resource_capacity_selections_organization_id_selection_fingerprint_unique',
  'webhook_deliveries_organization_id_endpoint_id_idempotency_key_unique',
])

describe('pg_identifier_audit 基础算法', () => {
  it('knexAutoName 复刻 knex `_indexCommand` 命名（真实撞名案例）', () => {
    expect(
      knexAutoName(
        'outgoing_webhook_delivery_attempts',
        ['delivery_event_id', 'attempt_number'],
        'unique',
      ),
    ).toBe('outgoing_webhook_delivery_attempts_delivery_event_id_attempt_number_unique')
    expect(
      knexAutoName(
        'outgoing_webhook_delivery_attempts',
        ['delivery_event_id', 'attempt_number'],
        'index',
      ),
    ).toBe('outgoing_webhook_delivery_attempts_delivery_event_id_attempt_number_index')
  })

  it('truncatePgIdentifier 按 63 字节截断，两个自动名截断后相同（复现 GCP 报错）', () => {
    const unique = knexAutoName(
      'outgoing_webhook_delivery_attempts',
      ['delivery_event_id', 'attempt_number'],
      'unique',
    )
    const index = knexAutoName(
      'outgoing_webhook_delivery_attempts',
      ['delivery_event_id', 'attempt_number'],
      'index',
    )
    expect(Buffer.byteLength(unique, 'utf8')).toBe(74)
    expect(Buffer.byteLength(index, 'utf8')).toBe(73)
    expect(truncatePgIdentifier(unique)).toBe(
      'outgoing_webhook_delivery_attempts_delivery_event_id_attempt_nu',
    )
    expect(truncatePgIdentifier(unique)).toBe(truncatePgIdentifier(index))
    // 短名不受影响
    expect(truncatePgIdentifier('uq_owda_event_attempt')).toBe('uq_owda_event_attempt')
  })

  it('stripComments 剥离注释但保留字符串内容', () => {
    const src = [
      "table.unique(['a'], 'uq_x') // table.index(['a','b']) 注释里的写法不应被扫描",
      "/* table.index(['c']) */",
      "const url = 'http://example.com//keep'",
    ].join('\n')
    const clean = stripComments(src)
    expect(clean).not.toContain("table.index(['a','b'])")
    expect(clean).not.toContain("table.index(['c'])")
    expect(clean).toContain('http://example.com//keep')
    expect(clean).toContain("table.unique(['a'], 'uq_x')")
  })

  it('auditMigrationSource 检出合成碰撞对', () => {
    const src = `
      export default class {
        protected tableName = 'outgoing_webhook_delivery_attempts'
        async up() {
          this.schema.createTable(this.tableName, (table) => {
            table.unique(['delivery_event_id', 'attempt_number'])
            table.index(['delivery_event_id', 'attempt_number'])
          })
        }
      }
    `
    const { objects } = auditMigrationSource(src, 'synthetic.ts')
    const names = objects.map((o) => o.truncatedName)
    expect(new Set(names).size).toBeLessThan(names.length)
  })
})

describe('outgoing_webhook_delivery_attempts schema 契约（第七轮回归）', () => {
  const source = readFileSync(
    fileURLToPath(
      new URL(
        '../../database/migrations/1815021000001_create_outgoing_webhook_delivery_attempts_table.ts',
        import.meta.url,
      ),
    ),
    'utf8',
  )
  const { objects } = auditMigrationSource(
    source,
    '1815021000001_create_outgoing_webhook_delivery_attempts_table.ts',
  )
  const tableObjects = objects.filter((o) => o.table === 'outgoing_webhook_delivery_attempts')

  it('unique 保留且使用显式短名 uq_owda_event_attempt（约束未被删除）', () => {
    const unique = tableObjects.find((o) => o.operation === 'unique')
    expect(unique).toBeDefined()
    expect(unique!.columns).toEqual(['delivery_event_id', 'attempt_number'])
    expect(unique!.name).toBe('uq_owda_event_attempt')
    expect(unique!.explicit).toBe(true)
  })

  it('不存在与 unique 同列同序的冗余普通索引（冗余 index 已移除）', () => {
    const redundant = tableObjects.filter(
      (o) => o.operation === 'index' && o.columns.join(',') === 'delivery_event_id,attempt_number',
    )
    expect(redundant).toEqual([])
  })

  it('organization_id 查询索引保留，且本表全部标识符低于 64 字节、互不相同', () => {
    expect(
      tableObjects.some(
        (o) => o.operation === 'index' && o.columns.join(',') === 'organization_id',
      ),
    ).toBe(true)
    const names = tableObjects.map((o) => o.name)
    for (const o of tableObjects) {
      expect(o.byteLength).toBeLessThanOrEqual(PG_IDENTIFIER_MAX_BYTES)
    }
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('全仓 migrations PG 标识符门禁', () => {
  const report = auditMigrationsDir(MIGRATIONS_DIR)

  it('静态解析零遗漏（动态表达式必须人工确认）', () => {
    expect(report.unparsed).toEqual([])
  })

  it('索引命名空间无截断后碰撞（跨迁移同名仅限 SAFE_DUPLICATE_ON_PG）', () => {
    const offenders = report.indexNamespaceCollisions.filter(
      (c) => !SAFE_DUPLICATE_ON_PG.has(c.truncatedName),
    )
    expect(offenders).toEqual([])
  })

  it('外键命名空间无截断后碰撞', () => {
    expect(report.foreignNamespaceCollisions).toEqual([])
  })

  it('超过 63 字节的标识符冻结于 LEGACY_TRUNCATED_NAMES（新增即失败）', () => {
    const unexpected = report.truncated.filter((o) => !LEGACY_TRUNCATED_NAMES.has(o.name))
    expect(unexpected).toEqual([])
  })

  it('allowlist 防 stale：SAFE_DUPLICATE 与 LEGACY 条目必须仍真实存在', () => {
    for (const name of SAFE_DUPLICATE_ON_PG) {
      expect(
        report.indexNamespaceCollisions.some((c) => c.truncatedName === name),
        `SAFE_DUPLICATE_ON_PG 条目已失效：${name}`,
      ).toBe(true)
    }
    for (const name of LEGACY_TRUNCATED_NAMES) {
      expect(
        report.truncated.some((o) => o.name === name),
        `LEGACY_TRUNCATED_NAMES 条目已失效（若已修复请同步移除）：${name}`,
      ).toBe(true)
    }
  })
})
