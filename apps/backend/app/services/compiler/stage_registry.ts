/**
 * v2-project-compiler-foundation —— StageRegistry（tasks 4.1）。
 *
 * 中央 Stage 注册表。支持：
 * - 按 stageId 注册 StageDefinition
 * - 按 stageId 查询
 * - 按 phase 查询
 * - 重复注册同一 stageId 报错
 * - 查询不存在 Stage 返回结构化错误
 */
import type { StageDefinition, StagePhase } from '@aiproj/compiler-spec'
import { z } from 'zod'

export class StageNotFoundError extends Error {
  constructor(stageId: string) {
    super(`Stage not found: ${stageId}`)
    this.name = 'StageNotFoundError'
  }
}

export class DuplicateStageError extends Error {
  constructor(stageId: string) {
    super(`Duplicate stage registration: ${stageId}`)
    this.name = 'DuplicateStageError'
  }
}

export class StageRegistry {
  /** stageId → StageDefinition */
  #stages = new Map<string, StageDefinition>()

  /**
   * 注册 Stage。
   * 重复注册同一 stageId 必须报 DuplicateStageError。
   */
  register(definition: StageDefinition): void {
    if (this.#stages.has(definition.stageId)) {
      throw new DuplicateStageError(definition.stageId)
    }
    this.#stages.set(definition.stageId, definition)
  }

  /**
   * 按 stageId 查询 Stage。
   * 不存在时抛出 StageNotFoundError。
   */
  get(stageId: string): StageDefinition {
    const stage = this.#stages.get(stageId)
    if (!stage) {
      throw new StageNotFoundError(stageId)
    }
    return stage
  }

  /**
   * 按 phase 查询 Stage 列表。
   * 返回有序数组（注册顺序）。
   */
  getByPhase(phase: StagePhase): StageDefinition[] {
    const result: StageDefinition[] = []
    for (const stage of this.#stages.values()) {
      if (stage.phase === phase) {
        result.push(stage)
      }
    }
    return result
  }

  /** 查询所有已注册 Stage。 */
  getAll(): StageDefinition[] {
    return Array.from(this.#stages.values())
  }

  /** 获取已注册 Stage 数量。 */
  get size(): number {
    return this.#stages.size
  }

  /** 清空注册表（主要用于测试）。 */
  clear(): void {
    this.#stages.clear()
  }
}

/** StageRegistry 的 zod schema（用于验证注册表状态）。 */
export const stageRegistrySchema = z.object({
  size: z.number().int().nonnegative(),
  stageIds: z.array(z.string()),
})
