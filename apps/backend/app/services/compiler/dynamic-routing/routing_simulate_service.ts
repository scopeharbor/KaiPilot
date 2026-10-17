/**
 * v2-5-compiler-dynamic-routing-management-ui（切片 C, task 4.1）—— 路由模拟纯函数。
 *
 * 只读 dry-run 模拟：复用纯函数 RoutingPlanner.plan()。
 * 不创建 run、不写库、不发事件、不调真实模型。
 * 零 AdonisJS 依赖——可被 unit test 直接导入。
 */
import { RoutingRuleRegistry } from './routing_rule_registry.js'
import { RoutingPlanner } from './routing_planner.js'
import type {
  RoutingSimulateRequest,
  RoutingSimulateResponse,
  SerializedDecisionSummary,
} from '@aiproj/types/compiler-dynamic-routing'

const KNOWN_STAGE_IDS = ['intent_ingestion', 'intent_parsing', 'dag_stub']

/**
 * 只读 dry-run 模拟。
 * 不创建 run、不写库、不发事件、不调真实模型。
 */
export function simulate(input: RoutingSimulateRequest): RoutingSimulateResponse {
  const registry = new RoutingRuleRegistry(KNOWN_STAGE_IDS)
  const planner = new RoutingPlanner()

  const result = planner.plan({
    registry,
    candidateStageIds: input.candidateStageIds,
    availableHandlerIds: input.availableHandlerStageIds,
    contractVersion: input.contractVersion,
    dependencies: input.dependencies.map((d) => ({
      stageId: d.stageId,
      dependsOn: d.dependsOn,
    })),
    scenarioKind: input.scenarioKind,
    runId: 0, // 模拟不绑定真实 run
  })

  const decisionSummary: SerializedDecisionSummary = {
    inputHash: result.decision.inputHash,
    ruleVersion: result.decision.ruleVersion,
    ruleId: result.decision.ruleId,
    scenarioKind: result.decision.scenarioKind,
    selectedStageCount: result.decision.selectedStageCount,
    originalStageCount: result.decision.originalStageCount,
    reasonCode: result.decision.reasonCode,
    isFallback: result.decision.isFallback,
    runId: 0,
    createdAt: result.decision.createdAt,
    selectedStageIds: result.decision.selectedStageIds,
    skippedStageIds: result.decision.skippedStageIds,
  }

  return {
    simulated: true,
    decision: decisionSummary,
    valid: result.valid,
    errors: result.errors,
    noSideEffect: true,
  }
}
