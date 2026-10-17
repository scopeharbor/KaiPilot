import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { columnNames, tableSql, hasUniqueIndex, checkEnum } from './_helpers.js'

/**
 * 任务 5.7 — 通用模块六表结构校验。
 * 重点断言：audit_logs 只写不删，attachments 支持 deleted_at 软删除；
 * 多态字段、枚举 CHECK、联合/多态索引。
 */
test.group('通用模块结构', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('audit_logs 不含 deleted_at（只写不删）', async ({ assert }) => {
    const cols = await columnNames('audit_logs')
    assert.notInclude(cols, 'deleted_at', 'audit_logs 禁止软删除字段')
    for (const c of [
      'organization_id',
      'project_id',
      'user_id',
      'entity_type',
      'entity_id',
      'action',
      'changes',
      'metadata',
      'severity',
      'request_id',
    ]) {
      assert.include(cols, c, `audit_logs 应含字段 ${c}`)
    }
    const sql = await tableSql('audit_logs')
    assert.isTrue(checkEnum(sql, 'action', ['create', 'read', 'update']), 'action 枚举 CHECK')
    assert.isTrue(
      checkEnum(sql, 'severity', ['info', 'warning', 'error', 'critical']),
      'severity 枚举 CHECK',
    )
  })

  test('attachments 含 deleted_at（软删除保留附件元数据）', async ({ assert }) => {
    const cols = await columnNames('attachments')
    assert.include(cols, 'deleted_at', 'attachments 应支持软删除字段')
    for (const c of [
      'entity_type',
      'entity_id',
      'project_id',
      'storage_provider',
      'file_size',
      'thumbnail_path',
    ]) {
      assert.include(cols, c)
    }
    const sql = await tableSql('attachments')
    assert.isTrue(
      checkEnum(sql, 'storage_provider', ['local', 's3', 'minio', 'oss']),
      'storage_provider 枚举 CHECK',
    )
  })

  test('comments 多态 + 自引用 + 软删除', async ({ assert }) => {
    const cols = await columnNames('comments')
    assert.include(cols, 'deleted_at')
    for (const c of [
      'entity_type',
      'entity_id',
      'project_id',
      'author_id',
      'parent_id',
      'content_json',
      'is_internal',
      'edited_at',
      'organization_id',
      'task_id',
      'body',
      'body_format',
      'deleted_by',
    ]) {
      assert.include(cols, c)
    }
  })

  test('change_requests 字段 + 状态机枚举', async ({ assert }) => {
    const cols = await columnNames('change_requests')
    assert.include(cols, 'deleted_at')
    for (const c of [
      'cr_code',
      'project_id',
      'change_type',
      'status',
      'impact_analysis',
      'ai_metadata',
      'submitted_at',
    ]) {
      assert.include(cols, c)
    }
    const sql = await tableSql('change_requests')
    assert.isTrue(checkEnum(sql, 'change_type', ['scope', 'schedule']), 'change_type 枚举 CHECK')
    assert.isTrue(
      checkEnum(sql, 'status', ['draft', 'submitted', 'under_review']),
      'change_requests status 枚举 CHECK',
    )
  })

  test('documents 多态文件夹结构 + 软删除', async ({ assert }) => {
    const cols = await columnNames('documents')
    assert.include(cols, 'deleted_at')
    for (const c of [
      'project_id',
      'parent_id',
      'document_type',
      'content',
      'content_json',
      'version',
      'is_template',
    ]) {
      assert.include(cols, c)
    }
  })

  test('reports 字段 + 类型枚举', async ({ assert }) => {
    const cols = await columnNames('reports')
    assert.include(cols, 'deleted_at')
    for (const c of [
      'project_id',
      'report_type',
      'config',
      'data_snapshot',
      'format_config',
      'generated_at',
      'file_path',
    ]) {
      assert.include(cols, c)
    }
    const sql = await tableSql('reports')
    assert.isTrue(
      checkEnum(sql, 'report_type', [
        'status',
        'progress',
        'delay',
        'workload',
        'risk',
        'resource',
        'cost',
        'milestone',
        'custom',
      ]),
      'report_type 枚举 CHECK（含 preset-project-reports 扩容的 delay/workload）',
    )
  })

  test('多态表含 (entity_type, entity_id) 索引', async ({ assert }) => {
    assert.isTrue(await hasUniqueIndex('task_dependencies', ['predecessor_id', 'successor_id']))
    // attachments / audit_logs 的多态复合索引（非 unique）
    const res = await import('@adonisjs/lucid/services/db')
    const db = res.default
    for (const t of ['attachments', 'audit_logs', 'comments']) {
      const idxRes = await db.rawQuery(
        `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='${t}'`,
      )
      const sqlText = (((idxRes as any).rows ?? idxRes) as any[]).map((r) => r.sql ?? '').join('\n')
      assert.match(sqlText, /entity_type.*entity_id|entity_id.*entity_type/s, `${t} 应有多态索引`)
    }
  })
})
