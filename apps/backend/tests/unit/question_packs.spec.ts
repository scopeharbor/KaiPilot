import { test } from '@japa/runner'
import { CARD_CATALOG } from '../../app/services/ai_intent/catalog.js'
import { QUESTION_PACKS, selectQuestionPacks } from '../../app/services/ai_intent/question_packs.js'
import type { ParsedIntent } from '@aiproj/types'

function parsed(projectType: 'software' | 'event' = 'software'): ParsedIntent {
  return {
    schemaVersion: '1.0',
    projectType,
    projectName: null,
    objectives: [],
    deliverables: [],
    timeline: { startDate: null, deadline: null, durationDays: null },
    constraints: [],
    entities: [],
    overallConfidence: 0.8,
  }
}

test.group('QuestionPack 注册表与选择器', () => {
  test('首批覆盖资安、效能、合规、整合/迁移与上线变更管理', ({ assert }) => {
    const ids = QUESTION_PACKS.map((pack) => pack.id)
    for (const expected of [
      'security@1.0',
      'performance@1.0',
      'compliance@1.0',
      'integration-migration@1.0',
      'rollout-change@1.0',
    ]) {
      assert.include(ids, expected)
    }
  })

  test('组版本稳定在 1.0 且字段都在共享目录中', ({ assert }) => {
    for (const pack of QUESTION_PACKS) {
      assert.match(pack.id, /@1\.0$/)
      for (const field of pack.fields) {
        assert.property(CARD_CATALOG, field)
      }
    }
  })

  test('触发证据被返回，未触发输入零暴露', ({ assert }) => {
    const triggered = selectQuestionPacks('建设包含权限审计与等保合规的内部系统', parsed())
    assert.isTrue(triggered.some((pack) => pack.id === 'security@1.0'))
    assert.isTrue(triggered.some((pack) => pack.id === 'compliance@1.0'))
    for (const pack of triggered) {
      assert.isNotEmpty(pack.evidence)
    }

    assert.deepEqual(selectQuestionPacks('做一次团队建设活动', parsed('event')), [])
  })

  test('工程约束组只在 software 项目触发，体现项目类型兼容', ({ assert }) => {
    const software = selectQuestionPacks('用 React 和数据库搭一个内部应用', parsed('software'))
    assert.isTrue(software.some((pack) => pack.id === 'engineering-constraints@1.0'))

    const event = selectQuestionPacks('用 React 和数据库搭一个内部应用', parsed('event'))
    assert.isFalse(event.some((pack) => pack.id === 'engineering-constraints@1.0'))
  })

  test('触发包字段不与 TRIZ 卡片字段重叠，保证普通/TRIZ 合并稳定', ({ assert }) => {
    const trizFields = new Set([
      'contradiction',
      'idealFinalResult',
      'resource',
      'inventivePrinciple',
      'evolutionTrend',
    ])
    for (const pack of QUESTION_PACKS) {
      for (const field of pack.fields) {
        assert.isFalse(trizFields.has(field))
      }
    }
  })
})
