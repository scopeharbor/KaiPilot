/**
 * v2-triz-recommendation-rationale-ui —— RationaleFeedbackService 单元测试。
 *
 * 使用 Mock AuditService 验证：
 * - Feedback 提交时调用 audit.log 且记录正确事件
 * - 备注脱敏（redactNoteText）
 * - Handoff 审计事件
 * - 审计失败不抛出（catch + logger.error）
 */
import { test } from '@japa/runner'
import RationaleFeedbackService from '#services/triz_rationale/rationale_feedback_service'
import { AuditEvent } from '#services/audit_service'
import { redactNoteText, type RationaleSourceRef } from '@aiproj/types'
import type { AuditEntry } from '#services/audit_service'

// ---------------------------------------------------------------------------
// Mock AuditService：捕获日志调用以便断言，不写入数据库。
// ---------------------------------------------------------------------------

function mockAuditService(throwOnLog: boolean = false) {
  const calls: AuditEntry[] = []
  const logFn = throwOnLog
    ? async (_entry: AuditEntry) => {
        calls.push(_entry)
        throw new Error('audit write failure')
      }
    : async (entry: AuditEntry) => {
        calls.push(entry)
      }

  return {
    log: logFn,
    calls,
  }
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function sampleSourceRefs(): RationaleSourceRef[] {
  return [
    {
      sourceType: 'contradiction',
      id: '42',
      hash: 'hash-abc',
      summary: '改善进度 vs 增加工作量',
    },
  ]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.group('RationaleFeedbackService', () => {
  // ── 1. 提交反馈写入审计日志 ─────────────────────────────────────────────

  test('submit 调用 audit.log 并记录 RATIONALE_FEEDBACK_SUBMITTED', async ({ assert }) => {
    const mock = mockAuditService()
    const service = new RationaleFeedbackService(mock as any)

    const response = await service.submit({
      organizationId: 1,
      projectId: 10,
      userId: 5,
      targetType: 'contradiction',
      targetId: '42',
      reason: 'helpful',
      note: '这个分析很准确',
      sourceRefs: sampleSourceRefs(),
    })

    // 审计日志被调用
    assert.lengthOf(mock.calls, 1)
    assert.equal(mock.calls[0].event, AuditEvent.RATIONALE_FEEDBACK_SUBMITTED)
    assert.equal(mock.calls[0].userId, 5)
    assert.equal(mock.calls[0].organizationId, 1)
    assert.equal(mock.calls[0].projectId, 10)
    assert.equal(mock.calls[0].entityType, 'triz_recommendation_rationale')
    assert.equal(mock.calls[0].metadata?.rationaleTarget, 'contradiction:42')
    assert.equal(mock.calls[0].metadata?.reason, 'helpful')
    assert.equal(mock.calls[0].metadata?.hasNote, true)
    assert.equal(mock.calls[0].metadata?.sourceRefCount, 1)

    // 反馈响应属性
    assert.property(response, 'id')
    assert.equal(response.rationaleTarget, 'contradiction:42')
    assert.equal(response.reason, 'helpful')
    assert.equal(response.note, '这个分析很准确')
    assert.equal(response.createdBy, 5)
    assert.property(response, 'createdAt')
  })

  // ── 2. 备注脱敏 ────────────────────────────────────────────────────────

  test('submit 含敏感 token 的备注被脱敏', async ({ assert }) => {
    const mock = mockAuditService()
    const service = new RationaleFeedbackService(mock as any)

    const response = await service.submit({
      organizationId: 1,
      projectId: 10,
      userId: 5,
      targetType: 'contradiction',
      targetId: '42',
      reason: 'helpful',
      note: 'token: sk-abc12345defghijklmnopqrstuvwxyz67890extralong and /etc/passwd content',
      sourceRefs: sampleSourceRefs(),
    })

    assert.notInclude(response.note!, 'sk-abc12345defgh')
    // redactNoteText 替换 base64 串与路径模式
    assert.notInclude(response.note!, '/etc/passwd')
    assert.include(response.note!, '[REDACTED_PATH]')
    const redacted = redactNoteText(
      'token: sk-abc12345defghijklmnopqrstuvwxyz67890extralong and /etc/passwd content',
    )
    assert.equal(response.note, redacted)
  })

  test('submit 无备注时返回 note=null', async ({ assert }) => {
    const mock = mockAuditService()
    const service = new RationaleFeedbackService(mock as any)

    const response = await service.submit({
      organizationId: 1,
      projectId: 10,
      userId: 5,
      targetType: 'recommendation',
      targetId: 'rec-1',
      reason: 'not_relevant',
      note: null,
      sourceRefs: [],
    })

    assert.isNull(response.note)
    // 审计 metadata 标记 hasNote=false
    assert.equal(mock.calls[0].metadata?.hasNote, false)
    assert.equal(mock.calls[0].metadata?.sourceRefCount, 0)
  })

  // ── 3. 各反馈原因 ──────────────────────────────────────────────────────

  test('每种反馈原因都能成功提交', async ({ assert }) => {
    const reasons = [
      'helpful',
      'not_relevant',
      'insufficient_evidence',
      'stale_source',
      'converted_to_draft',
    ] as const

    for (const reason of reasons) {
      const mock = mockAuditService()
      const service = new RationaleFeedbackService(mock as any)

      const response = await service.submit({
        organizationId: 1,
        projectId: 10,
        userId: 5,
        targetType: 'contradiction',
        targetId: '42',
        reason,
        note: null,
        sourceRefs: [],
      })

      assert.equal(response.reason, reason)
      assert.equal(mock.calls[0].metadata?.reason, reason)
    }
  })

  // ── 4. Handoff 审计 ────────────────────────────────────────────────────

  test('recordHandoff 记录 RATIONALE_HANDOFF_INITIATED 事件', async ({ assert }) => {
    const mock = mockAuditService()
    const service = new RationaleFeedbackService(mock as any)

    await service.recordHandoff(1, 10, 5, 'contradiction', '42', 'P1')

    assert.lengthOf(mock.calls, 1)
    assert.equal(mock.calls[0].event, AuditEvent.RATIONALE_HANDOFF_INITIATED)
    assert.equal(mock.calls[0].userId, 5)
    assert.equal(mock.calls[0].organizationId, 1)
    assert.equal(mock.calls[0].projectId, 10)
    assert.equal(mock.calls[0].entityType, 'triz_recommendation_rationale')
    assert.equal(mock.calls[0].metadata?.rationaleTarget, 'contradiction:42')
    assert.equal(mock.calls[0].metadata?.selectedPrinciple, 'P1')
  })

  test('recordHandoff 无选中原理时 selectedPrinciple=null', async ({ assert }) => {
    const mock = mockAuditService()
    const service = new RationaleFeedbackService(mock as any)

    await service.recordHandoff(1, 10, 5, 'recommendation', 'rec-1', null)

    assert.lengthOf(mock.calls, 1)
    assert.isNull(mock.calls[0].metadata?.selectedPrinciple)
  })

  // ── 5. 审计失败不抛出 ──────────────────────────────────────────────────

  test('audit.log 抛出异常时 submit 不抛出（内部 catch）', async ({ assert }) => {
    const mock = mockAuditService(true) // throwOnLog = true
    const service = new RationaleFeedbackService(mock as any)

    // 不应抛出异常
    await assert.doesNotReject(async () => {
      await service.submit({
        organizationId: 1,
        projectId: 10,
        userId: 5,
        targetType: 'contradiction',
        targetId: '42',
        reason: 'helpful',
        note: '测试异常隔离',
        sourceRefs: [],
      })
    })
  })

  test('audit.log 抛出异常时 recordHandoff 不抛出', async ({ assert }) => {
    const mock = mockAuditService(true)
    const service = new RationaleFeedbackService(mock as any)

    await assert.doesNotReject(async () => {
      await service.recordHandoff(1, 10, 5, 'contradiction', '42', 'P8')
    })
  })

  // ── 6. 只读无副作用：反馈响应是确定性结果 ──────────────────────────────

  test('相同输入产生 id 不同但 structure 一致', async ({ assert }) => {
    const mock = mockAuditService()
    const service = new RationaleFeedbackService(mock as any)

    const opts = {
      organizationId: 1,
      projectId: 10,
      userId: 5,
      targetType: 'contradiction' as const,
      targetId: '42',
      reason: 'helpful' as const,
      note: null,
      sourceRefs: [] as RationaleSourceRef[],
    }

    const a = await service.submit(opts)
    const b = await service.submit(opts)

    // id 基于 Date.now()，两次调用不同
    assert.notEqual(a.id, b.id)
    // 其余字段相同
    assert.equal(a.rationaleTarget, b.rationaleTarget)
    assert.equal(a.reason, b.reason)
    assert.equal(a.createdBy, b.createdBy)
  })
})
