import { test } from '@japa/runner'
import type { ClarificationAnswers, ClarificationCard } from '@aiproj/types'
import AgentQuestionPlanTokenService from '../../app/services/ai_intent/agent_question_plan_token_service.js'

function card(field: 'agentRisk' | 'agentDependency' | 'agentAcceptance'): ClarificationCard {
  return {
    cardId: `1.0:${field}:recommended`,
    field,
    category: 'recommended',
    title: `${field} 的追问`,
    description: '只询问仍会影响项目计划质量的缺口。',
    impactScope: [{ domain: '风险', severity: 'medium' }],
    questionType: 'text',
    quickOptions: [],
    customInput: {
      enabled: true,
      label: '自定义输入',
      placeholder: '请输入真实情况',
      description: '按实际情况补充。',
    },
    defaultValue: null,
    confidence: 0.6,
    reasoning: '计划仍缺少这一事实。',
    allowSkip: true,
    isRequired: false,
    phase: 'agent',
    source: 'agent',
    packId: null,
    triggerEvidence: ['固定与条件卡片已完成'],
    suggestedValue: null,
  }
}

function baseAnswers(): ClarificationAnswers {
  return {
    projectGoal: {
      field: 'projectGoal',
      action: 'answer',
      value: '建设内部工单系统',
      marker: null,
      cardId: '1.0:projectGoal:critical',
      source: 'core',
    },
  }
}

function agentAnswer(field: 'agentRisk' | 'agentDependency' | 'agentAcceptance') {
  return {
    field,
    action: 'answer' as const,
    value: `${field} 已确认`,
    marker: null,
    cardId: `1.0:${field}:recommended`,
    source: 'agent' as const,
  }
}

test.group('AgentQuestionPlanTokenService', () => {
  test('一次签发三张卡并逐题消费，revision 推进且不需要再次生成', ({ assert }) => {
    const service = new AgentQuestionPlanTokenService('test-plan-secret', () => 1_000)
    const answers = baseAnswers()
    const issued = service.issue({
      organizationId: 8,
      userId: 1,
      rawInput: '建设面向运营团队的内部工单系统',
      answers,
      selectedPackIds: ['integration-migration@1.0'],
      cards: [card('agentRisk'), card('agentDependency'), card('agentAcceptance')],
    })

    const afterFirstAnswers = { ...answers, agentRisk: agentAnswer('agentRisk') }
    const afterFirst = service.consume(issued.token, {
      organizationId: 8,
      userId: 1,
      rawInput: '建设面向运营团队的内部工单系统',
      answers: afterFirstAnswers,
      questionPlanRevision: issued.questionPlanRevision,
    })
    assert.deepEqual(
      afterFirst.cards.map((entry) => entry.field),
      ['agentDependency', 'agentAcceptance'],
    )
    assert.notEqual(afterFirst.questionPlanRevision, issued.questionPlanRevision)

    const afterSecondAnswers = {
      ...afterFirstAnswers,
      agentDependency: agentAnswer('agentDependency'),
    }
    const afterSecond = service.consume(issued.token, {
      organizationId: 8,
      userId: 1,
      rawInput: '建设面向运营团队的内部工单系统',
      answers: afterSecondAnswers,
      questionPlanRevision: afterFirst.questionPlanRevision,
    })
    assert.deepEqual(
      afterSecond.cards.map((entry) => entry.field),
      ['agentAcceptance'],
    )

    const completed = service.consume(issued.token, {
      organizationId: 8,
      userId: 1,
      rawInput: '建设面向运营团队的内部工单系统',
      answers: { ...afterSecondAnswers, agentAcceptance: agentAnswer('agentAcceptance') },
      questionPlanRevision: afterSecond.questionPlanRevision,
    })
    assert.lengthOf(completed.cards, 0)
    assert.equal(completed.answeredAgentCount, 3)
    assert.equal(completed.totalAgentCount, 3)
  })

  test('刷新或重试可用当前 revision 原样恢复同一批次', ({ assert }) => {
    const service = new AgentQuestionPlanTokenService('test-plan-secret', () => 1_000)
    const answers = baseAnswers()
    const issued = service.issue({
      organizationId: 8,
      userId: 1,
      rawInput: '建设面向运营团队的内部工单系统',
      answers,
      selectedPackIds: [],
      cards: [card('agentRisk'), card('agentDependency')],
    })
    const replayed = service.consume(issued.token, {
      organizationId: 8,
      userId: 1,
      rawInput: '建设面向运营团队的内部工单系统',
      answers,
      questionPlanRevision: issued.questionPlanRevision,
    })
    assert.deepEqual(
      replayed.cards.map((entry) => entry.field),
      ['agentRisk', 'agentDependency'],
    )
    assert.equal(replayed.questionPlanRevision, issued.questionPlanRevision)
  })

  test('篡改、跨组织、过期、核心答案变化与旧 revision 均 fail closed', ({ assert }) => {
    let now = 1_000
    const service = new AgentQuestionPlanTokenService('test-plan-secret', () => now)
    const answers = baseAnswers()
    const issued = service.issue({
      organizationId: 8,
      userId: 1,
      rawInput: '建设面向运营团队的内部工单系统',
      answers,
      selectedPackIds: [],
      cards: [card('agentRisk'), card('agentDependency')],
    })
    const consume = (overrides: Partial<Parameters<typeof service.consume>[1]> = {}) =>
      service.consume(issued.token, {
        organizationId: 8,
        userId: 1,
        rawInput: '建设面向运营团队的内部工单系统',
        answers,
        questionPlanRevision: issued.questionPlanRevision,
        ...overrides,
      })

    assert.throws(
      () =>
        service.consume(`${issued.token}x`, {
          organizationId: 8,
          userId: 1,
          rawInput: '建设面向运营团队的内部工单系统',
          answers,
          questionPlanRevision: issued.questionPlanRevision,
        }),
      /QUESTION_PLAN_STALE/u,
    )
    assert.throws(() => consume({ organizationId: 9 }), /QUESTION_PLAN_STALE/u)
    assert.throws(
      () =>
        consume({
          answers: { ...answers, projectGoal: { ...answers.projectGoal!, value: '已改变' } },
        }),
      /QUESTION_PLAN_STALE/u,
    )
    assert.throws(() => consume({ questionPlanRevision: 'old-revision' }), /QUESTION_PLAN_STALE/u)

    now += 8 * 60 * 60 * 1_000 + 1
    assert.throws(() => consume(), /QUESTION_PLAN_STALE/u)
  })
})
