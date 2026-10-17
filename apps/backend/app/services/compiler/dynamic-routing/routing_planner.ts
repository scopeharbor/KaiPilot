/**
 * @aiproj/backend —— Routing Planner（tasks 3.1–3.6）。
 *
 * 纯函数 planner：输入 run context、candidate execution plan、registry snapshot，
 * 输出 RoutingDecision。不依赖 DB、不修改任何状态。
 *
 * planner 在无匹配 rule 时返回 default plan，在匹配 rule 但验证失败时
 * 返回 fail-fast decision。
 *
 * @aiproj/backend
 */

import type {
  RoutingInput,
  RoutingDecision,
  PlannerResult,
  RoutingRule,
  CompilerScenarioKind,
  RoutingReasonCode,
} from '@aiproj/types/compiler-dynamic-routing'
import { computeRoutingInputHash } from '@aiproj/types/compiler-dynamic-routing'
import type { RoutingRuleRegistry } from './routing_rule_registry.js'

export interface PlannerDependency {
  stageId: string
  dependsOn: string[]
}

export interface PlannerContext {
  registry: RoutingRuleRegistry
  candidateStageIds: string[]
  availableHandlerIds: string[]
  contractVersion: string
  dependencies: PlannerDependency[]
  /** 场景类型——从 validator/service 推导。 */
  scenarioKind: CompilerScenarioKind
  runId: number
}

/**
 * 纯 routing planner。
 * 输入 context + registry → 输出 validated RoutingDecision。
 */
export class RoutingPlanner {
  /**
   * 执行路由规划。
   * 步骤：
   * 1. 查找匹配的 rule
   * 2. 若无匹配 → default plan（原始 candidate plan）
   * 3. 若有匹配 → 验证 selected stages 可用
   * 4. 重新校验依赖完整性
   * 5. 输出 validated RoutingDecision
   */
  plan(context: PlannerContext): PlannerResult {
    const {
      registry,
      candidateStageIds,
      availableHandlerIds,
      contractVersion,
      dependencies,
      scenarioKind,
      runId,
    } = context

    // 1. 构建 RoutingInput（用于 hash + 审计）
    const input: RoutingInput = {
      scenarioKind,
      candidateStageIds: [...candidateStageIds],
      availableHandlerStageIds: [...availableHandlerIds],
      contractVersion,
      runId,
    }
    const inputHash = computeRoutingInputHash(input)

    // 2. 查找匹配规则
    const matchedRules = registry.getRulesForScenario(scenarioKind)
    const matchedRule =
      matchedRules.length > 0
        ? this.#findBestMatch(matchedRules, contractVersion, registry)
        : undefined

    // 3. 无匹配 → default plan
    if (!matchedRule) {
      const defaultRule = registry.getDefaultRule()
      return {
        decision: {
          inputHash,
          ruleVersion: defaultRule?.version ?? null,
          ruleId: defaultRule?.id ?? null,
          scenarioKind,
          selectedStageIds: [...candidateStageIds],
          skippedStageIds: [],
          selectedStageCount: candidateStageIds.length,
          originalStageCount: candidateStageIds.length,
          reasonCode: 'ROUTE_DEFAULT_PLAN',
          isFallback: true,
          runId,
          createdAt: new Date().toISOString(),
        },
        valid: true,
        errors: [],
      }
    }

    // 4. 有匹配——计算 selected/skipped
    const selectedStageIds = this.#computeSelectedStages(matchedRule, candidateStageIds)
    const skippedStageIds = candidateStageIds.filter((s) => !selectedStageIds.includes(s))

    // 5. 验证依赖完整性
    const dependencyErrors = this.#validateDependencies(
      selectedStageIds,
      dependencies,
      candidateStageIds,
    )

    // 6. 验证 handler 可用性
    const handlerErrors = this.#validateHandlers(selectedStageIds, availableHandlerIds)

    // 7. 验证非空路径
    if (selectedStageIds.length === 0 && scenarioKind !== 'artifact_review') {
      return {
        decision: this.#buildFailFastDecision(inputHash, scenarioKind, runId, 'ROUTE_EMPTY_PATH'),
        valid: false,
        errors: ['Routing produced empty selected stage path'],
      }
    }

    const allErrors = [...dependencyErrors, ...handlerErrors]

