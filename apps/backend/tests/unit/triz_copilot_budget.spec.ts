// v3-triz-contradiction-copilot tasks 2.3 —— Autonomy Budget 硬上限单测。
//
// 覆盖（tasks 2.3 验收 + spec「澄清轮次与自主权预算硬上限」第 1–5 条 + design D7）：
// - 默认值 = 澄清 2 轮 / 度量 5 次 / Token = `TRIZ_MAPPING_LIMITS.runTokenBudget`（与 1.4 的模型侧预算同源；
//   原 4000，2026-09-26 为思考模型放宽到 64000）；
// - 默认值不可上调：构造入参传更大的值一律被忽略；收紧（下调）生效；
// - 第 3 轮澄清请求被拒绝，且给出中文原因（不静默、不无限重试）；
// - 第 6 次度量读取被拦截，前 5 次放行；
// - 触顶返回中间成果说明而非空结果（`state === 'exhausted'` 且原因非空、计数器保留）；
// - 与既有 `UnifiedBudgetGuard` 取交：守卫放行也无法把上限抬到默认 Token 预算以上；
//   守卫拒绝按原样传递；门不可用 / 抛错按 fail-closed 拒绝（不默认放行）。
import { test } from '@japa/runner'

import {
  TRIZ_AUTONOMY_BUDGET_DEFAULTS,
  TRIZ_BUDGET_REASON_CODES,
  TrizCopilotBudget,
  composeTrizBudgetGates,
  resolveTrizAutonomyBudgetLimits,
  trizBudgetClarificationReason,
  trizBudgetMetricReadReason,
} from '#services/triz_copilot/triz_copilot_budget'
import {
  TRIZ_MAPPING_CAPABILITY,
  TRIZ_MAPPING_LIMITS,
  createRunTokenBudgetGate,
  createUnifiedBudgetGate,
  type TrizMappingBudgetGate,
} from '#services/triz_copilot/triz_contradiction_mapping_service'

/** 单次分析 Token 默认上限（与 1.4 模型侧预算同源，调用方只能收紧）。 */
const RUN_TOKENS = TRIZ_MAPPING_LIMITS.runTokenBudget

const BASE_INPUT = {
  organizationId: 11,
  projectId: 22,
  userId: 33,
  capability: TRIZ_MAPPING_CAPABILITY,
  surface: 'triz_copilot_mapping',
  estimatedCost: 0,
  ledgerAttemptRef: null,
}

function gateThatReturns(allowed: boolean): TrizMappingBudgetGate {
  return {
    async preflight() {
      return {
        allowed,
        outcome: allowed ? 'allow' : 'block',
        reasonCode: allowed ? null : 'hard_limit_tokens_exceeded',
        reason: allowed ? null : '组织 AI 预算已耗尽',
      }
    },
  }
}

