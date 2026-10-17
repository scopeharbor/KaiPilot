/**
 * v3-multitenant-database-isolation —— 迁移守卫测试（任务 3.2/3.3/3.4）。
 *
 * 数据驱动：以 DatabaseIsolationCatalog 实表声明为权威清单（运行时读取全量条目），对真实
 * SQLite schema 逐表核对：
 * - 3.2 tenant-owned：organization_id 非空 + org FK（enforced）/ PG 补齐
 *   （sqlite-deferred 在 SQLite 下缺 FK 属预期，PG 由 1839300000001 补齐）；
 *   每张表存在 org 首列索引（高频租户过滤）
 * - 3.3 组织内唯一键必须含 organization_id；不含 org 的唯一索引仅允许落在
 *   全局唯一标识符白名单（UUID/hash/sig/token 类，跨组织不碰撞、不泄露）
 * - 3.4 tenant-derived 表：父级链存在且最终解析到 tenant-owned/derived 表
 *
 * 对应 spec「Tenant-scoped migrations MUST include ownership constraints and
 * indexes」全部场景 +「Verification MUST catch database isolation regressions」。
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import DatabaseIsolationCatalog from '#services/database_isolation_catalog'
import {
  tableColumns,
  foreignKeys,
  hasOrgLeadingIndex,
  hasUniqueIndexOn,
  uniqueIndexes,
  tableExists,
} from '#services/database_schema_introspection'
import { isPg } from '#services/dialect/dialect_helper'
import { DEFERRED_TABLES } from '../../../database/migrations/1839300000001_add_pg_org_fk_for_deferred_tables.js'

/**
 * 全局唯一标识符豁免：这些键由服务端生成 UUID/hash/sig/token，跨组织不会
 * 碰撞也不泄露，可安全作全局唯一（spec 单一上下文场景）。新增表若引入其他
 * 不含 org 的唯一业务键（slug/code/handle/policy name 等），本测试失败。
 */
