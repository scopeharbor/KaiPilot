import { test } from '@japa/runner'
import IntentParserService from '../../app/services/ai_intent/intent_parser_service.js'
import { AI_INTENT_EVALUATION_CASES } from '../fixtures/ai_intent_cases.js'

test.group('IntentParserService', () => {
  test('固定夹具覆盖五类项目且无随机或当前时间依赖', ({ assert }) => {
    const service = new IntentParserService()

    for (const fixture of AI_INTENT_EVALUATION_CASES) {
      const first = service.parse(fixture.rawInput)
      const second = service.parse(fixture.rawInput)

      assert.equal(first.projectType, fixture.expectedType, fixture.id)
      assert.deepEqual(second, first, fixture.id)
    }
  })

  test('提取中文日期、工期、人数、技术与原文位置', ({ assert }) => {
    const rawInput =
      '开发面向运营人员使用的 Web 系统，2026年8月1日开始，12周完成，6人参与，使用 Next.js 和 Python。'
    const result = new IntentParserService().parse(rawInput)
    const expected = [
      ['start_date', '2026年8月1日'],
      ['duration', '12周'],
      ['team_size', '6人'],
      ['technology', 'Next.js'],
      ['technology', 'Python'],
      ['platform', 'Web'],
      ['role', '运营人员'],
    ] as const

    for (const [type, text] of expected) {
      const entity = result.entities.find(
        (candidate) => candidate.type === type && candidate.text === text,
      )
      assert.exists(entity, `${type}:${text}`)
      assert.equal(rawInput.slice(entity!.start, entity!.end), text)
      assert.equal(entity!.source, 'explicit')
    }
    assert.equal(result.timeline.startDate, '2026-08-01')
    assert.equal(result.timeline.durationDays, 84)
  })

  test('成本只作为普通约束，不产生预算或财务澄清实体', ({ assert }) => {
    const rawInput = '开发内部工具，目标是减少重复录入，预算不能超过十万元。'
    const result = new IntentParserService().parse(rawInput)

    assert.include(result.constraints, '预算不能超过十万元')
    assert.isTrue(result.entities.some((entity) => entity.type === 'constraint'))
    assert.isFalse(result.entities.some((entity) => /budget|finance/iu.test(entity.type)))
  })

  test('活动场景区分观众规模、团队规模与举办日期', ({ assert }) => {
    const rawInput =
      '请规划 2026 年 8 月 15 日在台北举办的 800 人户外音乐表演项目，包括售票、场地租借、舞台灯光音响、停车接驳和安保医疗。团队 6 人，今天是 2026-07-24。'
    const result = new IntentParserService().parse(rawInput)

    assert.equal(result.projectType, 'event')
    assert.equal(result.timeline.deadline, '2026-08-15')
    assert.equal(result.timeline.startDate, '2026-07-24')
    assert.isFalse(
      result.entities.some((entity) => entity.type === 'team_size' && entity.value === 800),
    )
    assert.isTrue(
      result.entities.some((entity) => entity.type === 'team_size' && entity.value === 6),
    )
  })

  test('「年会抽奖和节目投票的 H5 页面」是软件项目，不落到通用', ({ assert }) => {
    const result = new IntentParserService().parse(
      '为公司年会做一个抽奖和节目投票的 H5 页面，12 月 20 日年会当天要用。',
    )
    assert.equal(result.projectType, 'software')
  })

  test('带空格的「10 月 12 日开工」不被读成工期 10 个月', ({ assert }) => {
    const result = new IntentParserService().parse(
      '做一个公司内部食堂订餐 H5：员工前一天 16 点前预订第二天午餐。10 月 12 日开工。团队：前端 1 人、后端 1 人。',
    )
    assert.isNull(result.timeline.durationDays)
    const withDuration = new IntentParserService().parse(
      '10 月 12 日开工，周期约 3 个月，团队 3 人',
    )
    assert.equal(withDuration.timeline.durationDays, 90)
  })

  test('名册「前端 1 人、后端 1 人、测试 1 人」的团队规模是合计 3 人；写了总数以总数为准', ({
    assert,
  }) => {
    const team = (text: string) =>
      new IntentParserService().parse(text).entities.find((entity) => entity.type === 'team_size')
        ?.value
    assert.equal(team('做一个订餐 H5。团队：前端 1 人、后端 1 人、测试 1 人。'), 3)
    assert.equal(team('团队 5 人：前端 2 人、后端 2 人、测试 1 人'), 5)
  })

  test('交付物清单不被「交付物」「日期后的完成」切出残片', ({ assert }) => {
    const rawInput =
      '某城商行计划于 2026 年 10 月 12 日启动支付清算中台重构，周期约 6 个月，目标 2027 年 4 月中旬完成生产切换。' +
      '交付物包括架构设计、微服务代码、数据迁移方案、运维手册。'
    const result = new IntentParserService().parse(rawInput)
    assert.deepEqual(result.deliverables, ['架构设计', '微服务代码', '数据迁移方案', '运维手册'])
    assert.notInclude(result.deliverables, '物包括架构设计')
    assert.notInclude(result.deliverables, '生产切换')
  })

  test('「约 6 个月」识别为项目工期，日期里的「4 月中旬」「12 月中旬」不算工期', ({ assert }) => {
    const rawInput =
      '项目 2026 年 10 月 12 日启动，周期约 6 个月，目标 2027 年 4 月中旬完成生产切换；' +
      '12 月中旬至 1 月上旬冻结生产变更。'
    const result = new IntentParserService().parse(rawInput)
    assert.equal(result.timeline.durationDays, 180)
    assert.equal(result.timeline.startDate, '2026-10-12')
    assert.equal(result.timeline.deadline, '2027-04-20')
    const durations = result.entities.filter((entity) => entity.type === 'duration')
    assert.deepEqual(
      durations.map((entity) => entity.text),
      ['6 个月'],
    )
    for (const entity of result.entities) {
      assert.equal(rawInput.slice(entity.start, entity.end), entity.text)
    }
  })

  test('固定评测的显式实体原文位置匹配率为 100%', ({ assert }) => {
    const service = new IntentParserService()
    const entities = AI_INTENT_EVALUATION_CASES.flatMap((fixture) =>
      service
        .parse(fixture.rawInput)
        .entities.map((entity) => ({ rawInput: fixture.rawInput, entity })),
    )
    const matched = entities.filter(
      ({ rawInput, entity }) => rawInput.slice(entity.start, entity.end) === entity.text,
    )

    assert.isAbove(entities.length, 0)
    assert.equal(matched.length / entities.length, 1)
  })
})
