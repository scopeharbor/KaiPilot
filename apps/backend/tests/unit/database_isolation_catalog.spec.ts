// v3-multitenant-database-isolation §2/R2 —— DatabaseIsolationCatalog 校验测试（任务 2.6）。
// 覆盖：validate() 全量通过；分类合法；tenant-owned 必带组织列与 FK 契约；
// tenant-derived 必带父级链且父表已登记；global/system 必须显式声明全局例外；
// 未批准全局例外/缺归属/非法分类负例；模型目录静态 table 与 catalog 互覆盖（防新增表漏登记）。
import { test } from '@japa/runner'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import stringHelpers from '@poppinss/utils/string'
import DatabaseIsolationCatalog from '#services/database_isolation_catalog'
import {
  DATABASE_ISOLATION_CLASSIFICATIONS,
  validateDatabaseTableDeclaration as validate,
  type DatabaseTableDeclaration,
} from '@aiproj/types/multitenant-database-isolation'

function makeDecl(overrides: Partial<DatabaseTableDeclaration>): DatabaseTableDeclaration {
  return {
    tableName: 'custom_views',
    classification: 'tenant-owned',
    organizationColumn: 'organization_id',
    tenantRequiredOperations: [
      'read',
      'list',
      'count',
      'aggregate',
      'preload',
      'write',
      'delete',
      'restore',
      'batch',
    ],
    uniqueScopeKeys: [],
    indexRequirements: [],
    testFixture: '双组织同名资源 harness',
    ...overrides,
  }
}