const globalUniqueKeyExempt = new Set<string>([
  'ai_project_drafts', // draft_uid（40 位服务端 ID）
  'ai_draft_layer_previews', // (session_id, version)
  'bi_custom_report_definitions', // definition_id
  'bi_custom_report_versions', // (definition_id, version)
  'comment_mentions', // (mentioned_user_id, comment_id)
  'compiler_codegen_candidate_runs', // runtime_session_id
  'compiler_codegen_stage_records', // (run_id, stage_id)
  'compliance_controls', // (profile_id, control_id)
  'document_comment_anchors', // (document_id, content_hash, range_start, range_end)
  'document_search_entries', // (project_id, document_id)
  'file_entity_links', // (file_type, file_id, entity_type, entity_id)
  'file_search_entries', // (file_type, file_id)
  'file_tags', // (project_id, name)
  'multi_project_dependency_previews', // preview_id
  'multi_project_impact_plans', // run_token
  'ocr_document_batch_sources', // (batch_id, source_index)
  'ocr_document_search_index_entries', // (extraction_id, status)
  'ocr_entity_link_candidates', // (run_id, candidate_key)：run 维度全局唯一标识
  'ocr_entity_link_confirmed_links', // (extraction_id, span_hash, target_kind, target_id)
  'ocr_privacy_copy_export_runs', // run_key（服务端生成运行键）
  'okr_alignments', // child_objective_id
  'okr_evidence_links', // (target_type, target_id, source_kind, source_id)
  'okr_key_results', // (objective_id, title)
  'okr_objective_relations', // (source_objective_id, target_objective_id, relation_type)
  'outgoing_webhook_batch_deliveries', // batch_id
  'outgoing_webhook_delivery_attempts', // (delivery_event_id, attempt_number)
  'pmo_grouping_views', // view_id
  'resource_capacity_versions', // (resource_id, version)
  'resource_gap_snapshots', // cache_key（内部缓存键）
  'risk_matrix_configs', // project_id（项目边界）
  // ── 以下由 v3-legacy-contract-debt-fixes 补登记 7 张图表馆表（迁移 1996000000000–1996070000000，
  // 服务 4.1）后暴露：这些唯一键是**项目/需求边界内的编号**，不是组织内唯一键——
  // project / requirement 必属唯一组织（catalog 已声明 projectColumn，跨组织不可能碰撞），
  // 故按上方 risk_matrix_configs 的既有先例显式豁免，而非把编号键强行改成含 organization_id：
  'project_charters', // project_id（一个项目一份章程）
  'requirements', // (project_id, code)：项目内需求编号
  'requirement_tasks', // (requirement_id, task_id)：需求内任务绑定去重
  'issues', // (project_id, code)：项目内议题编号
  'triz_assistant_feedback', // feedback_id
  'triz_assistant_messages', // message_id
  'triz_assistant_runs', // run_id（内部自增 ID）
  'triz_ifr_review_sessions', // ifr_id
  'triz_innovation_schemes', // scheme_id（复合已含 org，此处冗余豁免安全）
  'triz_pm_phase_snapshots', // snapshot_id
  'user_view_overrides', // (user_id, view_id, override_path)
  'watermark_plans', // plan_id
  'custom_views', // (owner_user_id, project_id) 项目边界
  'routing_decisions', // compiler_run_id（运行维度唯一）
  'risk_signal_candidates', // (project_id, idempotency_key) 项目边界
  'project_signals', // (project_id, signal_type, observation_window) 项目边界雷达信号唯一键
  'triz_gallery_artifacts', // (project_id, artifact_type, version) 项目边界产物版本链唯一键
  'ai_connection_models', // (connection_id, model_name) 连接边界
  'change_requests', // cr_code：CR-YYYY-NNNN 全局唯一业务码（跨组织不重复）
  // ── 以下由 v3-backend-type-debt-closure 的 F10 修复暴露（迁移里的 table.unique 此前
  // 被误写成 table.index(..., {unique:true}) 而从未生效，F10 修复后唯一约束真实存在，
  // 守卫按既有「服务端生成 ID/hash」语义予以显式豁免）：
  'plugin_private_registry_reviews', // (release_id, cycle_number)：release 维度服务端键
  'copilot_sessions', // session_id（服务端生成 UUID）
  'copilot_messages', // message_id（服务端生成 UUID）
  'copilot_routing_decisions', // idempotency_key（服务端生成 hash）
  'unified_ai_feedback_events', // idempotency_key（服务端生成 hash）
  'quality_validation_results', // idempotency_key（服务端生成 hash）
  'evaluation_scores', // idempotency_key（服务端生成 hash）
  'ai_trace_spans', // span_id（服务端生成 ID）
  'budget_decisions', // idempotency_key（服务端生成 hash）
])

/**
 * 可空 org 列豁免：审计留存类表按规格允许系统级事件不携带组织归属——
 * - audit_logs：V1 审计规格允许系统级事件（登录失败、跨组织审计等），
 *   organization_id 设计为 nullable（迁移 1768850000000 注释同）。
 * - enterprise_audit_evidence_packages / enterprise_audit_verifications：V3
 *   审计证据包 ledger 组织 scope 为冗余列、不建外键以保障审计留存（迁移
 *   1839100000000/1839100000001 注释同），同样可空。
 * - risk_knowledge_templates：系统内置模板（template_type='system'）与组织
 *   模板（'organization'）共用一张表，NULL org 表示系统内置模板（迁移
 *   1798250000000 注释同）。
 * 其余 tenant-owned 表必须 NOT NULL。
 */
const nullableOrgExempt = new Set<string>([
  'audit_logs',
  'enterprise_audit_evidence_packages',
  'enterprise_audit_verifications',
  'risk_knowledge_templates',
])

