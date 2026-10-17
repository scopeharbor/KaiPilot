import RiskRuleRegistry, { RiskSignalEvaluator } from '#services/risk_signal_evaluator'
import type { SignalInput, SignalCandidate } from '#services/risk_signal_evaluator'
import { test } from '@japa/runner'

/**
 * 风险信号确定性引擎测试。
 *
 * 测试规则引擎输入输出确定性：阈值命中/未命中、空输入、稳定性、排序确定性。
 * 所有测试不涉及数据库或 LLM 调用。
 */
test.group('确定性风险信号引擎', () => {
  const registry = new RiskRuleRegistry()
  const evaluator = new RiskSignalEvaluator(registry)

  function makeEmptyInput(projectId = 1, organizationId = 1): SignalInput {
    return {
      projectId,
      organizationId,
      overdueTasks: [],
      criticalPathTasks: [],
      resourceOverloads: [],
      overdueReviews: [],
      incompleteResponsePlans: [],
      upcomingMilestones: [],
    }
  }

  test('逾期任务规则：命中阈值（关键任务逾期 1 天）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      overdueTasks: [{ id: 1, title: '关键任务 A', daysOverdue: 1, isCritical: true }],
    }

    const candidates = evaluator.evaluate(input)
    const overdueCandidate = candidates.find((c) => c.ruleId === 'overdue-task')

    assert.isDefined(overdueCandidate)
    assert.equal(overdueCandidate!.ruleId, 'overdue-task')
    assert.equal(overdueCandidate!.ruleVersion, '1.0')
    assert.isAtLeast(overdueCandidate!.confidence, 0)
    assert.isTrue(overdueCandidate!.evidence.length >= 1)
  })

  test('逾期任务规则：命中阈值（一般任务逾期 3 天）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      overdueTasks: [{ id: 2, title: '一般任务 B', daysOverdue: 3, isCritical: false }],
    }

    const candidates = evaluator.evaluate(input)
    const overdueCandidate = candidates.find((c) => c.ruleId === 'overdue-task')

    assert.isDefined(overdueCandidate)
    assert.equal(overdueCandidate!.ruleId, 'overdue-task')
    assert.isTrue(overdueCandidate!.evidence.length >= 1)
  })

  test('逾期任务规则：未命中阈值（一般任务逾期 2 天 < 3）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      overdueTasks: [{ id: 3, title: '一般任务 C', daysOverdue: 2, isCritical: false }],
    }

    const candidates = evaluator.evaluate(input)
    const overdueCandidate = candidates.find((c) => c.ruleId === 'overdue-task')

    assert.isUndefined(overdueCandidate, '逾期 2 天的一般任务不应触发逾期任务规则')
  })

  test('逾期任务规则：未命中阈值（关键任务逾期 0 天 < 1）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      overdueTasks: [{ id: 4, title: '关键任务 D', daysOverdue: 0, isCritical: true }],
    }

    const candidates = evaluator.evaluate(input)
    const overdueCandidate = candidates.find((c) => c.ruleId === 'overdue-task')

    assert.isUndefined(overdueCandidate, '逾期 0 天的关键任务不应触发逾期任务规则')
  })

  test('关键路径漂移规则：命中阈值（延期 2 天）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      criticalPathTasks: [{ id: 5, title: '关键路径任务', delayDays: 2 }],
    }

    const candidates = evaluator.evaluate(input)
    const driftCandidate = candidates.find((c) => c.ruleId === 'critical-path-drift')

    assert.isDefined(driftCandidate)
    assert.equal(driftCandidate!.ruleId, 'critical-path-drift')
  })

  test('关键路径漂移规则：未命中阈值（延期 0 天）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      criticalPathTasks: [{ id: 6, title: '关键路径任务', delayDays: 0 }],
    }

    const candidates = evaluator.evaluate(input)
    const driftCandidate = candidates.find((c) => c.ruleId === 'critical-path-drift')

    assert.isUndefined(driftCandidate, '延期 0 天不应触发关键路径漂移规则')
  })

  test('资源过载规则：命中阈值（过载 >= 20%）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      resourceOverloads: [{ role: '开发者', overloadPercent: 30, count: 2 }],
    }

    const candidates = evaluator.evaluate(input)
    const overloadCandidate = candidates.find((c) => c.ruleId === 'resource-overload')

    assert.isDefined(overloadCandidate)
    assert.equal(overloadCandidate!.ruleId, 'resource-overload')
  })

  test('资源过载规则：未命中阈值（过载 10% < 20%）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      resourceOverloads: [{ role: '设计师', overloadPercent: 10, count: 1 }],
    }

    const candidates = evaluator.evaluate(input)
    const overloadCandidate = candidates.find((c) => c.ruleId === 'resource-overload')

    assert.isUndefined(overloadCandidate, '过载 10% 不应触发资源过载规则')
  })

  test('复查逾期规则：命中阈值（逾期 >= 7 天）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      overdueReviews: [{ riskId: 1, title: '逾期风险', daysOverdue: 10 }],
    }

    const candidates = evaluator.evaluate(input)
    const reviewCandidate = candidates.find((c) => c.ruleId === 'review-overdue')

    assert.isDefined(reviewCandidate)
    assert.equal(reviewCandidate!.ruleId, 'review-overdue')
  })

  test('复查逾期规则：未命中阈值（逾期 5 天 < 7）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      overdueReviews: [{ riskId: 2, title: '未逾期风险', daysOverdue: 5 }],
    }

    const candidates = evaluator.evaluate(input)
    const reviewCandidate = candidates.find((c) => c.ruleId === 'review-overdue')

    assert.isUndefined(reviewCandidate, '逾期 5 天不应触发复查逾期规则')
  })

  test('未完成应对计划规则：命中阈值（超期 >= 3 天）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      incompleteResponsePlans: [{ riskId: 1, planId: 1, daysPastDue: 5 }],
    }

    const candidates = evaluator.evaluate(input)
    const planCandidate = candidates.find((c) => c.ruleId === 'incomplete-response-plans')

    assert.isDefined(planCandidate)
    assert.equal(planCandidate!.ruleId, 'incomplete-response-plans')
  })

  test('未完成应对计划规则：未命中阈值（超期 2 天 < 3）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      incompleteResponsePlans: [{ riskId: 1, planId: 1, daysPastDue: 2 }],
    }

    const candidates = evaluator.evaluate(input)
    const planCandidate = candidates.find((c) => c.ruleId === 'incomplete-response-plans')

    assert.isUndefined(planCandidate, '超期 2 天不应触发未完成应对计划规则')
  })

  test('临近里程碑规则：命中阈值（14 天内到期）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      upcomingMilestones: [{ id: 1, title: '里程碑 V1', daysUntil: 7 }],
    }

    const candidates = evaluator.evaluate(input)
    const milestoneCandidate = candidates.find((c) => c.ruleId === 'upcoming-milestone')

    assert.isDefined(milestoneCandidate)
    assert.equal(milestoneCandidate!.ruleId, 'upcoming-milestone')
  })

  test('临近里程碑规则：未命中阈值（15 天 > 14）', async ({ assert }) => {
    const input: SignalInput = {
      ...makeEmptyInput(),
      upcomingMilestones: [{ id: 2, title: '远期里程碑', daysUntil: 15 }],
    }

    const candidates = evaluator.evaluate(input)
    const milestoneCandidate = candidates.find((c) => c.ruleId === 'upcoming-milestone')

    assert.isUndefined(milestoneCandidate, '15 天后到期的里程碑不应触发临近里程碑规则')
  })

  test('空输入产生空候选', async ({ assert }) => {
    const candidates = evaluator.evaluate(makeEmptyInput())
    assert.isEmpty(candidates, '空输入不应产生任何候选')
  })

  test('所有规则都启用了，同一输入同时触发多条规则', async ({ assert }) => {
    const input: SignalInput = {
      projectId: 1,
      organizationId: 1,
      overdueTasks: [{ id: 1, title: '逾期任务', daysOverdue: 5, isCritical: true }],
      criticalPathTasks: [{ id: 2, title: '关键路径延期', delayDays: 2 }],
      resourceOverloads: [{ role: '后端', overloadPercent: 30, count: 3 }],
      overdueReviews: [{ riskId: 1, title: '逾期复查', daysOverdue: 14 }],
      incompleteResponsePlans: [{ riskId: 2, planId: 1, daysPastDue: 7 }],
      upcomingMilestones: [{ id: 1, title: '上线里程碑', daysUntil: 5 }],
    }

    const candidates = evaluator.evaluate(input)

    // 应触发全部 6 条规则
    const triggeredRuleIds = candidates.map((c) => c.ruleId).sort()
    assert.deepEqual(triggeredRuleIds, [
      'critical-path-drift',
      'incomplete-response-plans',
      'overdue-task',
      'resource-overload',
      'review-overdue',
      'upcoming-milestone',
    ])
  })

  test('相同输入产生相同候选（稳定性保证）', async ({ assert }) => {
    const input: SignalInput = {
      projectId: 42,
      organizationId: 1,
      overdueTasks: [
        { id: 1, title: '任务 A', daysOverdue: 4, isCritical: false },
        { id: 2, title: '任务 B', daysOverdue: 7, isCritical: true },
      ],
      criticalPathTasks: [],
      resourceOverloads: [{ role: '前端', overloadPercent: 25, count: 2 }],
      overdueReviews: [],
      incompleteResponsePlans: [],
      upcomingMilestones: [],
    }

    // 两次评估同一输入
    const first = evaluator.evaluate(input)
    const second = evaluator.evaluate(input)

    // 长度相同
    assert.lengthOf(first, second.length)

    // 逐个比较候选字段
    for (const [i, element] of first.entries()) {
      assert.equal(element!.ruleId, second[i]!.ruleId)
      assert.equal(element!.ruleVersion, second[i]!.ruleVersion)
      assert.equal(element!.severity, second[i]!.severity)
      assert.equal(element!.recommendedAction, second[i]!.recommendedAction)
      assert.equal(element!.confidence, second[i]!.confidence)
      assert.equal(element!.idempotencyKey, second[i]!.idempotencyKey)
      // evidence 数组深度相等
      assert.deepEqual(element!.evidence, second[i]!.evidence)
    }
  })

  test('候选排序确定性：同规则输出顺序稳定', async ({ assert }) => {
    const input: SignalInput = {
      projectId: 1,
      organizationId: 1,
      overdueTasks: [
        { id: 10, title: '任务 10', daysOverdue: 5, isCritical: false },
        { id: 11, title: '任务 11', daysOverdue: 8, isCritical: true },
      ],
      criticalPathTasks: [{ id: 20, title: '路径任务 20', delayDays: 3 }],
      resourceOverloads: [{ role: '测试', overloadPercent: 40, count: 2 }],
      overdueReviews: [{ riskId: 30, title: '复查风险', daysOverdue: 14 }],
      incompleteResponsePlans: [{ riskId: 40, planId: 1, daysPastDue: 10 }],
      upcomingMilestones: [{ id: 50, title: '里程碑', daysUntil: 3 }],
    }

    // 运行 10 次检查顺序稳定
    const results: SignalCandidate[][] = []
    for (let run = 0; run < 10; run++) {
      results.push(evaluator.evaluate(input))
    }

    for (let run = 1; run < 10; run++) {
      assert.lengthOf(results[run]!, results[0]!.length)
      for (let i = 0; i < results[0]!.length; i++) {
        assert.equal(results[run]![i]!.ruleId, results[0]![i]!.ruleId)
        assert.deepEqual(results[run]![i]!.evidence, results[0]![i]!.evidence)
      }
    }
  })

  test('规则引擎不调用 LLM（无异步 AI 调用）', async ({ assert }) => {
    // 验证 evaluate 是同步方法
    const input = makeEmptyInput()

    // evaluate 是普通方法（非 async），但返回数组
    // 从实现看：evaluate(input): SignalCandidate[] 是同步方法
    const candidates = evaluator.evaluate(input)

    // 验证返回类型
    assert.isArray(candidates)

    // 验证所有输出字段完整
    const richInput: SignalInput = {
      ...makeEmptyInput(),
      overdueTasks: [{ id: 1, title: '测试', daysOverdue: 5, isCritical: true }],
    }
    const richCandidates = evaluator.evaluate(richInput)

    for (const c of richCandidates) {
      assert.isString(c.ruleId)
      assert.isString(c.ruleVersion)
      assert.isString(c.severity)
      assert.isArray(c.evidence)
      assert.isString(c.recommendedAction)
      assert.isNumber(c.confidence)
      assert.isString(c.idempotencyKey)
    }
  })
})
