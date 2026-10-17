import { test } from '@japa/runner'
import {
  ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
  type AdaptiveClarificationSession,
} from '@aiproj/types'
import AdaptiveClarificationTokenService from '../../app/services/ai_intent/adaptive_clarification_token_service.js'

function session(): AdaptiveClarificationSession {
  return {
    schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
    sessionId: 'session-1',
    round: 2,
    understanding: {
      schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
      summaryForUser: '测试项目',
      inferredDomainLabel: '测试',
      likelyDeliverables: [],
      knownFacts: [],
      informationNeeds: [],
      sufficientForPreliminaryDraft: true,
    },
    ledger: {
      schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
      revision: 1,
      entries: [],
    },
    knownUnknowns: [],
    conversation: null,
    status: 'ready',
  }
}

test.group('AdaptiveClarificationTokenService', () => {
  test('token 绑定组织、用户、原始意图与 ledger revision，并可刷新恢复', ({ assert }) => {
    const service = new AdaptiveClarificationTokenService('adaptive-test-secret', () => 1_000)
    const token = service.issue({
      organizationId: 7,
      userId: 9,
      rawInput: '这是至少十个字的测试项目描述',
      session: session(),
    })
    const restored = service.consume(token, {
      organizationId: 7,
      userId: 9,
      rawInput: '这是至少十个字的测试项目描述',
    })
    assert.equal(restored.ledger.revision, 1)
    assert.throws(
      () =>
        service.consume(token, {
          organizationId: 8,
          userId: 9,
          rawInput: '这是至少十个字的测试项目描述',
        }),
      /QUESTION_PLAN_STALE/u,
    )
    assert.throws(
      () =>
        service.consume(token, {
          organizationId: 7,
          userId: 9,
          rawInput: '被并发修改后的另一个项目描述',
        }),
      /QUESTION_PLAN_STALE/u,
    )
  })

  test('同一 revision 的并发双提交只允许一个 mutation 消费', ({ assert }) => {
    const service = new AdaptiveClarificationTokenService('adaptive-test-secret', () => 1_000)
    const scope = {
      organizationId: 7,
      userId: 9,
      rawInput: '这是至少十个字的并发提交测试',
    }
    const token = service.issue({ ...scope, session: session() })
    assert.equal(service.consumeForMutation(token, scope).ledger.revision, 1)
    assert.throws(() => service.consumeForMutation(token, scope), /QUESTION_PLAN_STALE/u)
    // Read-only refresh remains possible and does not count as a second answer submission.
    assert.equal(service.consume(token, scope).round, 2)
  })

  test('模型失败释放消费后可重试原答案，成功消费仍不能重复提交', ({ assert }) => {
    const service = new AdaptiveClarificationTokenService('adaptive-test-secret', () => 1_000)
    const scope = {
      organizationId: 7,
      userId: 9,
      rawInput: '这是至少十个字的失败重试测试',
    }
    const token = service.issue({ ...scope, session: session() })
    service.consumeForMutation(token, scope)
    service.releaseFailedMutation(token)
    assert.equal(service.consumeForMutation(token, scope).ledger.revision, 1)
    assert.throws(() => service.consumeForMutation(token, scope), /QUESTION_PLAN_STALE/u)
  })
})
