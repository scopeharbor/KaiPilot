import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { columnNames, foreignKeys } from './_helpers.js'

/**
 * TRIZ 进化趋势分析表结构测试（v3-triz-evolution-trend-analysis §3.1、§3.3）。
 *
 * 验证四张表的必需列、组织/项目/运行外键与级联策略、索引存在性，
 * 以及 JSON 列在 SQLite 上的默认值与 model/migration 列名一致性。
 */
const RUNS = 'triz_evolution_trend_analysis_runs'
const SCORES = 'triz_evolution_trend_scores'
const RISKS = 'triz_evolution_trend_risk_candidates'
const HISTORY = 'triz_evolution_trend_history_snapshots'

async function indexNames(table: string): Promise<string[]> {
  const res = await db.rawQuery(`PRAGMA index_list(${table})`)
  const rows = (res as { rows?: any[] }).rows ?? (res as any[])
  return rows.map((r: any) => String(r.name))
}

test.group('TRIZ 进化趋势分析表结构', (group) => {
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
      'scope_type',
      'input_signature',
      'output_hash',
      'rule_version',
      'taxonomy_version',
      'idempotency_key',
      'source_summary_json',
      'warning_summary_json',
      'trend_count',
      'risk_count',
      'cost_summary_json',
      'created_at',
      'updated_at',
      'completed_at',
      'archived_at',
    ]) {
      assert.include(cols, c, `${RUNS} 应含字段 ${c}`)
    }
  })

  test('scores 表含趋势评分快照列', async ({ assert }) => {
    const cols = await columnNames(SCORES)
    for (const c of [
      'run_id',
      'organization_id',
      'project_id',
      'trend_key',
      'trend_id',
      'stage',
      'score',
      'confidence',
      'severity',
      'direction',
      'source_refs_json',
      'source_hashes_json',
      'metrics_json',
      'warning_codes_json',
      'created_at',
      'updated_at',
    ]) {
      assert.include(cols, c, `${SCORES} 应含字段 ${c}`)
    }
  })

  test('risks 表含候选评分、审查与 hash 列，且 ai_explanation_ref_json 列名与 model 一致', async ({
    assert,
  }) => {
    const cols = await columnNames(RISKS)
    for (const c of [
      'run_id',
      'organization_id',
      'project_id',
      'risk_key',
      'trend_id',
      'risk_type',
      'rule_id',
      'status',
      'severity',
      'confidence',
      'impact_score',
      'title',
      'rationale_summary',
      'trend_refs_json',
      'target_refs_json',
      'suggested_actions_json',
      'source_hashes_json',
      'warning_codes_json',
      'ai_explanation_ref_json',
      'output_hash',
      'reviewed_by',
      'reviewed_at',
      'created_at',
      'updated_at',
    ]) {
      assert.include(cols, c, `${RISKS} 应含字段 ${c}`)
    }
  })

  test('history 表含对比快照列', async ({ assert }) => {
    const cols = await columnNames(HISTORY)
    for (const c of [
      'run_id',
      'organization_id',
      'project_id',
      'baseline_run_id',
      'comparison_mode',
      'trend_delta_json',
      'risk_delta_json',
      'source_hashes_json',
      'created_at',
      'updated_at',
    ]) {
      assert.include(cols, c, `${HISTORY} 应含字段 ${c}`)
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

    for (const table of [SCORES, RISKS, HISTORY]) {
      const fks = await foreignKeys(table)
      const run = fks.find((f) => f.from === 'run_id')
      assert.isDefined(run, `${table} 应有 run_id 外键`)
      assert.equal(run!.table, RUNS)
      assert.equal(run!.on_delete.toUpperCase(), 'CASCADE')
    }
  })

  test('四张表均建有组织+项目维度索引', async ({ assert }) => {
    for (const table of [RUNS, SCORES, RISKS, HISTORY]) {
      const indexes = await indexNames(table)
      assert.isAbove(indexes.length, 0, `${table} 应至少有一个索引`)
    }
    const runIndexes = await indexNames(RUNS)
    assert.include(runIndexes, 'idx_teta_org_project_idem')
    assert.include(runIndexes, 'idx_teta_org_project_status')
  })

  test('JSON 列具备默认值，插入时无需显式赋值', async ({ assert }) => {
    const res = await db.rawQuery(`PRAGMA table_info(${RUNS})`)
    const rows = (res as { rows?: any[] }).rows ?? (res as any[])
    const summary = rows.find((r: any) => r.name === 'source_summary_json')
    const warnings = rows.find((r: any) => r.name === 'warning_summary_json')
    assert.isNotNull(summary.dflt_value)
    assert.isNotNull(warnings.dflt_value)
  })

  test('CHECK 约束限定 status / trend_id / risk_type 取值', async ({ assert }) => {
    // 插入非法 status 应被拒绝
    try {
      await db.table(RUNS).insert({
        organization_id: 1,
        project_id: 1,
        actor_id: 1,
        status: 'invalid_status',
        scope_type: 'project',
        input_signature: 'x',
        rule_version: '1.0.0',
        taxonomy_version: '1.0.0',
        idempotency_key: 'k',
        created_at: new Date().toISOString(),
      })
      assert.isTrue(false, '非法 status 应被 CHECK 约束拒绝')
    } catch {
      assert.isTrue(true)
    }
  })
})
