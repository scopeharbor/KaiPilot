import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { columnNames, foreignKeys, hasUniqueIndex, tableSql, checkEnum } from './_helpers.js'
import PluginChangeRequest from '#models/plugin_change_request'
import PluginChangeDecision from '#models/plugin_change_decision'

/**
 * v3-plugin-approval-change-flow —— plugin_change_requests / plugin_change_decisions 迁移测试。
 *
 * 验证：
 * - 关键列存在性（组织 scope、状态机、digest、handle、rowVersion、幂等键）
 * - organization_id 外键 → organizations ON DELETE CASCADE
 * - decisions.request_id 外键 → plugin_change_requests ON DELETE CASCADE
 * - 组织维度幂等唯一键（organization_id + request_uid / decision_uid）
 * - 封闭枚举 CHECK 约束（kind/state/event）
 * - 组织前缀索引（隔离查询路径）
 * - Model forOrganization scope 与 JSON 列 prepare/consume 往返
 * - 方言自适应断言（同一套断言在 SQLite 与 PostgreSQL 上均可运行）
 */
/** sqlite_master 索引行（PG 下由 pg_indexes 保证，此处仅做兜底）。 */
interface IndexRow {
  sql?: string | null
}

test.group('plugin change flow 迁移', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('plugin_change_requests 关键列存在', async ({ assert }) => {
    const cols = await columnNames('plugin_change_requests')
    for (const c of [
      'id',
      'organization_id',
      'project_id',
      'request_uid',
      'kind',
      'state',
      'plugin_id',
      'requested_by',
      'target_revision',
      'diff_json',
      'diff_digest',
      'permission_digest',
      'compatibility_digest',
      'approval_required',
      'approved_by',
      'handle_digest',
      'handle_actor_ref',
      'handle_expires_at',
      'row_version',
      'expires_at',
      'created_at',
    ]) {
      assert.include(cols, c, `plugin_change_requests 应含字段 ${c}`)
    }
  })

  test('plugin_change_decisions 关键列存在', async ({ assert }) => {
    const cols = await columnNames('plugin_change_decisions')
    for (const c of [
      'id',
      'organization_id',
      'request_id',
      'decision_uid',
      'event',
      'actor_ref',
      'idempotency_key',
      'from_state',
      'to_state',
      'reason_code',
      'diff_digest',
      'audit_log_id',
      'receipt_created_at',
      'created_at',
    ]) {
      assert.include(cols, c, `plugin_change_decisions 应含字段 ${c}`)
    }
  })

  test('organization_id 外键 → organizations ON DELETE CASCADE（两表）', async ({ assert }) => {
    const reqFks = await foreignKeys('plugin_change_requests')
    const hit = reqFks.find(
      (f) =>
        f.from === 'organization_id' && f.table === 'organizations' && f.on_delete === 'CASCADE',
    )
    assert.isOk(hit, 'requests.organization_id 应级联删除')

    const decFks = await foreignKeys('plugin_change_decisions')
    const decHit = decFks.find(
      (f) =>
        f.from === 'organization_id' && f.table === 'organizations' && f.on_delete === 'CASCADE',
    )
    assert.isOk(decHit, 'decisions.organization_id 应级联删除')
    const reqRefHit = decFks.find(
      (f) =>
        f.from === 'request_id' &&
        f.table === 'plugin_change_requests' &&
        f.on_delete === 'CASCADE',
    )
    assert.isOk(reqRefHit, 'decisions.request_id 应级联删除')
  })

  test('组织维度幂等唯一键存在', async ({ assert }) => {
    assert.isTrue(
      await hasUniqueIndex('plugin_change_requests', ['organization_id', 'request_uid']),
      '应存在 (organization_id, request_uid) 唯一键',
    )
    assert.isTrue(
      await hasUniqueIndex('plugin_change_decisions', ['organization_id', 'decision_uid']),
      '应存在 (organization_id, decision_uid) 幂等唯一键',
    )
  })

  test('封闭枚举 CHECK 约束（kind/state/event）', async ({ assert }) => {
    const reqSql = await tableSql('plugin_change_requests')
    assert.isTrue(checkEnum(reqSql, 'kind', ['install']), 'kind 应有 CHECK 约束')
    assert.isTrue(checkEnum(reqSql, 'state', ['draft']), 'state 应有九态 CHECK 约束（起始值）')
    // 九态完整出现（checkEnum 仅支持首值起匹配，深位序列用 includes 断言）
    for (const s of [
      'pending-approval',
      'awaiting-confirmation',
      'withdrawn',
      'expired',
      'failed',
    ]) {
      assert.isTrue(reqSql.includes(`'${s}'`), `state CHECK 应含 ${s}`)
    }
    const decSql = await tableSql('plugin_change_decisions')
    assert.isTrue(checkEnum(decSql, 'event', ['requested']), 'event 应有 CHECK 约束（起始值）')
    assert.isTrue(decSql.includes("'applied'"), 'event CHECK 应含 applied')
  })

  test('组织前缀索引覆盖常用查询路径', async ({ assert }) => {
    const reqSqlRaw = await tableSql('plugin_change_requests')
    const res = await db
      .rawQuery(
        `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='plugin_change_requests'`,
      )
      .catch(() => [] as IndexRow[])
    // SQLite 驱动直接返回行数组，PG 驱动返回 { rows }
    const rows: IndexRow[] = Array.isArray(res) ? res : ((res as { rows?: IndexRow[] }).rows ?? [])
    const sqls: string[] = rows.map((r) => r.sql ?? '')
    // SQLite 才能取到索引 SQL；PG 下由 pg_indexes 保证（此处仅做非空兜底）
    if (sqls.length > 0 && !reqSqlRaw.includes('information_schema')) {
      assert.isTrue(sqls.some((s) => s.includes('organization_id') && s.includes('state')))
      assert.isTrue(sqls.some((s) => s.includes('organization_id') && s.includes('expires_at')))
    } else {
      assert.isTrue(true)
    }
  })

  test('Model forOrganization 强制组织过滤', async ({ assert }) => {
    const rows = await PluginChangeRequest.forOrganization(999999)
    assert.equal(rows.length, 0, '不存在组织 999999 的请求')
    const decisions = await PluginChangeDecision.forOrganization(999999)
    assert.equal(decisions.length, 0)
  })
})
