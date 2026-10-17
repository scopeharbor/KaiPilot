import { test } from '@japa/runner'
import type { ClarificationCard, InformationNeed, QuestionCardProposal } from '@aiproj/types'
import QuestionPlanChecker from '../../app/services/ai_intent/question_plan_checker.js'
import PlainQuestionComposer from '../../app/services/ai_intent/plain_question_composer.js'
import { CARD_CATALOG, makeCardId } from '../../app/services/ai_intent/catalog.js'

function card(field: 'projectGoal' | 'targetUser'): ClarificationCard {
  const definition = CARD_CATALOG[field]
  return {
    ...definition,
    cardId: makeCardId(field, 'critical'),
    category: 'critical',
    confidence: definition.defaultConfidence,
    reasoning: definition.defaultReasoning,
    allowSkip: false,
    isRequired: true,
    customInput: {
      enabled: true,
      label: '自定义输入',
      placeholder: '请输入真实情况',
      description: '可以直接输入真实情况。',
    },
    phase: 'core',
    source: 'core',
    packId: null,
    triggerEvidence: [],
    suggestedValue: null,
  }
}

const adaptiveNeed: InformationNeed = {
  id: 'need:audience',
  topic: 'event.audience',
  missingInformation: '大约有多少人会参加',
  decisionImpact: ['resource', 'risk'],
  whyItMatters: '人数会影响空间、安全和人手安排。',
  priority: 'high',
  answerKind: 'single_choice',
  suggestedOptions: [
    { id: 'small', label: '300 人以内', value: 'small' },
    { id: 'medium', label: '300 到 1000 人', value: 'medium' },
  ],
  confidence: 0.9,
  uncertainty: 0.8,
  userEffort: 'low',
  sensitivity: 'none',
}

function proposal(overrides: Partial<QuestionCardProposal> = {}): QuestionCardProposal {
  return {
    needId: adaptiveNeed.id,
    question: '大约有多少人会参加？',
    reason: adaptiveNeed.whyItMatters,
    answerKind: adaptiveNeed.answerKind,
    options: adaptiveNeed.suggestedOptions,
    allowOther: true,
    allowUnknown: true,
    unknownImpact: adaptiveNeed.whyItMatters,
    ...overrides,
  }
}

