import { AuditEvent } from '#services/audit_service'
import {
  encodeTimelineCursor,
  decodeTimelineCursor,
} from '#services/timeline/project_activity_event_service'
import TimelineEventAdapter, { type AuditLogLike } from '#services/timeline/timeline_event_adapter'
import {
  buildAggregatedSummary,
  isTimelineCandidate,
  resolveTimelineMapping,
} from '#services/timeline/timeline_event_mapping'
import TimelineVisibilityService from '#services/timeline/timeline_visibility_service'
import type { ActivityEvent } from '#types/timeline_event'
import { test } from '@japa/runner'

function auditLog(overrides: Partial<AuditLogLike> & { event?: string } = {}): AuditLogLike {
  const { event, ...rest } = overrides
  return {
    id: overrides.id ?? 1,
    organizationId: 1,
    projectId: 10,
    userId: 100,
    entityType: 'task',
    entityId: 5,
    metadata: { event: event ?? AuditEvent.TASK_CREATED, name: '登录页' },
    createdAt: new Date('2026-07-12T10:00:00.000Z'),
    ...rest,
  }
}

test.group('Timeline 映射 allowlist', () => {
  test('允许事件可派生为候选', ({ assert }) => {
    assert.isTrue(isTimelineCandidate(AuditEvent.TASK_CREATED, { event: AuditEvent.TASK_CREATED }))
    assert.isTrue(isTimelineCandidate(AuditEvent.MILESTONE_ACHIEVED, {}))
    assert.isTrue(isTimelineCandidate(AuditEvent.CHANGE_REQUEST_APPROVED, {}))
  })

  test('认证/安全类事件默认隐藏', ({ assert }) => {
    assert.isFalse(isTimelineCandidate(AuditEvent.LOGIN_SUCCESS, {}))
    assert.isFalse(isTimelineCandidate(AuditEvent.PASSWORD_CHANGED, {}))
    assert.isFalse(isTimelineCandidate(AuditEvent.PERMISSION_DENIED, {}))
    assert.isFalse(isTimelineCandidate(AuditEvent.ROLE_CHANGED, {}))
  })

  test('删除类默认隐藏', ({ assert }) => {
    assert.isFalse(isTimelineCandidate(AuditEvent.TASK_DELETED, {}))
    assert.isFalse(isTimelineCandidate(AuditEvent.PROJECT_DELETED, {}))
    assert.isFalse(isTimelineCandidate(AuditEvent.COMMENT_DELETED, {}))
  })

  test('未知/未声明事件默认隐藏', ({ assert }) => {
    assert.isFalse(isTimelineCandidate('SOME_FUTURE_EVENT', {}))
    assert.isFalse(isTimelineCandidate(undefined, {}))
    assert.isFalse(isTimelineCandidate(null, {}))
    assert.isNull(resolveTimelineMapping('SOME_FUTURE_EVENT'))
  })

  test('TASK_UPDATED 仅重要字段变更时纳入', ({ assert }) => {
    assert.isFalse(isTimelineCandidate(AuditEvent.TASK_UPDATED, { changed: ['description'] }))
    assert.isFalse(isTimelineCandidate(AuditEvent.TASK_UPDATED, { changed: [] }))
    assert.isTrue(isTimelineCandidate(AuditEvent.TASK_UPDATED, { changed: ['assigneeId'] }))
    assert.isTrue(isTimelineCandidate(AuditEvent.TASK_UPDATED, { changed: ['endDate', 'color'] }))
  })

  test('摘要不泄露原始 event code', ({ assert }) => {
    for (const code of [
      AuditEvent.TASK_CREATED,
      AuditEvent.MILESTONE_ACHIEVED,
      AuditEvent.LOGIN_SUCCESS,
      AuditEvent.TASK_DELETED,
    ]) {
      const mapping = resolveTimelineMapping(code)
      if (!mapping) continue
      const summary = mapping.summaryBuilder({ objectLabel: null })
      assert.notInclude(summary, code)
    }
  })
})

