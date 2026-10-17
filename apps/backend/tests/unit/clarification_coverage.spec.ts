import { test } from '@japa/runner'
import {
  ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
  type ClarificationLedger,
  type ClarificationLedgerEntry,
  type InformationNeed,
} from '@aiproj/types'
import {
  absorbAdditionalAnswers,
  assessNeedAgainstLedger,
  buildCoverageMatrix,
  detectCoverageSlots,
  openCoreSlots,
  textSimilarity,
} from '../../app/services/ai_intent/clarification_coverage.js'

function need(overrides: Partial<InformationNeed> = {}): InformationNeed {
  return {
    id: 'need:1',
    topic: '范围',
    missingInformation: '这次一定要做的事情有哪些',
    decisionImpact: ['scope'],
    whyItMatters: '范围决定工期与人力。',
    priority: 'high',
    answerKind: 'short_text',
    confidence: 0.8,
    uncertainty: 0.6,
    userEffort: 'low',
    sensitivity: 'none',
    ...overrides,
  }
}

function entry(overrides: Partial<ClarificationLedgerEntry> = {}): ClarificationLedgerEntry {
  return {
    needId: 'need:old',
    topic: '范围',
    status: 'answered',
    questionSummary: '这次一定要做的事情有哪些？',
    answer: '先做报名和签到两个功能',
    revision: 1,
    updatedAt: '2026-09-08T00:00:00.000Z',
    ...overrides,
  }
}

function ledger(entries: ClarificationLedgerEntry[]): ClarificationLedger {
  return {
    schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
    revision: entries.length,
    entries,
  }
}

