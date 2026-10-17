// v3-triz-contradiction-copilot tasks 2.1 —— `triz_copilot_analyses` 迁移与模型 schema 校验。
//
// 覆盖（tasks 2.1 验收 + design D5 字段表 + 红线守卫 RL-12「观测禁存全文」）：
// - 列齐全：归属 / 映射 / 方案 / 溯源 / 改判 / 软删 / 审计 + Autonomy Budget 计数器（2.3 落库位）；
// - 低敏静态断言：**不存在**可容纳 prompt、模型输出全文或 PM 陈述原文的列（陈述只有 digest 与长度）；
// - `organization_id` / `project_id` / `created_by` 外键与 NOT NULL 约束；
// - 索引：组织 + 项目 + 创建时间（列表主路径）、组织 + 项目 + path、澄清链父记录；
// - 迁移保留 PostgreSQL 路径：无 SQLite 专有语法、无 raw DDL、JSON 列不参与 btree 索引。
import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION_PATH = join(
  process.cwd(),
  'database',
  'migrations',
  '1997000000000_create_triz_copilot_analyses_table.ts',
)

const TABLE = 'triz_copilot_analyses'

/** 低敏红线列黑名单：出现任一列即视为 RL-12 破口（可容纳全文的容器）。 */
const FORBIDDEN_TEXT_COLUMNS = [
  'prompt',
  'prompt_text',
  'system_prompt',
  'user_prompt',
  'model_output',
  'model_output_text',
  'raw_output',
  'raw_text',
  'output_text',
  'statement',
  'statement_text',
  'statement_body',
  'contradiction_statement',
  'description',
  'content',
  'payload',
  'response_text',
  'result_json',
  'input_json',
]

