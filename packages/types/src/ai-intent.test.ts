/**
 * ai-intent shared contract —— QuestionPlan 上界、序列化、revision 与脱敏。
 *
 * 覆盖 task 1.2 的共享类型单元测试：phase/activeCard/coverage 常量、
 * QuestionPlan 有界序列化、稳定 revision 与 secret-redaction。
 */

import { describe, it, expect } from 'vitest'
import {
  ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
  ADAPTIVE_CLARIFICATION_LIMITS,
  CLARIFICATION_PHASES,
  CLARIFICATION_SOURCES,
  CLARIFICATION_QUESTION_TYPES,
  QUESTION_PLAN_LIMITS,
  computeQuestionPlanRevision,
  redactQuestionPlan,
  redactQuestionPlanText,
  serializeQuestionPlan,
  adaptLegacyClarificationAnswers,
  repairProjectUnderstandingShape,
  validateProjectUnderstanding,
  type ProjectUnderstanding,
  type QuestionPlan,
  type QuestionPlanEntry,
} from './ai-intent.ts'

function understanding(overrides: Partial<ProjectUnderstanding> = {}): ProjectUnderstanding {
  return {
    schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
    summaryForUser: '你想把办公室搬到新地点，并尽量不影响日常工作。',
    inferredDomainLabel: '办公室搬迁',
    intendedOutcome: '按时完成搬迁并恢复办公',
    likelyDeliverables: ['搬迁安排', '资产清单'],
    knownFacts: [
      {
        id: 'fact:destination',
        topic: '新地点',
        value: '已确定',
        evidence: '用户明确说明新办公室已签约',
        confidence: 1,
        source: 'initial_intent',
      },
    ],
    informationNeeds: [
      {
        id: 'need:headcount',
        topic: 'workspace.capacity',
        missingInformation: '需要搬迁的大致人数',
        decisionImpact: ['resource', 'schedule'],
        whyItMatters: '人数会影响车辆、工位和分批安排。',
        priority: 'high',
        answerKind: 'number',
        confidence: 0.9,
        uncertainty: 0.7,
        userEffort: 'low',
        sensitivity: 'none',
      },
    ],
    sufficientForPreliminaryDraft: false,
    ...overrides,
  }
}

function entry(overrides: Partial<QuestionPlanEntry> = {}): QuestionPlanEntry {
  return {
    cardId: '1.0:projectGoal:critical',
    field: 'projectGoal',
    phase: 'core',
    source: 'core',
    packId: null,
    questionType: 'single_choice',
    isRequired: true,
    triggerEvidence: ['输入包含内部工单系统目标'],
    ...overrides,
  }
}

function plan(overrides: Partial<QuestionPlan> = {}): QuestionPlan {
  const base: QuestionPlan = {
    revision: '',
    phase: 'core',
    entries: [entry()],
    coverage: {
      valid: true,
      requiredIds: ['1.0:projectGoal:critical'],
      coveredIds: ['1.0:projectGoal:critical'],
      missingIds: [],
      rejectedIds: [],
      reasonCodes: [],
      selectedPackIds: ['security@1.0'],
    },
  }
  const merged = { ...base, ...overrides }
  merged.revision = computeQuestionPlanRevision(merged)
  return merged
}

describe('QuestionPlan 上界常量', () => {
  it('封闭 phase/source/questionType 常量仍稳定', () => {
    expect(CLARIFICATION_PHASES).toEqual(['core', 'conditional', 'agent', 'ready'])
    expect(CLARIFICATION_SOURCES).toEqual(['core', 'conditional', 'agent', 'triz'])
    expect(CLARIFICATION_QUESTION_TYPES).toEqual([
      'single_choice',
      'multi_choice',
      'number',
      'date',
      'text',
    ])
  })

  it('上界与 revision 长度有界且可预期', () => {
    expect(QUESTION_PLAN_LIMITS.maxCards).toBe(20)
    expect(QUESTION_PLAN_LIMITS.maxTriggerEvidencePerCard).toBe(3)
    expect(QUESTION_PLAN_LIMITS.maxSelectedPacks).toBe(8)
    expect(QUESTION_PLAN_LIMITS.maxRevisionLength).toBe(64)
  })
})

