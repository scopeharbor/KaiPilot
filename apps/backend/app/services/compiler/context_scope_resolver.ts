/**
 * v2-project-compiler-foundation —— ContextScopeResolver（tasks 4.3）。
 *
 * 根据 Stage 声明的 contextScope 层级，裁剪注入 Stage 执行时的上下文。
 * 支持的最小范围：
 *   user_input_only、run_metadata、stage_outputs、blueprint、full_draft
 *
 * Stage 只能收到自己声明范围内的上下文。
 */

import type { ContextScope } from '@aiproj/compiler-spec'

/** 完整运行上下文（所有可能的数据来源）。 */
export interface CompilerContext {
  userInput: Record<string, unknown>
  runMetadata: Record<string, unknown>
  stageOutputs: Map<string, unknown>
  blueprints: Record<string, unknown>
  fullDraft: Record<string, unknown>
}

/** 裁剪后的 Stage 可见上下文。 */
export interface ResolvedContext {
  userInput?: Record<string, unknown>
  runMetadata?: Record<string, unknown>
  stageOutputs?: Record<string, unknown>
  blueprints?: Record<string, unknown>
}

/** ContextScope 的包含层级（深度越大，可见数据越多）。 */
const SCOPE_HIERARCHY: Record<ContextScope, number> = {
  user_input_only: 0,
  run_metadata: 1,
  stage_outputs: 2,
  blueprint: 3,
  full_draft: 4,
}

/**
 * ContextScopeResolver —— 上下文可见性控制器。
 * 输入 Stage 声明的 contextScope 与完整 CompilerContext，
 * 输出裁剪后的 ResolvedContext。
 */
export class ContextScopeResolver {
  /**
   * 根据 contextScope 列表裁剪上下文。
   * 多个 scope 取并集。
   */
  resolve(scopes: ContextScope[], context: CompilerContext): ResolvedContext {
    const result: ResolvedContext = {}

    for (const scope of scopes) {
      switch (scope) {
        case 'user_input_only':
          result.userInput = { ...context.userInput }
          break
        case 'run_metadata':
          result.runMetadata = { ...context.runMetadata }
          break
        case 'stage_outputs':
          result.stageOutputs = Object.fromEntries(context.stageOutputs)
          break
        case 'blueprint':
          result.blueprints = { ...context.blueprints }
          result.runMetadata = { ...context.runMetadata }
          break
        case 'full_draft':
          result.userInput = { ...context.userInput }
          result.runMetadata = { ...context.runMetadata }
          result.stageOutputs = Object.fromEntries(context.stageOutputs)
          result.blueprints = { ...context.blueprints }
          break
      }
    }

    return result
  }

  /**
   * 判断某个 scope 是否包含在已授权的 scope 列表中。
   * 基于层级比较：user_input_only < run_metadata < stage_outputs < blueprint < full_draft
   */
  hasScope(authorizedScopes: ContextScope[], target: ContextScope): boolean {
    const targetLevel = SCOPE_HIERARCHY[target]
    return authorizedScopes.some((s) => SCOPE_HIERARCHY[s] >= targetLevel)
  }
}
