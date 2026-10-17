import { AuditEvent } from '#services/audit_service'
import {
  resolveTimelineMapping,
  isTimelineCandidate,
} from '#services/timeline/timeline_event_mapping'
import { test } from '@japa/runner'

/**
 * 变更影响分析 Timeline 适配测试（v2-change-management-impact-analysis §9.2）。
 *
 * 断言允许事件可见、未知事件隐藏、摘要不泄露原始 event code 或敏感正文。
 */

const IMPACT_EVENTS = [
  AuditEvent.CHANGE_IMPACT_ANALYSIS_CREATED,
  AuditEvent.CHANGE_IMPACT_ANALYSIS_REFRESHED,
  AuditEvent.CHANGE_IMPACT_ANALYSIS_CONFIRMED,
  AuditEvent.CHANGE_IMPACT_ANALYSIS_CONFIRMED_STALE,
  AuditEvent.CHANGE_IMPACT_ANALYSIS_STALE_DETECTED,
  AuditEvent.CHANGE_IMPACT_AI_EXPLANATION_GENERATED,
  AuditEvent.CHANGE_IMPACT_APPROVE_REFERENCED,
] as const

test.group('变更影响 Timeline 映射', () => {
  test('全部 7 个影响事件均为 Timeline 候选且归入 change_request 分类', ({ assert }) => {
    for (const event of IMPACT_EVENTS) {
      assert.isTrue(isTimelineCandidate(event), `${event} 应为 Timeline 候选`)
      const mapping = resolveTimelineMapping(event)
      assert.exists(mapping, `${event} 应有映射`)
      assert.equal(mapping!.category, 'change_request')
      assert.equal(mapping!.visibility, 'project_member')
      assert.equal(mapping!.objectType, 'change_impact_analysis')
    }
  })

  test('未知/未声明事件默认隐藏', ({ assert }) => {
    assert.isFalse(isTimelineCandidate('CHANGE_IMPACT_SOMETHING_UNKNOWN'))
    assert.isNull(resolveTimelineMapping('CHANGE_IMPACT_SOMETHING_UNKNOWN'))
    assert.isFalse(isTimelineCandidate(null))
    assert.isFalse(isTimelineCandidate(undefined))
  })

  test('摘要为中文短语，不回退为原始 event code，也不含敏感数字/字段', ({ assert }) => {
    for (const event of IMPACT_EVENTS) {
      const mapping = resolveTimelineMapping(event)!
      const summary = mapping.summaryBuilder({ objectLabel: null })
      assert.isString(summary)
      assert.isAbove(summary.trim().length, 0, `${event} 摘要不得为空`)
      assert.notInclude(summary, event, '摘要不得泄露原始 event code')
      assert.notInclude(summary, 'CHANGE_IMPACT', '摘要不得泄露内部事件前缀')
      // 静态摘要不得携带严重度数字或确认原因等敏感正文
      assert.notInclude(summary, 'confirmReason')
      assert.notMatch(summary, /\d{2,}/, '摘要不应嵌入敏感数字（如严重度分布）')
    }
  })

  test('审批引用为关键事件；过期检测为低重要度', ({ assert }) => {
    const approveRef = resolveTimelineMapping(AuditEvent.CHANGE_IMPACT_APPROVE_REFERENCED)!
    assert.isTrue(approveRef.isKeyEvent, '审批引用应为关键事件')
    assert.equal(approveRef.importance, 'high')

    const staleDetected = resolveTimelineMapping(AuditEvent.CHANGE_IMPACT_ANALYSIS_STALE_DETECTED)!
    assert.isFalse(staleDetected.isKeyEvent)
    assert.equal(staleDetected.importance, 'low')
  })
})