test.group('QuestionPlanChecker', () => {
  test('完整核心计划通过并只返回稳定 ID', ({ assert }) => {
    const cards = [card('projectGoal'), card('targetUser')]
    const result = new QuestionPlanChecker().check({
      cards,
      requiredIds: cards.map((item) => item.cardId),
      answeredFields: [],
      selectedPackIds: [],
      packRequiredIds: {},
    })

    assert.isTrue(result.valid)
    assert.deepEqual(
      result.coveredIds,
      cards.map((item) => item.cardId),
    )
    assert.deepEqual(result.reasonCodes, [])
  })

  test('遗漏、重复与已回答字段会 fail closed', ({ assert }) => {
    const first = card('projectGoal')
    const duplicate = { ...first, cardId: `${first.cardId}:duplicate` }
    const missingId = makeCardId('targetUser', 'critical')
    const result = new QuestionPlanChecker().check({
      cards: [first, duplicate],
      requiredIds: [first.cardId, missingId],
      answeredFields: ['projectGoal'],
      selectedPackIds: ['core-test@1.0'],
      packRequiredIds: { 'core-test@1.0': [first.cardId, missingId] },
    })

    assert.isFalse(result.valid)
    assert.includeMembers(result.reasonCodes, [
      'DUPLICATE_FIELD',
      'ANSWERED_FIELD_REPEATED',
      'MISSING_REQUIRED_ID',
      'INCOMPLETE_TRIGGERED_PACK',
    ])
    assert.include(result.missingIds, missingId)
  })

  test('问题文本包含 secret、Authorization 或联系方式时拒绝发布', ({ assert }) => {
    const unsafe = {
      ...card('projectGoal'),
      description: '请确认 Authorization: Bearer abcdefghijklmnop',
    }
    const result = new QuestionPlanChecker().check({
      cards: [unsafe],
      requiredIds: [unsafe.cardId],
      answeredFields: [],
      selectedPackIds: [],
      packRequiredIds: {},
    })

    assert.isFalse(result.valid)
    assert.include(result.reasonCodes, 'SENSITIVE_TEXT_EXPOSED')
    assert.include(result.rejectedIds, unsafe.cardId)
  })

  test('通俗问题正向用例通过并输出五项语言量表', ({ assert }) => {
    const result = new QuestionPlanChecker().checkProposal({
      proposal: proposal(),
      need: adaptiveNeed,
    })
    assert.isTrue(result.valid)
    assert.equal(result.rubric.total, 25)
  })

  test('拒绝内部术语、双问题、敏感值、重复与 known unknown', ({ assert }) => {
    const result = new QuestionPlanChecker().checkProposal({
      proposal: proposal({
        question: '请提供 scopeBoundary？同时告诉我 stakeholder 是谁？',
        reason: 'Authorization: Bearer abcdefghijklmnop',
      }),
      need: adaptiveNeed,
      answeredNeedIds: [adaptiveNeed.id],
      knownUnknownNeedIds: [adaptiveNeed.id],
    })
    assert.isFalse(result.valid)
    assert.includeMembers(result.reasonCodes, [
      'INTERNAL_TERM_EXPOSED',
      'MULTIPLE_PRIMARY_QUESTIONS',
      'SENSITIVE_TEXT_EXPOSED',
      'ANSWERED_FIELD_REPEATED',
      'KNOWN_UNKNOWN_REPEATED',
    ])
  })

  test('拒绝重叠选项、缺少其他/未知路径和语义漂移', ({ assert }) => {
    const result = new QuestionPlanChecker().checkProposal({
      proposal: proposal({
        needId: 'need:other',
        answerKind: 'short_text',
        options: [
          { id: 'a', label: '差不多', value: 'a' },
          { id: 'b', label: '差不多', value: 'b' },
        ],
        allowOther: false,
        allowUnknown: false,
      }),
      need: adaptiveNeed,
    })
    assert.includeMembers(result.reasonCodes, [
      'SEMANTIC_DRIFT',
      'OVERLAPPING_OPTIONS',
      'MISSING_OTHER_PATH',
      'MISSING_UNKNOWN_PATH',
    ])
  })

  test('有限重写可移除术语，第二次失败产生 typed failure', ({ assert }) => {
    const checker = new QuestionPlanChecker()
    const rewritten = checker.rewriteProposal(
      proposal({ question: '请定义核心痛点？', reason: '' }),
      adaptiveNeed,
      0,
    )
    assert.notInclude(rewritten.question, '核心痛点')
    assert.equal(rewritten.reason, adaptiveNeed.whyItMatters)
    const single = checker.rewriteProposal(
      proposal({ question: '大约有多少人参加，同时场地在哪里？' }),
      adaptiveNeed,
      0,
    )
    assert.equal(single.question, '大约有多少人参加？')
    assert.throws(() => checker.rewriteProposal(proposal(), adaptiveNeed, 2), /连续两次未通过/u)
  })

  test('顿号连接的两个主题算复合问句，会被拆成单一焦点', ({ assert }) => {
    const checker = new QuestionPlanChecker()
    // 用户报的正是这一类：一道题同时问上线时间和可投入人员，
    // 候选项却只覆盖了时间，另一半只能靠「其他」手写。
    const compound = proposal({ question: '关于上线时间、可投入人员，目前可以确认到什么程度？' })
    assert.include(
      checker.checkProposal({ proposal: compound, need: adaptiveNeed }).reasonCodes,
      'MULTIPLE_PRIMARY_QUESTIONS',
    )
    const rewritten = checker.rewriteProposal(compound, adaptiveNeed, 0)
    // 截出的第一段「关于上线时间」不是问句：改用这条信息需求本身的问法，
    // 不再套「目前可以确认到什么程度」（实测「单场培训，目前可以确认到什么程度？」读不懂）。
    assert.equal(rewritten.question, `${adaptiveNeed.missingInformation.replace(/[？?]$/u, '')}？`)
  })

  test('顿号只是在列举候选项时不算复合问句，不会被拦腰截断', ({ assert }) => {
    const checker = new QuestionPlanChecker()
    const optionList = proposal({ question: '要先做 Web、移动端还是两者都要？' })
    assert.notInclude(
      checker.checkProposal({ proposal: optionList, need: adaptiveNeed }).reasonCodes,
      'MULTIPLE_PRIMARY_QUESTIONS',
    )
  })
})

test.group('列举式问句不会让追问卡死', () => {
  test('「报名、投票开始/截止和结果……通知」改写后仍能出题（按主题问）', ({ assert }) => {
    const need: InformationNeed = {
      ...adaptiveNeed,
      id: 'notifications.channels',
      topic: '通知渠道',
      missingInformation: '报名、投票开始/截止和结果主要通过什么方式通知？',
    }
    // 实测：两次改写都交回同一句列举句 → 抛错 → 整轮追问停在「需人工检查」，前端反复重试。
    const question = new PlainQuestionComposer().compose(need)
    assert.equal(question.question, '关于通知渠道，你倾向哪种做法？')
  })
})