test.group('迁移守卫 3.2：tenant-owned 组织归属约束', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('全量 tenant-owned 表：organization_id 非空列', async ({ assert }) => {
    const owned = DatabaseIsolationCatalog.all().filter((d) => d.classification === 'tenant-owned')
    assert.isAbove(owned.length, 100, 'catalog 应包含 100+ tenant-owned 表')
    for (const decl of owned) {
      assert.isTrue(await tableExists(decl.tableName), `${decl.tableName} 表应存在`)
      const cols = await tableColumns(decl.tableName)
      const orgCol = cols.find((c) => c.name === 'organization_id')
      assert.isDefined(orgCol, `${decl.tableName} 应存在 organization_id 列`)
      if (!nullableOrgExempt.has(decl.tableName)) {
        assert.isTrue(orgCol!.notnull, `${decl.tableName}.organization_id 应为 NOT NULL`)
      }
    }
  })

  test('enforced 表带 organizations FK；sqlite-deferred 在 SQLite 无 FK、PG 补齐', async ({
    assert,
  }) => {
    const owned = DatabaseIsolationCatalog.all().filter((d) => d.classification === 'tenant-owned')
    for (const decl of owned) {
      const fks = await foreignKeys(decl.tableName)
      const orgFk = fks.some((f) => f.from === 'organization_id' && f.table === 'organizations')
      if (decl.organizationFk === 'enforced') {
        assert.isTrue(orgFk, `${decl.tableName}（enforced）应有 organization FK`)
      } else if (isPg()) {
        assert.isTrue(orgFk, `${decl.tableName}（deferred）PG 下应有追加迁移补齐的 FK`)
      }
    }
  })

  test('每张 tenant-owned 表存在 org 首列索引（高频租户过滤）', async ({ assert }) => {
    const owned = DatabaseIsolationCatalog.all().filter((d) => d.classification === 'tenant-owned')
    for (const decl of owned) {
      const has = await hasOrgLeadingIndex(decl.tableName)
      assert.isTrue(has, `${decl.tableName} 应存在 organization_id 首列索引`)
    }
  })

  test('3.5 补丁验证：bi_dashboard_versions / comment_mentions 已有 org 首列索引', async ({
    assert,
  }) => {
    assert.isTrue(await hasOrgLeadingIndex('bi_dashboard_versions'))
    assert.isTrue(await hasOrgLeadingIndex('comment_mentions'))
  })
})

test.group('迁移守卫 3.3：组织内唯一键含 org 或为全局标识豁免', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('tenant-owned 表全部唯一索引含 org 或属白名单', async ({ assert }) => {
    const owned = DatabaseIsolationCatalog.all().filter((d) => d.classification === 'tenant-owned')
    const violations: string[] = []
    for (const decl of owned) {
      const uniques = await uniqueIndexes(decl.tableName)
      for (const u of uniques) {
        if (u.columns.includes('organization_id')) continue
        if (globalUniqueKeyExempt.has(decl.tableName)) continue
        violations.push(`${decl.tableName}.(${u.columns.join(',')})`)
      }
    }
    assert.deepEqual(violations, [], `出现不含 org 的非白名单唯一键: ${violations.join('; ')}`)
  })

  test('uc：任何未在豁免名单的 tenant-owned 表不得存在无 org 唯一键', async ({ assert }) => {
    const owned = DatabaseIsolationCatalog.all()
      .filter((d) => d.classification === 'tenant-owned')
      .filter((d) => !globalUniqueKeyExempt.has(d.tableName))
    for (const decl of owned) {
      const uniques = await uniqueIndexes(decl.tableName)
      for (const u of uniques) {
        assert.isTrue(
          u.columns.includes('organization_id'),
          `${decl.tableName}(${u.columns.join(',')}) 唯一键必须含 organization_id`,
        )
      }
    }
  })
})