test.group('TRIZ Autonomy Budget 硬上限（tasks 2.3）', () => {
  test('默认上限：澄清 2 轮 / 度量 5 次 / Token 与 1.4 模型侧预算同源', ({ assert }) => {
    assert.deepEqual(TRIZ_AUTONOMY_BUDGET_DEFAULTS, {
      clarificationRounds: 2,
      metricReads: 5,
      runTokens: RUN_TOKENS,
    })
    const budget = new TrizCopilotBudget()
    assert.deepEqual(budget.limits, {
      clarificationRounds: 2,
      metricReads: 5,
      runTokens: RUN_TOKENS,
    })
  })

  test('默认值不可上调：传入更大的预算被忽略，收紧生效', ({ assert }) => {
    const raised = resolveTrizAutonomyBudgetLimits({
      clarificationRounds: 9,
      metricReads: 50,
      runTokens: RUN_TOKENS * 10,
    })
    assert.deepEqual(raised, { clarificationRounds: 2, metricReads: 5, runTokens: RUN_TOKENS })

    const tightened = resolveTrizAutonomyBudgetLimits({
      clarificationRounds: 1,
      metricReads: 2,
      runTokens: 800,
    })
    assert.deepEqual(tightened, { clarificationRounds: 1, metricReads: 2, runTokens: 800 })

    // 非法取值（0 / 负数 / 非有限数）同样忽略，不会把链路压到不可用
    assert.deepEqual(
      resolveTrizAutonomyBudgetLimits({
        clarificationRounds: 0,
        metricReads: Number.POSITIVE_INFINITY,
        runTokens: Number.NaN,
      }),
      { clarificationRounds: 2, metricReads: 5, runTokens: RUN_TOKENS },
    )

    // 构造函数同样只收不放
    const budget = new TrizCopilotBudget({
      limits: { clarificationRounds: 7, runTokens: RUN_TOKENS + 1 },
    })
    assert.equal(budget.limits.clarificationRounds, 2)
    assert.equal(budget.limits.runTokens, RUN_TOKENS)
  })

  test('第 3 轮澄清请求被拒绝并给出中文原因', ({ assert }) => {
    const budget = new TrizCopilotBudget()

    assert.isTrue(budget.requestClarification().allowed)
    assert.equal(budget.clarificationRounds, 1)
    assert.isTrue(budget.requestClarification().allowed)
    assert.equal(budget.clarificationRounds, 2)

    const third = budget.requestClarification()
    assert.isFalse(third.allowed)
    assert.equal(third.code, TRIZ_BUDGET_REASON_CODES.clarificationExhausted)
    assert.equal(third.reason, trizBudgetClarificationReason(2))
    assert.include(third.reason ?? '', '2 轮')
    assert.match(third.reason ?? '', /[\u4e00-\u9fff]/)
    // 被拒的第 3 轮不得计入轮数
    assert.equal(budget.clarificationRounds, 2)
    assert.equal(budget.state, 'exhausted')
  })

  test('第 6 次度量读取被拦截，前 5 次放行', ({ assert }) => {
    const budget = new TrizCopilotBudget()

    for (let index = 1; index <= 5; index += 1) {
      const decision = budget.requestMetricRead()
      assert.isTrue(decision.allowed, `第 ${index} 次读取应放行`)
      assert.equal(budget.metricReadCount, index)
    }

    const sixth = budget.requestMetricRead()
    assert.isFalse(sixth.allowed)
    assert.equal(sixth.code, TRIZ_BUDGET_REASON_CODES.metricReadsExhausted)
    assert.equal(sixth.reason, trizBudgetMetricReadReason(5))
    assert.equal(budget.metricReadCount, 5, '被拦截的读取不计数')
  })

  test('批量申请：额度不足时只放行剩余部分并记触顶原因', ({ assert }) => {
    const budget = new TrizCopilotBudget()
    const first = budget.requestMetricReads(4)
    assert.deepEqual(first, { granted: 4, denied: 0, reason: null })

    const second = budget.requestMetricReads(3)
    assert.equal(second.granted, 1)
    assert.equal(second.denied, 2)
    assert.equal(second.reason, trizBudgetMetricReadReason(5))
    assert.equal(budget.metricReadCount, 5)
  })

  test('触顶返回中间成果说明而非空结果，计数器与用量保留', ({ assert }) => {
    const budget = new TrizCopilotBudget()
    budget.requestMetricReads(5)
    budget.recordEstimatedTokens(1200)
    budget.recordActualTokens(980)
    const decision = budget.requestClarification() // 第 1 轮放行
    assert.isTrue(decision.allowed)
    budget.requestClarification() // 第 2 轮放行
    budget.requestClarification() // 第 3 轮触顶

    const snapshot = budget.snapshot()
    assert.equal(snapshot.state, 'exhausted')
    assert.isString(snapshot.reason)
    assert.isNotEmpty(snapshot.reason ?? '')
    assert.match(snapshot.reason ?? '', /[\u4e00-\u9fff]/)
    // 触顶不清零已有成果（中间成果可照常返回）
    assert.equal(snapshot.metricReadCount, 5)
    assert.equal(snapshot.clarificationRounds, 2)
    assert.equal(snapshot.estimatedTokens, 1200)
    assert.equal(snapshot.actualTokens, 980)
    assert.equal(snapshot.tokenBudget, RUN_TOKENS)
    assert.isNotEmpty(budget.reasons)
    assert.equal(budget.suspensionReason, snapshot.reason)
  })

  test('未知真实用量保持 null（不伪报为 0）', ({ assert }) => {
    const budget = new TrizCopilotBudget()
    budget.recordEstimatedTokens(2100)
    budget.recordActualTokens(null)
    assert.isNull(budget.snapshot().actualTokens)
  })

  test('本地 4000 门：超出预算阻断并给出中文原因', async ({ assert }) => {
    const gate = createRunTokenBudgetGate(4000)
    const blocked = await gate.preflight({
      ...BASE_INPUT,
      estimatedTokens: 4200,
      idempotencyKey: 'k1',
    })
    assert.isFalse(blocked.allowed)
    assert.equal(blocked.reasonCode, 'run_token_budget_exceeded')
    assert.match(blocked.reason ?? '', /4000/)

    const allowed = await gate.preflight({
      ...BASE_INPUT,
      estimatedTokens: 3200,
      idempotencyKey: 'k2',
    })
    assert.isTrue(allowed.allowed)
  })

  test('组合门：守卫放行也不能把上限抬到默认 Token 预算以上', async ({ assert }) => {
    const budget = new TrizCopilotBudget({ limits: { runTokens: RUN_TOKENS * 10 } })
    const composed = composeTrizBudgetGates([budget.tokenGate(), gateThatReturns(true)])

    assert.equal(budget.limits.runTokens, RUN_TOKENS)
    const decision = await composed.preflight({
      ...BASE_INPUT,
      estimatedTokens: RUN_TOKENS + 1000,
      idempotencyKey: 'compose-1',
    })
    assert.isFalse(decision.allowed)
    assert.equal(decision.reasonCode, 'run_token_budget_exceeded')
  })

  test('组合门：接入既有 UnifiedBudgetGuard 适配门（拒绝按原样传递）', async ({ assert }) => {
    const seen: Array<Record<string, unknown>> = []
    const guardGate = createUnifiedBudgetGate({
      preflight: async (input) => {
        seen.push(input as unknown as Record<string, unknown>)
        return {
          allowed: false,
          outcome: 'block',
          reasonCode: 'hard_limit_tokens_exceeded',
          reason: '组织 AI 预算已耗尽',
          triggeringScope: null,
          triggeringPolicyName: null,
          appliedPolicies: ['org-monthly'],
          degradation: null,
          decisionRecord: {} as never,
        }
      },
    })

    const composed = composeTrizBudgetGates([new TrizCopilotBudget().tokenGate(), guardGate])
    const decision = await composed.preflight({
      ...BASE_INPUT,
      estimatedTokens: 1000,
      idempotencyKey: 'compose-2',
    })

    assert.isFalse(decision.allowed)
    assert.equal(decision.reasonCode, 'hard_limit_tokens_exceeded')
    assert.equal(decision.reason, '组织 AI 预算已耗尽')
    assert.lengthOf(seen, 1)
    assert.equal(seen[0].capability, TRIZ_MAPPING_CAPABILITY)
    assert.equal(seen[0].idempotencyKey, 'compose-2')
  })

  test('组合门 fail-closed：门抛错或门列表为空一律拒绝（不默认放行）', async ({ assert }) => {
    const throwing: TrizMappingBudgetGate = {
      async preflight() {
        throw new Error('guard 不可用')
      },
    }
    const withThrow = await composeTrizBudgetGates([throwing]).preflight({
      ...BASE_INPUT,
      estimatedTokens: 100,
      idempotencyKey: 'compose-3',
    })
    assert.isFalse(withThrow.allowed)
    assert.equal(withThrow.reasonCode, TRIZ_BUDGET_REASON_CODES.gateUnavailable)
    assert.match(withThrow.reason ?? '', /预算校验不可用/)

    const empty = await composeTrizBudgetGates([]).preflight({
      ...BASE_INPUT,
      estimatedTokens: 100,
      idempotencyKey: 'compose-4',
    })
    assert.isFalse(empty.allowed)
    assert.equal(empty.reasonCode, TRIZ_BUDGET_REASON_CODES.gateUnavailable)
  })
})
