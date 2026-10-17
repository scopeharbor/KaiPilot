/**
 * PMO Priority Scoring 审计测试（v3-pmo-priority-scoring-model §4.15-4.16）
 *
 * 覆盖：元数据发射、脱敏、拒绝读行为、策略拒绝前无审计写入
 */
import { test } from '@japa/runner'
import {
  PMO_PRIORITY_SCORING_AUDIT_EVENTS,
  buildPriorityScoringSummaryReadAudit,
  buildPriorityScoringListReadAudit,
  buildPriorityScoringGroupsReadAudit,
  buildPriorityScoringWeightsReadAudit,
  buildPriorityScoringDetailReadAudit,
  buildPriorityScoringDeniedAudit,
} from '../../app/services/pmo_priority_scoring_audit.js'

// 简单 mock User 类型
function mockUser(id: number) {
  return { id, email: `user${id}@test.local`, isSuperAdmin: false } as any
}

test.group('PriorityScoring — audit events', () => {
  test('6 个审计事件类型定义完整', ({ assert }) => {
    assert.equal(Object.keys(PMO_PRIORITY_SCORING_AUDIT_EVENTS).length, 6)
  })

  test('SUMMARY_READ 事件包含 organizationId 和 actorId', ({ assert }) => {
    const user = mockUser(1)
    const entry = buildPriorityScoringSummaryReadAudit(user, 42, 'pmo-priority-v1')
    assert.equal(entry.event, PMO_PRIORITY_SCORING_AUDIT_EVENTS.SUMMARY_READ)
    assert.equal(entry.metadata.organizationId, 42)
    assert.equal(entry.metadata.actorId, 1)
    assert.equal(entry.metadata.scoreVersion, 'pmo-priority-v1')
  })

  test('LIST_READ 事件包含分页参数', ({ assert }) => {
    const user = mockUser(2)
    const entry = buildPriorityScoringListReadAudit(user, 42, {
      page: 1,
      perPage: 20,
      sort: 'priority_score',
    })
    assert.equal(entry.event, PMO_PRIORITY_SCORING_AUDIT_EVENTS.LIST_READ)
    assert.equal(entry.metadata.page, 1)
    assert.equal(entry.metadata.perPage, 20)
  })

  test('GROUPS_READ 事件包含 groupBy', ({ assert }) => {
    const user = mockUser(3)
    const entry = buildPriorityScoringGroupsReadAudit(user, 42, 'priority_level')
    assert.equal(entry.event, PMO_PRIORITY_SCORING_AUDIT_EVENTS.GROUPS_READ)
    assert.equal(entry.metadata.groupBy, 'priority_level')
  })

  test('WEIGHTS_READ 事件包含版本', ({ assert }) => {
    const user = mockUser(4)
    const entry = buildPriorityScoringWeightsReadAudit(user, 42, 'pmo-priority-v1')
    assert.equal(entry.event, PMO_PRIORITY_SCORING_AUDIT_EVENTS.WEIGHTS_READ)
    assert.equal(entry.metadata.scoreVersion, 'pmo-priority-v1')
  })

  test('DETAIL_READ 事件包含 projectId', ({ assert }) => {
    const user = mockUser(5)
    const entry = buildPriorityScoringDetailReadAudit(user, 42, 100)
    assert.equal(entry.event, PMO_PRIORITY_SCORING_AUDIT_EVENTS.DETAIL_READ)
    assert.equal(entry.metadata.projectId, 100)
  })

  test('PERMISSION_DENIED 事件包含 deniedCode', ({ assert }) => {
    const user = mockUser(6)
    const entry = buildPriorityScoringDeniedAudit(user, 42, 'PERMISSION_DENIED')
    assert.equal(entry.event, PMO_PRIORITY_SCORING_AUDIT_EVENTS.PERMISSION_DENIED)
    assert.equal(entry.metadata.deniedCode, 'PERMISSION_DENIED')
  })
})

test.group('PriorityScoring — audit redaction', () => {
  test('审计元数据不含 prompt/模型输出/token/API key', ({ assert }) => {
    const user = mockUser(1)
    const entry = buildPriorityScoringSummaryReadAudit(user, 42)

    const metaJson = JSON.stringify(entry.metadata)
    assert.isFalse(metaJson.includes('prompt'))
    assert.isFalse(metaJson.includes('modelOutput'))
    assert.isFalse(metaJson.includes('apiKey'))
    assert.isFalse(metaJson.includes('token'))
  })

  test('审计元数据不含跨组织数据', ({ assert }) => {
    const user = mockUser(1)
    const entry = buildPriorityScoringSummaryReadAudit(user, 42)

    const metaJson = JSON.stringify(entry.metadata)
    assert.isFalse(metaJson.includes('crossOrg'))
    assert.isFalse(metaJson.includes('otherOrganization'))
  })

  test('审计元数据不含完整证据文本', ({ assert }) => {
    const user = mockUser(1)
    const entry = buildPriorityScoringDetailReadAudit(user, 42, 100)

    const metaJson = JSON.stringify(entry.metadata)
    assert.isFalse(metaJson.includes('evidence'))
    assert.isFalse(metaJson.includes('fullText'))
  })
})
