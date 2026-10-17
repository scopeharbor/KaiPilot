/**
 * v2-project-compiler-foundation —— LevelValidator（tasks 5.3）。
 *
 * 即时验证的两层：
 * - Level 0：zod/schema 校验（语法正确性）
 * - Level 1：引用完整性校验（引用 ID 必须存在、简单 DAG 不允许环）
 *
 * 不做 Hard Validator 全 25 条、Soft Evaluator 全 17 维。
 */

import type { z } from 'zod'

export interface LevelValidationError {
  path: string
  message: string
  code: string
  level: 0 | 1
}

export interface LevelValidationResult {
  passed: boolean
  level: 0 | 1
  errors: LevelValidationError[]
}

/**
 * LevelValidator —— 两级即时验证器。
 *
 * Level 0：zod schema 语法校验。
 * Level 1：引用完整性校验（ID 存在、简单 DAG 无环）。
 */
export class LevelValidator {
  /**
   * Level 0：zod/schema 校验。
   */
  level0(schema: z.ZodTypeAny, data: unknown): LevelValidationResult {
    const result = schema.safeParse(data)
    if (result.success) {
      return { passed: true, level: 0, errors: [] }
    }

    const errors: LevelValidationError[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: 'SCHEMA_VALIDATION_ERROR',
      level: 0,
    }))

    return { passed: false, level: 0, errors }
  }

  /**
   * Level 1：引用完整性校验。
   * - "引用 ID 必须存在"：所有实体引用的 ID 都必须在实体列表中定义。
   * - "简单 DAG 不允许环"：实体间依赖关系不能形成循环。
   */
  level1(params: {
    /** 所有合法的实体 ID 集合。 */
    entityIds: Set<string>
    /** 依赖关系映射：entityId → entityId[]（依赖的实体 ID 列表）。 */
    dependencies: Map<string, string[]>
    /** 实体名称映射：entityId → entityName（用于更清晰的错误消息）。 */
    entityNames?: Map<string, string>
  }): LevelValidationResult {
    const errors: LevelValidationError[] = []
    const { entityIds, dependencies, entityNames } = params

    // 1. 检查所有引用 ID 是否存在
    for (const [entityId, deps] of dependencies) {
      for (const depId of deps) {
        if (!entityIds.has(depId)) {
          const name = entityNames?.get(entityId) ?? entityId
          errors.push({
            path: entityId,
            message: `Entity "${name}" references non-existent ID: ${depId}`,
            code: 'REFERENCE_NOT_FOUND',
            level: 1,
          })
        }
      }
    }

    // 2. 简单 DAG 环检测（DFS）
    const visited = new Set<string>()
    const inStack = new Set<string>()

    function dfs(node: string): boolean {
      visited.add(node)
      inStack.add(node)

      const deps = dependencies.get(node) ?? []
      for (const dep of deps) {
        if (!entityIds.has(dep)) continue // 已在上一步报错
        if (inStack.has(dep)) return true // 发现环
        if (!visited.has(dep)) {
          if (dfs(dep)) return true
        }
      }

      inStack.delete(node)
      return false
    }

    for (const entityId of entityIds) {
      if (!visited.has(entityId)) {
        if (dfs(entityId)) {
          const name = entityNames?.get(entityId) ?? entityId
          errors.push({
            path: entityId,
            message: `Circular dependency detected involving entity: ${name}`,
            code: 'CIRCULAR_DEPENDENCY',
            level: 1,
          })
        }
      }
    }

    return { passed: errors.length === 0, level: 1, errors }
  }
}
