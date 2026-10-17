// apps/backend — v3-ai-tools-orchestration-layer —— 服务端权威工具注册表（W1 核心骨架）。
//
// 设计（change design.md D4）：
// - `ToolDefinition` 是唯一的工具契约：名称、中文说明、JSON Schema 入参、RBAC 权限清单、
//   副作用分类与执行 handler；
// - `AiToolsRegistry` 单例在生产装配期（服务启动模块加载时）被静态填充，`seal()` 之后
//   任何 `register()` 调用都被拒绝——杜绝运行时动态注入（RL-14 确定性防动态代码注入）；
// - 元数据投影 `getAllMetadata()` 只暴露契约字段，绝不泄露 handler 实现或内部状态。
//
// W2 接线点（注册点）：W2 在 `app/services/ai_tools/handlers/` 实现 8 个 P0 handler 后，
// 新增 `handlers/index.ts`：
//
//   import { AiToolsRegistry } from '../registry.js'
//   import { navigateToSpaceDefinition } from './navigate_to_space.js'
//   // ...其余 7 个工具定义
//   const registry = AiToolsRegistry.getInstance()
//   registry.register([ navigateToSpaceDefinition, /* ... */ ])
//   registry.seal()
//
// 并被 executor/模块图顶层 import（side-effect import）以保证请求到达前完成静态装配。
// W1 阶段注册点保持空数组（下方 `STATIC_BASELINE_DEFINITIONS`）。

import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import type User from '#models/user'

export type ToolSideEffect = 'read' | 'navigate' | 'write'

export interface ToolExecutionContext {
  readonly user: User
  readonly organizationId: number
  readonly requestId: string | null
}

export interface ToolExecutionResult<T = unknown> {
  readonly status: 'SUCCESS' | 'PREVIEW_REQUIRED'
  readonly data: T
  readonly previewToken?: string
  readonly diff?: unknown
}

export interface ToolDefinition<TInput = Record<string, unknown>, TOutput = unknown> {
  readonly name: string
  readonly description: string
  readonly parametersJsonSchema: Record<string, unknown>
  readonly requiredPermissions: readonly string[]
  readonly sideEffect: ToolSideEffect
  readonly handler: (
    ctx: ToolExecutionContext,
    input: TInput,
  ) => Promise<ToolExecutionResult<TOutput>>
}

/** 注册表已被 seal 后仍然调用 register() 时抛出（RL-14 守卫）。 */
export class AiToolsRegistrySealedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiToolsRegistrySealedError'
  }
}

/** 工具名必须为 snake_case 标识符（spec：`name` 工具唯一标识符 snake_case）。 */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const SIDE_EFFECTS: readonly string[] = ['read', 'navigate', 'write']

/**
 * 静态权威注册表（RL-14）。
 *
 * 不可变语义：
 * 1. `register()` 只允许在装配期调用（`sealed === false`），且注册即深冻结定义对象；
 * 2. `seal()` 之后 `register()` 一律抛 `AiToolsRegistrySealedError`；
 * 3. 生产调用方只经 `getInstance()` 取得单例，无法替换或覆盖内部 Map。
 */
export class AiToolsRegistry {
  private static instance: AiToolsRegistry | null = null

  private readonly definitions = new Map<string, ToolDefinition>()
  private sealed = false

  static getInstance(): AiToolsRegistry {
    if (!AiToolsRegistry.instance) {
      const registry = new AiToolsRegistry()
      registry.register(STATIC_BASELINE_DEFINITIONS)
      AiToolsRegistry.instance = registry
    }
    return AiToolsRegistry.instance
  }

  /**
   * 装配期静态注册（RL-14：注册点仅服务端代码可触达；seal 后不可变）。
   */
  register(definitions: readonly ToolDefinition[]): void {
    if (this.sealed) {
      throw new AiToolsRegistrySealedError(
        'AiToolsRegistry 已 seal，禁止运行时注册或修改工具（RL-14）',
      )
    }
    for (const definition of definitions) {
      this.assertRegistrationContract(definition)
      if (this.definitions.has(definition.name)) {
        throw new ValidationException(`AI 工具重复注册：「${definition.name}」`)
      }
      this.definitions.set(definition.name, deepFreeze(definition))
    }
  }

