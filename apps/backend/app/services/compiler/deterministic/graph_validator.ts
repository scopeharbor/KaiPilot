/**
 * Deterministic Engine —— 图校验服务。
 *
 * 检测重复 ID、缺失节点、非法依赖类型、依赖环、跨项目引用、孤立核心对象。
 *
 * @aiproj/backend
 */

import type {
  GraphValidationInput,
  GraphValidationResult,
  ValidationRuleResult,
} from '@aiproj/compiler-spec'
import type { DeterministicContext, GraphValidationService } from './interfaces.js'

export class GraphValidator implements GraphValidationService {
  readonly name = 'graph_validator'

  async validate(
    input: GraphValidationInput,
    _context: DeterministicContext,
  ): Promise<GraphValidationResult> {
    const rules: ValidationRuleResult[] = []
    const blocking: ValidationRuleResult[] = []
    const warnings: ValidationRuleResult[] = []
    const infos: ValidationRuleResult[] = []

    const taskIds = new Set(Object.keys(input.taskDependencies))

    // 1. 检查重复 ID（entityId 重复）
    this.#checkDuplicateIds(input, rules, blocking)

    // 2. 检查缺失节点（依赖引用了不存在的 taskId）
    this.#checkMissingNodes(input, taskIds, rules, blocking)

    // 3. 检查非法依赖类型
    this.#checkInvalidDependencyTypes(input, warnings)

    // 4. 检查依赖环（DFS cycle detection）
    this.#checkCycles(input, rules, blocking)

    // 5. 检查跨项目引用（dependencies 中引用了 input 外的 taskId）
    this.#checkCrossProjectRefs(input, taskIds, rules, warnings)

    // 6. 检查孤立核心对象
    this.#checkOrphanedTasks(input, taskIds, rules, infos)

    return {
      passed: blocking.length === 0,
      rules,
      blocking,
      warnings,
      infos,
    }
  }