test.group('DatabaseIsolationCatalog 完整性', () => {
  // 245 = 205（既有基线：202 + v3-sso-saml2 三表 …… 后续 change 陆续补登记）
  //     + 13（V3 Copilot 与统一 AI 观测族：会话/消息/记忆/路由决策/建议收件箱/
  //           统一调用账本/反馈事件/质量校验/评测分数/追踪 span/预算决策/限流决策/
  //           插件权限决策）+ 4（v3-copilot-session-retention 四表）+ 14（SCIM、插件私有目录等既有批次）
  //     + 9（v3-backend-type-debt-closure 补登记：agent_assignments/copilot_context_observations/
  //           observability_aggregates/cleanup_jobs/cleanup_runs/export_records/retention_policies/
  //           organization_settings/plugin_installations——这些表早已建立但从未登记归属）
  //     + 2（v3-plugin-policy-bundles：plugin_policy_bundles/plugin_policy_bundle_activations）
  //     + 2（v3-plugin-action-preview-boundary：plugin_action_proposals/plugin_pilot_items）
  //     + 7（插件族补登记批次：plugin_change_requests/plugin_change_decisions（审批流）、
  //           plugin_fixture_seed_records（示例市场种子）、plugin_storage_namespaces/
  //           plugin_storage_entries（作用域存储，后者为 tenant-derived 经父链归属）、
  //           plugin_runtime_health_events/plugin_runtime_health_snapshots（运行期健康）
  //           ——这些表建表早于本轮，但一直没进 catalog）
  //     + 6（v3-pmo-decision-intelligence-workbench：pmo_decision_cases/
  //           pmo_decision_options/pmo_decision_evidence_snapshots/pmo_decision_positions/
  //           pmo_decision_outcomes/pmo_decision_handoff_receipts）
  //     + 8（v3-resource-capacity-forecasting-closed-loop：resource_capacity_loops/
  //           baseline_snapshots/scenarios/simulation_snapshots/selections/handoff_receipts/
  //           observation_snapshots/reviews）
  //     + 10（v3-legacy-contract-debt-fixes 补登记：图表馆 7 表 departments/project_charters/
  //           requirements/requirement_tasks/issues/project_stakeholders/communication_plans
  //           + 两步验证 3 表 user_two_factor_{credentials,challenges,recovery_codes}）
  // 这个数字是**故意写死的绊线**：新增表必须同时改 catalog 与这里，
  // 才不会出现「建了表但没人登记归属」的静默漂移。
  test('validate() 全量通过：全部表声明合法、父链完整', ({ assert }) => {
    assert.doesNotThrow(() => DatabaseIsolationCatalog.validate())
    const decls = DatabaseIsolationCatalog.all()
    // v3-triz-to-delivery-closed-loop +2（triz_delivery_links/triz_delivery_events）
    // v3-ai-quality-cost-console-deferred-p1 +2（ai_slo_thresholds/frontend_telemetry_events）
    // v3-triz-contradiction-copilot +3（triz_copilot_analyses/project_signals/triz_gallery_artifacts）
    //   —— W2.1 的 triz_copilot_analyses、W3.1 的 project_signals 与 W4.1 的 triz_gallery_artifacts
    // 实验与版本域 +5（ai_prompt_versions/ai_offline_regression_cases/ai_offline_regression_runs/ai_shadow_experiments/ai_shadow_runs）
    // 其中 31 张是企业版独有表（企业审计 2、DLP 4、水印 3、KMS 4、合规 5、SAML 3、OIDC 3、SCIM 7），
    // 个人版导出时随企业模块一起排除（v3-personal-edition-open-source-export 3.6）
    // v3-llm-wiki-memory-foundation +10（wiki_spaces/pages/revisions/claims/claim_sources/links/log_entries/lint_findings/retractions/search_entries）
    // v3-llm-wiki-ingest-pipeline +1（wiki_ingest_runs）
    // v3-llm-wiki-query-navigation +1（wiki_context_shadow_records）
    // v3-llm-wiki-eval-gate +1（wiki_eval_runs）——维基表两个版本都有
    let expectedTables = 276
    assert.equal(decls.length, expectedTables)
  })

  test('分类全部合法且归属元数据齐备', ({ assert }) => {
    for (const decl of DatabaseIsolationCatalog.all()) {
      assert.isTrue(
        DATABASE_ISOLATION_CLASSIFICATIONS.includes(decl.classification),
        `${decl.tableName} 分类非法: ${String(decl.classification)}`,
      )
      if (decl.classification === 'tenant-owned') {
        assert.equal(decl.organizationColumn, 'organization_id', `${decl.tableName} 应声明组织列`)
        assert.isTrue(
          decl.organizationFk === 'enforced' || decl.organizationFk === 'sqlite-deferred',
          `${decl.tableName} 应声明 organizationFk 契约`,
        )
        if (decl.organizationFk === 'sqlite-deferred') {
          assert.isNotEmpty(
            decl.organizationFkReason ?? '',
            `${decl.tableName} sqlite-deferred 必须声明原因`,
          )
        }
      } else if (decl.classification === 'tenant-derived') {
        assert.isNotEmpty(decl.parentResolvers ?? [], `${decl.tableName} 派生表必须声明父级链`)
        for (const resolver of decl.parentResolvers ?? []) {
          assert.isTrue(
            DatabaseIsolationCatalog.has(resolver.parentTable),
            `${decl.tableName} 父表 ${resolver.parentTable} 未在 catalog 登记`,
          )
          assert.isNotEmpty(resolver.viaColumn, `${decl.tableName} 父级解析 viaColumn 必填`)
        }
      } else {
        assert.isTrue(
          decl.globalException?.allowed === true,
          `${decl.tableName} 全局类必须显式 allowed=true`,
        )
        assert.isNotEmpty(
          decl.globalException?.reason ?? '',
          `${decl.tableName} 全局例外必须给理由`,
        )
        assert.isNull(decl.organizationColumn ?? null, `${decl.tableName} 全局/系统表不得带组织列`)
      }
    }
  })

  test('tenant-owned/derived 一律不得声明全局例外（未批准全局访问即失败）', ({ assert }) => {
    for (const decl of DatabaseIsolationCatalog.all()) {
      if (decl.classification === 'tenant-owned' || decl.classification === 'tenant-derived') {
        assert.isUndefined(
          decl.globalException?.allowed ?? undefined,
          `${decl.tableName} 不得批准全局例外`,
        )
      }
    }
    assert.throws(() => DatabaseIsolationCatalog.assertGlobalAllowed('projects'))
  })

  test('global/system 表 assertGlobalAllowed 放行；租户表拒绝', ({ assert }) => {
    assert.doesNotThrow(() => DatabaseIsolationCatalog.assertGlobalAllowed('users'))
    assert.doesNotThrow(() =>
      DatabaseIsolationCatalog.assertGlobalAllowed('ai_model_catalog_snapshots'),
    )
    assert.throws(() => DatabaseIsolationCatalog.assertGlobalAllowed('projects'))
    assert.throws(() => DatabaseIsolationCatalog.assertGlobalAllowed('tasks'))
  })

  test('未登记表 get() 抛错（fail closed）', ({ assert }) => {
    assert.throws(() => DatabaseIsolationCatalog.get('ghost_table'))
    assert.isFalse(DatabaseIsolationCatalog.has('ghost_table'))
  })
})

