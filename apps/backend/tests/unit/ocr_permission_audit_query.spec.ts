import { test } from '@japa/runner'
import AuditLog from '#models/audit_log'
import {
  computeBoundedPaginationMeta,
  queryOcrPermissionAudit,
} from '../../app/services/ai_ocr/ocr_permission_audit_query.js'
import { createTestOrg, createTestUser, setupTest } from '../helpers/index.js'

/**
 * OCR 权限/审计查询只读回归测试（v3-ocr-permission-and-audit §3.9）。
 *
 * 证明 `queryOcrPermissionAudit` 只对既有 `audit_logs` 做 SELECT，绝不
 * update/delete：查询前后同一批记录不变、无新增、无篡改，且复用 AuditLog
 * 模型自带的不可变语义（delete/update 抛错）。
 */
test.group('OCR 权限/审计查询（只读）', () => {
  test('查询仅返回 OCR 权限事件且不修改 audit_logs', async ({ assert }) => {
    const { db } = await setupTest()
    const org = await createTestOrg(db)
    const user = await createTestUser(db, org, { role: 'pmo' })

    const base = {
      organizationId: org.id,
      projectId: 1,
      entityType: 'ocr',
      severity: 'info',
      userId: user.id,
    }

    // 一条 OCR 权限事件（应被查询命中）
    await AuditLog.create({
      ...base,
      action: 'read',
      entityId: 1,
      metadata: {
        event: 'ocr.permission.status_read',
        action: 'permission_status_read',
        result: 'allow',
        reasonCodes: [],
        sourceHash: 'src_hash_001',
      },
    })
    // 一条非 OCR 事件（应被过滤）
    await AuditLog.create({
      ...base,
      action: 'read',
      metadata: { event: 'project.updated', action: 'update' },
    })
    // 一条 OCR 但非权限事件（应被过滤）
    await AuditLog.create({
      ...base,
      action: 'read',
      metadata: { event: 'ocr.run.completed', action: 'provider_run' },
    })

    const beforeCountRow = await AuditLog.query().count('* as total').first()
    const beforeCount = Number(beforeCountRow?.$extras.total ?? 0)

    const result = await queryOcrPermissionAudit({
      organizationId: org.id,
      projectId: 1,
      page: 1,
      perPage: 10,
    })

    // 只命中 1 条 OCR 权限事件
    assert.equal(result.data.length, 1)
    assert.equal(result.data[0].action, 'permission_status_read')
    assert.equal(result.data[0].result, 'allow')
    assert.equal(result.meta.total, 1)
    assert.equal(result.meta.totalPages, 1)

    // 只读性：查询后记录数不变、记录未被篡改
    const afterCountRow = await AuditLog.query().count('* as total').first()
    const afterCount = Number(afterCountRow?.$extras.total ?? 0)
    assert.equal(afterCount, beforeCount, '查询不应新增/删除 audit_logs')

    const row = await AuditLog.query()
      .where('metadata', 'like', '%ocr.permission.status_read%')
      .first()
    assert.isNotNull(row)
    assert.equal((row!.metadata as Record<string, unknown>).result, 'allow')
  })

  test('按 action / result / reasonCode 过滤', async ({ assert }) => {
    const { db } = await setupTest()
    const org = await createTestOrg(db)
    const user = await createTestUser(db, org, { role: 'pmo' })

    const base = {
      organizationId: org.id,
      projectId: 2,
      entityType: 'ocr',
      severity: 'info',
      userId: user.id,
    }
    await AuditLog.create({
      ...base,
      action: 'approve',
      metadata: {
        event: 'ocr.permission.review_confirm',
        action: 'review_confirm',
        result: 'confirm_required',
        reasonCodes: ['confirmation_required'],
        sourceHash: 'a',
      },
    })
    await AuditLog.create({
      ...base,
      action: 'reject',
      metadata: {
        event: 'ocr.permission.privacy_block',
        action: 'review_confirm',
        result: 'privacy_blocked',
        reasonCodes: ['privacy_blocked'],
        sourceHash: 'b',
      },
    })

    const confirmed = await queryOcrPermissionAudit({
      organizationId: org.id,
      projectId: 2,
      action: 'review_confirm',
      result: 'confirm_required',
    })
    assert.equal(confirmed.data.length, 1)
    assert.equal(confirmed.data[0].reasonCodes[0], 'confirmation_required')

    const blocked = await queryOcrPermissionAudit({
      organizationId: org.id,
      projectId: 2,
      reasonCode: 'privacy_blocked',
    })
    assert.equal(blocked.data.length, 1)
    assert.equal(blocked.data[0].result, 'privacy_blocked')
  })

  test('分页元信息有界且正确', ({ assert }) => {
    const meta = computeBoundedPaginationMeta(5, 1, 10)
    assert.equal(meta.total, 5)
    assert.equal(meta.perPage, 10)
    assert.equal(meta.totalPages, 1)
  })
})
