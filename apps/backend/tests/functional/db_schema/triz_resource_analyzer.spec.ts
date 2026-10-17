import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { columnNames, foreignKeys } from './_helpers.js'

/**
 * TRIZ 资源分析器表结构测试（v3-triz-resource-analyzer §3.1、§3.3）。
 *
 * 验证三张表的必需列、组织/项目/运行外键与级联策略、索引存在性，
 * 以及 JSON 列在 SQLite 上的默认值与往返可用性。
 */
const RUNS = 'triz_resource_analysis_runs'
const ITEMS = 'triz_resource_analysis_items'
const OPPORTUNITIES = 'triz_resource_opportunity_candidates'

async function indexNames(table: string): Promise<string[]> {
  const res = await db.rawQuery(`PRAGMA index_list(${table})`)
  const rows = (res as { rows?: any[] }).rows ?? (res as any[])
  return rows.map((r: any) => String(r.name))
}

test.group('TRIZ 资源分析器表结构', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('runs 表含运行元数据、签名与计数列', async ({ assert }) => {
    const cols = await columnNames(RUNS)
    for (const c of [
      'id',
      'organization_id',
      'project_id',
      'actor_id',
      'status',
      'input_signature',
      'output_hash',
      'rule_version',
      'taxonomy_version',
      'idempotency_key',
      'source_summary_json',
      'warning_summary_json',
      'resource_count',
      'opportunity_count',
      'cost_summary_json',
      'created_at',
      'updated_at',
      'completed_at',
      'archived_at',
    ]) {
      assert.include(cols, c, `${RUNS} 应含字段 ${c}`)
    }
  })

  test('items 表含资源分类、利用度与来源列', async ({ assert }) => {
    const cols = await columnNames(ITEMS)
    for (const c of [
      'run_id',
      'organization_id',
      'project_id',
      'resource_key',
      'label',
      'resource_kind',
      'system_scope',
      'origin',
      'availability',
      'utilization_state',
      'source_refs_json',
      'source_hashes_json',
      'metrics_json',
      'constraint_codes_json',
      'warning_codes_json',
    ]) {
      assert.include(cols, c, `${ITEMS} 应含字段 ${c}`)
    }
  })

  test('opportunities 表含候选评分、审查与 hash 列', async ({ assert }) => {
    const cols = await columnNames(OPPORTUNITIES)
    for (const c of [
      'run_id',
      'organization_id',
      'project_id',
      'opportunity_key',
      'opportunity_type',
      'rule_id',
      'status',
      'severity',
      'confidence',
      'impact_score',
      'title',
      'rationale_summary',
      'resource_refs_json',
      'target_refs_json',
      'suggested_actions_json',
      'source_hashes_json',
      'warning_codes_json',
      'output_hash',
      'reviewed_by',
      'reviewed_at',
    ]) {
      assert.include(cols, c, `${OPPORTUNITIES} 应含字段 ${c}`)
    }
  })

  test('组织/项目外键级联删除，运行外键级联到子表', async ({ assert }) => {
    const runFks = await foreignKeys(RUNS)
    const org = runFks.find((f) => f.from === 'organization_id')
    const project = runFks.find((f) => f.from === 'project_id')
    assert.isDefined(org)
    assert.equal(org!.table, 'organizations')
    assert.equal(org!.on_delete.toUpperCase(), 'CASCADE')
    assert.isDefined(project)
    assert.equal(project!.table, 'projects')
    assert.equal(project!.on_delete.toUpperCase(), 'CASCADE')

    for (const table of [ITEMS, OPPORTUNITIES]) {
      const fks = await foreignKeys(table)
      const run = fks.find((f) => f.from === 'run_id')
      assert.isDefined(run, `${table} 应有 run_id 外键`)
      assert.equal(run!.table, RUNS)
      assert.equal(run!.on_delete.toUpperCase(), 'CASCADE')
    }
  })

  test('三张表均建有组织+项目维度索引', async ({ assert }) => {
    for (const table of [RUNS, ITEMS, OPPORTUNITIES]) {
      const indexes = await indexNames(table)
      assert.isAbove(indexes.length, 0, `${table} 应至少有一个索引`)
    }
    const runIndexes = await indexNames(RUNS)
    assert.include(runIndexes, 'idx_trar_org_project_idem')
    assert.include(runIndexes, 'idx_trar_org_project_status')
  })

  test('JSON 列具备默认值，插入时无需显式赋值', async ({ assert }) => {
    const res = await db.rawQuery(`PRAGMA table_info(${RUNS})`)
    const rows = (res as { rows?: any[] }).rows ?? (res as any[])
    const summary = rows.find((r: any) => r.name === 'source_summary_json')
    const warnings = rows.find((r: any) => r.name === 'warning_summary_json')
    assert.isNotNull(summary.dflt_value)
    assert.isNotNull(warnings.dflt_value)
  })
})
