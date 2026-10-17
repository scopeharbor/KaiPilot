/**
 * v3-chart-gallery-data-foundation —— W1 数据库迁移与表结构测试（tasks 1.3）。
 *
 * 覆盖：
 * - 8 个新迁移在 SQLite 测试库按单调时间戳顺序全部执行（adonis_schema 全 ran）
 * - 7 张新表（departments / project_charters / requirements / requirement_tasks /
 *   issues / project_stakeholders / communication_plans）字段、外键、CHECK、
 *   唯一约束与显式索引完整建立
 * - projects / organization_members 的 department_id 列与索引
 * - tasks 新列（consulted_user_ids / informed_user_ids / location_unit /
 *   cycle_stage）可成功读写，JSON 列默认 '[]' 生效
 *
 * 全部断言走真实连接内省（SQLite PRAGMA），与 db_schema 套件既有惯例一致。
 */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import {
  assertColumnExists,
  assertForeignKey,
  checkEnum,
  columnDefault,
  columnNames,
  foreignKeys,
  hasUniqueIndex,
  indexNames,
  tableSql,
} from './_helpers.js'

/** 单值插入返回 id（兼容 number | number[]）。 */
async function insertId(table: string, row: Record<string, unknown>): Promise<number> {
  const r = await db.table(table).insert(row)
  return Array.isArray(r) ? r[0] : r
}

/** 构造 user → org → project → task 数据链，返回关键 id。 */
async function buildChain(suffix: string) {
  const now = new Date().toISOString()
  const userId = await insertId('users', {
    full_name: `u-${suffix}`,
    email: `${suffix}@test.local`,
    password: 'x',
    created_at: now,
    updated_at: now,
  })
  const orgId = await insertId('organizations', {
    owner_id: userId,
    name: `org-${suffix}`,
    slug: `slug-${suffix}`,
    created_at: now,
    updated_at: now,
  })
  const projectId = await insertId('projects', {
    organization_id: orgId,
    name: 'p',
    created_by: userId,
    created_at: now,
    updated_at: now,
  })
  return { userId, orgId, projectId, now }
}

const NEW_MIGRATION_NAMES = [
  '1996000000000_create_departments_table',
  '1996010000000_add_department_id_to_projects_and_members',
  '1996020000000_create_project_charters_table',
  '1996030000000_create_requirements_and_task_links_table',
  '1996040000000_add_raci_and_lob_fields_to_tasks_table',
  '1996050000000_create_issues_table',
  '1996060000000_create_project_stakeholders_table',
  '1996070000000_create_communication_plans_table',
]

const NEW_TABLES = [
  'departments',
  'project_charters',
  'requirements',
  'requirement_tasks',
  'issues',
  'project_stakeholders',
  'communication_plans',
]

/** 取列默认值并归一化（去 SQL 引号与 PG 类型转换后缀），便于跨方言断言。 */
async function defaultOf(table: string, column: string): Promise<string> {
  const raw = await columnDefault(table, column)
  if (raw === null) return ''
  // PG: `'draft'::character varying` / `'[]'::json`；SQLite: `'draft'`
  return raw.replace(/^'/, '').replace(/'(:{2}[\w ]+)?$/, '')
}

test.group('Chart Gallery 迁移执行与表结构', () => {
  test('8 个 W1 迁移按序全部 ran', async ({ assert }) => {
    // Lucid 22 在 adonis_schema 中以 `database/migrations/<basename>` 记录迁移名
    const rows = await db.from('adonis_schema').select('id', 'name', 'batch')
    const mine = rows
      .filter((r: { name: string }) =>
        NEW_MIGRATION_NAMES.some((n) => r.name.endsWith(`/${n}`) || r.name.endsWith(n)),
      )
      .sort((a: { id: number }, b: { id: number }) => a.id - b.id)
    assert.equal(mine.length, NEW_MIGRATION_NAMES.length, '8 个迁移都应登记在 adonis_schema')

    // 按执行顺序（id 升序）与迁移目录内单调时间戳顺序一致
    const basenames = mine.map((r: { name: string }) => r.name.split('/').pop())
    assert.deepEqual(basenames, NEW_MIGRATION_NAMES)
    for (const row of mine) {
      assert.isAbove(row.batch, 0, `${row.name} 应有有效 batch（已执行）`)
    }
  })

  test('7 张新表全部存在且带 organization_id 外键', async ({ assert }) => {
    for (const table of NEW_TABLES) {
      const cols = await columnNames(table)
      assert.isTrue(cols.includes('id'), `${table}.id 应存在`)
      assert.isTrue(cols.includes('organization_id'), `${table}.organization_id 应存在`)
      const fks = await foreignKeys(table)
      assertForeignKey(fks, 'organization_id', 'organizations', 'CASCADE')
    }
  })
})

