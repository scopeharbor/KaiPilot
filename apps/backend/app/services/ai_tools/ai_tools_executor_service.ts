// apps/backend — v3-ai-tools-orchestration-layer —— 统一工具执行调度服务（W1 核心）。
//
// 编排链路（change design.md §2/§5/§6、tasks W1 1.9）：
//   1. 注册表取工具定义（未注册 → 404 RESOURCE_NOT_FOUND，不泄露工具存在性）；
//   2. 构造 `ToolExecutionContext`（强制注入服务端会话 organizationId，RL-05）；
//   3. `AiToolsPolicy` 鉴权（ai:trigger / ai:confirm + 工具声明领域权限；跨组织统一 404）；
//   4. 按工具 `parametersJsonSchema` 二次校验入参（422 VALIDATION_ERROR）；
//   5. 调度 handler；
//   6. RL-01/RL-06：`sideEffect: 'write'` 工具在 execute 阶段**必须**返回
//      `PREVIEW_REQUIRED` + 合法 SHA-256 previewToken，否则 fail-closed；
//      confirm 阶段才允许单事务落库；
//   7. 全流程兜底审计（RL-12：只存 parametersHash/状态/耗时/错误码）：
//      鉴权失败 → denied/REJECTED；资源不可见 → executed/REJECTED(RESOURCE_NOT_FOUND)；
//      其余失败 → executed|confirmed/FAILED；成功 → SUCCESS/PREVIEW_GENERATED/CONFIRMED。
//
// 错误统一抛 ApiException 子类 → 全局 ExceptionHandler 渲染 `{ error: { code, message, details } }`。

