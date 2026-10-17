/**
 * Compiler v2 适配控制器
 *
 * v2-5-compiler-resume-replay-wiring（tasks 5.1-5.3 / 6.5-6.8，design D4）：
 * 薄适配层——复用现有 CompilerRunService/CompilerPolicy/CompilerRunOrchestrator 路径，
 * 不做业务逻辑拷贝。响应格式仅做版本化投影，不变更业务行为。
 *
 * Resume（5.1-5.2）：从 501 stub 实现为薄适配——AUTH → canResume → 组织校验 → service.resumeCompilation
 * → 成功写 AI_COMPILER_RUN_RESUMED 审计。
 * Replay（6.5-6.6）：net-new 对称链——AUTH → canReplay → 组织校验 → service.replayRun → 成功写 AI_COMPILER_RUN_REPLAYED 审计。
 */
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { CompilerRunService } from '#services/compiler/compiler_run_service'
import CompilerPolicy from '#policies/compiler_policy'
import { CompilerRunOrchestrator } from '#services/compiler/compiler_run_orchestrator'
import AuditService from '#services/audit_service'

@inject()
export default class ApiV2CompilerController {
  constructor(
    private readonly compilerService: CompilerRunService,
    private readonly compilerPolicy: CompilerPolicy,
    private readonly orchestrator: CompilerRunOrchestrator,
    private readonly auditService: AuditService,
  ) {}

  /**
   * GET /api/v2/ai/compiler/runs
   * 列出编译运行（委托 v1 CompilerController）
   */
  async index(ctx: HttpContext) {
    return this.#notImplemented(ctx)
  }

  /**
   * POST /api/v2/ai/compiler/runs
   * 启动编译运行
   */
  async startRun(ctx: HttpContext) {
    return this.#notImplemented(ctx)
  }

  /**
   * GET /api/v2/ai/compiler/runs/:id
   * 获取运行详情
   */
  async getRun(ctx: HttpContext) {
    return this.#notImplemented(ctx)
  }

  /**
   * GET /api/v2/ai/compiler/runs/:id/events
   * 获取运行事件
   */
  async getEvents(ctx: HttpContext) {
    return this.#notImplemented(ctx)
  }

  /**
   * POST /api/v2/ai/compiler/runs/:id/resume
   * 恢复运行（tasks 5.1，design D4）。
   * 薄适配：AUTH → canResume → 组织校验 → service.resumeCompilation → 审计。
   */
  async resume(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const runId = Number(ctx.params.id)
    if (!runId) {
      return response.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid runId' },
      })
    }

    // RBAC 校验
    const authorized = await this.compilerPolicy.canResume(authUser, tenant.organizationId)
    if (!authorized.allowed) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: authorized.reason ?? 'Permission denied' },
      })
    }

    // 委托 service（含 CAS 护栏 + checkpoint manifest 还原）
    const result = await this.compilerService.resumeCompilation(
      this.orchestrator,
      runId,
      tenant.organizationId,
    )

    if (!result.resumed) {
      // 不可恢复（终态/无 checkpoint）
      return response.status(409).json({
        error: {
          code: 'RUN_NOT_RESUMABLE',
          message: 'Run is in terminal state or has no checkpoint to resume from',
        },
      })
    }

    // 写审计（tasks 5.2，低敏 metadata 仅 runId）
    await this.auditService.log({
      event: 'AI_COMPILER_RUN_RESUMED',
      userId: authUser.id,
      organizationId: tenant.organizationId,
      metadata: { compilerRunId: runId },
    })

    return response.ok({
      resumed: true,
      runId,
      result: result.result
        ? {
            success: result.result.success,
            terminalStatus: result.result.terminalStatus,
            checkpointVersion: result.result.checkpointVersion,
          }
        : null,
    })
  }

  /**
   * POST /api/v2/ai/compiler/runs/:id/replay
   * Replay 编译运行（tasks 6.5，design D4）。
   * 薄适配：AUTH → canReplay → 组织校验 → service.replayRun → 审计。
   */
  async replay(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const runId = Number(ctx.params.id)
    if (!runId) {
      return response.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid runId' },
      })
    }

    // RBAC 校验
    const authorized = await this.compilerPolicy.canReplay(authUser, tenant.organizationId)
    if (!authorized.allowed) {
      return response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message: authorized.reason ?? 'Permission denied' },
      })
    }

    // 委托 service（只读重建）
    const result = await this.compilerService.replayRun(
      tenant.organizationId,
      runId,
      this.orchestrator,
    )

    if (!result.replayed) {
      return response.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Run not found or has no replayable data' },
      })
    }

    // 写审计（tasks 6.6，低敏 metadata 仅 runId）
    await this.auditService.log({
      event: 'AI_COMPILER_RUN_REPLAYED',
      userId: authUser.id,
      organizationId: tenant.organizationId,
      metadata: { compilerRunId: runId },
    })

    return response.ok({
      replayed: true,
      runId,
      stages: result.stages,
      missingArtifacts: result.missingArtifacts,
    })
  }

  #notImplemented({ response }: HttpContext) {
    return response.status(501).json({
      error: {
        code: 'V2_ADAPTER_NOT_IMPLEMENTED',
        message: 'API v2 compiler adapter is admitted but not wired yet.',
        details: null,
      },
    })
  }
}