test.group('Chart Gallery departments / 部门树表', () => {
  test('departments 字段与树形外键完整', async ({ assert }) => {
    const cols = await columnNames('departments')
    assert.includeMembers(cols, [
      'id',
      'organization_id',
      'parent_id',
      'name',
      'code',
      'description',
      'leader_id',
      'sort_order',
      'path',
      'depth',
      'created_by',
      'created_at',
      'updated_at',
      'deleted_at',
    ])
    const fks = await foreignKeys('departments')
    assertForeignKey(fks, 'parent_id', 'departments', 'RESTRICT')
    assertForeignKey(fks, 'leader_id', 'users', 'SET NULL')
    assertForeignKey(fks, 'created_by', 'users', 'RESTRICT')
  })

  test('departments 唯一约束与组织+路径索引', async ({ assert }) => {
    assert.isTrue(await hasUniqueIndex('departments', ['organization_id', 'code']))
    const idx = await indexNames('departments')
    assert.isTrue(idx.includes('idx_departments_org_path'), '应有 idx_departments_org_path')
  })

  test('projects / organization_members 已关联 department_id', async ({ assert }) => {
    for (const table of ['projects', 'organization_members']) {
      await assertColumnExists(table, 'department_id')
      const idx = await indexNames(table)
      const expected = table === 'projects' ? 'idx_projects_dept' : 'idx_org_members_dept'
      assert.isTrue(idx.includes(expected), `${table} 应有 ${expected}`)
    }
  })
})

test.group('Chart Gallery project_charters / 章程表', () => {
  test('章程表字段、唯一项目外键与审批状态机 CHECK', async ({ assert }) => {
    const cols = await columnNames('project_charters')
    assert.includeMembers(cols, [
      'organization_id',
      'project_id',
      'title',
      'vision',
      'scope',
      'objectives',
      'success_criteria',
      'start_date',
      'end_date',
      'business_case',
      'approval_status',
      'approved_by',
      'approved_at',
      'version',
      'created_by',
      'updated_by',
      'deleted_at',
    ])
    const fks = await foreignKeys('project_charters')
    assertForeignKey(fks, 'project_id', 'projects', 'CASCADE')
    assertForeignKey(fks, 'approved_by', 'users', 'SET NULL')
    assert.isTrue(await hasUniqueIndex('project_charters', ['project_id']))
    const idx = await indexNames('project_charters')
    assert.isTrue(idx.includes('idx_charters_org_project'))
    assert.equal(await defaultOf('project_charters', 'approval_status'), 'draft')
    assert.equal(await defaultOf('project_charters', 'version'), '1')
    const sql = await tableSql('project_charters')
    assert.isTrue(
      checkEnum(sql, 'approval_status', ['draft', 'pending_approval', 'approved', 'rejected']),
    )
  })
})

