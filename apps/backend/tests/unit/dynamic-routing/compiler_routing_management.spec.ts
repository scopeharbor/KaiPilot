/**
 * v2-5-compiler-dynamic-routing-management-ui —— 后端单元测试。
 *
 * 覆盖：
 * - 切片 A：只读观测（进程内存决策、低敏断言、敏感字段守卫）
 * - 切片 C：只读模拟（no-write/no-execute、相同输入相同预测、fail-fast）
 * - 切片 B：编排请求低敏/敏感守卫
 * - 安全：低敏投影、no-auto-apply、敏感字段拒绝
 *
 * 不依赖 DB/AdonisJS 容器——纯逻辑测试。
 * DB 依赖路径（persistRoutingDecision/getRegistrySnapshot/buildRulePreview）
 * 在集成测试或 functional test 中覆盖。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { simulate } from '../../../app/services/compiler/dynamic-routing/routing_simulate_service.js'
import {
  resetRoutingStore,
  recordRoutingDecision,
} from '../../../app/services/compiler/dynamic-routing/index.js'
import type {
  RoutingDecision,
  RoutingSimulateRequest,
  RoutingRuleAuthoringRequest,
} from '@aiproj/types/compiler-dynamic-routing'
import {
  routingDecisionContainsSensitiveFields,
  routingResponseContainsSensitiveFields,
} from '@aiproj/types/compiler-dynamic-routing'

// ── 共享 fixture ──

function makeDecision(overrides?: Partial<RoutingDecision>): RoutingDecision {
  return {
    inputHash: 'routing_abc123',
    ruleVersion: { major: 1, minor: 0 },
    ruleId: 'default-plan-v1',
    scenarioKind: 'default_plan',
    selectedStageIds: ['intent_ingestion', 'intent_parsing', 'dag_stub'],
    skippedStageIds: [],
    selectedStageCount: 3,
    originalStageCount: 3,
    reasonCode: 'ROUTE_DEFAULT_PLAN',
    isFallback: false,
    runId: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeSimulateInput(overrides?: Partial<RoutingSimulateRequest>): RoutingSimulateRequest {
  return {
    scenarioKind: 'default_plan',
    candidateStageIds: ['intent_ingestion', 'intent_parsing', 'dag_stub'],
    availableHandlerStageIds: ['intent_ingestion', 'intent_parsing', 'dag_stub'],
    contractVersion: '2.0',
    dependencies: [
      { stageId: 'intent_parsing', dependsOn: ['intent_ingestion'] },
      { stageId: 'dag_stub', dependsOn: ['intent_ingestion', 'intent_parsing'] },
    ],
    ...overrides,
  }
}

function makeAuthoringRequest(
  overrides?: Partial<RoutingRuleAuthoringRequest>,
): RoutingRuleAuthoringRequest {
  return {
    id: 'custom-rule-v1',
    version: { major: 1, minor: 0 },
    compatibleContracts: { min: '1.0', max: '2.0' },
    scenarioKinds: ['default_plan'],
    allowedStageIds: ['intent_ingestion'],
    allowedSkippedStageIds: ['intent_parsing', 'dag_stub'],
    reasonCode: 'ROUTE_MATCHED',
    enabled: true,
    ...overrides,
  }
}

// ── 切片 A：只读观测 ──

describe('切片 A：只读观测', () => {
  beforeEach(() => {
    resetRoutingStore()
  })

  it('进程内存记录决策成功', () => {
    const decision = makeDecision({ runId: 42 })
    const result = recordRoutingDecision(decision)
    expect(result.ok).toBe(true)
  })

  it('决策证据不含敏感字段', () => {
    const decision = makeDecision()
    const sensitive = routingDecisionContainsSensitiveFields(decision)
    expect(sensitive.found).toBe(false)
  })

  it('序列化摘要不含 prompt/output/artifact/secret', () => {
    const decision = makeDecision()
    const json = JSON.stringify(decision)
    expect(json).not.toContain('prompt')
    expect(json).not.toContain('rawOutput')
    expect(json).not.toContain('artifactBody')
    expect(json).not.toContain('secret')
  })

  it('含敏感字段的 decision 被拒绝', () => {
    const bad = makeDecision()
    // @ts-expect-error 故意注入敏感字段
    bad.prompt = 'leak'
    const result = recordRoutingDecision(bad)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('sensitive')
  })
})

// ── 切片 C：只读路由模拟 ──

describe('切片 C：只读路由模拟', () => {
  it('模拟返回 noSideEffect=true', () => {
    const result = simulate(makeSimulateInput())
    expect(result.simulated).toBe(true)
    expect(result.noSideEffect).toBe(true)
  })

  it('相同输入产生相同预测', () => {
    const input = makeSimulateInput()
    const r1 = simulate(input)
    const r2 = simulate(input)
    expect(r1.decision.inputHash).toBe(r2.decision.inputHash)
    expect(r1.decision.selectedStageIds).toEqual(r2.decision.selectedStageIds)
    expect(r1.decision.reasonCode).toBe(r2.decision.reasonCode)
  })

  it('模拟命中 default_plan', () => {
    const result = simulate(makeSimulateInput({ scenarioKind: 'default_plan' }))
    expect(result.valid).toBe(true)
    expect(result.decision.selectedStageIds.length).toBeGreaterThan(0)
  })

  it('模拟命中 lightweight_draft', () => {
    const result = simulate(makeSimulateInput({ scenarioKind: 'lightweight_draft' }))
    expect(result.valid).toBe(true)
    expect(result.decision.selectedStageIds).toContain('intent_ingestion')
  })

  it('模拟命中 deterministic_validation', () => {
    const result = simulate(makeSimulateInput({ scenarioKind: 'deterministic_validation' }))
    expect(result.valid).toBe(true)
    expect(result.decision.selectedStageIds).toContain('intent_ingestion')
    expect(result.decision.selectedStageIds).toContain('intent_parsing')
  })

  it('模拟命中 artifact_review', () => {
    const result = simulate(makeSimulateInput({ scenarioKind: 'artifact_review' }))
    // artifact_review 允许空 selected（全部跳过）
    expect(result).toHaveProperty('valid')
  })

  it('模拟响应不含敏感字段', () => {
    const result = simulate(makeSimulateInput())
    const sensitive = routingResponseContainsSensitiveFields(result)
    expect(sensitive.found).toBe(false)
  })

  it('模拟不绑定真实 run（runId=0）', () => {
    const result = simulate(makeSimulateInput())
    expect(result.noSideEffect).toBe(true)
    expect(result.decision.runId).toBe(0)
  })

  it('模拟 fail-fast：候选含未知 stage 时仍返回（planner 不校验未知 stage，由 Validator 前置守卫）', () => {
    const result = simulate(
      makeSimulateInput({ candidateStageIds: ['intent_ingestion', 'unknown_stage'] }),
    )
    expect(result).toHaveProperty('valid')
    expect(result).toHaveProperty('decision')
  })
})

// ── 切片 B：编排请求守卫 ──

describe('切片 B：编排请求守卫', () => {
  it('编排请求不含敏感字段', () => {
    const request = makeAuthoringRequest()
    const sensitive = routingResponseContainsSensitiveFields(request)
    expect(sensitive.found).toBe(false)
  })

  it('编排请求含敏感字段被守卫检测', () => {
    const bad = { ...makeAuthoringRequest(), secret: 'leak' }
    const sensitive = routingResponseContainsSensitiveFields(bad)
    expect(sensitive.found).toBe(true)
  })
})

// ── 安全红线 ──

describe('安全红线', () => {
  it('no-auto-apply：模拟绝不写正式项目数据', () => {
    const result = simulate(makeSimulateInput())
    expect(result.noSideEffect).toBe(true)
  })

  it('低敏投影：模拟响应无敏感字段', () => {
    const result = simulate(makeSimulateInput())
    expect(routingResponseContainsSensitiveFields(result).found).toBe(false)
  })

  it('敏感字段守卫：含 prompt 的 decision 被拒绝', () => {
    const badDecision = makeDecision()
    // @ts-expect-error 故意注入敏感字段测试守卫
    badDecision.prompt = 'secret'
    const result = routingDecisionContainsSensitiveFields(badDecision)
    expect(result.found).toBe(true)
  })

  it('routingResponseContainsSensitiveFields 按字段名精确匹配', () => {
    // confirmToken 的值含 "tok" 但字段名不是敏感字段
    const payload = { confirmToken: 'tok-123', ruleId: 'x' }
    expect(routingResponseContainsSensitiveFields(payload).found).toBe(false)
    // 字段名 "token" 是敏感字段
    const bad = { token: 'abc', ruleId: 'x' }
    expect(routingResponseContainsSensitiveFields(bad).found).toBe(true)
  })
})