  #checkDuplicateIds(
    input: GraphValidationInput,
    rules: ValidationRuleResult[],
    blocking: ValidationRuleResult[],
  ) {
    const seen = new Map<string, string[]>()
    for (const tid of Object.keys(input.taskDependencies)) {
      const list = seen.get(tid) ?? []
      list.push(tid)
      seen.set(tid, list)
    }

    for (const [id, occurrences] of seen) {
      if (occurrences.length > 1) {
        const rule: ValidationRuleResult = {
          ruleId: 'GRAPH_DUPLICATE_ID',
          severity: 'blocking',
          path: `/tasks/${id}`,
          message: `重复实体 ID: ${id} 出现 ${occurrences.length} 次`,
          sourceStageId: 'deterministic_graph_validation',
          autoFixable: true,
          requiresHumanReview: true,
          entityIds: [id],
        }
        rules.push(rule)
        blocking.push(rule)
      }
    }
  }

  #checkMissingNodes(
    input: GraphValidationInput,
    taskIds: Set<string>,
    rules: ValidationRuleResult[],
    blocking: ValidationRuleResult[],
  ) {
    const reported = new Set<string>()

    for (const deps of Object.values(input.taskDependencies)) {
      for (const depId of deps.dependsOn ?? []) {
        if (!taskIds.has(depId) && !reported.has(depId)) {
          reported.add(depId)
          const rule: ValidationRuleResult = {
            ruleId: 'GRAPH_MISSING_NODE',
            severity: 'blocking',
            path: `/tasks/${deps.id}/dependsOn`,
            message: `缺失节点: 引用的实体 ${depId} 不存在`,
            sourceStageId: 'deterministic_graph_validation',
            autoFixable: false,
            requiresHumanReview: true,
            entityIds: [deps.id, depId],
          }
          rules.push(rule)
          blocking.push(rule)
        }
      }
    }

    // 检查 dependencies 数组
    for (const dep of input.dependencies ?? []) {
      if (!taskIds.has(dep.predecessorId) && !reported.has(dep.predecessorId)) {
        reported.add(dep.predecessorId)
        blocking.push({
          ruleId: 'GRAPH_MISSING_NODE',
          severity: 'blocking',
          path: `/dependencies/${dep.predecessorId}`,
          message: `缺失节点: 前驱 ${dep.predecessorId} 不存在`,
          sourceStageId: 'deterministic_graph_validation',
          autoFixable: false,
          requiresHumanReview: true,
          entityIds: [dep.predecessorId, dep.successorId],
        })
      }
      if (!taskIds.has(dep.successorId) && !reported.has(dep.successorId)) {
        reported.add(dep.successorId)
        blocking.push({
          ruleId: 'GRAPH_MISSING_NODE',
          severity: 'blocking',
          path: `/dependencies/${dep.successorId}`,
          message: `缺失节点: 后续 ${dep.successorId} 不存在`,
          sourceStageId: 'deterministic_graph_validation',
          autoFixable: false,
          requiresHumanReview: true,
          entityIds: [dep.predecessorId, dep.successorId],
        })
      }
    }
  }

  #checkInvalidDependencyTypes(input: GraphValidationInput, warnings: ValidationRuleResult[]) {
    const validTypes = new Set(['FS', 'SS', 'FF', 'SF'])

    for (const deps of Object.values(input.taskDependencies)) {
      for (const dep of deps.dependencies ?? []) {
        if (!validTypes.has(dep.type ?? 'FS')) {
          warnings.push({
            ruleId: 'GRAPH_INVALID_DEPENDENCY_TYPE',
            severity: 'warning',
            path: `/tasks/${deps.id}/dependencies`,
            message: `非法依赖类型: ${dep.type}，默认降级为 FS`,
            sourceStageId: 'deterministic_graph_validation',
            autoFixable: true,
            requiresHumanReview: false,
            entityIds: [deps.id, dep.predecessorId],
          })
        }
      }
    }
  }

  #checkCycles(
    input: GraphValidationInput,
    rules: ValidationRuleResult[],
    blocking: ValidationRuleResult[],
  ) {
    const taskIds = Object.keys(input.taskDependencies)
    const adjacency = new Map<string, string[]>()

    for (const tid of taskIds) {
      adjacency.set(tid, [])
    }

    for (const deps of Object.values(input.taskDependencies)) {
      const neighbors = adjacency.get(deps.id) ?? []
      for (const depId of deps.dependsOn ?? []) {
        if (adjacency.has(depId) && !neighbors.includes(depId)) {
          neighbors.push(depId)
        }
      }
    }

    const WHITE = 0
    const GRAY = 1
    const BLACK = 2
    const color = new Map<string, number>()
    const parent = new Map<string, string | null>()
    const cycleNodes = new Set<string>()

    for (const tid of taskIds) color.set(tid, WHITE)

    function dfs(u: string): boolean {
      color.set(u, GRAY)
      for (const v of adjacency.get(u) ?? []) {
        if (color.get(v) === GRAY) {
          // 发现环：收集环上的节点
          cycleNodes.add(v)
          let cur = u
          while (cur !== v) {
            cycleNodes.add(cur)
            cur = parent.get(cur) ?? ''
          }
          cycleNodes.add(u)
          return true
        }
        if (color.get(v) === WHITE) {
          parent.set(v, u)
          if (dfs(v)) return true
        }
      }
      color.set(u, BLACK)
      return false
    }

    for (const tid of taskIds) {
      if (color.get(tid) === WHITE) {
        dfs(tid)
      }
    }

    if (cycleNodes.size > 0) {
      const rule: ValidationRuleResult = {
        ruleId: 'GRAPH_CYCLE_DETECTED',
        severity: 'blocking',
        path: '/tasks',
        message: `依赖环检测到，涉及节点: ${Array.from(cycleNodes).join(', ')}`,
        sourceStageId: 'deterministic_graph_validation',
        autoFixable: false,
        requiresHumanReview: true,
        entityIds: Array.from(cycleNodes),
      }
      rules.push(rule)
      blocking.push(rule)
    }
  }

  #checkCrossProjectRefs(
    input: GraphValidationInput,
    taskIds: Set<string>,
    _rules: ValidationRuleResult[],
    warnings: ValidationRuleResult[],
  ) {
    for (const deps of Object.values(input.taskDependencies)) {
      for (const dep of deps.dependencies ?? []) {
        if (!taskIds.has(dep.predecessorId) && !taskIds.has(dep.successorId)) {
          warnings.push({
            ruleId: 'GRAPH_CROSS_PROJECT_REF',
            severity: 'warning',
            path: `/tasks/${deps.id}/dependencies`,
            message: `跨项目引用: ${dep.predecessorId} -> ${dep.successorId} 均不在当前项目`,
            sourceStageId: 'deterministic_graph_validation',
            autoFixable: false,
            requiresHumanReview: true,
            entityIds: [dep.predecessorId, dep.successorId],
          })
        }
      }
    }
  }

  #checkOrphanedTasks(
    input: GraphValidationInput,
    taskIds: Set<string>,
    _rules: ValidationRuleResult[],
    infos: ValidationRuleResult[],
  ) {
    const hasIncoming = new Set<string>()
    for (const deps of Object.values(input.taskDependencies)) {
      for (const depId of deps.dependsOn ?? []) {
        hasIncoming.add(depId)
      }
    }

    for (const tid of taskIds) {
      if (!hasIncoming.has(tid)) {
        const taskDeps = input.taskDependencies[tid]?.dependsOn ?? []
        if (taskDeps.length === 0) {
          infos.push({
            ruleId: 'GRAPH_ORPHANED_TASK',
            severity: 'info',
            path: `/tasks/${tid}`,
            message: `孤立任务: ${tid} 无前驱也无后继`,
            sourceStageId: 'deterministic_graph_validation',
            autoFixable: false,
            requiresHumanReview: false,
            entityIds: [tid],
          })
        }
      }
    }
  }
}
