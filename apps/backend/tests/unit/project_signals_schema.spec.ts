// v3-triz-contradiction-copilot tasks 3.1 —— `project_signals` 迁移与模型 schema 校验。
//
// 覆盖（tasks 3.1 验收 + design D5 字段表 + 三条硬边界）：
// - 列齐全：归属 / 分层 / 证据 / 幂等键 / 观测窗 / 过期 / 状态 / 采纳分析 ID / 审计字段；
// - **库层唯一约束**：同一「项目 + 类型 + 观测窗」重复插入被拒（运行期真插验证）；
// - 索引齐备（列表主路径 / 分层 / 幂等键 / 过期扫描）；
// - 外键：组织、项目、状态操作人、检测发起人、采纳分析记录；
// - 低敏：不存在可容纳 prompt / 模型输出全文 / 陈述原文的列；证据为有界 JSON；
// - 迁移保留 PostgreSQL 路径（无 SQLite 专有语法、无 raw DDL、无 `.after()`）。
import ProjectSignal from '#models/project_signal'
import ProjectSignalService from '#services/project_signal/project_signal_service'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION_PATH = join(
  process.cwd(),
  'database',
  'migrations',
  '1997010000000_create_project_signals_table.ts',
)

const TABLE = 'project_signals'

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
  'description',
  'content',
  'payload',
  'response_text',
  'result_json',
  'input_json',
  'note',
  'note_text',
]

