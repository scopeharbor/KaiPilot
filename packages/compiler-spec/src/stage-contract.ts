/**
 * v2-project-compiler-foundation —— Stage Contract 类型（design D2/D6）。
 *
 * 定义 Stage（编译流水线的一个环节）的 I-P-O Contract、可见性控制与类型约束。
 * 供前后端共享，作为 Pipeline Executor 编排的类型基础。
 *
 * ⚠️ 本文件变更需同步更新 index.ts 导出。
 */

import { z } from 'zod'

/** Stage 类型枚举。 */
export const stageTypeSchema = z.enum(['llm', 'deterministic', 'hybrid', 'gate', 'meta'])
export type StageType = z.infer<typeof stageTypeSchema>

/** Stage 阶段枚举。 */
export const stagePhaseSchema = z.enum([
  'intake',
  'understanding',
  'analysis',
  'structuring',
  'optimization',
  'verification',
  'reporting',
  'review',
  'confirmation',
])
export type StagePhase = z.infer<typeof stagePhaseSchema>

/** 上下文范围枚举。 */
export const contextScopeSchema = z.enum([
  'user_input_only',
  'run_metadata',
  'stage_outputs',
  'blueprint',
  'full_draft',
])
export type ContextScope = z.infer<typeof contextScopeSchema>

/** Side-effect 声明。 */
export const sideEffectsSchema = z.object({
  writesArtifact: z.boolean().default(false),
  updatesManifest: z.boolean().default(false),
  updatesLedger: z.boolean().default(false),
  callsLlm: z.boolean().default(false),
})

export type SideEffects = z.infer<typeof sideEffectsSchema>

/** 允许的工具声明。 */
export const allowedToolSchema = z.object({
  toolId: z.string().min(1),
  description: z.string().default(''),
  required: z.boolean().default(false),
})

export type AllowedTool = z.infer<typeof allowedToolSchema>

/**
 * StageDefinition —— 编译阶段定义（用于注册到 StageRegistry）。
 */
export interface StageDefinition {
  /** 全局唯一的 Stage ID。 */
  stageId: string
  /** Stage 类型。 */
  type: StageType
  /** 所属 Phase。 */
  phase: StagePhase
  /** 人类可读名称。 */
  name: string
  /** 描述。 */
  description: string
  /** 输入 Schema。 */
  inputSchema: z.ZodTypeAny
  /** 输出 Schema。 */
  outputSchema: z.ZodTypeAny
  /** 上下文可见性范围。 */
  contextScope: ContextScope[]
  /** 授权可见的工具。 */
  allowedTools: AllowedTool[]
  /** Side-effect 声明。 */
  sideEffects: SideEffects
  /** 依赖的 Stage ID 列表（本 Stage 开始前必须完成的 Stage）。 */
  dependsOn: string[]
  /** 同 phase 内并行组 ID（同一组可并行执行，不同组顺序执行）。 */
  parallelGroup?: string
  /** 超时毫秒（0 表示不限制）。 */
  timeoutMs: number
}

/**
 * StageContract<I, O> —— 运行时契约（校验输入/输出/可见性）。
 * 由 Pipeline Executor 在每个 Stage 执行前后使用。
 */
export class StageContract<I, O> {
  constructor(public readonly definition: StageDefinition) {}

  /** 校验输入数据是否符合 inputSchema。 */
  validateInput(
    input: unknown,
  ): { success: true; data: I } | { success: false; errors: z.ZodError } {
    const result = this.definition.inputSchema.safeParse(input)
    if (result.success) {
      return { success: true, data: result.data as I }
    }
    return { success: false, errors: result.error }
  }

  /** 校验输出数据是否符合 outputSchema。 */
  validateOutput(
    output: unknown,
  ): { success: true; data: O } | { success: false; errors: z.ZodError } {
    const result = this.definition.outputSchema.safeParse(output)
    if (result.success) {
      return { success: true, data: result.data as O }
    }
    return { success: false, errors: result.error }
  }

  /** 获取当前 Stage 可用的工具列表。 */
  getAllowedToolIds(): string[] {
    return this.definition.allowedTools.map((t) => t.toolId)
  }

  /** 获取上下文范围。 */
  getContextScopes(): ContextScope[] {
    return [...this.definition.contextScope]
  }
}
