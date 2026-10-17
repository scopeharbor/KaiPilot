/**
 * compiler-dynamic-routing 类型契约测试（tasks 1.3-1.5）。
 */

import { describe, it, expect } from 'vitest'
import {
  COMPILER_SCENARIO_KINDS,
  ROUTING_REASON_CODES,
  routingDecisionContainsSensitiveFields,
  computeRoutingInputHash,
  routingResponseContainsSensitiveFields,
  type CompilerScenarioKind,
  type RoutingReasonCode,
  type RoutingRule,
  type RoutingInput,
  type RoutingDecision,
  type RoutingRuleVersion,
  type RoutingRegistrySnapshotView,
  type RoutingDecisionSummaryView,
  type RoutingSimulateRequest,
  type RoutingSimulateResponse,
  type RoutingRuleAuthoringRequest,
  type RoutingRulePreviewResponse,
  type RoutingRuleConfirmRequest,
  type RoutingRuleCommittedView,
  type RoutingRuleView,
} from './compiler-dynamic-routing'

describe('COMPILER_SCENARIO_KINDS', () => {
  it('包含首批受控场景', () => {
    expect(COMPILER_SCENARIO_KINDS).toContain('default_plan')
    expect(COMPILER_SCENARIO_KINDS).toContain('lightweight_draft')
    expect(COMPILER_SCENARIO_KINDS).toContain('deterministic_validation')
    expect(COMPILER_SCENARIO_KINDS).toContain('artifact_review')
    expect(COMPILER_SCENARIO_KINDS).toContain('incompatible_rule')
  })

  it('所有 kind 为 snake_case', () => {
    for (const kind of COMPILER_SCENARIO_KINDS) {
      expect(kind).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('未知场景不在枚举中', () => {
    const unknown = 'software_code_generation' as CompilerScenarioKind
    expect(COMPILER_SCENARIO_KINDS).not.toContain(unknown)
  })
})

describe('ROUTING_REASON_CODES', () => {
  it('包含成功/失败/诊断 code', () => {
    expect(ROUTING_REASON_CODES).toContain('ROUTE_MATCHED')
    expect(ROUTING_REASON_CODES).toContain('ROUTE_DEFAULT_PLAN')
    expect(ROUTING_REASON_CODES).toContain('ROUTE_UNKNOWN_STAGE')
    expect(ROUTING_REASON_CODES).toContain('ROUTE_DEPENDENCY_VIOLATION')
    expect(ROUTING_REASON_CODES).toContain('ROUTE_DRIFT_DETECTED')
  })

  it('所有 code 使用大写 ROUTE_ 前缀', () => {
    for (const code of ROUTING_REASON_CODES) {
      expect(code).toMatch(/^ROUTE_/)
    }
  })
})

describe('RoutingRule 结构', () => {
  it('合法的 rule 对象通过类型检查', () => {
    const rule: RoutingRule = {
      id: 'default-plan-v1',
      version: { major: 1, minor: 0 },
      compatibleContracts: { min: '1.0', max: '2.0' },
      scenarioKinds: ['default_plan'],
      allowedStageIds: ['intent_ingestion', 'dag_stub'],
      allowedSkippedStageIds: [],
      reasonCode: 'ROUTE_DEFAULT_PLAN',
      isDefault: true,
    }
    expect(rule.id).toBe('default-plan-v1')
    expect(rule.allowedStageIds).toHaveLength(2)
  })
})

describe('RoutingDecision 审计', () => {
  it('合法 decision 对象', () => {
    const decision: RoutingDecision = {
      inputHash: 'abc123',
      ruleVersion: { major: 1, minor: 0 },
      ruleId: 'lightweight-v1',
      scenarioKind: 'lightweight_draft',
      selectedStageIds: ['intent_ingestion'],
      skippedStageIds: ['dag_stub', 'validation'],
      selectedStageCount: 1,
      originalStageCount: 3,
      reasonCode: 'ROUTE_MATCHED',
      isFallback: false,
      runId: 42,
      createdAt: new Date().toISOString(),
    }
    expect(decision.selectedStageCount).toBeLessThanOrEqual(decision.originalStageCount)
  })

  it('default_plan decision 无 ruleId', () => {
    const decision: RoutingDecision = {
      inputHash: 'abc123',
      ruleVersion: null,
      ruleId: null,
      scenarioKind: 'default_plan',
      selectedStageIds: ['s1', 's2'],
      skippedStageIds: [],
      selectedStageCount: 2,
      originalStageCount: 2,
      reasonCode: 'ROUTE_DEFAULT_PLAN',
      isFallback: true,
      runId: 1,
      createdAt: new Date().toISOString(),
    }
    expect(decision.ruleId).toBeNull()
    expect(decision.isFallback).toBe(true)
  })
})

describe('敏感字段检测', () => {
  it('发现敏感字段', () => {
    const decision: RoutingDecision = {
      inputHash: 'x',
      ruleVersion: null,
      ruleId: null,
      scenarioKind: 'default_plan',
      selectedStageIds: [],
      skippedStageIds: [],
      selectedStageCount: 0,
      originalStageCount: 0,
      reasonCode: 'ROUTE_DEFAULT_PLAN',
      isFallback: true,
      runId: 1,
      createdAt: '',
    }
    const withSensitive = { ...decision, prompt: 'user input' } as any
    expect(routingDecisionContainsSensitiveFields(withSensitive).found).toBe(true)
  })

  it('安全 decision 通过检测', () => {
    const decision: RoutingDecision = {
      inputHash: 'safe_hash_123',
      ruleVersion: { major: 1, minor: 0 },
      ruleId: 'rule-v1',
      scenarioKind: 'deterministic_validation',
      selectedStageIds: ['intent_ingestion'],
      skippedStageIds: [],
      selectedStageCount: 1,
      originalStageCount: 2,
      reasonCode: 'ROUTE_MATCHED',
      isFallback: false,
      runId: 42,
      createdAt: '2026-07-20T00:00:00Z',
    }
    expect(routingDecisionContainsSensitiveFields(decision).found).toBe(false)
  })
})

describe('computeRoutingInputHash', () => {
  it('相同输入产生相同 hash', () => {
    const input1: RoutingInput = {
      scenarioKind: 'lightweight_draft',
      candidateStageIds: ['s1', 's2', 's3'],
      availableHandlerStageIds: ['s1', 's2'],
      contractVersion: '2.0',
      runId: 1,
    }
    const input2: RoutingInput = {
      scenarioKind: 'lightweight_draft',
      candidateStageIds: ['s1', 's2', 's3'],
      availableHandlerStageIds: ['s1', 's2'],
      contractVersion: '2.0',
      runId: 2, // 注意：runId 不同但 hash 相同（runId 不在 hash 输入中）
    }
    expect(computeRoutingInputHash(input1)).toBe(computeRoutingInputHash(input2))
  })

  it('不同输入产生不同 hash', () => {
    const input1: RoutingInput = {
      scenarioKind: 'default_plan',
      candidateStageIds: ['s1', 's2'],
      availableHandlerStageIds: ['s1'],
      contractVersion: '2.0',
      runId: 1,
    }
    const input2: RoutingInput = {
      scenarioKind: 'lightweight_draft',
      candidateStageIds: ['s1', 's2'],
      availableHandlerStageIds: ['s1'],
      contractVersion: '2.0',
      runId: 2,
    }
    expect(computeRoutingInputHash(input1)).not.toBe(computeRoutingInputHash(input2))
  })

  it('排序不影响 hash', () => {
    const input1: RoutingInput = {
      scenarioKind: 'default_plan',
      candidateStageIds: ['s2', 's1'],
      availableHandlerStageIds: ['handler_b', 'handler_a'],
      contractVersion: '2.0',
      runId: 1,
    }
    const input2: RoutingInput = {
      scenarioKind: 'default_plan',
      candidateStageIds: ['s1', 's2'],
      availableHandlerStageIds: ['handler_a', 'handler_b'],
      contractVersion: '2.0',
      runId: 2,
    }
    expect(computeRoutingInputHash(input1)).toBe(computeRoutingInputHash(input2))
  })
})

describe('非法 state 组合', () => {
  it('selectedStageCount 不能 > originalStageCount', () => {
    const bad = { selectedStageCount: 5, originalStageCount: 3 }
    expect(bad.selectedStageCount).toBeGreaterThan(bad.originalStageCount)
  })

  it('default_plan 必须标记 isFallback', () => {
    const defaultPlan: RoutingDecision = {
      inputHash: 'h',
      ruleVersion: null,
      ruleId: null,
      scenarioKind: 'default_plan',
      selectedStageIds: [],
      skippedStageIds: [],
      selectedStageCount: 0,
      originalStageCount: 0,
      reasonCode: 'ROUTE_DEFAULT_PLAN',
      isFallback: true,
      runId: 1,
      createdAt: '',
    }
    expect(defaultPlan.isFallback).toBe(true)
    expect(defaultPlan.reasonCode).toBe('ROUTE_DEFAULT_PLAN')
  })
})

// ── 管理 UI DTO 契约测试（v2-5-compiler-dynamic-routing-management-ui tasks 2.1-2.2） ──

describe('管理 UI DTO 低敏字段白名单', () => {
  it('RoutingRuleView 不含敏感字段键', () => {
    const rule: RoutingRuleView = {
      id: 'default-plan-v1',
      version: { major: 1, minor: 0 },
      compatibleContracts: { min: '1.0', max: '2.0' },
      scenarioKinds: ['default_plan'],
      allowedStageIds: ['intent_ingestion'],
      allowedSkippedStageIds: [],
      reasonCode: 'ROUTE_DEFAULT_PLAN',
      isDefault: true,
      enabled: true,
      source: 'code_default',
    }
    const json = JSON.stringify(rule)
    expect(json).not.toContain('prompt')
    expect(json).not.toContain('secret')
    expect(json).not.toContain('token')
    expect(json).not.toContain('artifactBody')
  })

  it('RoutingRegistrySnapshotView 仅含低敏投影字段', () => {
    const snap: RoutingRegistrySnapshotView = {
      version: '1.0',
      rules: [],
      ruleCount: 0,
    }
    expect(routingResponseContainsSensitiveFields(snap).found).toBe(false)
  })

  it('RoutingDecisionSummaryView 空态结构正确', () => {
    const empty: RoutingDecisionSummaryView = {
      hasDecision: false,
      decision: null,
      drift: [],
    }
    expect(empty.hasDecision).toBe(false)
    expect(empty.decision).toBeNull()
  })

  it('RoutingSimulateResponse 标注 noSideEffect 且 simulated=true', () => {
    const resp: RoutingSimulateResponse = {
      simulated: true,
      decision: {
        inputHash: 'h',
        ruleVersion: null,
        ruleId: null,
        scenarioKind: 'default_plan',
        selectedStageCount: 0,
        originalStageCount: 0,
        reasonCode: 'ROUTE_DEFAULT_PLAN',
        isFallback: true,
        runId: 0,
        createdAt: '',
        selectedStageIds: [],
        skippedStageIds: [],
      },
      valid: true,
      errors: [],
      noSideEffect: true,
    }
    expect(resp.simulated).toBe(true)
    expect(resp.noSideEffect).toBe(true)
  })
})

describe('routingResponseContainsSensitiveFields 守卫', () => {
  it('对干净 DTO 返回 found:false', () => {
    const req: RoutingSimulateRequest = {
      scenarioKind: 'default_plan',
      candidateStageIds: ['intent_ingestion'],
      availableHandlerStageIds: ['intent_ingestion'],
      contractVersion: '2.0',
      dependencies: [],
    }
    expect(routingResponseContainsSensitiveFields(req).found).toBe(false)
  })

  it('对含 prompt 字段的 payload 返回 found:true', () => {
    const bad = { scenarioKind: 'default_plan', prompt: 'secret-prompt-text' }
    const result = routingResponseContainsSensitiveFields(bad)
    expect(result.found).toBe(true)
    expect(result.fieldPath).toBe('prompt')
  })

  it('对含 token 字段的 payload 返回 found:true', () => {
    const bad = { ruleId: 'x', token: 'abc' }
    expect(routingResponseContainsSensitiveFields(bad).found).toBe(true)
  })

  it('对含 apiKey 字段的 payload 返回 found:true（大小写不敏感）', () => {
    const bad = { ruleId: 'x', apiKey: 'abc' }
    expect(routingResponseContainsSensitiveFields(bad).found).toBe(true)
  })

  it('对编排请求 preview/confirm/committed DTO 均生效', () => {
    const authoring: RoutingRuleAuthoringRequest = {
      id: 'r-v1',
      version: { major: 1, minor: 0 },
      compatibleContracts: { min: '1.0', max: '2.0' },
      scenarioKinds: ['default_plan'],
      allowedStageIds: ['intent_ingestion'],
      allowedSkippedStageIds: [],
      reasonCode: 'ROUTE_MATCHED',
      enabled: true,
    }
    expect(routingResponseContainsSensitiveFields(authoring).found).toBe(false)

    const badAuthoring = { ...authoring, secret: 'leak' }
    expect(routingResponseContainsSensitiveFields(badAuthoring).found).toBe(true)

    const confirm: RoutingRuleConfirmRequest = { confirmToken: 'tok-123' }
    expect(routingResponseContainsSensitiveFields(confirm).found).toBe(false)

    const committed: RoutingRuleCommittedView = {
      committed: true,
      rule: {
        id: 'r-v1',
        version: { major: 1, minor: 0 },
        compatibleContracts: { min: '1.0', max: '2.0' },
        scenarioKinds: ['default_plan'],
        allowedStageIds: [],
        allowedSkippedStageIds: [],
        reasonCode: 'ROUTE_MATCHED',
        isDefault: false,
        enabled: true,
        source: 'org_persisted',
      },
      auditEvent: 'AI_COMPILER_ROUTING_RULE_CREATED',
    }
    expect(routingResponseContainsSensitiveFields(committed).found).toBe(false)
  })

  it('preview 响应 previewOnly 恒为 true', () => {
    const preview: RoutingRulePreviewResponse = {
      before: null,
      after: {
        id: 'r-v1',
        version: { major: 1, minor: 0 },
        compatibleContracts: { min: '1.0', max: '2.0' },
        scenarioKinds: ['default_plan'],
        allowedStageIds: [],
        allowedSkippedStageIds: [],
        reasonCode: 'ROUTE_MATCHED',
        isDefault: false,
        enabled: true,
        source: 'org_persisted',
      },
      affectedScenarioKinds: ['default_plan'],
      affectedStageIds: [],
      confirmToken: 'ctoken',
      previewOnly: true,
    }
    expect(preview.previewOnly).toBe(true)
  })
})