test.group('clarification coverage', () => {
  test('中文相似度不再恒为 0——旧实现按空白切词，在中文上永远算不出重合', ({ assert }) => {
    assert.isAbove(textSimilarity('到岗统计口径', '到岗统计方式'), 0.4)
    assert.isBelow(textSimilarity('到岗统计口径', '八周的项目周期'), 0.2)
    assert.equal(textSimilarity('上线日期', '上线日期'), 1)
    // 中英混排同样有效：拉丁词重合率与字符二元组取较大者
    assert.isAbove(textSimilarity('SSO 单点登录接入', 'SSO 登录接入'), 0.4)
  })

  test('主题槽位按用户看得见的说法识别，一段话可以同时命中多个', ({ assert }) => {
    assert.includeMembers(detectCoverageSlots('到岗人数怎么统计口径'), ['resource', 'data'])
    assert.include(detectCoverageSlots('什么时候上线'), 'schedule')
    assert.include(detectCoverageSlots('谁来负责审批'), 'permission')
    assert.include(detectCoverageSlots('需要发短信通知吗'), 'notification')
    assert.include(detectCoverageSlots('要和现有 ERP 对接吗'), 'integration')
    assert.isEmpty(detectCoverageSlots('随便聊两句'))
  })

  test('覆盖矩阵区分已确认与待决定，superseded 不参与判定', ({ assert }) => {
    const matrix = buildCoverageMatrix(
      ledger([
        entry({ needId: 'a', topic: '上线时间', questionSummary: '什么时候上线？' }),
        entry({
          needId: 'b',
          topic: '人员配置',
          questionSummary: '可以投入多少人力？',
          status: 'known_unknown',
          answer: undefined,
        }),
        entry({
          needId: 'c',
          topic: '验收标准',
          questionSummary: '怎样才算做完？',
          status: 'superseded',
        }),
      ]),
    )
    const byslot = new Map(matrix.map((item) => [item.slot, item.status]))
    assert.equal(byslot.get('schedule'), 'covered')
    assert.equal(byslot.get('resource'), 'deferred')
    assert.equal(byslot.get('acceptance'), 'open', '被取代的历史版本不能算作已覆盖')
  })

  test('关键槽位缺口可枚举，用于告诉用户「还差哪个主题」', ({ assert }) => {
    const open = openCoreSlots(buildCoverageMatrix(ledger([entry()])))
    assert.notInclude(open, 'scope')
    assert.includeMembers(open, ['schedule', 'resource'])
  })

  test('同一件事判 repeat；同主题更细的缺口判 finer；新主题判 new', ({ assert }) => {
    const answered = ledger([
      entry({
        needId: 'need:scope',
        topic: '范围',
        questionSummary: '这次一定要做的事情有哪些？',
      }),
    ])
    assert.equal(
      assessNeedAgainstLedger(
        need({ id: 'need:renamed', topic: '范围', missingInformation: '这次一定要做的事情有哪些' }),
        answered,
      ).verdict,
      'repeat',
      '换个 id 问同一件事必须被判重复',
    )
    assert.equal(
      assessNeedAgainstLedger(
        need({
          id: 'need:finer',
          topic: '范围',
          // 同样落在 scope 槽位，只是问得更细——不引入任何新主题
          missingInformation: '这次的功能范围要不要再收窄一些',
        }),
        answered,
      ).verdict,
      'finer',
    )
    assert.equal(
      assessNeedAgainstLedger(
        need({
          id: 'need:new',
          topic: '通知方式',
          missingInformation: '需要用什么方式发提醒',
          decisionImpact: ['dependency'],
        }),
        answered,
      ).verdict,
      'new',
    )
    // 同主题下但牵出新主题（导入=对接）的需求算 new，不能因为沾了「范围」就被降级
    assert.equal(
      assessNeedAgainstLedger(
        need({
          id: 'need:cross',
          topic: '范围',
          missingInformation: '报名功能要不要支持批量导入',
        }),
        answered,
      ).verdict,
      'new',
    )
  })

  test('id 式 topic 高度相似但问的是两件事时不判重复', ({ assert }) => {
    const answered = ledger([
      entry({
        needId: 'need:a',
        topic: 'schedule.launch_date',
        questionSummary: '计划什么时候上线？',
      }),
    ])
    assert.notEqual(
      assessNeedAgainstLedger(
        need({
          id: 'need:b',
          topic: 'schedule.launch_window',
          missingInformation: '上线当天可以停服多久',
          decisionImpact: ['schedule'],
        }),
        answered,
      ).verdict,
      'repeat',
    )
  })

  test('自由文本吸收要求「自报主题 + 具体值」，闲聊与提问都不吸收', ({ assert }) => {
    const needs = [
      need({
        id: 'need:date',
        topic: '上线日期',
        missingInformation: '计划什么时候上线',
        answerKind: 'date',
      }),
      need({
        id: 'need:people',
        topic: '人员配置',
        missingInformation: '可以投入多少人力',
        answerKind: 'number',
      }),
    ]
    const absorbed = absorbAdditionalAnswers({
      text: '上线日期是 12 月 31 日，人员配置大概 5 个人',
      needs,
      excludeNeedIds: ['need:date'],
    })
    assert.lengthOf(absorbed, 1)
    assert.equal(absorbed[0]?.need.id, 'need:people')
    assert.include(absorbed[0]?.answer ?? '', '5')

    // 没有具体值就不吸收，免得把「回头再说」记成答案
    assert.isEmpty(
      absorbAdditionalAnswers({
        text: '上线日期定了，人员配置回头再说',
        needs,
        excludeNeedIds: ['need:date'],
      }),
    )
    // 反问句不吸收
    assert.isEmpty(
      absorbAdditionalAnswers({
        text: '上线日期是 12 月 31 日，人员配置该怎么算？',
        needs,
        excludeNeedIds: ['need:date'],
      }),
    )
    // 只有一个子句时全部归当前这道题，不做跨题归属
    assert.isEmpty(
      absorbAdditionalAnswers({
        text: '人员配置大概 5 个人',
        needs,
        excludeNeedIds: ['need:date'],
      }),
    )
  })
})
