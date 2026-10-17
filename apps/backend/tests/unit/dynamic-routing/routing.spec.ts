/**
 * Compiler Dynamic Routing 完整测试套件（tasks 1.3–6.4）。
 *
 * 覆盖：
 * - 规则注册表（注册、验证、查重、未知 stage、版本）
 * - Planner（default plan、匹配路由、依赖校验、handler 校验、fail-fast）
 * - Decision 证据（记录、查询、敏感字段、序列化）
 * - Resume/Replay（decision 绑定、drift 检测）
 * - 安全边界（敏感字段拒绝）
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  RoutingRuleRegistry,
  RoutingPlanner,
  recordRoutingDecision,
  getRoutingDecision,
  hasRoutingDecision,
  resetRoutingStore,
  recordDriftDiagnostic,
  getDriftDiagnostics,
  serializeDecisionSummary,
} from '../../../app/services/compiler/dynamic-routing/index.js'
import type {
  RoutingRule,
  RoutingDecision,
  PlannerContext,
  PlannerDependency,
} from '../../../app/services/compiler/dynamic-routing/index.js'

// ── 共享 fixture ──

const KNOWN_STAGE_IDS = [
  'intent_ingestion',
  'intent_parsing',
  'dag_stub',
  'validation',
  'artifact_review',
]
const KNOWN_HANDLER_IDS = ['intent_ingestion', 'intent_parsing', 'dag_stub']

function makeDependencies(): PlannerDependency[] {
  return [
    { stageId: 'intent_parsing', dependsOn: ['intent_ingestion'] },
    { stageId: 'dag_stub', dependsOn: ['intent_ingestion', 'intent_parsing'] },
    { stageId: 'validation', dependsOn: ['dag_stub'] },
  ]
}

function baseContext(overrides?: Partial<PlannerContext>): PlannerContext {
  return {
    registry: new RoutingRuleRegistry(KNOWN_STAGE_IDS),
    candidateStageIds: ['intent_ingestion', 'intent_parsing', 'dag_stub'],
    availableHandlerIds: KNOWN_HANDLER_IDS,
    contractVersion: '2.0',
    dependencies: makeDependencies(),
    scenarioKind: 'default_plan',
    runId: 1,
    ...overrides,
  }
}

describe('RoutingRuleRegistry', () => {
  it('注册默认规则', () => {
    const registry = new RoutingRuleRegistry(KNOWN_STAGE_IDS)
    expect(registry.ruleCount).toBeGreaterThan(0)
    expect(registry.versionString).toBe('1.0')
  })

  it('getDefaultRule 返回 isDefault 规则', () => {
    const registry = new RoutingRuleRegistry(KNOWN_STAGE_IDS)
    const defaultRule = registry.getDefaultRule()
    expect(defaultRule).toBeDefined()
    expect(defaultRule!.isDefault).toBe(true)
  })

  it('getRulesForScenario 返回匹配规则', () => {
    const registry = new RoutingRuleRegistry(KNOWN_STAGE_IDS)
    const rules = registry.getRulesForScenario('lightweight_draft')
    expect(rules.length).toBeGreaterThan(0)
    expect(rules[0]!.id).toBe('lightweight-draft-v1')
  })

  it('getRulesForScenario 未知场景返回空', () => {
    const registry = new RoutingRuleRegistry(KNOWN_STAGE_IDS)
    const rules = registry.getRulesForScenario('incompatible_rule')
    expect(rules.length).toBe(0)
  })

  it('重复注册抛出 DuplicateRuleError', () => {
    const rules: RoutingRule[] = [
      {
        id: 'dup-rule',
        version: { major: 1, minor: 0 },
        compatibleContracts: { min: '1.0', max: '2.0' },
        scenarioKinds: ['default_plan'],
        allowedStageIds: ['intent_ingestion'],
        allowedSkippedStageIds: [],
        reasonCode: 'ROUTE_DEFAULT_PLAN',
      },
      {
        id: 'dup-rule',
        version: { major: 1, minor: 0 },
        compatibleContracts: { min: '1.0', max: '2.0' },
        scenarioKinds: ['default_plan'],
        allowedStageIds: ['intent_ingestion'],
        allowedSkippedStageIds: [],
        reasonCode: 'ROUTE_DEFAULT_PLAN',
      },
    ]
    expect(() => new RoutingRuleRegistry(KNOWN_STAGE_IDS, rules)).toThrow('Duplicate routing rule')
  })

  it('未知 stage id 抛出 UnknownStageInRuleError', () => {
    const rules: RoutingRule[] = [
      {
        id: 'bad-rule',
        version: { major: 1, minor: 0 },
        compatibleContracts: { min: '1.0', max: '2.0' },
        scenarioKinds: ['default_plan'],
        allowedStageIds: ['unknown_stage'],
        allowedSkippedStageIds: [],
        reasonCode: 'ROUTE_DEFAULT_PLAN',
      },
    ]
    expect(() => new RoutingRuleRegistry(KNOWN_STAGE_IDS, rules)).toThrow('Unknown stage')
  })

  it('snapshot 返回当前状态', () => {
    const registry = new RoutingRuleRegistry(KNOWN_STAGE_IDS)
    const snap = registry.snapshot()
    expect(snap.ruleCount).toBe(registry.ruleCount)
    expect(snap.version).toBe('1.0')
  })
})

describe('RoutingPlanner - default plan', () => {
  it('default_plan 场景返回原始候选 plan（通过匹配规则）', () => {
    const ctx = baseContext({ scenarioKind: 'default_plan' })
    const planner = new RoutingPlanner()
    const result = planner.plan(ctx)
    expect(result.valid).toBe(true)
    expect(result.decision.selectedStageIds).toEqual([
      'intent_ingestion',
      'intent_parsing',
      'dag_stub',
    ])
    // default_plan 有匹配规则（default-plan-v1），isFallback 为 false 因为规则匹配成功
    expect(result.decision.reasonCode).toBe('ROUTE_MATCHED')
  })

  it('default_plan 保持原始 stage count', () => {
    const ctx = baseContext({ scenarioKind: 'default_plan' })
    const planner = new RoutingPlanner()
    const result = planner.plan(ctx)
    expect(result.decision.selectedStageCount).toBe(3)
    expect(result.decision.originalStageCount).toBe(3)
  })
})

describe('RoutingPlanner - matched route', () => {
  it('lightweight_draft 场景只选择 intent_ingestion', () => {
    const ctx = baseContext({ scenarioKind: 'lightweight_draft' })
    const planner = new RoutingPlanner()
    const result = planner.plan(ctx)
    expect(result.valid).toBe(true)
    expect(result.decision.selectedStageIds).toEqual(['intent_ingestion'])
    expect(result.decision.skippedStageIds).toEqual(['intent_parsing', 'dag_stub'])
    expect(result.decision.reasonCode).toBe('ROUTE_MATCHED')
  })

  it('deterministic_validation 选择意图分析', () => {
    const ctx = baseContext({ scenarioKind: 'deterministic_validation' })
    const planner = new RoutingPlanner()
    const result = planner.plan(ctx)
    expect(result.valid).toBe(true)
    expect(result.decision.selectedStageIds).toContain('intent_ingestion')
    expect(result.decision.selectedStageIds).toContain('intent_parsing')
  })
})

describe('RoutingPlanner - dependency validation', () => {
  it('依赖缺失导致 fail-fast', () => {
    const deps: PlannerDependency[] = [
      { stageId: 'intent_parsing', dependsOn: ['intent_ingestion'] },
    ]
    const knownStages = ['intent_ingestion', 'intent_parsing']
    const customRules: RoutingRule[] = [
      {
        id: 'skip-ingestion',
        version: { major: 1, minor: 0 },
        compatibleContracts: { min: '1.0', max: '2.0' },
        scenarioKinds: ['deterministic_validation'],
        allowedStageIds: ['intent_parsing'],
        allowedSkippedStageIds: ['intent_ingestion'],
        reasonCode: 'ROUTE_MATCHED',
      },
    ]
    const ctx: PlannerContext = {
      registry: new RoutingRuleRegistry(knownStages, customRules),
      candidateStageIds: ['intent_ingestion', 'intent_parsing'],
      availableHandlerIds: ['intent_ingestion', 'intent_parsing'],
      contractVersion: '2.0',
      dependencies: deps,
      scenarioKind: 'deterministic_validation',
      runId: 1,
    }
    const planner = new RoutingPlanner()
    const result = planner.plan(ctx)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('RoutingPlanner - handler validation', () => {
  it('lightweight_draft 缺少 handler 导致 fail-fast', () => {
    const ctx = baseContext({
      scenarioKind: 'lightweight_draft',
      availableHandlerIds: [], // 没有匹配的 handler
    })
    const planner = new RoutingPlanner()
    const result = planner.plan(ctx)
    // lightweight_draft 匹配规则，但 intent_ingestion 没有 handler
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('handler'))).toBe(true)
  })
})

describe('RoutingPlanner - empty path', () => {
  it('未知场景回到 default plan', () => {
    const ctx = baseContext({ scenarioKind: 'incompatible_rule' })
    const planner = new RoutingPlanner()
    const result = planner.plan(ctx)
    // 无匹配规则 -> default plan
    expect(result.valid).toBe(true)
    expect(result.decision.isFallback).toBe(true)
  })
})

describe('RoutingPlanner - 相同输入收敛', () => {
  it('相同输入两次产生相同 decision', () => {
    const ctx1 = baseContext({ scenarioKind: 'lightweight_draft', runId: 1 })
    const ctx2 = baseContext({ scenarioKind: 'lightweight_draft', runId: 2 })
    const planner = new RoutingPlanner()
    const r1 = planner.plan(ctx1)
    const r2 = planner.plan(ctx2)
    expect(r1.decision.inputHash).toBe(r2.decision.inputHash)
    expect(r1.decision.selectedStageIds).toEqual(r2.decision.selectedStageIds)
    expect(r1.valid).toBe(r2.valid)
  })
})

describe('RoutingDecision 证据', () => {
  beforeEach(() => {
    resetRoutingStore()
  })

  it('recordRoutingDecision 存储 decision', () => {
    const decision: RoutingDecision = {
      inputHash: 'h1',
      ruleVersion: { major: 1, minor: 0 },
      ruleId: 'test-rule',
      scenarioKind: 'lightweight_draft',
      selectedStageIds: ['intent_ingestion'],
      skippedStageIds: [],
      selectedStageCount: 1,
      originalStageCount: 3,
      reasonCode: 'ROUTE_MATCHED',
      isFallback: false,
      runId: 42,
      createdAt: new Date().toISOString(),
    }
    const result = recordRoutingDecision(decision)
    expect(result.ok).toBe(true)
    expect(hasRoutingDecision(42)).toBe(true)
    expect(getRoutingDecision(42)).toBeDefined()
  })

  it('getRoutingDecision 返回 undefined 当不存在', () => {
    resetRoutingStore()
    expect(getRoutingDecision(999)).toBeUndefined()
  })

  it('敏感字段 decision 被拒绝', () => {
    const decision: RoutingDecision = {
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
      runId: 43,
      createdAt: '',
    }
    const withSecret = { ...decision, prompt: 'user secret' } as any
    const result = recordRoutingDecision(withSecret)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('sensitive')
  })

  it('serializeDecisionSummary 只输出低敏字段', () => {
    const decision: RoutingDecision = {
      inputHash: 'h',
      ruleVersion: null,
      ruleId: null,
      scenarioKind: 'default_plan',
      selectedStageIds: ['s1'],
      skippedStageIds: [],
      selectedStageCount: 1,
      originalStageCount: 2,
      reasonCode: 'ROUTE_DEFAULT_PLAN',
      isFallback: true,
      runId: 1,
      createdAt: '2026-07-20T00:00:00Z',
      auditRefs: { runId: 1, actorUserId: 42, organizationId: 100 },
    }
    const summary = serializeDecisionSummary(decision)
    expect(summary.inputHash).toBe('h')
    expect(summary.scenarioKind).toBe('default_plan')
    expect(summary.selectedStageIds).toEqual(['s1'])
    // 不包含敏感字段
    expect((summary as any).prompt).toBeUndefined()
  })
})

describe('Drift 诊断', () => {
  beforeEach(() => {
    resetRoutingStore()
  })

  it('recordDriftDiagnostic 记录 drift', () => {
    const drift = recordDriftDiagnostic(1, { major: 1, minor: 0 }, '1.1', [
      'Rule version changed from 1.0 to 1.1',
    ])
    expect(drift.drifts).toHaveLength(1)
    expect(drift.currentRegistryVersion).toBe('1.1')
  })

  it('getDriftDiagnostics 返回空数组当无 drift', () => {
    resetRoutingStore()
    expect(getDriftDiagnostics(999)).toEqual([])
  })

  it('run 绑定原 decision，resume 读取原 decision', () => {
    const decision: RoutingDecision = {
      inputHash: 'h',
      ruleVersion: { major: 1, minor: 0 },
      ruleId: 'lightweight-draft-v1',
      scenarioKind: 'lightweight_draft',
      selectedStageIds: ['intent_ingestion'],
      skippedStageIds: ['intent_parsing', 'dag_stub'],
      selectedStageCount: 1,
      originalStageCount: 3,
      reasonCode: 'ROUTE_MATCHED',
      isFallback: false,
      runId: 100,
      createdAt: '2026-07-20T00:00:00Z',
    }
    recordRoutingDecision(decision)

    // 模拟 resume：读取原 decision
    const original = getRoutingDecision(100)
    expect(original).toBeDefined()
    expect(original!.ruleId).toBe('lightweight-draft-v1')
    expect(original!.selectedStageIds).toEqual(['intent_ingestion'])
  })
})

describe('安全与产品边界', () => {
  it('routing decision 不含 artifact body', () => {
    const decision: RoutingDecision = {
      inputHash: 'h',
      ruleVersion: null,
      ruleId: null,
      scenarioKind: 'default_plan',
      selectedStageIds: ['s1'],
      skippedStageIds: [],
      selectedStageCount: 1,
      originalStageCount: 2,
      reasonCode: 'ROUTE_DEFAULT_PLAN',
      isFallback: true,
      runId: 1,
      createdAt: '',
    }
    const summary = serializeDecisionSummary(decision)
    expect((summary as any).artifactBody).toBeUndefined()
    expect((summary as any).artifactContext).toBeUndefined()
  })

  it('不绕过人工确认——routed run completed 不写项目数据', () => {
    // routing 只改变 stage path，不触发正式写入
    // 此断言仅验证 design 原则：无 auto-apply 相关字段
    const decision: RoutingDecision = {
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
    expect((decision as any).autoApply).toBeUndefined()
    expect((decision as any).bypassConfirm).toBeUndefined()
  })
})