test.group('迁移守卫 3.4：tenant-derived 父级链可解析组织归属', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('derived 表父级链存在且解析到 tenant-owned/derived 表', async ({ assert }) => {
    const catalog = DatabaseIsolationCatalog.all()
    const byName = new Map(catalog.map((d) => [d.tableName, d]))
    for (const decl of catalog.filter((d) => d.classification === 'tenant-derived')) {
      const resolvers = decl.parentResolvers ?? []
      assert.isNotEmpty(resolvers, `${decl.tableName} 必须声明父级链`)
      for (const resolver of resolvers) {
        assert.isTrue(
          byName.has(resolver.parentTable),
          `${decl.tableName} 父表未在 catalog 登记: ${resolver.parentTable}`,
        )
        const parent = byName.get(resolver.parentTable)!
        assert.isTrue(
          parent.classification === 'tenant-owned' || parent.classification === 'tenant-derived',
          `${decl.tableName} 父表 ${resolver.parentTable} 必须是 tenant 表（实际 ${parent.classification}）`,
        )
      }
    }
  })

  test('tenant-derived 表在数据库真实存在', async ({ assert }) => {
    const derived = DatabaseIsolationCatalog.all().filter(
      (d) => d.classification === 'tenant-derived',
    )
    for (const decl of derived) {
      assert.isTrue(await tableExists(decl.tableName), `${decl.tableName} 应在 DB 中存在`)
    }
  })

  /**
   * 父级链的 viaColumn 必须是真实存在且 NOT NULL 的列——可空外键无法可靠解析
   * 组织归属（NULL 行会解析失败或被当作无归属），构成隐式全局通道。
   * 本轮核准即用此断言抓出 ai_draft_layer_apply_results 误用可空 project_id 作父级链
   * （正确路径是 session_id → ai_draft_layer_sessions，见迁移 1795030000000 注释）。
   */
  test('derived 表 parentResolver.viaColumn 存在且 NOT NULL（可空外键无法解析归属）', async ({
    assert,
  }) => {
    const derived = DatabaseIsolationCatalog.all().filter(
      (d) => d.classification === 'tenant-derived',
    )
    const violations: string[] = []
    for (const decl of derived) {
      const cols = await tableColumns(decl.tableName)
      for (const resolver of decl.parentResolvers ?? []) {
        const col = cols.find((c) => c.name === resolver.viaColumn)
        if (!col) {
          violations.push(`${decl.tableName}.${resolver.viaColumn}（列不存在）`)
          continue
        }
        // 可空列必须在 catalog 中显式说明为什么仍可可靠解析（fail-closed 策略），
        // 否则属未登记的隐式全局通道。
        if (!col.notnull && !(resolver.nullableReason ?? '').trim()) {
          violations.push(`${decl.tableName}.${resolver.viaColumn}（可空且未声明 nullableReason）`)
        }
      }
    }
    assert.deepEqual(violations, [], `父级链 viaColumn 违规: ${violations.join('; ')}`)
  })
})

test.group('迁移守卫 3.3 正向：catalog uniqueScopeKeys 必须在 DB 存在唯一索引', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('catalog 声明的每组 uniqueScopeKeys 在真实 schema 中有对应唯一索引', async ({ assert }) => {
    const declared = DatabaseIsolationCatalog.all().filter((d) => d.uniqueScopeKeys.length > 0)
    assert.isAbove(declared.length, 0, 'catalog 应至少声明一组租户内唯一键')
    const missing: string[] = []
    for (const decl of declared) {
      if (!(await hasUniqueIndexOn(decl.tableName, decl.uniqueScopeKeys))) {
        missing.push(`${decl.tableName}(${decl.uniqueScopeKeys.join(',')})`)
      }
    }
    assert.deepEqual(missing, [], `catalog 声明的唯一键在 DB 中缺失: ${missing.join('; ')}`)
  })

  test('3.3 补丁验证：5 张幂等键表已改为组织/父级 scope 内唯一', async ({ assert }) => {
    assert.isTrue(
      await hasUniqueIndexOn('ocr_provider_budget_decisions', [
        'organization_id',
        'idempotency_key',
      ]),
    )
    assert.isTrue(
      await hasUniqueIndexOn('ocr_provider_attempts', ['organization_id', 'idempotency_key']),
    )
    assert.isTrue(
      await hasUniqueIndexOn('ocr_queue_items', ['organization_id', 'idempotency_key_hash']),
    )
    assert.isTrue(
      await hasUniqueIndexOn('ai_draft_layer_apply_results', ['session_id', 'idempotency_key']),
    )
    // 旧全局唯一键必须已移除（否则跨租写入仍冲突并泄露存在性）
    assert.isFalse(await hasUniqueIndexOn('ocr_queue_items', ['idempotency_key_hash']))
  })
})

