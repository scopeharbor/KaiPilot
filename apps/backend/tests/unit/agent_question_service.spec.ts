import { test } from '@japa/runner'
import {
  AI_INTENT_SCHEMA_VERSION,
  type ClarificationAnswers,
  type ConfirmedProjectContext,
} from '@aiproj/types'
import type { GenerateOptions, GenerateResult } from '../../app/services/ai_m0/gateway.js'
import AgentQuestionService from '../../app/services/ai_intent/agent_question_service.js'

function context(): ConfirmedProjectContext {
  return {
    schemaVersion: AI_INTENT_SCHEMA_VERSION,
    rawInput: '内部工单系统，联系人 pm@example.com，密钥 sk-not-a-real-test-secret',
    parsedIntent: {
      schemaVersion: AI_INTENT_SCHEMA_VERSION,
      projectType: 'software',
      projectName: '内部工单系统',
      objectives: ['缩短处理时效'],
      deliverables: ['工单流转', '数据看板'],
      timeline: { startDate: '2026-09-01', deadline: '2026-10-30', durationDays: null },
      constraints: [],
      entities: [],
      overallConfidence: 0.9,
    },
    resolvedFields: {
      projectGoal: {
        value: '让 pm@example.com 的工单处理时效提升 30%',
        marker: {
          source: 'explicit',
          confidence: 1,
          reason: '测试',
          needsConfirmation: false,
        },
      },
    },
    assumptions: {},
    unresolvedCriticalFields: [],
    unansweredOptionalFields: [],
  }
}

function result(rawText: string): GenerateResult {
  return {
    rawText,
    triggeredErrors: [],
    outputTokens: 80,
    firstTokenMs: 10,
    totalMs: 20,
    usingRealAdapter: true,
  }
}

test.group('AgentQuestionService', () => {
  test('生成目录内追问并在发布前通过 checker', async ({ assert }) => {
    let captured: GenerateOptions | null = null
    const gateway = {
      async generate(options: GenerateOptions) {
        captured = options
        return result(
          JSON.stringify({
            questions: [
              {
                field: 'agentDependency',
                title: '哪个外部依赖最可能影响 10 月上线？',
                description: '请确认审批、供应商或接口依赖。',
                questionType: 'single_choice',
                reasoning: '当前计划已有日期，但没有外部依赖负责人。',
                quickOptions: [
                  {
                    label: '跨部门审批',
                    value: 'approval',
                    description: '需要明确审批人和最晚完成时间。',
                  },
                ],
              },
            ],
          }),
        )
      },
    }

    const plan = await new AgentQuestionService().propose({
      gateway,
      context: context(),
      answers: {},
      selectedPackIds: ['rollout-change@1.0'],
    })

    assert.lengthOf(plan.cards, 1)
    assert.equal(plan.cards[0]?.source, 'agent')
    assert.equal(plan.cards[0]?.phase, 'agent')
    assert.isTrue(plan.coverage.valid)
    const userPrompt = (captured as GenerateOptions | null)?.promptSet?.userPrompt ?? ''
    assert.notInclude(userPrompt, 'pm@example.com')
    assert.notInclude(userPrompt, 'sk-not-a-real-test-secret')
    assert.include(userPrompt, '[REDACTED_EMAIL]')
  })

  test('目录外、重复和不完整问题不会发布', async ({ assert }) => {
    const gateway = {
      async generate() {
        return result(
          JSON.stringify({
            questions: [
              {
                field: 'projectGoal',
                title: '重复问目标',
                description: '不应显示',
                questionType: 'text',
                reasoning: '不应显示',
              },
              { field: 'agentRisk', title: '', description: '', questionType: 'text' },
            ],
          }),
        )
      },
    }

    const plan = await new AgentQuestionService().propose({
      gateway,
      context: context(),
      answers: {},
      selectedPackIds: [],
    })
    assert.lengthOf(plan.cards, 0)
    assert.isTrue(plan.coverage.valid)
  })

  test('单次 provider 调用可以发布最多五张不同 Agent 卡片', async ({ assert }) => {
    let calls = 0
    const fields = [
      'agentRisk',
      'agentDependency',
      'agentAcceptance',
      'agentStakeholder',
      'agentConstraint',
    ] as const
    const gateway = {
      async generate() {
        calls += 1
        return result(
          JSON.stringify({
            questions: fields.map((field) => ({
              field,
              title: `${field} 需要确认什么？`,
              description: '请补充会影响真实项目计划的事实。',
              questionType: 'text',
              reasoning: '当前上下文仍缺少该项事实。',
            })),
          }),
        )
      },
    }

    const plan = await new AgentQuestionService().propose({
      gateway,
      context: context(),
      answers: {},
      selectedPackIds: [],
      compatibilityBatchLimit: 5,
    })

    assert.equal(calls, 1)
    assert.deepEqual(
      plan.cards.map((entry) => entry.field),
      fields,
    )
  })

  test('provider 失败安全降级为无更多问题且不伪造卡片', async ({ assert }) => {
    const gateway = {
      async generate() {
        throw new Error('provider timeout')
      },
    }
    const plan = await new AgentQuestionService().propose({
      gateway,
      context: context(),
      answers: {},
      selectedPackIds: [],
    })
    assert.lengthOf(plan.cards, 0)
    assert.isTrue(plan.coverage.valid)
  })

  test('五个 Agent 回答后不再调用 provider', async ({ assert }) => {
    let calls = 0
    const gateway = {
      async generate() {
        calls += 1
        return result('{"questions":[]}')
      },
    }
    const answers = Object.fromEntries(
      [
        'agentRisk',
        'agentDependency',
        'agentAcceptance',
        'agentStakeholder',
        'agentConstraint',
      ].map((field) => [
        field,
        { field, action: 'answer', value: '已确认', marker: null, source: 'agent' },
      ]),
    ) as ClarificationAnswers
    const plan = await new AgentQuestionService().propose({
      gateway,
      context: context(),
      answers,
      selectedPackIds: [],
    })

    assert.equal(calls, 0)
    assert.lengthOf(plan.cards, 0)
  })
})