describe('QuestionPlan 序列化与 revision', () => {
  it('同计划同 revision，且 revision 不超过上界', () => {
    const first = plan()
    const second = plan()
    expect(first.revision).toBe(second.revision)
    expect(first.revision.length).toBeLessThanOrEqual(QUESTION_PLAN_LIMITS.maxRevisionLength)
  })

  it('序列化确定性与对象键序无关', () => {
    const left = plan({
      coverage: {
        valid: true,
        requiredIds: [],
        coveredIds: [],
        missingIds: [],
        rejectedIds: [],
        reasonCodes: [],
        selectedPackIds: ['security@1.0', 'compliance@1.0'],
      },
    })
    const right = plan({
      coverage: {
        valid: true,
        coveredIds: [],
        requiredIds: [],
        selectedPackIds: ['security@1.0', 'compliance@1.0'],
        rejectedIds: [],
        reasonCodes: [],
        missingIds: [],
      },
    })
    expect(serializeQuestionPlan(left)).toBe(serializeQuestionPlan(right))
    expect(computeQuestionPlanRevision(left)).toBe(computeQuestionPlanRevision(right))
  })

  it('条目顺序或触发证据变化产生不同 revision', () => {
    const first = plan()
    const second = plan({
      entries: [entry({ triggerEvidence: ['另一个触发证据'] })],
    })
    expect(computeQuestionPlanRevision(first)).not.toBe(computeQuestionPlanRevision(second))
  })

  it('序列化裁断超出上界的条目与证据', () => {
    const many = plan({
      entries: Array.from({ length: QUESTION_PLAN_LIMITS.maxCards + 5 }, (_, index) =>
        entry({ cardId: 'id:' + index }),
      ),
    })
    const parsed = JSON.parse(serializeQuestionPlan(many)) as QuestionPlan
    expect(parsed.entries).toHaveLength(QUESTION_PLAN_LIMITS.maxCards)
    expect(parsed.entries[0].triggerEvidence).toHaveLength(1)
  })
})

describe('QuestionPlan secret-redaction', () => {
  it('redactQuestionPlanText 覆盖 secret/Authorization/邮箱/手机号', () => {
    expect(
      redactQuestionPlanText(
        'Authorization: Bearer sk-abcdefghijklmnop 联系 pm@example.com 13800138000',
      ),
    ).not.toMatch(/sk-abcdefghijklmnop|pm@example.com|13800138000/)
  })

  it('redactQuestionPlan 只改触发证据，保留 coverage 稳定 ID', () => {
    const redacted = redactQuestionPlan(
      plan({
        entries: [
          entry({
            triggerEvidence: ['密钥 sk-abcdefghijklmnop 已出现在原始输入'],
          }),
        ],
      }),
    )
    expect(redacted.entries[0].triggerEvidence[0]).not.toContain('sk-abcdefghijklmnop')
    expect(redacted.coverage.coveredIds).toEqual(['1.0:projectGoal:critical'])
  })
})