test.group('Chart Gallery requirements / requirement_tasks 表', () => {
  test('requirements 字段、约束与索引完整', async ({ assert }) => {
    const cols = await columnNames('requirements')
    assert.includeMembers(cols, [
      'organization_id',
      'project_id',
      'code',
      'title',
      'description',
      'category',
      'priority',
      'status',
      'acceptance_criteria',
      'created_by',
      'updated_by',
      'deleted_at',
    ])
    const fks = await foreignKeys('requirements')
    assertForeignKey(fks, 'project_id', 'projects', 'CASCADE')
    assert.isTrue(await hasUniqueIndex('requirements', ['project_id', 'code']))
    const idx = await indexNames('requirements')
    assert.isTrue(idx.includes('idx_requirements_org_project_status'))
    // 结构化验收条目 JSON 默认 '[]'
    assert.equal(await defaultOf('requirements', 'acceptance_criteria'), '[]')
    const sql = await tableSql('requirements')
    assert.isTrue(checkEnum(sql, 'category', ['business', 'user', 'functional', 'non_functional']))
    assert.isTrue(checkEnum(sql, 'priority', ['lowest', 'low', 'medium', 'high']))
    assert.isTrue(checkEnum(sql, 'status', ['draft', 'approved', 'in_progress', 'completed']))
  })

  test('requirement_tasks 双向外键与唯一约束', async ({ assert }) => {
    const cols = await columnNames('requirement_tasks')
    assert.includeMembers(cols, [
      'id',
      'organization_id',
      'requirement_id',
      'task_id',
      'created_at',
    ])
    const fks = await foreignKeys('requirement_tasks')
    assertForeignKey(fks, 'requirement_id', 'requirements', 'CASCADE')
    assertForeignKey(fks, 'task_id', 'tasks', 'CASCADE')
    assert.isTrue(await hasUniqueIndex('requirement_tasks', ['requirement_id', 'task_id']))
    const idx = await indexNames('requirement_tasks')
    assert.isTrue(idx.includes('idx_requirement_tasks_task_id'))
  })
})

test.group('Chart Gallery issues / 议题表', () => {
  test('issues 字段、分类与状态机 CHECK、索引', async ({ assert }) => {
    const cols = await columnNames('issues')
    assert.includeMembers(cols, [
      'organization_id',
      'project_id',
      'related_task_id',
      'reported_by',
      'assignee_id',
      'code',
      'title',
      'description',
      'type',
      'severity',
      'priority',
      'status',
      'root_cause',
      'resolution',
      'resolved_at',
      'closed_at',
      'deleted_at',
    ])
    const fks = await foreignKeys('issues')
    assertForeignKey(fks, 'related_task_id', 'tasks', 'SET NULL')
    assertForeignKey(fks, 'reported_by', 'users', 'RESTRICT')
    assertForeignKey(fks, 'assignee_id', 'users', 'SET NULL')
    assert.isTrue(await hasUniqueIndex('issues', ['project_id', 'code']))
    const idx = await indexNames('issues')
    assert.isTrue(idx.includes('idx_issues_org_project_status'))
    assert.isTrue(idx.includes('idx_issues_project_type'))
    const sql = await tableSql('issues')
    assert.isTrue(checkEnum(sql, 'type', ['bug', 'blocker', 'technical', 'process']))
    assert.isTrue(checkEnum(sql, 'severity', ['critical', 'major', 'minor', 'trivial']))
    assert.isTrue(checkEnum(sql, 'priority', ['urgent', 'high', 'medium', 'low']))
    assert.isTrue(checkEnum(sql, 'status', ['open', 'in_progress', 'resolved', 'closed']))
  })
})

test.group('Chart Gallery project_stakeholders / 干系人表', () => {
  test('干系人表字段、评估档位 CHECK 与策略索引', async ({ assert }) => {
    const cols = await columnNames('project_stakeholders')
    assert.includeMembers(cols, [
      'organization_id',
      'project_id',
      'user_id',
      'name',
      'organization_name',
      'role_title',
      'stakeholder_type',
      'power_level',
      'interest_level',
      'attitude',
      'expectations',
      'management_strategy',
      'contact_info',
      'created_by',
      'updated_by',
      'deleted_at',
    ])
    const fks = await foreignKeys('project_stakeholders')
    assertForeignKey(fks, 'user_id', 'users', 'SET NULL')
    const idx = await indexNames('project_stakeholders')
    assert.isTrue(idx.includes('idx_stakeholders_org_project_strategy'))
    assert.equal(await defaultOf('project_stakeholders', 'contact_info'), '{}')
    const sql = await tableSql('project_stakeholders')
    assert.isTrue(checkEnum(sql, 'stakeholder_type', ['internal', 'external']))
    assert.isTrue(checkEnum(sql, 'power_level', ['low', 'medium', 'high']))
    assert.isTrue(checkEnum(sql, 'attitude', ['supportive', 'neutral', 'resistant']))
    assert.isTrue(
      checkEnum(sql, 'management_strategy', ['manage_closely', 'keep_satisfied', 'keep_informed']),
    )
  })
})