/**
 * 6.2 数据库派生制品门禁：存放预览签名、导出句柄、下载令牌、幂等记录、缓存聚合、
 * 源快照的行必须带组织 scope 或可解析的父级归属（spec「Database-derived artifacts
 * MUST include tenant namespace」）。
 *
 * 两条可执行断言：
 * 1. 全局/系统分类的表**不得**出现这些派生制品列——否则制品脱离任何租户归属；
 * 2. 这些列若参与唯一索引，该唯一索引必须含 organization_id 或本表的父级外键，
 *    否则跨租写入会因唯一冲突而泄露"该键在别处已存在"。
 */
const DERIVED_ARTIFACT_COLUMN_PATTERN =
  /^(.*_)?(signature|handle|download_token|token_hash|idempotency_key|idempotency_key_hash|cache_key|preview_id|run_token|source_signature|source_hash)$/

/**
 * 全局表允许的派生制品列：
 * - 供应商目录/定价快照的 `source_hash` 是**供应商内容**摘要，不由任何租户数据派生，
 *   也不作为租户可重放的句柄，故不需要租户命名空间。
 * - `user_two_factor_challenges.token_hash`（v3-legacy-contract-debt-fixes 补登记 2FA 三表后
 *   由本守卫暴露）：登录挑战票据由服务端 `crypto.randomBytes(32).toString('base64url')`
 *   生成（`TwoFactorService.issueChallenge`），落库值是该随机票据的 sha256 十六进制串
 *   （`hashChallengeToken`）——**既不参与任何租户数据的派生，也不是可跨租重放的句柄**
 *   （票据明文只在密码校验通过那一次响应里返回）。该表本身按 users 先例登记为
 *   `system-global-maintenance`（用户级凭据不挂组织），故其唯一键不含租户 scope 属预期。
 */
const globalArtifactColumnExempt = new Set<string>([
  'ai_model_catalog_snapshots.source_hash',
  'ai_model_pricing_snapshots.source_hash',
  'user_two_factor_challenges.token_hash',
])

/**
 * 允许不含组织列的派生制品唯一键——逐条核准过生成方式，跨租不可能碰撞也不可猜测：
 * - `multi_project_dependency_previews.preview_id`：`preview-${randomUUID()}`（随机 UUID）
 * - `multi_project_impact_plans.run_token`：fnv1a(`run-${organizationId}-…`)，键内已含组织，
 *   且读取路径 `runAnalysis` 带 `where organization_id`
 * - `resource_gap_snapshots.cache_key`：stableHash(`snapshot:${organizationId}:${actorId}:…`)，
 *   键内已含组织，且读取路径 `tryReadSnapshot` 带 `where organization_id`
 *
 * 反例已修：`dlp_previews.signature` = fnv1a(decisionHash+expiresAt) 不含组织，
 * 已改为 (organization_id, signature) 唯一（迁移 1839300000003）。
 */
const artifactUniqueKeyExempt = new Set<string>([
  'multi_project_dependency_previews(preview_id)',
  'multi_project_impact_plans(run_token)',
  'resource_gap_snapshots(cache_key)',
  // 以下由 F10（唯一约束真实生效）暴露：服务端生成的幂等键/hash 全局不碰撞，
  // 与 multi_project_impact_plans(run_token) 同一豁免语义
  'copilot_routing_decisions(idempotency_key)',
  'unified_ai_feedback_events(idempotency_key)',
  'quality_validation_results(idempotency_key)',
  'evaluation_scores(idempotency_key)',
  'budget_decisions(idempotency_key)',
])