  /** 装配完成后固话注册表，此后任何注册/修改都被拒绝。 */
  seal(): void {
    this.sealed = true
  }

  isSealed(): boolean {
    return this.sealed
  }

  /**
   * 按工具名取定义；未注册抛 404 `RESOURCE_NOT_FOUND`（与跨组织不可见同一错误，
   * 不泄露工具名是否存在——RL-05 防探测语义）。
   */
  getOrFail(name: string): ToolDefinition {
    const definition = this.definitions.get(name)
    if (!definition) {
      throw new ResourceNotFoundException('未注册的 AI 工具或无权访问')
    }
    return definition
  }

  /**
   * 只读元数据投影（GET /api/v1/ai/tools 数据源）：纯契约字段，无 handler/内部状态。
   * `parameters` 为 spec 定义的对外字段名；`parametersJsonSchema` 为 design/task
   * 使用的内部命名（同一 schema 对象，双名保证两侧契约一致）。
   */
  getAllMetadata(): ReadonlyArray<{
    name: string
    description: string
    parameters: Record<string, unknown>
    parametersJsonSchema: Record<string, unknown>
    requiredPermissions: readonly string[]
    sideEffect: ToolSideEffect
  }> {
    const descriptors = [...this.definitions.values()].map((definition) => {
      const descriptor = {
        name: definition.name,
        description: definition.description,
        parameters: definition.parametersJsonSchema,
        parametersJsonSchema: definition.parametersJsonSchema,
        requiredPermissions: [...definition.requiredPermissions],
        sideEffect: definition.sideEffect,
      }
      return Object.freeze(descriptor)
    })
    return Object.freeze(descriptors)
  }

  private assertRegistrationContract(definition: ToolDefinition): void {
    if (!definition || typeof definition !== 'object') {
      throw new ValidationException('AI 工具定义必须是对象')
    }
    const { name, description, parametersJsonSchema, requiredPermissions, sideEffect, handler } =
      definition
    if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) {
      throw new ValidationException(
        'AI 工具 name 必须是 snake_case 标识符（1-64 位小写字母/数字/下划线）',
      )
    }
    if (typeof description !== 'string' || description.trim().length === 0) {
      throw new ValidationException(`AI 工具「${name}」缺少 description`)
    }
    if (!parametersJsonSchema || typeof parametersJsonSchema !== 'object') {
      throw new ValidationException(`AI 工具「${name}」缺少 parametersJsonSchema`)
    }
    if (
      !Array.isArray(requiredPermissions) ||
      requiredPermissions.some((perm) => typeof perm !== 'string' || perm.length === 0)
    ) {
      throw new ValidationException(`AI 工具「${name}」requiredPermissions 必须是非空字符串数组`)
    }
    if (!SIDE_EFFECTS.includes(sideEffect)) {
      throw new ValidationException(
        `AI 工具「${name}」sideEffect 必须是 read | navigate | write 之一`,
      )
    }
    if (typeof handler !== 'function') {
      throw new ValidationException(`AI 工具「${name}」缺少 handler`)
    }
  }
}

/**
 * W1 阶段静态基线（空）。
 *
 * 注意：W2 的 8 个 P0 工具（navigate_to_space / get_project_summary / list_project_tasks /
 * get_task_detail / list_project_risks / get_gantt_snapshot / search_projects_tasks /
 * update_task_schedule）由 `handlers/index.ts` 装配，见文件头接线说明，勿在本处注册。
 */
const STATIC_BASELINE_DEFINITIONS: readonly ToolDefinition[] = []

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested)
    }
    return Object.freeze(value)
  }
  return value
}
