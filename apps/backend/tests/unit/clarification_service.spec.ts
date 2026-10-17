import { test } from '@japa/runner'
import type { ClarificationAnswer, ClarificationAnswers, ClarificationField } from '@aiproj/types'
import ClarificationService from '../../app/services/ai_intent/clarification_service.js'
import { CARD_CATALOG } from '../../app/services/ai_intent/catalog.js'
import { AI_INTENT_EVALUATION_CASES, COMPLETE_INTENT_INPUT } from '../fixtures/ai_intent_cases.js'

function answer(field: ClarificationField, value: string | number): ClarificationAnswer {
  return { field, action: 'answer', value, marker: null }
}

function coreAnswers(): ClarificationAnswers {
  return {
    projectGoal: answer('projectGoal', '形成真实可交付的项目结果'),
    corePain: answer('corePain', '当前流程低效且信息不透明'),
    targetUser: answer('targetUser', '内部运营人员'),
    successMetrics: answer('successMetrics', '处理时效提升 30%'),
    scopeBoundary: answer('scopeBoundary', '首期完成核心闭环'),
    teamSize: answer('teamSize', 5),
    startDate: answer('startDate', '2026-09-01'),
  }
}

test.group('ClarificationService', () => {
  test('成功指标预填优先选择量化验收句而不是含 SLA 的范围句', ({ assert }) => {
    const input =
      '为 5 人运营团队建设内部工单系统，服务约 150 名员工，计划 2026-09-01 启动、2026-10-30 上线；范围包含 Web 端、角色权限、SLA 与超时升级、数据看板、旧工单迁移、SSO、审计日志、备份回滚和灰度上线，不包含请假、报销、用印等 OA 审批。验收要求工单创建成功率≥99%、P95 页面响应≤2秒、SLA 命中率≥95%，并满足个人资料合规。'
    const result = new ClarificationService().analyze(input)
    const successCard = result.cards.find((card) => card.field === 'successMetrics')

    assert.equal(
      successCard?.suggestedValue,
      '验收要求工单创建成功率≥99%、P95 页面响应≤2秒、SLA 命中率≥95%，并满足个人资料合规',
    )
    assert.notInclude(String(successCard?.suggestedValue), '范围包含')
  })

  test('内部工单系统多指标输入（99% / P95≤2秒 / SLA≥95% / 2026-10-30）预填为正确指标而非范围文本（任务 4.1 契约）', ({
    assert,
  }) => {
    const input =
      '为 5 人运营团队建设内部工单系统，计划 2026-09-01 启动、2026-10-30 上线；范围包含 Web 端、角色权限、SLA 与超时升级，明确排除请假、报销等 OA 审批。验收指标要求工单创建成功率≥99%、P95 页面响应≤2秒、SLA 命中率≥95%，并保证数据备份。'
    const result = new ClarificationService().analyze(input)
    const successCard = result.cards.find((card) => card.field === 'successMetrics')

    assert.isDefined(successCard)
    assert.include(String(successCard?.suggestedValue), '99%')
    assert.include(String(successCard?.suggestedValue), 'P95')
    assert.include(String(successCard?.suggestedValue), '≤2秒')
    assert.include(String(successCard?.suggestedValue), 'SLA 命中率≥95%')
    assert.notInclude(String(successCard?.suggestedValue), '范围包含')
    assert.notInclude(String(successCard?.suggestedValue), '明确排除')
    assert.notInclude(String(successCard?.suggestedValue), '请假、报销')
  })

  test('当 successMetrics 建议值缺失或命中 scope 文本时用 qualityStandard 回填（任务 4.1 契约）', ({
    assert,
  }) => {
    const input =
      '开发内部项目管理系统，项目范围包含任务拆解与甘特图排期，质量标准要求测试覆盖率≥80%且高可用。'
    const result = new ClarificationService().analyze(input)
    const successCard = result.cards.find((card) => card.field === 'successMetrics')

    assert.isDefined(successCard)
    assert.include(String(successCard?.suggestedValue), '质量标准要求测试覆盖率≥80%且高可用')
    assert.notInclude(String(successCard?.suggestedValue), '项目范围包含')
  })

  test('组合规则升级开始日期、团队规模与敏感业务合规问题', ({ assert }) => {
    const service = new ClarificationService()
    const initial = service.analyze(
      '开发支付系统，目标是支持商户收款，包括登录、支付、退款和对账，8周完成。',
    )

    assert.equal(initial.phase, 'core')
    assert.equal(initial.cards.find((card) => card.field === 'startDate')?.category, 'critical')
    assert.equal(initial.cards.find((card) => card.field === 'teamSize')?.category, 'critical')

    const result = service.analyze(
      '开发支付系统，目标是支持商户收款，包括登录、支付、退款和对账，8周完成。',
      coreAnswers(),
    )
    assert.equal(result.phase, 'conditional')
    assert.equal(result.cards.find((card) => card.field === 'compliance')?.category, 'recommended')
  })

  test('卡片按类别、影响数、置信度与字段稳定排序', ({ assert }) => {
    const service = new ClarificationService()
    const first = service.analyze('帮我安排一下这个事情').cards
    const second = service.analyze('帮我安排一下这个事情').cards

    assert.deepEqual(second, first)
    assert.equal(first[0]?.field, 'projectGoal')
    assert.isTrue(
      first.every((card, index) => index === 0 || rank(first[index - 1]!) <= rank(card)),
    )
  })

  test('answer/default/skip 语义生成确认上下文且关键问题阻断 ready', ({ assert }) => {
    const service = new ClarificationService()
    const initial = service.analyze('开发一个内部工具')
    assert.equal(initial.branch, 'clarify')

    assert.throws(
      () =>
        service.analyze('开发一个内部工具', {
          projectGoal: { field: 'projectGoal', action: 'skip', value: null, marker: null },
        }),
      /关键问题/,
    )

    const result = service.analyze('开发一个内部工具', {
      ...coreAnswers(),
      projectGoal: answer('projectGoal', '减少重复录入'),
      hosting: { field: 'hosting', action: 'skip', value: null, marker: null },
    })

    assert.equal(result.branch, 'ready')
    assert.equal(result.confirmedContext.resolvedFields.projectGoal?.marker.source, 'explicit')
    assert.include(result.confirmedContext.unansweredOptionalFields, 'hosting')
    assert.isUndefined(result.cards.find((card) => card.field === 'projectGoal'))
    assert.isUndefined(result.cards.find((card) => card.field === 'teamSize'))
  })

  test('固定评测关键缺失召回不低于 80%', ({ assert }) => {
    const service = new ClarificationService()
    let expected = 0
    let recalled = 0

    for (const fixture of AI_INTENT_EVALUATION_CASES) {
      const critical = new Set(
        service
          .analyze(fixture.rawInput)
          .cards.filter((card) => card.category === 'critical')
          .map((card) => card.field),
      )
      for (const field of fixture.expectedCritical) {
        expected += 1
        recalled += Number(critical.has(field))
      }
    }

    assert.isAbove(expected, 0)
    assert.isAtLeast(recalled / expected, 0.8)
  })

  test('完整输入问题相关率不低于 90%', ({ assert }) => {
    const result = new ClarificationService().analyze(COMPLETE_INTENT_INPUT)
    const irrelevantFields = new Set<ClarificationField>([])
    const relevant = result.cards.filter((card) => !irrelevantFields.has(card.field)).length
    const relevance = result.cards.length === 0 ? 1 : relevant / result.cards.length

    assert.isAtLeast(relevance, 0.9)
    assert.equal(result.phase, 'core')
    assert.equal(result.summary.critical, 7)
    assert.equal(result.activeCard?.field, 'projectGoal')
    assert.equal(result.remainingCount, 7)
    assert.isTrue(result.coverage?.valid)
  })

  test('活动项目不展示软件交付专用澄清卡', ({ assert }) => {
    const result = new ClarificationService().analyze(
      '举办 800 人户外音乐表演，目标是安全完成售票和现场执行，包括联系表演团队、帐篷厂商、场地租借、停车接驳、安保医疗和雨天备援。团队 6 人，今天是 2026-07-24，2026 年 8 月 15 日举办。',
    )
    const fields = new Set(result.cards.map((card) => card.field))

    assert.equal(result.confirmedContext.parsedIntent.projectType, 'event')
    assert.isFalse(fields.has('techStack'))
    assert.isFalse(fields.has('hosting'))
    assert.isFalse(fields.has('integration'))
    assert.isFalse(fields.has('designPreference'))
  })

  test('每张澄清卡都带选项说明、自定义输入与必填边界', ({ assert }) => {
    const service = new ClarificationService()
    const result = service.analyze('开发一个内部系统')

    assert.isAtLeast(result.cards.length, 1)
    for (const card of result.cards) {
      for (const option of card.quickOptions) {
        assert.isAbove(option.description.trim().length, 0)
      }
      assert.equal(card.customInput.enabled, true)
      assert.isAbove(card.customInput.label.trim().length, 0)
      assert.isAbove(card.customInput.placeholder.trim().length, 0)
      assert.isAbove(card.customInput.description.trim().length, 0)
      assert.equal(card.isRequired, card.category === 'critical')
      assert.equal(card.allowSkip, card.category !== 'critical')
    }

    const critical = result.cards.find((card) => card.category === 'critical')
    assert.isDefined(critical)
    assert.equal(critical?.allowSkip, false)
    assert.equal(critical?.isRequired, true)
  })

  test('卡片目录中的快速选项必须有一行说明', ({ assert }) => {
    for (const definition of Object.values(CARD_CATALOG)) {
      for (const option of definition.quickOptions) {
        assert.isAbove(option.description.trim().length, 0)
      }
    }
  })

  test('连续三轮已回答 cardId 零重复且显式回答优先', ({ assert }) => {
    const service = new ClarificationService()
    const rawInput = '开发一个内部系统'
    const accumulated: ClarificationAnswers = {
      projectGoal: answer('projectGoal', '提升审批效率'),
    }
    const firstCardId = service
      .analyze(rawInput)
      .cards.find((card) => card.field === 'projectGoal')?.cardId
    const second = service.analyze(rawInput, accumulated)
    accumulated.targetUser = answer('targetUser', '财务人员')
    const third = service.analyze(rawInput, accumulated)

    assert.isNotNull(firstCardId)
    assert.isFalse(second.cards.some((card) => card.cardId === firstCardId))
    assert.isFalse(third.cards.some((card) => card.field === 'targetUser'))
    assert.equal(third.confirmedContext.resolvedFields.targetUser?.value, '财务人员')
  })

  test('问题 revision 只接受当前 activeCard 的下一次回答', ({ assert }) => {
    const service = new ClarificationService()
    const rawInput = '开发一个内部运营工单系统'
    const initial = service.analyze(rawInput)
    const current = initial.activeCard!
    const answers: ClarificationAnswers = {
      [current.field]: {
        field: current.field,
        action: 'answer',
        value: '提升工单处理效率',
        marker: null,
        cardId: current.cardId,
        source: current.source,
      },
    }

    service.assertQuestionPlanRevision(rawInput, answers, initial.questionPlanRevision!)
    assert.throws(
      () => service.assertQuestionPlanRevision(rawInput, answers, 'stale-revision'),
      /QUESTION_PLAN_STALE/,
    )
  })
})

function rank(card: { category: 'critical' | 'recommended' | 'optional' }): number {
  return { critical: 0, recommended: 1, optional: 2 }[card.category]
}