test.group('Chart Gallery communication_plans / 沟通计划表', () => {
  test('沟通计划表字段、渠道频次 CHECK 与启停索引', async ({ assert }) => {
    const cols = await columnNames('communication_plans')
    assert.includeMembers(cols, [
      'organization_id',
      'project_id',
      'owner_id',
      'name',
      'communication_type',
      'purpose',
      'frequency',
      'channel',
      'audience',
      'deliverable',
      'report_template_key',
      'is_active',
      'created_by',
      'updated_by',
      'deleted_at',
    ])
    const fks = await foreignKeys('communication_plans')
    assertForeignKey(fks, 'owner_id', 'users', 'RESTRICT')
    const idx = await indexNames('communication_plans')
    assert.isTrue(idx.includes('idx_comm_plans_org_project_active'))
    assert.equal(await defaultOf('communication_plans', 'communication_type'), 'meeting')
    assert.equal(await defaultOf('communication_plans', 'frequency'), 'weekly')
    assert.equal(await defaultOf('communication_plans', 'is_active'), '1')
    const sql = await tableSql('communication_plans')
    assert.isTrue(checkEnum(sql, 'communication_type', ['meeting', 'report', 'email']))
    assert.isTrue(checkEnum(sql, 'frequency', ['daily', 'weekly', 'biweekly', 'monthly']))
    assert.isTrue(
      checkEnum(sql, 'channel', ['in_person', 'video_conference', 'email', 'wechat_work']),
    )
  })
})

test.group('Chart Gallery tasks 扩展列读写', () => {
  test('tasks 新列完整存在（RACI + LOB）', async ({ assert }) => {
    await assertColumnExists('tasks', 'consulted_user_ids')
    await assertColumnExists('tasks', 'informed_user_ids')
    await assertColumnExists('tasks', 'location_unit')
    await assertColumnExists('tasks', 'cycle_stage')
    assert.equal(await defaultOf('tasks', 'consulted_user_ids'), '[]')
    assert.equal(await defaultOf('tasks', 'informed_user_ids'), '[]')
    const idx = await indexNames('tasks')
    assert.isTrue(idx.includes('idx_tasks_project_location'), '应有 idx_tasks_project_location')
  })

  test('tasks 新列可成功读写且 JSON 默认生效', async ({ assert }) => {
    const suffix = `raci-${Date.now()}`
    const { projectId, now } = await buildChain(suffix)

    // 不提供新列：默认 '[]' 生效
    const t1 = await insertId('tasks', {
      project_id: projectId,
      name: 't-default',
      created_at: now,
      updated_at: now,
    })
    const row1 = await db.from('tasks').where('id', t1).first()
    assert.equal(row1.consulted_user_ids, '[]')
    assert.equal(row1.informed_user_ids, '[]')
    assert.isNull(row1.location_unit)
    assert.isNull(row1.cycle_stage)

    // 显式写入 JSON 数组与 LOB 字段后读回
    const t2 = await insertId('tasks', {
      project_id: projectId,
      name: 't-full',
      consulted_user_ids: JSON.stringify([11, 22]),
      informed_user_ids: JSON.stringify([33]),
      location_unit: 'Floor-1',
      cycle_stage: '结构施工',
      created_at: now,
      updated_at: now,
    })
    const row2 = await db.from('tasks').where('id', t2).first()
    assert.deepEqual(JSON.parse(row2.consulted_user_ids), [11, 22])
    assert.deepEqual(JSON.parse(row2.informed_user_ids), [33])
    assert.equal(row2.location_unit, 'Floor-1')
    assert.equal(row2.cycle_stage, '结构施工')

    // UPDATE 路径
    await db
      .from('tasks')
      .where('id', t2)
      .update({ consulted_user_ids: JSON.stringify([44]), cycle_stage: '水电预埋' })
    const row3 = await db.from('tasks').where('id', t2).first()
    assert.deepEqual(JSON.parse(row3.consulted_user_ids), [44])
    assert.equal(row3.cycle_stage, '水电预埋')
  })
})
