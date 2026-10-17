/**
 * v2-5-compiler-run-executor-wiring —— CompilerController（tasks 2.1-3.6）。
 *
 * HTTP 入口，只处理请求解析、权限校验、响应格式化。
 * 业务逻辑下沉到 CompilerRunService。
 *
 * V2.5 扩展：startRun 通过 CompilerRunService 驱动完整编译。
 * design D1：Controller 只处理 HTTP，不做业务编排。
 *
 * 红线 1：本控制器绝不写 V1 正式业务表。
 * 跨组织访问返回 not-found，不泄漏存在性。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { CompilerRunService } from '#services/compiler/compiler_run_service'
import type { StageBlueprint } from '#services/compiler/manifest_builder'
import { createOrchestrator } from '#services/compiler/orchestrator_factory'
import CompilerPolicy from '#policies/compiler_policy'
import AuditService from '#services/audit_service'
import { validateStartRunBody, validateQuery, validateRunId } from '#validators/compiler_validator'
import CompilerTemplateContributionResolver from '#services/compiler_template_contribution_resolver'
import { buildSnapshotFromDetail } from '#services/compiler/compiler_template_overlay_service'
import { RepairHistoryService } from '#services/compiler/repair/repair_history_service'
import { CompilerObservabilityRecorder } from '#services/compiler/observability_recorder'
import { CompilerObservabilitySummaryService } from '#services/compiler/observability_summary_service'
import { ArtifactStore } from '#services/compiler/artifact_store'
import { StageEventLogger } from '#services/compiler/stage_event_logger'

@inject()
export default class CompilerController {
  constructor(
    private readonly service: CompilerRunService,
    private readonly policy: CompilerPolicy,
    private readonly audit: AuditService,
  ) {}

  /** POST /api/v1/ai/compiler/runs —— 发起编译。 */
  async startRun(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const body = validateStartRunBody(ctx)
    if (!body) return

    const authResult = await this.policy.canTrigger(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    // 幂等检查（快速校验）
    if (body.idempotencyKey) {
      const existing = await this.service.validateIdempotency(
        tenant.organizationId,
        body.idempotencyKey,
      )
      if (existing.conflict && existing.existingRunId) {
        const run = await this.service.getRun(tenant.organizationId, existing.existingRunId)
        if (run) {
          return response.ok({
            data: {
              id: run.id,
              status: run.status,
              currentPhase: run.currentPhase,
              currentStage: run.currentStage,
              createdAt: run.createdAt,
              idempotent: true,
            },
          })
        }
      }
    }

    // v3-template-compiler-plugin-integration: templateSelection 处理（TOCTOU + snapshot）
    let templateSnapshot: Record<string, unknown> | null = null
    let templateSelectionDigest: string | null = null
    if ((body as any).templateSelection) {
      const sel = (body as any).templateSelection as { templateId: string; selectionDigest: string }
      const inst = new CompilerTemplateContributionResolver()
      const resolvedDetail = await inst.getDetail(tenant.organizationId, sel.templateId)

      if (!resolvedDetail) {
        return response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Template not found or not available' },
        })
      }

      if (resolvedDetail.selectionDigest !== sel.selectionDigest) {
        return response.badRequest({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Template selection digest is stale; please refresh and re-select.',
            details: { expected: resolvedDetail.selectionDigest, received: sel.selectionDigest },
          },
        })
      }

      const snapshot = buildSnapshotFromDetail(resolvedDetail as any)
      templateSnapshot = snapshot as unknown as Record<string, unknown>
      templateSelectionDigest = snapshot.selectionDigest
    }

    // 解析 blueprints
    const blueprints = this.#parseBlueprints(body)

    // 获取 orchestrator 实例
    const orchestrator = createOrchestrator()

    // 创建 queued run 并异步执行编译
    const run = await this.service.startRun({
      organizationId: tenant.organizationId,
      userId: authUser.id,
      input: body.input as Record<string, unknown>,
      idempotencyKey: body.idempotencyKey,
      orchestrator,
      manifestBlueprints: blueprints,
      templateSnapshot,
      templateSelectionDigest,
    })

    await this.audit.log({
      event: 'AI_COMPILER_RUN_STARTED',
      userId: authUser.id,
      organizationId: tenant.organizationId,
      requestId: ctx.request?.id() ?? undefined,
      metadata: { compilerRunId: run.id },
    })

    return response.created({
      data: {
        id: run.id,
        status: run.status,
        currentPhase: run.currentPhase,
        currentStage: run.currentStage,
        createdAt: run.createdAt,
      },
    })
  }

  /** GET /api/v1/ai/compiler/runs/:id —— 查询 run 状态。 */
  async getRun(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const runId = validateRunId(ctx)
    if (runId === null) return

    const run = await this.service.getRun(tenant.organizationId, runId)
    if (!run) {
      return response.notFound({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Run not found' } })
    }

    return response.ok({
      data: {
        id: run.id,
        organizationId: run.organizationId,
        status: run.status,
        currentPhase: run.currentPhase,
        currentStage: run.currentStage,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      },
    })
  }

  /** GET /api/v1/ai/compiler/runs/:id/events —— 查询 Stage events。 */
  async getEvents(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const runId = validateRunId(ctx)
    if (runId === null) return

    const run = await this.service.getRun(tenant.organizationId, runId)
    if (!run) {
      return response.notFound({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Run not found' } })
    }

    const query = validateQuery(ctx)
    const result = await this.service.getEvents(tenant.organizationId, runId, query)

    return response.ok(result)
  }

  /** GET /api/v1/ai/compiler/runs/:id/ledger —— 读取最新 Ledger。 */
  async getLedger(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const runId = validateRunId(ctx)
    if (runId === null) return

    const run = await this.service.getRun(tenant.organizationId, runId)
    if (!run) {
      return response.notFound({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Run not found' } })
    }

    const ledger = await this.service.getLatestLedger(tenant.organizationId, runId)
    return response.ok({ data: ledger })
  }

  /** GET /api/v1/ai/compiler/runs/:id/pdm —— 读取最新 PDM 预览。 */
  async getPdm(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const runId = validateRunId(ctx)
    if (runId === null) return

    const run = await this.service.getRun(tenant.organizationId, runId)
    if (!run) {
      return response.notFound({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Run not found' } })
    }

    const pdm = await this.service.getLatestPdm(tenant.organizationId, runId)
    return response.ok({ data: pdm })
  }

  /** GET /api/v1/ai/compiler/runs/:id/repair-history —— 查询 Repair/Reconciliation history。 */
  async getRepairHistory(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const runId = validateRunId(ctx)
    if (runId === null) return

    const run = await this.service.getRun(tenant.organizationId, runId)
    if (!run) {
      return response.notFound({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Run not found' } })
    }

    const query = validateQuery(ctx)
    const history = new RepairHistoryService(this.service.artifactStore)
    const result = await history.queryHistory(runId, tenant.organizationId, {
      offset: (query.page - 1) * query.perPage,
      limit: query.perPage,
    })

    return response.ok({
      data: result.entries,
      meta: {
        total: result.total,
        page: query.page,
        perPage: query.perPage,
        totalPages: Math.ceil(result.total / query.perPage),
      },
    })
  }

  /** GET /api/v1/ai/compiler/runs/:id/observability-summary —— 查询运行可观测摘要。 */
  async getObservabilitySummary(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const runId = validateRunId(ctx)
    if (runId === null) return

    const run = await this.service.getRun(tenant.organizationId, runId)
    if (!run) {
      return response.notFound({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Run not found' } })
    }

    const summaryService = new CompilerObservabilitySummaryService(
      new CompilerObservabilityRecorder({
        stageEventLogger: new StageEventLogger(),
        artifactStore: new ArtifactStore(),
      }),
    )

    const query = validateQuery(ctx)
    const summary = query.stageId
      ? await summaryService.getStageSummary({
          compilerRunId: runId,
          organizationId: tenant.organizationId,
          stageId: query.stageId,
        })
      : await summaryService.getRunSummary({
          compilerRunId: runId,
          organizationId: tenant.organizationId,
        })

    if (!summary) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Summary not found' },
      })
    }

    return response.ok({ data: summary })
  }

  /** POST /api/v1/ai/compiler/runs/:id/resume —— Resume run。 */
  async resume(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const runId = validateRunId(ctx)
    if (runId === null) return

    const authResult = await this.policy.canResume(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const run = await this.service.getRun(tenant.organizationId, runId)
    if (!run) {
      return response.notFound({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Run not found' } })
    }

    // 终态 run 不允许 resume
    if (['completed', 'failed', 'cancelled', 'needs_human_review'].includes(run.status)) {
      return response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: `Cannot resume run in terminal status: ${run.status}`,
        },
      })
    }

    try {
      // 获取 orchestrator 实例
      const orchestrator = createOrchestrator()

      const { resumed } = await this.service.resumeCompilation(
        orchestrator,
        runId,
        tenant.organizationId,
      )

      return response.ok({
        data: {
          resumed,
          runId: run.id,
          status: run.status,
        },
      })
    } catch (error) {
      return response.internalServerError({
        error: {
          code: 'AI_SERVICE_ERROR',
          message: `Resume failed: ${(error as Error).message}`,
        },
      })
    }
  }

  // ── Private ──

  /**
   * 从请求体解析 blueprints。
   * 支持两种格式：
   * 1. body.blueprints[] — 客户端显式提供
   * 2. 从 body.input 自动推导（默认最小 manifest）
   */
  #parseBlueprints(body: any): StageBlueprint[] {
    if (body.blueprints && Array.isArray(body.blueprints) && body.blueprints.length > 0) {
      return body.blueprints as StageBlueprint[]
    }

    // 默认：使用 3 个 production stage 的最小 manifest
    return [
      {
        stageId: 'intent_ingestion',
        phase: 'intake',
        dependsOn: [],
        entities: [{ entityId: 'E_intent_ingestion', kind: 'work_package' }],
      },
      {
        stageId: 'intent_parsing',
        phase: 'understanding',
        dependsOn: ['intent_ingestion'],
        entities: [{ entityId: 'E_intent_parsing', kind: 'work_package' }],
      },
      {
        stageId: 'dag_stub',
        phase: 'analysis',
        dependsOn: ['intent_parsing'],
        entities: [{ entityId: 'E_dag_stub', kind: 'work_package' }],
      },
    ]
  }
}
