import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { columnNames, columnDefault, assertForeignKey, foreignKeys } from './_helpers.js'
import ChangeRequest from '#models/change_request'
import db from '@adonisjs/lucid/services/db'

/**
 * change_requests V1 补充迁移测试（simple-change-approval）。
 *
 * 验证：
 * - 新增字段存在性与默认值
 * - organization_id 外键 → organizations ON DELETE CASCADE
 * - requester_id / approver_id 外键 → users ON DELETE SET NULL
 * - 索引存在性
 * - Model JSON 列的 prepare/consume 往返
 * - 默认状态为 draft
 */
test.group('change_requests V1 迁移', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('新增字段存在性', async ({ assert }) => {
    const cols = await columnNames('change_requests')
    for (const c of [
      'organization_id',
      'requester_id',
      'approver_id',
      'priority',
      'impact_summary',
      'conditions',
      'decision_reason',
      'implemented_by',
      'closed_at',
      'closed_by',
    ]) {
      assert.include(cols, c, `change_requests 应含字段 ${c}`)
    }
  })

  test('priority 默认值为 medium', async ({ assert }) => {
    const dflt = await columnDefault('change_requests', 'priority')
    assert.equal(dflt, "'medium'")
  })

  test('status 默认值为 draft', async ({ assert }) => {
    const dflt = await columnDefault('change_requests', 'status')
    assert.equal(dflt, "'draft'")
  })

  test('change_type 默认值为 other', async ({ assert }) => {
    const dflt = await columnDefault('change_requests', 'change_type')
    assert.equal(dflt, "'other'")
  })

  test('organization_id 外键 → organizations ON DELETE CASCADE', async () => {
    const fks = await foreignKeys('change_requests')
    assertForeignKey(fks, 'organization_id', 'organizations', 'CASCADE')
  })

  test('requester_id / approver_id 外键 → users ON DELETE SET NULL', async () => {
    const fks = await foreignKeys('change_requests')
    assertForeignKey(fks, 'requester_id', 'users', 'SET NULL')
    assertForeignKey(fks, 'approver_id', 'users', 'SET NULL')
  })

  test('implemented_by / closed_by 外键 → users ON DELETE SET NULL', async () => {
    const fks = await foreignKeys('change_requests')
    assertForeignKey(fks, 'implemented_by', 'users', 'SET NULL')
    assertForeignKey(fks, 'closed_by', 'users', 'SET NULL')
  })

  test('复合索引 organization_id + project_id + status + updated_at', async ({ assert }) => {
    const res = await db.rawQuery(
      `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='change_requests'`,
    )
    const rows = (res as any).rows ?? (res as any[])
    const sqls = rows.map((r: any) => r.sql ?? '')
    const hasComposite = sqls.some(
      (sql: string) =>
        sql.includes('organization_id') &&
        sql.includes('project_id') &&
        sql.includes('status') &&
        sql.includes('updated_at'),
    )
    assert.isTrue(
      hasComposite,
      '应存在 organization_id + project_id + status + updated_at 复合索引',
    )
  })

  test('索引 requester_id', async ({ assert }) => {
    const res = await db.rawQuery(
      `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='change_requests'`,
    )
    const rows = (res as any).rows ?? (res as any[])
    const sqls = rows.map((r: any) => r.sql ?? '')
    assert.isTrue(
      sqls.some((sql: string) => sql.includes('requester_id')),
      '应存在 requester_id 索引',
    )
  })

  test('索引 approver_id', async ({ assert }) => {
    const res = await db.rawQuery(
      `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='change_requests'`,
    )
    const rows = (res as any).rows ?? (res as any[])
    const sqls = rows.map((r: any) => r.sql ?? '')
    assert.isTrue(
      sqls.some((sql: string) => sql.includes('approver_id')),
      '应存在 approver_id 索引',
    )
  })
})

test.group('ChangeRequest Model', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('impactSummary JSON 往返序列化', async ({ assert }) => {
    const summary = {
      scope: '增加用户管理模块',
      schedule: '延期 5 天',
      resources: '需 1 名后端工程师',
      cost: '约 2 万元',
      risks: '可能影响现有认证流程',
      assumptions: '假设 API 兼容',
    }

    // 先关闭 FK 检查以创建测试数据（测试数据库无种子数据）
    await db.rawQuery('PRAGMA foreign_keys = OFF')
    try {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
      await db.rawQuery(
        `INSERT INTO change_requests (cr_code, organization_id, project_id, title, change_type, status, priority, impact_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'CR-2026-TEST-' + Date.now(),
          1,
          1,
          '测试变更',
          'scope',
          'draft',
          'medium',
          JSON.stringify(summary),
          now,
        ],
      )

      // 用 Model read 验证 consume
      const row = await ChangeRequest.query().where('title', '测试变更').firstOrFail()
      assert.deepEqual(row.impactSummary, summary)
    } finally {
      await db.rawQuery('PRAGMA foreign_keys = ON')
    }
  })
})