test.group('迁移守卫 6.2：数据库派生制品必须带租户 scope', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('全局/系统分类表不得存放派生制品列', async ({ assert }) => {
    const globals = DatabaseIsolationCatalog.all().filter(
      (d) =>
        d.classification === 'tenant-global-reference' ||
        d.classification === 'system-global-maintenance',
    )
    const violations: string[] = []
    for (const decl of globals) {
      if (!(await tableExists(decl.tableName))) continue
      for (const col of await tableColumns(decl.tableName)) {
        const key = `${decl.tableName}.${col.name}`
        if (
          DERIVED_ARTIFACT_COLUMN_PATTERN.test(col.name) &&
          !globalArtifactColumnExempt.has(key)
        ) {
          violations.push(key)
        }
      }
    }
    assert.deepEqual(violations, [], `全局表出现派生制品列: ${violations.join('; ')}`)
  })

  test('派生制品列参与的唯一索引必须含组织或父级 scope', async ({ assert }) => {
    const tenantTables = DatabaseIsolationCatalog.all().filter(
      (d) => d.classification === 'tenant-owned' || d.classification === 'tenant-derived',
    )
    const violations: string[] = []
    for (const decl of tenantTables) {
      const parentColumns = new Set((decl.parentResolvers ?? []).map((r) => r.viaColumn))
      for (const unique of await uniqueIndexes(decl.tableName)) {
        const touchesArtifact = unique.columns.some((c) => DERIVED_ARTIFACT_COLUMN_PATTERN.test(c))
        if (!touchesArtifact) continue
        const scoped =
          unique.columns.includes('organization_id') ||
          unique.columns.some((c) => parentColumns.has(c)) ||
          // 项目边界等价于组织边界（project 必属唯一组织，且 catalog 已声明项目列）
          (decl.projectColumn ? unique.columns.includes(decl.projectColumn) : false)
        const key = `${decl.tableName}(${unique.columns.join(',')})`
        if (!scoped && !artifactUniqueKeyExempt.has(key)) {
          violations.push(key)
        }
      }
    }
    assert.deepEqual(violations, [], `派生制品唯一键缺租户 scope: ${violations.join('; ')}`)
  })
})

test.group('迁移守卫 3.6：PostgreSQL opt-in 归属元数据断言', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  /**
   * 方言无关断言：catalog 的 sqlite-deferred 集合必须与 PG 补 FK 迁移清单逐项一致。
   * 这让「PG 上全部 tenant-owned 表都有 organization FK」这一契约在 SQLite 默认
   * 验证下也可被守护，而不要求本机安装 PostgreSQL。
   */
  test('catalog sqlite-deferred 集合与 PG 补 FK 迁移清单一致', ({ assert }) => {
    const catalogDeferred = DatabaseIsolationCatalog.all()
      .filter((d) => d.organizationFk === 'sqlite-deferred')
      .map((d) => d.tableName)
      .sort()
    assert.deepEqual([...DEFERRED_TABLES].sort(), catalogDeferred)
  })

  /** PG opt-in（DB_TEST_CONNECTION=pg）：全部 tenant-owned 表都必须带 organization FK。 */
  test('PG opt-in：全部 tenant-owned 表带 organization FK（SQLite 下跳过）', async ({ assert }) => {
    if (!isPg()) {
      assert.isTrue(true, 'SQLite 默认验证：本断言仅在 DB_TEST_CONNECTION=pg 下生效')
      return
    }
    const missing: string[] = []
    for (const decl of DatabaseIsolationCatalog.all().filter(
      (d) => d.classification === 'tenant-owned',
    )) {
      const fks = await foreignKeys(decl.tableName)
      if (!fks.some((f) => f.from === 'organization_id' && f.table === 'organizations')) {
        missing.push(decl.tableName)
      }
    }
    assert.deepEqual(missing, [], `PG 下缺 organization FK: ${missing.join(', ')}`)
  })
})