test.group('DatabaseIsolationCatalog 校验函数负例', () => {
  test('非法分类即失败', ({ assert }) => {
    assert.isNotEmpty(validate(makeDecl({ classification: 'wildcard' as never })))
  })

  test('tenant-owned 缺组织列即失败', ({ assert }) => {
    assert.isNotEmpty(validate(makeDecl({ organizationColumn: null })) ?? [])
  })

  test('tenant-derived 缺父级链即失败', ({ assert }) => {
    assert.isNotEmpty(
      validate(
        makeDecl({
          classification: 'tenant-derived',
          organizationColumn: null,
          parentResolvers: [],
        }),
      ),
    )
  })

  test('global 类未显式批准全局例外即失败', ({ assert }) => {
    assert.isNotEmpty(
      validate(
        makeDecl({
          classification: 'system-global-maintenance',
          organizationColumn: null,
          globalException: { allowed: false, reason: 'x' },
        }),
      ),
    )
  })

  test('tenant-owned 显式批准全局例外即失败（负例）', ({ assert }) => {
    assert.isNotEmpty(validate(makeDecl({ globalException: { allowed: true, reason: 'x' } })))
  })
})

test.group('DatabaseIsolationCatalog 模型覆盖（防新增表漏登记）', () => {
  test('app/models 静态 table 全部在 catalog 登记，catalog 表名全部有模型或为系统/备份表', ({
    assert,
  }) => {
    const modelsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../app/models')
    const declared = new Map(DatabaseIsolationCatalog.all().map((d) => [d.tableName, d]))
    const catalogTables = new Set(declared.keys())
    const modelTables = new Set<string>()
    for (const file of fs.readdirSync(modelsDir)) {
      if (!file.endsWith('.ts')) continue
      const src = fs.readFileSync(path.join(modelsDir, file), 'utf8')
      // 必须容忍 `static readonly table` / `public static readonly table`：
      // 仓库里有 6 个模型这么写，漏掉修饰符会退到「按类名复数化」的兜底，
      // 于是 unified_ai_invocation_ledger 被算成不存在的 ...ledgers，报一个假缺口。
      const explicit = src.match(/static\s+(?:readonly\s+)?table\s*=\s*'([^']+)'/)
      if (explicit) {
        modelTables.add(explicit[1])
      } else {
        // Lucid 默认命名策略：pluralize(snakeCase(className))，与 @adonisjs/lucid
        // naming_strategies/camel_case.js 一致（cross_project_allocation_commit → _commits）
        const cls = src.match(/export default class\s+([A-Za-z0-9_]+)/)
        if (cls) modelTables.add(stringHelpers.pluralize(stringHelpers.snakeCase(cls[1])))
      }
    }
    // 1) 有模型表但 catalog 无条目 → 必须失败（新表漏登记）
    // 豁免：孤儿模型（模型声明 static table 但仓库无任何迁移创建该表，已核实 grep 迁移目录无匹配）
    const orphanModels = new Set(['multi_project_dependency_idempotency'])
    const missingInCatalog = [...modelTables].filter(
      (t) => !catalogTables.has(t) && !orphanModels.has(t),
    )
    assert.deepEqual(
      missingInCatalog,
      [],
      `模型表未在 catalog 登记: ${missingInCatalog.join(', ')}`,
    )
    // 2) catalog 登记的 tenant-owned/derived 表应有模型（除备份/遗留表与 Schema 基类模型）
    const backupTables = new Set([
      'compiler_artifacts_old',
      'compiler_artifacts_v2_backup',
      'compiler_artifacts_v3_backup',
      'multi_project_dependency_idempotency',
    ])
    const schemaBased = new Set([
      'audit_logs',
      'change_requests',
      'documents',
      'document_search_entries',
      'file_entity_links',
      'file_search_entries',
      'file_tags',
      'milestones',
      'multi_project_dependencies',
      'multi_project_dependency_detection_results',
      'multi_project_dependency_detection_runs',
      'multi_project_dependency_previews',
      'notifications',
      'attachment_versions',
      'resource_allocations',
      'user_view_overrides',
      'bi_dashboard_versions',
      'triz_ifr_stage_snapshots',
    ])
    for (const [table, decl] of declared) {
      if (
        (decl.classification === 'tenant-owned' || decl.classification === 'tenant-derived') &&
        !modelTables.has(table) &&
        !backupTables.has(table) &&
        !schemaBased.has(table)
      ) {
        assert.fail(`catalog 表 ${table} 无对应模型且不在豁免名单`)
      }
    }
  })
})

// 便捷封装：返回声明校验错误数组（空数组 = 通过）
// （实际为 @aiproj/types 的 validateDatabaseTableDeclaration 别名，见文件顶部 import）