test.group('TrizCopilotAnalysesSchema', () => {
  test('迁移文件存在且建出目标表', async ({ assert }) => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')
    assert.include(source, `this.schema.createTable`)

    const { default: db } = await import('@adonisjs/lucid/services/db')
    assert.isTrue(await db.connection().schema.hasTable(TABLE))
  })

  test('organization_id / project_id / created_by 非空', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    for (const column of ['organization_id', 'project_id', 'created_by']) {
      const info = await db.connection().columnsInfo(TABLE, column)
      assert.isNotNull(info, `${column} 列缺失`)
      assert.isFalse(info.nullable, `${column} 必须非空`)
    }
  })

  test('外键：组织 / 项目 / 创建人 / 澄清链父记录（source_signal_id 本期无 FK）', async ({
    assert,
  }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const source = readFileSync(MIGRATION_PATH, 'utf8')

    // 声明层面（跨方言可断言）
    assert.include(source, ".inTable('organizations')")
    assert.include(source, ".inTable('projects')")
    assert.include(source, ".inTable('users')")
    assert.include(source, ".inTable('triz_copilot_analyses')")

    // 运行期：SQLite 下用 PRAGMA 取实际约束（PG 走 information_schema，由模型层与静态断言共同保证）
    const { isSqlite } = await import('#services/dialect/dialect_helper')
    if (!isSqlite()) return
    const rows = (await db.rawQuery(`PRAGMA foreign_key_list('${TABLE}')`)) as unknown as Array<{
      table: string
      from: string
      on_delete: string
    }>
    const byColumn = new Map(rows.map((row) => [row.from, row.table]))
    assert.equal(byColumn.get('organization_id'), 'organizations')
    assert.equal(byColumn.get('project_id'), 'projects')
    assert.equal(byColumn.get('created_by'), 'users')
    assert.equal(byColumn.get('parent_analysis_id'), TABLE)
    assert.isUndefined(byColumn.get('source_signal_id'), 'project_signals 由 W3 建表，本期不留 FK')
  })

  test('RL-12：不存在可容纳 prompt / 模型输出全文 / 陈述原文的列', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const columns = Object.keys(await db.connection().columnsInfo(TABLE))
    const offenders = columns.filter((column) => FORBIDDEN_TEXT_COLUMNS.includes(column))
    assert.deepEqual(offenders, [], `存在可容纳全文的列：${offenders.join(', ')}`)

    // 陈述只留指纹与长度：digest 为定长字符串（非 text），长度列为整数
    const digest = await db.connection().columnsInfo(TABLE, 'statement_digest')
    assert.notEqual(digest.type, 'text')
    assert.isFalse(digest.nullable)
    const length = await db.connection().columnsInfo(TABLE, 'statement_length')
    assert.include(['integer', 'int'], String(length.type))
  })

  test('映射 / 方案 / 溯源列齐全且 JSON 列类型正确', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const columns = Object.keys(await db.connection().columnsInfo(TABLE))
    const expected = [
      'contradiction_type',
      'improving_parameter',
      'worsening_parameter',
      'candidate_principles',
      'top_solutions',
      'path',
      'confidence',
      'entity_binding',
      'context_refs',
      'quality_flags',
      'fallback_reasons',
      'knowledge_pack_version',
      'human_override',
      'override_by',
      'override_at',
      'source_signal_id',
      'parent_analysis_id',
      'deleted_at',
    ]
    for (const column of expected) {
      assert.include(columns, column, `${column} 列缺失`)
    }

    for (const jsonColumn of [
      'candidate_principles',
      'top_solutions',
      'context_refs',
      'quality_flags',
      'fallback_reasons',
    ]) {
      const info = await db.connection().columnsInfo(TABLE, jsonColumn)
      assert.include(['json', 'jsonb', 'text'], String(info.type), `${jsonColumn} 应为 JSON 列`)
      assert.isFalse(info.nullable, `${jsonColumn} 必须非空（落库时给空数组而非 null）`)
    }
  })

  test('Autonomy Budget 计数器列与默认值（design D7 硬上限）', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const budget = await db.connection().columnsInfo(TABLE, 'token_budget')
    assert.include(String(budget.defaultValue ?? ''), '4000')
    assert.isFalse(budget.nullable)

    for (const counter of ['clarification_rounds', 'metric_read_count']) {
      const info = await db.connection().columnsInfo(TABLE, counter)
      assert.isFalse(info.nullable)
      assert.include(String(info.defaultValue ?? ''), '0')
    }

    const state = await db.connection().columnsInfo(TABLE, 'budget_state')
    assert.include(String(state.defaultValue ?? ''), 'within_budget')

    // 真实用量未知时为 null（不回填 0）
    const actual = await db.connection().columnsInfo(TABLE, 'actual_tokens')
    assert.isTrue(actual.nullable)
  })

  test('索引：列表主路径 + path 过滤 + 澄清链父记录', async ({ assert }) => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')
    assert.include(source, "['organization_id', 'project_id', 'created_at']")
    assert.include(source, "['organization_id', 'project_id', 'path']")
    assert.include(source, "['parent_analysis_id']")

    // JSON 列不得进索引（PG json 无 btree opclass）
    for (const jsonColumn of ['candidate_principles', 'top_solutions', 'context_refs']) {
      assert.notInclude(source, `${jsonColumn}', '`, `${jsonColumn} 不应出现在索引/唯一约束里`)
    }

    const { isSqlite } = await import('#services/dialect/dialect_helper')
    if (!isSqlite()) return
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const rows = (await db.rawQuery(`PRAGMA index_list('${TABLE}')`)) as unknown as Array<{
      name: string
      unique: number
    }>
    const names = rows.map((row) => row.name)
    assert.include(names, 'idx_triz_copilot_analyses_org_project_created')
    assert.include(names, 'idx_triz_copilot_analyses_org_path')
    assert.include(names, 'idx_triz_copilot_analyses_parent')
  })

  test('CHECK 约束：矛盾类型 / path / 实体绑定 / 参数编号闭集 / 预算状态', ({ assert }) => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')
    assert.include(source, "contradiction_type IN ('administrative','technical','physical')")
    assert.include(source, "path IN ('ai','rule')")
    assert.include(source, "entity_binding IN ('bound','partial','none')")
    assert.include(source, "budget_state IN ('within_budget','exhausted')")
    assert.include(source, 'improving_parameter >= 1 AND improving_parameter <= 39')
    assert.include(source, 'worsening_parameter >= 1 AND worsening_parameter <= 39')
    assert.include(source, 'confidence >= 0 AND confidence <= 1')
  })

  test('迁移保留 PostgreSQL 路径（无 SQLite 专有语法 / 无 raw DDL）', ({ assert }) => {
    // 只看代码：注释里会说明「未使用 .after()」，不能把说明文字当成实现
    const source = readFileSync(MIGRATION_PATH, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const sqliteOnly = [
      'AUTOINCREMENT',
      'PRAGMA',
      'sqlite_master',
      'WITHOUT ROWID',
      'datetime(',
      'strftime(',
    ]
    const offenders = sqliteOnly.filter((token) => source.includes(token))
    assert.deepEqual(offenders, [], `迁移含 SQLite 专有语法：${offenders.join(', ')}`)
    assert.isFalse(/this\.schema\.raw\(/.test(source), '迁移不应使用 raw DDL（会绑定方言）')
    assert.isFalse(source.includes('.after('), '不使用 .after()（方言不兼容）')
  })
})
