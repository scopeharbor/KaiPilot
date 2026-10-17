import { test } from '@japa/runner'
import {
  ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
  type InformationNeed,
  type ProjectUnderstanding,
} from '@aiproj/types'
import type { GenerateResult } from '../../app/services/ai_m0/gateway.js'
import AdaptiveClarificationService from '../../app/services/ai_intent/adaptive_clarification_service.js'
import QuestionPlanChecker from '../../app/services/ai_intent/question_plan_checker.js'

const scenarios: Array<{
  name: string
  intent: string
  knownTopic: string
  knownValue: string
  need: Pick<
    InformationNeed,
    'topic' | 'missingInformation' | 'whyItMatters' | 'decisionImpact' | 'answerKind'
  >
}> = [
  {
    name: '活动',
    intent: '计划十月在校园举办公开演出，日期已经确定，希望形成完整执行计划。',
    knownTopic: '举行日期',
    knownValue: '十月',
    need: {
      topic: '参加规模',
      missingInformation: '大约有多少人会参加',
      whyItMatters: '人数会改变场地、安全和人手安排。',
      decisionImpact: ['resource', 'risk'],
      answerKind: 'number',
    },
  },
  {
    name: '系统迁移',
    intent: '把现有业务系统迁到新环境，来源系统已经确定，希望尽量不中断服务。',
    knownTopic: '来源系统',
    knownValue: '现有业务系统',
    need: {
      topic: '可接受中断',
      missingInformation: '业务最多可以暂停多久',
      whyItMatters: '可暂停时间会改变切换、回滚和演练方式。',
      decisionImpact: ['schedule', 'risk', 'dependency'],
      answerKind: 'short_text',
    },
  },
  {
    name: '市场发布',
    intent: '为已经完成开发的新产品安排上市推广，希望形成跨团队执行计划。',
    knownTopic: '产品状态',
    knownValue: '已完成开发',
    need: {
      topic: '首要对象',
      missingInformation: '这次最想先让哪一类客户看到',
      whyItMatters: '首要对象会改变渠道、内容和投放安排。',
      decisionImpact: ['scope', 'deliverable'],
      answerKind: 'short_text',
    },
  },
  {
    name: '研究',
    intent: '做一项面向在校学生的问卷研究，研究对象已经确定，需要完整研究计划。',
    knownTopic: '研究对象',
    knownValue: '在校学生',
    need: {
      topic: '结论用途',
      missingInformation: '研究结果最后要支持什么决定',
      whyItMatters: '用途会改变问题设计、样本和分析方法。',
      decisionImpact: ['scope', 'acceptance'],
      answerKind: 'short_text',
    },
  },
  {
    name: '办公室搬迁',
    intent: '把公司办公室搬到已经签约的新地点，并尽量不影响正常办公。',
    knownTopic: '新地点',
    knownValue: '已经签约',
    need: {
      topic: '搬迁人数',
      missingInformation: '大约有多少人和工位需要搬',
      whyItMatters: '人数会改变车辆、分批和恢复办公安排。',
      decisionImpact: ['resource', 'schedule'],
      answerKind: 'number',
    },
  },
  {
    name: '流程改善',
    intent: '改善每周重复发生的客户投诉处理流程，现有流程每周运行一次。',
    knownTopic: '发生频率',
    knownValue: '每周一次',
    need: {
      topic: '当前卡点',
      missingInformation: '现在最常卡在哪一步',
      whyItMatters: '卡点会决定先改流程、工具还是职责分工。',
      decisionImpact: ['scope', 'dependency'],
      answerKind: 'short_text',
    },
  },
]

function understanding(scenario: (typeof scenarios)[number]): ProjectUnderstanding {
  return {
    schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
    summaryForUser: `你想完成${scenario.name}项目，并希望得到可执行计划。`,
    inferredDomainLabel: scenario.name,
    likelyDeliverables: ['执行计划'],
    knownFacts: [
      {
        id: `fact:${scenario.name}`,
        topic: scenario.knownTopic,
        value: scenario.knownValue,
        evidence: '来自用户原始描述',
        confidence: 1,
        source: 'initial_intent',
      },
    ],
    informationNeeds: [
      {
        id: `need:${scenario.name}`,
        ...scenario.need,
        priority: 'high',
        confidence: 0.9,
        uncertainty: 0.8,
        userEffort: 'low',
        sensitivity: 'none',
      },
      {
        id: `need:known:${scenario.name}`,
        topic: scenario.knownTopic,
        missingInformation: scenario.knownTopic,
        whyItMatters: '这个事实已经知道，不应再次询问。',
        decisionImpact: ['scope'],
        priority: 'high',
        answerKind: 'short_text',
        confidence: 0.9,
        uncertainty: 0.1,
        userEffort: 'low',
        sensitivity: 'none',
      },
    ],
    sufficientForPreliminaryDraft: false,
  }
}

function generated(value: ProjectUnderstanding): GenerateResult {
  return {
    rawText: JSON.stringify(value),
    triggeredErrors: [],
    outputTokens: 180,
    firstTokenMs: 4,
    totalMs: 12,
    usingRealAdapter: false,
  }
}

test.group('adaptive clarification diverse scenario evaluation', () => {
  test('六类项目得到相关且不重复的普通语言问题，已知事实不再询问', async ({ assert }) => {
    const questions: string[] = []
    const checker = new QuestionPlanChecker()
    for (const scenario of scenarios) {
      const service = new AdaptiveClarificationService()
      const session = await service.start({
        // 开工日 / 工期 / 团队写清楚时系统不再追问，这里只看模型提的领域问题是否相关、不重复。
        rawInput: `${scenario.intent}下周一开始，工期 2 个月，团队 5 人。`,
        gateway: {
          async generate() {
            return generated(understanding(scenario))
          },
        },
      })
      const conversation = session.conversation
      assert.exists(conversation)
      assert.equal(conversation?.activeNeedId, `need:${scenario.name}`)
      assert.notInclude(conversation?.activeQuestion.question ?? '', scenario.knownTopic)
      const need = session.understanding.informationNeeds.find(
        (item) => item.id === conversation?.activeNeedId,
      )!
      const quality = checker.checkProposal({ proposal: conversation!.activeQuestion, need })
      assert.isTrue(quality.valid)
      assert.isAtLeast(quality.rubric.total, 22)
      questions.push(conversation!.activeQuestion.question)
    }
    assert.equal(new Set(questions).size, scenarios.length)
  })
})