describe('adaptive clarification contract', () => {
  it('accepts a bounded versioned project understanding', () => {
    const result = validateProjectUnderstanding(understanding())
    expect(result.success).toBe(true)
    expect(result.data?.informationNeeds[0]?.id).toBe('need:headcount')
  })

  it('rejects unknown fields, secret values, invalid nesting and excessive length', () => {
    const unsafe = {
      ...understanding(),
      arbitraryToolCall: { name: 'shell', arguments: { secret: 'sk-abcdefghijklmnop' } },
    }
    const result = validateProjectUnderstanding(unsafe)
    expect(result.success).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining(['UNKNOWN_FIELD', 'SENSITIVE_VALUE_EXPOSED']),
    )

    let nested: unknown = 'end'
    for (let index = 0; index < ADAPTIVE_CLARIFICATION_LIMITS.maxDepth + 2; index += 1) {
      nested = { child: nested }
    }
    expect(validateProjectUnderstanding(nested).errors).toContain('NESTING_TOO_DEEP')
    expect(
      validateProjectUnderstanding(
        understanding({
          summaryForUser: '字'.repeat(ADAPTIVE_CLARIFICATION_LIMITS.maxTextLength + 1),
        }),
      ).errors,
    ).toContain('INVALID_SUMMARY')
  })

  it('校验失败时逐条给出路径与收到的值，而不只是一串错误码', () => {
    const broken = understanding()
    ;(broken.informationNeeds[0] as unknown as Record<string, unknown>).sensitivity = 'medium'
    const result = validateProjectUnderstanding(broken)
    expect(result.success).toBe(false)
    const issue = result.details?.find((item) => item.code === 'INVALID_SENSITIVITY')
    expect(issue?.path).toBe('$.informationNeeds[0].sensitivity')
    // 「明确告知触发内容」：光有 INVALID_SENSITIVITY 这个码，用户和修复提示词都无从下手
    expect(issue?.received).toBe('medium')
  })

  it('顶层不是对象时只报 INVALID_ROOT，并说清收到的是什么', () => {
    const result = validateProjectUnderstanding([1, 2, 3])
    expect(result.errors).toContain('INVALID_ROOT')
    expect(result.details?.[0]?.received).toBe('array')
  })

  it('命中密钥模式时回显脱敏片段，不把凭据再抄一遍', () => {
    const leaky = understanding({ summaryForUser: '密钥是 sk-abcdefghijklmnop 请保管好' })
    const issue = validateProjectUnderstanding(leaky).details?.find(
      (item) => item.code === 'SENSITIVE_VALUE_EXPOSED',
    )
    expect(issue).toBeDefined()
    expect(issue?.received).not.toContain('abcdefghijklmnop')
    expect(issue?.received).toContain('***')
  })

  it('本地 schema 修复把机械性错误补齐，无需再跑一次模型', () => {
    const repaired = repairProjectUnderstandingShape({
      schemaVersion: 'wrong-version',
      summaryForUser: '一个需要确认若干决定的项目。',
      inferredDomainLabel: '用户描述的项目',
      likelyDeliverables: '单个交付物也可能不是数组',
      knownFacts: null,
      extraneousKey: '模型多给的字段要被丢掉',
      informationNeeds: [
        {
          id: 'need:1',
          topic: '范围',
          missingInformation: '这次一定要做的事情有哪些',
          decisionImpact: 'scope,timeline',
          whyItMatters: '范围决定工期与人力。',
          priority: 'high',
          answerKind: 'single_choice',
          suggestedOptions: null,
          dependsOn: null,
        },
      ],
      sufficientForPreliminaryDraft: 'false',
    })
    const result = validateProjectUnderstanding(repaired)
    expect(result.success).toBe(true)
    const need = result.data?.informationNeeds[0]
    expect(need?.decisionImpact).toEqual(['scope', 'schedule'])
    expect(need?.sensitivity).toBe('none')
    expect(need?.userEffort).toBe('low')
    // 选择题凑不齐候选项就降级成自由作答，而不是让整轮理解作废
    expect(need?.answerKind).toBe('short_text')
    expect(result.data?.likelyDeliverables).toEqual(['单个交付物也可能不是数组'])
    expect(result.data?.knownFacts).toEqual([])
    expect(result.data?.sufficientForPreliminaryDraft).toBe(false)
  })

  it('修复只补结构、不发明事实：缺内容字段的条目直接丢弃', () => {
    const repaired = repairProjectUnderstandingShape({
      schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
      summaryForUser: '一个项目。',
      inferredDomainLabel: '项目',
      likelyDeliverables: [],
      knownFacts: [{ id: 'fact:1', topic: '', value: '', evidence: '', confidence: 1 }],
      informationNeeds: [{ id: 'need:1', whyItMatters: '重要' }],
      sufficientForPreliminaryDraft: true,
    }) as Record<string, unknown>
    expect(repaired.knownFacts).toEqual([])
    expect(repaired.informationNeeds).toEqual([])
  })

  it('adapts old fixed-field answers without losing answers or turning skips into facts', () => {
    const ledger = adaptLegacyClarificationAnswers(
      {
        projectGoal: {
          field: 'projectGoal',
          action: 'answer',
          value: '缩短交付周期',
          marker: null,
        },
        teamSize: { field: 'teamSize', action: 'skip', value: null, marker: null },
      },
      '2026-08-31T00:00:00.000Z',
    )
    expect(ledger.entries).toHaveLength(2)
    expect(ledger.entries[0]).toMatchObject({
      needId: 'legacy:projectGoal',
      answer: '缩短交付周期',
    })
    expect(ledger.entries[1]).toMatchObject({
      needId: 'legacy:teamSize',
      status: 'known_unknown',
    })
  })
})