test.group('ProjectSignals 迁移与模型 schema', (group) => {
  useAuthDatabase(group)

  test('迁移文件存在且建出目标表', async ({ assert }) => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')
    assert.include(source, 'this.schema.createTable')
    const { default: db } = await import('@adonisjs/lucid/services/db')
    assert.isTrue(await db.connection().schema.hasTable(TABLE))
  })

  test('D5 字段齐全（分层 / 证据 / 幂等 / 观测窗 / 过期 / 状态 / 采纳分析 ID / 审计）', async ({
    assert,
  }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const columns = Object.keys(await db.connection().columnsInfo(TABLE))
    const expected = [
      'organization_id',
      'project_id',
      'signal_type',
      'confidence_tier',
      'tier_reasons',
      'severity',
      'evidence',
      'idempotency_key',
      'observation_window',
      'expires_at',
      'status',
      'previous_status',
      'status_changed_by',
      'status_changed_at',
      'adopted_analysis_id',
      'created_by',
      'deleted_at',
      'created_at',
      'updated_at',
    ]
    for (const column of expected) {
      assert.include(columns, column, `${column} 列缺失`)
    }

    for (const jsonColumn of ['tier_reasons', 'evidence']) {
      const info = await db.connection().columnsInfo(TABLE, jsonColumn)
      assert.include(['json', 'jsonb', 'text'], String(info.type), `${jsonColumn} 应为 JSON 列`)
      assert.isFalse(info.nullable, `${jsonColumn} 必须非空（落库给空对象而非 null）`)
    }
  })

  test('归属与审计列非空约束正确（组织 / 项目 / 类型 / 幂等键 / 观测窗 / 过期 / 状态）', async ({
    assert,
  }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    for (const column of [
      'organization_id',
      'project_id',
      'signal_type',
      'confidence_tier',
      'severity',
      'idempotency_key',
      'observation_window',
      'expires_at',
      'status',
      'created_at',
    ]) {
      const info = await db.connection().columnsInfo(TABLE, column)
      assert.isNotNull(info, `${column} 列缺失`)
      assert.isFalse(info.nullable, `${column} 必须非空`)
    }
    // 系统触发（计划任务）时无发起人；审计字段可为空
    for (const nullable of ['created_by', 'status_changed_by', 'status_changed_at', 'deleted_at']) {
      const info = await db.connection().columnsInfo(TABLE, nullable)
      assert.isTrue(info.nullable, `${nullable} 应可空`)
    }
    const statusColumn = await db.connection().columnsInfo(TABLE, 'status')
    assert.include(String(statusColumn.defaultValue), 'open')
    const tierColumn = await db.connection().columnsInfo(TABLE, 'confidence_tier')
    assert.include(String(tierColumn.defaultValue), 'low')
  })

  test('库层唯一约束：同一「项目 + 类型 + 观测窗」重复插入被拒', async ({ assert }) => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')
    assert.include(
      source,
      "['project_id', 'signal_type', 'observation_window']",
      '唯一约束必须落在三列上',
    )

    const owner = await createUser({ email: uniqueEmail('signal-schema') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const payload = {
      organizationId: Number(org.id),
      projectId: Number(project.id),
      signalType: 'progress_deviation' as const,
      confidenceTier: 'low' as const,
      tierReasons: { amplitude: { hit: false, detail: 'x' } },
      severity: 'warning' as const,
      evidence: { metric: 'schedule_performance_index', readings: { spi: 0.9 } },
      idempotencyKey: 'a'.repeat(64),
      observationWindow: '2026-09-01..2026-09-07',
      expiresAt: DateTime.fromISO('2026-09-21T00:00:00.000Z'),
      status: 'open' as const,
      previousStatus: null,
      statusChangedBy: null,
      statusChangedAt: null,
      adoptedAnalysisId: null,
      createdBy: Number(owner.id),
      deletedAt: null,
    }

    await ProjectSignal.create(payload)

    let rejected = false
    try {
      await ProjectSignal.create(payload)
    } catch {
      rejected = true
    }
    assert.isTrue(rejected, '同一「项目 + 类型 + 观测窗」必须被库层唯一约束拒绝')

    // 不同观测窗可正常落库（幂等粒度是观测窗，不是永久唯一）
    await ProjectSignal.create({ ...payload, observationWindow: '2026-09-08..2026-09-14' })
    const rows = await ProjectSignal.query().where('project_id', project.id)
    assert.lengthOf(rows, 2)
  })

  test('库层 CHECK：非法信号类型（含 S 曲线类）与非法状态被拒', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('signal-check') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const { default: db } = await import('@adonisjs/lucid/services/db')

    const base = {
      organization_id: org.id,
      project_id: project.id,
      confidence_tier: 'low',
      tier_reasons: '{}',
      severity: 'warning',
      evidence: '{}',
      idempotency_key: 'b'.repeat(64),
      observation_window: '2026-09-01..2026-09-07',
      expires_at: '2026-09-21 00:00:00',
      status: 'open',
      created_at: '2026-09-07 00:00:00',
    }

    const invalidType = await db
      .table(TABLE)
      .insert({ ...base, signal_type: 's_curve_stage' })
      .then(() => null)
      .catch((error: unknown) => error)
    assert.isNotNull(invalidType, '禁用信号类型必须被 CHECK 约束拒绝')

    const invalidStatus = await db
      .table(TABLE)
      .insert({ ...base, signal_type: 'progress_deviation', status: 'ignored' })
      .then(() => null)
      .catch((error: unknown) => error)
    assert.isNotNull(invalidStatus, '状态机闭集外的状态必须被 CHECK 约束拒绝')
  })

  test('外键：组织 / 项目 / 状态操作人 / 采纳分析记录', async ({ assert }) => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')
    assert.include(source, ".inTable('organizations')")
    assert.include(source, ".inTable('projects')")
    assert.include(source, ".inTable('users')")
    assert.include(source, ".inTable('triz_copilot_analyses')")

    const { isSqlite } = await import('#services/dialect/dialect_helper')
    if (!isSqlite()) return
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const rows = (await db.rawQuery(`PRAGMA foreign_key_list('${TABLE}')`)) as unknown as Array<{
      table: string
      from: string
    }>
    const byColumn = new Map(rows.map((row) => [row.from, row.table]))
    assert.equal(byColumn.get('organization_id'), 'organizations')
    assert.equal(byColumn.get('project_id'), 'projects')
    assert.equal(byColumn.get('status_changed_by'), 'users')
    assert.equal(byColumn.get('created_by'), 'users')
    assert.equal(byColumn.get('adopted_analysis_id'), 'triz_copilot_analyses')
  })

  test('索引：列表主路径 / 分层过滤 / 幂等键 / 过期扫描 + 三列唯一', async ({ assert }) => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')
    assert.include(source, "['organization_id', 'project_id', 'status']")
    assert.include(source, "['organization_id', 'project_id', 'confidence_tier']")
    assert.include(source, "['idempotency_key']")
    assert.include(source, "['expires_at']")

    // JSON 列不得进索引（PG json 无 btree opclass）
    for (const jsonColumn of ['tier_reasons', 'evidence']) {
      assert.notInclude(source, `['${jsonColumn}']`, `${jsonColumn} 不应出现在索引里`)
    }

    const { isSqlite } = await import('#services/dialect/dialect_helper')
    if (!isSqlite()) return
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const rows = (await db.rawQuery(`PRAGMA index_list('${TABLE}')`)) as unknown as Array<{
      name: string
      unique: number
    }>
    const byName = new Map(rows.map((row) => [row.name, Number(row.unique)]))
    assert.equal(byName.get('uq_project_signals_project_type_window'), 1, '唯一索引必须存在')
    for (const index of [
      'idx_project_signals_org_project_status',
      'idx_project_signals_org_project_tier',
      'idx_project_signals_idempotency',
      'idx_project_signals_expires_at',
    ]) {
      assert.isTrue(byName.has(index), `${index} 索引缺失`)
    }
  })

  test('RL-12：不存在可容纳 prompt / 模型输出 / 陈述原文的列', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const columns = Object.keys(await db.connection().columnsInfo(TABLE))
    const offenders = columns.filter((column) => FORBIDDEN_TEXT_COLUMNS.includes(column))
    assert.deepEqual(offenders, [], `存在可容纳全文的列：${offenders.join(', ')}`)
  })

  test('模型与表名一致，且 DTO 投影可读（低敏）', async ({ assert }) => {
    assert.equal(ProjectSignal.table, TABLE)
    const owner = await createUser({ email: uniqueEmail('signal-dto') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const row = await ProjectSignal.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      signalType: 'risk_surge',
      confidenceTier: 'high',
      tierReasons: { amplitude: { hit: true, detail: 'significant_amplitude_met' } },
      severity: 'critical',
      evidence: { metric: 'risk_register_surge', readings: { activeRisksCurrent: 12 } },
      idempotencyKey: 'c'.repeat(64),
      observationWindow: '2026-09-01..2026-09-07',
      expiresAt: DateTime.fromISO('2026-09-21T00:00:00.000Z'),
      status: 'open',
      previousStatus: null,
      statusChangedBy: null,
      statusChangedAt: null,
      adoptedAnalysisId: null,
      createdBy: Number(owner.id),
      deletedAt: null,
    })

    const service = new ProjectSignalService()
    // 有 risk:view 权限 → 证据可读
    const withPermission = service.toDTO(row, { 'risk:view': true, 'resource:view': true })
    assert.isNotNull(withPermission.evidence)
    assert.isFalse(withPermission.evidenceRedacted)
    assert.equal(withPermission.requiredPermission, 'risk:view')
    assert.equal(withPermission.signalTypeLabel, '风险/缺陷突变')

    // 无 risk:view → 证据整体裁剪并给出原因（fail-closed）
    const withoutPermission = service.toDTO(row, { 'task:view': true })
    assert.isNull(withoutPermission.evidence)
    assert.isTrue(withoutPermission.evidenceRedacted)
    assert.equal(withoutPermission.redactedReason, 'missing_permission:risk:view')
  })

  test('迁移保留 PostgreSQL 路径（无 SQLite 专有语法 / 无 raw DDL / 无 .after）', ({ assert }) => {
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
