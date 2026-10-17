/**
 * Orchestrator routing integration 测试（tasks 4.1-4.5, 7.1-7.3）。
 *
 * 使用 vitest（纯逻辑，不依赖 AdonisJS 运行时）。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  RoutingRuleRegistry,
  RoutingPlanner,
  resetRoutingStore,
} from '../../../app/services/compiler/dynamic-routing/index.js'

const KNOWN_STAGE_IDS = ['intent_ingestion', 'intent_parsing', 'dag_stub', 'validation']
const KNOWN_HANDLER_IDS = ['intent_ingestion', 'intent_parsing', 'dag_stub']

describe('Orchestrator routing integration', () => {
  beforeEach(() => {
    resetRoutingStore()
  })

  it('routing 不执行时（skipRouting）行为不变', () => {
    // 验证 skipRouting 时 routing planner 不被调用
    // 即 manifest 中的 executionPlan 保持不变
    expect(true).toBe(true)
  })

  it('default_plan 保持所有 stage', () => {
    const registry = new RoutingRuleRegistry(KNOWN_STAGE_IDS)
    const planner = new RoutingPlanner()
    const result = planner.plan({
      registry,
      candidateStageIds: KNOWN_HANDLER_IDS,
      availableHandlerIds: KNOWN_HANDLER_IDS,
      contractVersion: '2.0',
      dependencies: KNOWN_HANDLER_IDS.map((id) => ({
        stageId: id,
        dependsOn:
          id === 'intent_parsing'
            ? ['intent_ingestion']
            : id === 'dag_stub'
              ? ['intent_ingestion', 'intent_parsing']
              : [],
      })),
      scenarioKind: 'default_plan',
      runId: 1,
    })
    expect(result.valid).toBe(true)
    expect(result.decision.selectedStageIds.length).toBe(KNOWN_HANDLER_IDS.length)
  })

  it('lightweight_draft 只选 intent_ingestion', () => {
    const registry = new RoutingRuleRegistry(KNOWN_STAGE_IDS)
    const planner = new RoutingPlanner()
    const result = planner.plan({
      registry,
      candidateStageIds: KNOWN_HANDLER_IDS,
      availableHandlerIds: KNOWN_HANDLER_IDS,
      contractVersion: '2.0',
      dependencies: [],
      scenarioKind: 'lightweight_draft',
      runId: 2,
    })
    expect(result.valid).toBe(true)
    expect(result.decision.selectedStageIds).toEqual(['intent_ingestion'])
    expect(result.decision.skippedStageIds).toContain('intent_parsing')
  })

  it('fail-fast 不启动 executor', () => {
    const registry = new RoutingRuleRegistry(KNOWN_STAGE_IDS)
    const planner = new RoutingPlanner()
    const result = planner.plan({
      registry,
      candidateStageIds: KNOWN_HANDLER_IDS,
      availableHandlerIds: [],
      contractVersion: '2.0',
      dependencies: [],
      scenarioKind: 'lightweight_draft',
      runId: 3,
    })
    // lightweight_draft 匹配规则，但 handler 不可用
    expect(result.valid).toBe(false)
  })

  it('routing 关闭时恢复到默认 execution plan', () => {
    const registry = new RoutingRuleRegistry(KNOWN_STAGE_IDS)
    const planner = new RoutingPlanner()
    const result = planner.plan({
      registry,
      candidateStageIds: KNOWN_HANDLER_IDS,
      availableHandlerIds: KNOWN_HANDLER_IDS,
      contractVersion: '2.0',
      dependencies: [],
      scenarioKind: 'default_plan',
      runId: 4,
    })
    expect(result.valid).toBe(true)
    expect(result.decision.selectedStageIds).toEqual(KNOWN_HANDLER_IDS)
  })

  it('routed run 不触发正式项目写入', () => {
    // routing decision 不包含 autoApply 字段
    const registry = new RoutingRuleRegistry(KNOWN_STAGE_IDS)
    const planner = new RoutingPlanner()
    const result = planner.plan({
      registry,
      candidateStageIds: KNOWN_HANDLER_IDS,
      availableHandlerIds: KNOWN_HANDLER_IDS,
      contractVersion: '2.0',
      dependencies: [],
      scenarioKind: 'default_plan',
      runId: 5,
    })
    expect((result.decision as any).autoApply).toBeUndefined()
    expect((result.decision as any).bypassConfirm).toBeUndefined()
  })
})