    if (allErrors.length > 0) {
      return {
        decision: this.#buildFailFastDecision(
          inputHash,
          scenarioKind,
          runId,
          allErrors.some((e) => e.includes('dependency'))
            ? 'ROUTE_DEPENDENCY_VIOLATION'
            : allErrors.some((e) => e.includes('handler'))
              ? 'ROUTE_MISSING_HANDLER'
              : 'ROUTE_FALLBACK',
        ),
        valid: false,
        errors: allErrors,
      }
    }

    // 8. 成功决策
    return {
      decision: {
        inputHash,
        ruleVersion: matchedRule.version,
        ruleId: matchedRule.id,
        scenarioKind,
        selectedStageIds,
        skippedStageIds,
        selectedStageCount: selectedStageIds.length,
        originalStageCount: candidateStageIds.length,
        reasonCode: 'ROUTE_MATCHED',
        isFallback: false,
        runId,
        createdAt: new Date().toISOString(),
      },
      valid: true,
      errors: [],
    }
  }

  /**
   * 从匹配的规则中选择最佳规则。
   * 优先选择兼容 contract 且所有 stage 都有 handler 的规则。
   */
  #findBestMatch(
    rules: RoutingRule[],
    contractVersion: string,
    registry: RoutingRuleRegistry,
  ): RoutingRule | undefined {
    // 优先非 default 规则
    const nonDefault = rules.filter((r) => !r.isDefault)

    for (const rule of nonDefault) {
      // 检查 contract 兼容性
      if (!registry.isContractCompatible(contractVersion, rule.compatibleContracts)) {
        continue
      }

      // 检查 capabilities（如需要特定 mode）
      if (rule.capabilities?.requiresMode) {
        // mode 匹配由调用方保证，不在此处检查
      }

      return rule
    }

    // fallback 到 default
    return rules.find((r) => r.isDefault)
  }

  /**
   * 计算规则匹配后的 selected stages。
   * 选择所有在 allowedStageIds 中且在 candidate 中的 stage。
   */
  #computeSelectedStages(rule: RoutingRule, candidateStageIds: string[]): string[] {
    // 如果 rule 指定了 allowedStageIds，只选择其中且在 candidate 中的
    if (rule.allowedStageIds.length > 0) {
      return candidateStageIds.filter((s) => rule.allowedStageIds.includes(s))
    }
    // 如果 rule 没有指定 allowedStageIds（如 artifact_review），返回空
    return []
  }

  /**
   * 验证所选 stage 的依赖完整性。
   * 所有 selected stage 的依赖必须是 selected、已满足或在 candidate 中被跳过时标记。
   */
  #validateDependencies(
    selectedStageIds: string[],
    dependencies: PlannerDependency[],
    allCandidateIds: string[],
  ): string[] {
    const errors: string[] = []
    const selectedSet = new Set(selectedStageIds)

    for (const dep of dependencies) {
      if (!selectedSet.has(dep.stageId)) continue

      for (const need of dep.dependsOn) {
        // 依赖必须在 selected 中
        if (!selectedSet.has(need)) {
          // 但如果依赖不在 candidate 中，是正常的
          if (allCandidateIds.includes(need)) {
            errors.push(`Stage "${dep.stageId}" depends on "${need}" which is not selected`)
          }
        }
      }
    }

    return errors
  }

  /**
   * 验证 selected stages 都有 handler。
   */
  #validateHandlers(selectedStageIds: string[], availableHandlerIds: string[]): string[] {
    const errors: string[] = []
    const handlerSet = new Set(availableHandlerIds)

    for (const sid of selectedStageIds) {
      if (!handlerSet.has(sid)) {
        errors.push(`No handler registered for selected stage "${sid}"`)
      }
    }

    return errors
  }

  #buildFailFastDecision(
    inputHash: string,
    scenarioKind: CompilerScenarioKind,
    runId: number,
    reasonCode: RoutingReasonCode,
  ): RoutingDecision {
    return {
      inputHash,
      ruleVersion: null,
      ruleId: null,
      scenarioKind,
      selectedStageIds: [],
      skippedStageIds: [],
      selectedStageCount: 0,
      originalStageCount: 0,
      reasonCode,
      isFallback: true,
      runId,
      createdAt: new Date().toISOString(),
    }
  }
}
