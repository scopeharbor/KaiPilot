import { test } from '@japa/runner'
import {
  ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
  type ClarificationLedger,
  type InformationNeed,
} from '@aiproj/types'
import InformationNeedSelector from '../../app/services/ai_intent/information_need_selector.js'

function need(overrides: Partial<InformationNeed>): InformationNeed {
  return {
    id: 'need:default',
    topic: 'project.default',
    missingInformation: '需要确认的资料',
    decisionImpact: ['scope'],
    whyItMatters: '会改变计划内容。',
    priority: 'useful',
    answerKind: 'short_text',
    confidence: 0.8,
    uncertainty: 0.5,
    userEffort: 'low',
    sensitivity: 'none',
    ...overrides,
  }
}

const ledger: ClarificationLedger = {
  schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
  revision: 0,
  entries: [],
}

test.group('InformationNeedSelector', () => {
  test('高影响阻断项早于低影响外观偏好且只选择一个 active need', ({ assert }) => {
    const selector = new InformationNeedSelector()
    const result = selector.selectOne({
      needs: [
        need({
          id: 'need:appearance',
          topic: 'preference.appearance',
          missingInformation: '喜欢什么颜色',
          priority: 'optional',
          decisionImpact: ['deliverable'],
        }),
        need({
          id: 'need:deadline',
          topic: 'delivery.deadline',
          missingInformation: '最晚什么时候必须完成',
          priority: 'blocking',
          decisionImpact: ['schedule', 'resource', 'risk'],
          uncertainty: 0.9,
        }),
      ],
      ledger,
      knownUnknowns: [],
    })
    assert.equal(result?.need.id, 'need:deadline')
  })

  test('已回答和 known unknown 不会再次入选，近重复问题也被抑制', ({ assert }) => {
    const selector = new InformationNeedSelector()
    const answeredLedger: ClarificationLedger = {
      ...ledger,
      revision: 1,
      entries: [
        {
          needId: 'need:people',
          topic: '规模 人数',
          status: 'answered',
          questionSummary: '大约有多少人参加',
          answer: 500,
          revision: 1,
          updatedAt: '2026-08-31T00:00:00.000Z',
        },
      ],
    }
    const ranked = selector.rank({
      needs: [
        need({ id: 'need:people', topic: '规模 人数' }),
        need({ id: 'need:people-copy', topic: '规模 人数', missingInformation: '大约多少人参加' }),
        need({ id: 'need:budget', topic: '可用 预算', missingInformation: '预算是否已经确定' }),
      ],
      ledger: answeredLedger,
      knownUnknowns: [
        {
          needId: 'need:budget',
          topic: '可用 预算',
          impact: '影响采购安排',
          recordedAt: '2026-08-31T00:00:00.000Z',
        },
      ],
    })
    assert.notInclude(
      ranked.map((item) => item.need.id),
      'need:people',
    )
    assert.notInclude(
      ranked.map((item) => item.need.id),
      'need:budget',
    )
  })
})
