/**
 * @aiproj/backend —— Cascade Guard（tasks 2.7）。
 *
 * 基于 changedEntityIds/paths 计算受影响闭包并拒绝超过级联上限的自动修复。
 *
 * @aiproj/backend
 */

import type { CascadeGuard } from '@aiproj/compiler-spec'
import { DEFAULT_REPAIR_BUDGET } from '@aiproj/compiler-spec'

export { type CascadeGuard }

export interface AffectedClosureResult {
  cascadeGuard: CascadeGuard
  /** 计算受影响闭包时的详细实体路径映射。 */
  closureMap: Map<string, string[]>
}

export class CascadeGuardService {
  readonly #maxCascadeDepth: number

  constructor(maxCascadeDepth: number = DEFAULT_REPAIR_BUDGET.maxCascadeDepth) {
    this.#maxCascadeDepth = maxCascadeDepth
  }

  /**
   * 计算受影响闭包并检查是否超出级联上限。
   *
   * @param changedEntityIds 本次修复直接更改的实体 ID。
   * @param changedPaths 直接更改的 PDM 路径。
   * @param entityDependencyMap 实体间依赖关系（如 taskId → [downstreamTaskIds]）。
   */
  computeClosure(
    changedEntityIds: string[],
    changedPaths: string[],
    entityDependencyMap: Map<string, string[]> = new Map(),
  ): AffectedClosureResult {
    const affected = new Set<string>()
    const closureMap = new Map<string, string[]>()
    let depth = 0

    // BFS 遍历下游依赖
    const queue = [...changedEntityIds]
    while (queue.length > 0 && depth <= this.#maxCascadeDepth) {
      const levelSize = queue.length
      for (let i = 0; i < levelSize; i++) {
        const entityId = queue.shift()!
        if (affected.has(entityId)) continue
        affected.add(entityId)

        const downstream = entityDependencyMap.get(entityId) ?? []
        closureMap.set(entityId, downstream)
        for (const dep of downstream) {
          if (!affected.has(dep)) {
            queue.push(dep)
          }
        }
      }
      depth++
    }

    const cascadeGuard: CascadeGuard = {
      changedEntityIds,
      changedPaths,
      affectedEntityIds: Array.from(affected),
      cascadeDepth: depth - 1,
      exceedsLimit: depth > this.#maxCascadeDepth && queue.length > 0,
    }

    return { cascadeGuard, closureMap }
  }

  /**
   * 检查是否允许自动修复。
   */
  canAutoRepair(guard: CascadeGuard): { allowed: boolean; reason?: string } {
    if (guard.exceedsLimit) {
      return {
        allowed: false,
        reason: `Cascade depth exceeds limit of ${this.#maxCascadeDepth}`,
      }
    }
    return { allowed: true }
  }
}