import ApiException, { ValidationException } from '#exceptions/api_exception'
import type User from '#models/user'
import AiToolsPolicy from '#policies/ai_tools_policy'
import AiToolsAuditHelper, { type AiToolAuditKind } from '#services/ai_tools/ai_tools_audit_helper'
// 生产装配（RL-14 静态注册点）：模块图顶层 side-effect import，确保任何一次工具调用
// （含 GET /ai/tools 元数据读取）到达前，`handlers/index` 已把 8 个 P0 工具注册进
// 单例并 seal。显式 /index 是 NodeNext 解析要求（目录裸导入无法解析）。
// 未装配前注册表为空 → 任何工具名一律 404 fail-closed（不泄露存在性）。
import '#services/ai_tools/handlers/index'
import {
  AiToolsRegistry,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from '#services/ai_tools/registry'
import { validateParametersWithSchema } from '#validators/ai_tools_validator'
import { inject } from '@adonisjs/core'

const PREVIEW_TOKEN_PATTERN = /^[0-9a-f]{64}$/
const REJECTED_ERROR_CODES: ReadonlySet<string> = new Set([
  'PERMISSION_DENIED',
  'RESOURCE_NOT_FOUND',
])

export interface AiToolInvokeBase {
  readonly toolName: string
  readonly parameters: Record<string, unknown>
  readonly user: User
  readonly organizationId: number
  /** 参数中的项目 scope（有则交给 Policy 做组织∩项目的权限交集；跨组织由 Policy 映射 404）。 */
  readonly projectId?: number | null
  readonly requestId?: string | null
}

export interface AiToolExecuteParams extends AiToolInvokeBase {}

export interface AiToolOutcome<T = unknown> extends ToolExecutionResult<T> {
  readonly meta: { toolName: string; status: 'SUCCESS' | 'PREVIEW_REQUIRED'; durationMs: number }
}

export interface AiToolConfirmParams extends AiToolInvokeBase {
  readonly previewToken: string
}

export interface AiToolConfirmOutcome<T = unknown> {
  readonly data: T
  readonly meta: { toolName: string; committed: true; durationMs: number }
}

@inject()
export default class AiToolsExecutorService {
  constructor(
    private policy: AiToolsPolicy,
    private audit: AiToolsAuditHelper,
  ) {}

  /** execute 阶段：只读/导航工具直接执行；写工具强制预览拦截（RL-01，业务表零写入）。 */
  async execute(params: AiToolExecuteParams): Promise<AiToolOutcome> {
    const startedAt = nowMs()
    // 注册表查定义在 try 内：未注册/未知工具同样产生 REJECTED 审计（spec：所有调用尝试一律留痕）
    let definition: ToolDefinition | null = null
    const ctx = this.buildContext(params)
    const projectId = params.projectId ?? extractProjectId(params.parameters)
    try {
      definition = this.registry.getOrFail(params.toolName)
      await this.policy.authorizeExecute(
        params.user,
        params.organizationId,
        definition.requiredPermissions,
        projectId,
      )
      validateParametersWithSchema(definition.parametersJsonSchema, params.parameters)
      const result = await definition.handler(ctx, params.parameters)
      if (definition.sideEffect === 'write') {
        assertWritePreviewResult(result)
      }
      const durationMs = nowMs() - startedAt
      await this.audit.log({
        kind: 'executed',
        userId: params.user.id,
        organizationId: params.organizationId,
        projectId,
        requestId: params.requestId,
        toolName: params.toolName,
        parameters: params.parameters,
        status: result.status === 'PREVIEW_REQUIRED' ? 'PREVIEW_GENERATED' : 'SUCCESS',
        durationMs,
      })
      return {
        status: result.status,
        data: result.data,
        ...(result.previewToken !== undefined ? { previewToken: result.previewToken } : {}),
        ...(result.diff !== undefined ? { diff: result.diff } : {}),
        meta: { toolName: params.toolName, status: result.status, durationMs },
      }
    } catch (error) {
      await this.recordFailure('executed', params, projectId, nowMs() - startedAt, error)
      throw error
    }
  }

  /** confirm 阶段：仅 `sideEffect: 'write'` 工具可确认（RL-01/RL-06）；原子落库由 handler 委托领域服务完成。 */
  async confirm(params: AiToolConfirmParams): Promise<AiToolConfirmOutcome> {
    const startedAt = nowMs()
    let definition: ToolDefinition | null = null
    const ctx = this.buildContext(params)
    const projectId = params.projectId ?? extractProjectId(params.parameters)
    try {
      definition = this.registry.getOrFail(params.toolName)
      if (definition.sideEffect !== 'write') {
        throw new ValidationException(`工具「${params.toolName}」不支持确认提交`)
      }
      await this.policy.authorizeConfirm(
        params.user,
        params.organizationId,
        definition.requiredPermissions,
        projectId,
      )
      validateParametersWithSchema(definition.parametersJsonSchema, params.parameters)
      // 编排层把信封级 previewToken 合入 handler 入参（不参与工具 Schema 校验）；
      // W2 写工具 handler 须将其透传给领域服务（如 GanttSchedulingService mode:'commit'）。
      const result = await definition.handler(ctx, {
        ...params.parameters,
        previewToken: params.previewToken,
      })
      if (result.status !== 'SUCCESS' || result.previewToken !== undefined) {
        throw new ValidationException('写工具确认必须返回 SUCCESS 状态（RL-01）')
      }
      const durationMs = nowMs() - startedAt
      await this.audit.log({
        kind: 'confirmed',
        userId: params.user.id,
        organizationId: params.organizationId,
        projectId,
        requestId: params.requestId,
        toolName: params.toolName,
        parameters: params.parameters,
        status: 'CONFIRMED',
        durationMs,
      })
      return {
        data: result.data,
        meta: { toolName: params.toolName, committed: true, durationMs },
      }
    } catch (error) {
      await this.recordFailure('confirmed', params, projectId, nowMs() - startedAt, error)
      throw error
    }
  }

  /**
   * 失败兜底审计（design.md 流程一/流程二）：权限不足 → denied/REJECTED；
   * 资源不可见（404）→ executed/REJECTED；其余 → FAILED。绝不吞原异常。
   */
  private async recordFailure(
    kind: 'executed' | 'confirmed',
    params: AiToolInvokeBase,
    projectId: number | undefined,
    durationMs: number,
    error: unknown,
  ): Promise<void> {
    const errorCode = this.errorCodeOf(error)
    const auditKind: AiToolAuditKind = errorCode === 'PERMISSION_DENIED' ? 'denied' : kind
    await this.audit.log({
      kind: auditKind,
      userId: params.user.id,
      organizationId: params.organizationId,
      projectId,
      requestId: params.requestId,
      toolName: params.toolName,
      parameters: params.parameters,
      status: REJECTED_ERROR_CODES.has(errorCode) ? 'REJECTED' : 'FAILED',
      durationMs,
      errorCode,
    })
  }

  private buildContext(params: AiToolInvokeBase): ToolExecutionContext {
    return {
      user: params.user,
      organizationId: params.organizationId,
      requestId: params.requestId ?? null,
    }
  }

  private get registry(): AiToolsRegistry {
    return AiToolsRegistry.getInstance()
  }

  private errorCodeOf(error: unknown): string {
    if (error instanceof ApiException && typeof error.code === 'string') return error.code
    return 'INTERNAL_ERROR'
  }
}

function nowMs(): number {
  return performance.now()
}

/** 从工具入参提取项目 scope（约定：`parameters.projectId` 为 number 时生效）。 */
export function extractProjectId(parameters: Record<string, unknown>): number | undefined {
  return typeof parameters['projectId'] === 'number' ? parameters['projectId'] : undefined
}

/** RL-01/RL-06 写工具防御断言：execute 阶段必须返回预览结果，否则 fail-closed。 */
function assertWritePreviewResult(result: ToolExecutionResult): void {
  if (result.status !== 'PREVIEW_REQUIRED') {
    throw new ValidationException('写工具执行必须返回 PREVIEW_REQUIRED 状态（RL-01/RL-06）')
  }
  if (typeof result.previewToken !== 'string' || !PREVIEW_TOKEN_PATTERN.test(result.previewToken)) {
    throw new ValidationException('写工具预览必须返回合法 SHA-256 previewToken（RL-01/RL-06）')
  }
}
