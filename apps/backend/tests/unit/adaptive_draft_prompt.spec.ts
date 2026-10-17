import { test } from '@japa/runner'
import {
  ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
  AI_INTENT_SCHEMA_VERSION,
  type ConfirmedProjectContext,
} from '@aiproj/types'
import { ProjectDraftPromptBuilder } from '../../app/services/ai_draft/prompt_builder.js'

function context(): ConfirmedProjectContext {
  return {
    schemaVersion: AI_INTENT_SCHEMA_VERSION,
    rawInput: '规划一个资料尚未完全确定的项目',
    parsedIntent: {
      schemaVersion: AI_INTENT_SCHEMA_VERSION,
      projectType: 'general',
      projectName: '测试项目',
      objectives: ['形成可执行计划'],
      deliverables: [],
      timeline: { startDate: null, deadline: null, durationDays: null },
      constraints: [],
      entities: [],
      overallConfidence: 0.8,
    },
    resolvedFields: {},
    assumptions: {},
    unresolvedCriticalFields: [],
    unansweredOptionalFields: [],
    adaptiveLedger: {
      schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
      revision: 2,
      entries: [
        {
          needId: 'need:people',
          topic: '参与人数',
          status: 'answered',
          questionSummary: '大约有多少人参与？',
          answer: 500,
          revision: 1,
          updatedAt: '2026-08-31T00:00:00.000Z',
        },
      ],
    },
    knownUnknowns: [
      {
        needId: 'need:budget',
        topic: '可用预算',
        impact: '会影响采购范围和审批时间',
        recordedAt: '2026-08-31T00:00:00.000Z',
      },
    ],
  }
}

test.group('adaptive clarification draft prompt', () => {
  test('已确认动态事实进入生成上下文，known unknown 只能成为待决定事项而不能虚构数值', ({
    assert,
  }) => {
    const prompt = new ProjectDraftPromptBuilder().buildPromptSet(context(), 'prompt').userPrompt
    assert.include(prompt, '参与人数')
    assert.include(prompt, '500')
    assert.include(prompt, '明确尚未决定事项')
    assert.include(prompt, '可用预算')
    assert.include(prompt, '严禁虚构具体数值')
    assert.include(prompt, 'assumption、decision-needed 或 risk')
  })

  test('动态事实中的凭证样式值在发给模型前脱敏', ({ assert }) => {
    const unsafe = context()
    unsafe.adaptiveLedger!.entries[0]!.answer = 'Authorization: Bearer sk-abcdefghijklmnop'
    const prompt = new ProjectDraftPromptBuilder().buildPromptSet(unsafe, 'prompt').userPrompt
    assert.notInclude(prompt, 'sk-abcdefghijklmnop')
    assert.include(prompt, '[REDACTED]')
  })
})