test.group('Timeline 适配器', () => {
  const adapter = new TimelineEventAdapter()

  test('允许事件转 ActivityEvent', ({ assert }) => {
    const ev = adapter.toActivityEvent(auditLog({ event: AuditEvent.TASK_CREATED }))
    assert.isNotNull(ev)
    assert.equal(ev!.eventType, AuditEvent.TASK_CREATED)
    assert.equal(ev!.category, 'task')
    assert.equal(ev!.objectId, 5)
    assert.include(ev!.summaryTemplate, '登录页')
    assert.notInclude(ev!.summaryTemplate, 'TASK_CREATED')
  })

  test('隐藏事件返回 null', ({ assert }) => {
    assert.isNull(adapter.toActivityEvent(auditLog({ event: AuditEvent.LOGIN_SUCCESS })))
    assert.isNull(adapter.toActivityEvent(auditLog({ event: AuditEvent.TASK_DELETED })))
  })

  test('未知事件返回 null', ({ assert }) => {
    assert.isNull(adapter.toActivityEvent(auditLog({ event: 'UNKNOWN_XYZ' })))
    assert.isNull(adapter.toActivityEvent(auditLog({ metadata: {} })))
  })

  test('TASK_UPDATED 非重要字段返回 null', ({ assert }) => {
    assert.isNull(
      adapter.toActivityEvent(
        auditLog({ metadata: { event: AuditEvent.TASK_UPDATED, changed: ['description'] } }),
      ),
    )
    assert.isNotNull(
      adapter.toActivityEvent(
        auditLog({ metadata: { event: AuditEvent.TASK_UPDATED, changed: ['status'] } }),
      ),
    )
  })

  test('目标不可访问时脱敏：无 href/label/objectId', ({ assert }) => {
    const ev = adapter.toActivityEvent(auditLog({ event: AuditEvent.TASK_CREATED }))!
    const dto = adapter.toTimelineEvent(ev, {
      actorDisplayName: '甲',
      targetAccessible: false,
      redactObjectLabel: true,
    })
    assert.isNull(dto.objectId)
    assert.isNull(dto.targetRef!.href)
    assert.isNull(dto.targetRef!.label)
    assert.isFalse(dto.targetRef!.accessible)
    assert.notInclude(dto.summary, '登录页')
  })

  test('聚合 DTO 携带计数与目标集合', ({ assert }) => {
    const base = adapter.toActivityEvent(auditLog({ event: AuditEvent.TASK_CREATED }))!
    const group: ActivityEvent[] = [
      base,
      { ...base, id: 'audit:2', sourceId: 2 },
      { ...base, id: 'audit:3', sourceId: 3 },
    ]
    const dto = adapter.toAggregatedTimelineEvent(group, { actorDisplayName: '甲' })
    assert.isTrue(dto.isAggregated)
    assert.equal(dto.aggregatedCount, 3)
    assert.include(dto.summary, '3')
    assert.equal(dto.aggregatedTargets!.length, 3)
  })
})

test.group('Timeline 可见性与脱敏', () => {
  const svc = new TimelineVisibilityService()

  function ev(overrides: Partial<ActivityEvent>): ActivityEvent {
    return {
      id: 'audit:1',
      organizationId: 1,
      projectId: 10,
      source: 'audit_log',
      sourceId: 1,
      eventType: AuditEvent.TASK_CREATED,
      verb: 'created',
      category: 'task',
      importance: 'normal',
      visibility: 'project_member',
      occurredAt: new Date(),
      actorId: 100,
      objectType: 'task',
      objectId: 5,
      summaryTemplate: '创建了任务',
      objectLabel: '登录页',
      metadataSnapshot: null,
      isKeyEvent: false,
      ...overrides,
    }
  }

  test('隐藏事件不可见', ({ assert }) => {
    const d = svc.decide(ev({ visibility: 'hidden' }), { userId: 1, isAdmin: false })
    assert.isFalse(d.visible)
  })

  test('管理员可见事件对普通成员隐藏', ({ assert }) => {
    const admin = svc.decide(ev({ visibility: 'admin' }), { userId: 1, isAdmin: true })
    const member = svc.decide(ev({ visibility: 'admin' }), { userId: 1, isAdmin: false })
    assert.isTrue(admin.visible)
    assert.isFalse(member.visible)
  })

  test('删除类对非管理员隐藏', ({ assert }) => {
    const d = svc.decide(ev({ verb: 'deleted' }), { userId: 1, isAdmin: false })
    assert.isFalse(d.visible)
  })

  test('目标不可访问 → 可见但脱敏名称', ({ assert }) => {
    const accessible = new Map<string, Set<number>>([['task', new Set([999])]])
    const d = svc.decide(ev({ objectId: 5 }), {
      userId: 1,
      isAdmin: false,
      accessibleTargetIds: accessible,
    })
    assert.isTrue(d.visible)
    assert.isFalse(d.targetAccessible)
    assert.isTrue(d.redactObjectLabel)
  })

  test('filterVisible 丢弃不可见事件', ({ assert }) => {
    const list = [
      ev({ id: 'a', visibility: 'project_member' }),
      ev({ id: 'b', visibility: 'hidden' }),
    ]
    const visible = svc.filterVisible(list, { userId: 1, isAdmin: false })
    assert.equal(visible.length, 1)
    assert.equal(visible[0]!.event.id, 'a')
  })
})

test.group('Timeline 游标', () => {
  test('编码解码往返一致', ({ assert }) => {
    const now = new Date('2026-07-12T10:00:00.000Z')
    const cursor = encodeTimelineCursor(now, 42)
    const decoded = decodeTimelineCursor(cursor)
    assert.isNotNull(decoded)
    assert.equal(decoded!.i, 42)
    assert.equal(new Date(decoded!.t).getTime(), now.getTime())
  })

  test('非法游标返回 null', ({ assert }) => {
    assert.isNull(decodeTimelineCursor('not-base64-@@@'))
    assert.isNull(decodeTimelineCursor(Buffer.from('{"x":1}').toString('base64url')))
  })

  test('聚合摘要文案', ({ assert }) => {
    assert.equal(buildAggregatedSummary('created', 'task', 5), '创建了 5 个任务')
  })
})
