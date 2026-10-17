/**
 * CodegenCandidateRunController — 34 阶段代码生成候选运行 API
 * （v3-codegen-34-stage-candidate-runtime-execution）。
 *
 * 端点全部挂在 /api/v1/projects/:projectId/compiler/codegen/candidate-runs 下。
 * 所有查询无条件附加 organization_id 过滤；跨组织一律 404 不泄露存在性。
 *
 * 本控制器只暴露「创建候选运行」与「只读查询」，没有任何把候选转正的端点（红线 1）。
 */

import type { HttpContext } from '@adonisjs/core/http'
import CompilerCodegenCandidateRun from '#models/compiler_codegen_candidate_run'
import CompilerCodegenStageRecord from '#models/compiler_codegen_stage_record'
import CodegenCandidateRunPolicy from '#policies/codegen_candidate_run_policy'
import {
  CodegenCandidateRunService,
  CODEGEN_STAGE_TOTAL,
} from '#services/compiler/code-generation/codegen_candidate_run_service'
import {
  createCodegenCandidateRunValidator,
  listCodegenCandidateRunsValidator,
  listCodegenStageRecordsValidator,
} from '#validators/codegen_candidate_run'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'

export default class CodegenCandidateRunController {
  private orgIdOf(ctx: HttpContext): number {
    const orgId = (ctx as any).tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private projectIdOf(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private userIdOf(ctx: HttpContext): number {
    // jwt_guard 认证后写入 ctx.authUser，是本仓库控制器取当前用户的统一入口
    const user = ctx.authUser ?? (ctx as any).auth?.user
    return user ? Number(user.id) : 0
  }

  /** 组织隔离的 run 查询：跨组织返回 404，不区分「不存在」与「无权见」。 */
  private async findRunOrFail(ctx: HttpContext): Promise<CompilerCodegenCandidateRun> {
    const run = await CompilerCodegenCandidateRun.query()
      .where('id', Number(ctx.params.id))
      .where('organization_id', this.orgIdOf(ctx))
      .where('project_id', this.projectIdOf(ctx))
      .first()
    if (!run) throw new ResourceNotFoundException('代码生成候选运行不存在')
    return run
  }

  /** POST /api/v1/projects/:projectId/compiler/codegen/candidate-runs */
  async store(ctx: HttpContext) {
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const actorId = this.userIdOf(ctx)
    await new CodegenCandidateRunPolicy(ctx).assertRun()

    const input = await ctx.request.validateUsing(createCodegenCandidateRunValidator)
    const runtimeSessionId =
      input.runtimeSessionId ?? `codegen-${organizationId}-${projectId}-${Date.now()}`

    const outcome = await new CodegenCandidateRunService().execute({
      organizationId,
      projectId,
      actorId,
      provider: input.provider,
      runtimeSessionId,
      executionMode: input.executionMode ?? 'fixture',
    })

    return ctx.response.created({ data: serializeRun(outcome.run) })
  }

  /** GET /api/v1/projects/:projectId/compiler/codegen/candidate-runs */
  async index(ctx: HttpContext) {
    await new CodegenCandidateRunPolicy(ctx).assertView()
    const filters = await ctx.request.validateUsing(listCodegenCandidateRunsValidator)
    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 20

    let query = CompilerCodegenCandidateRun.query()
      .where('organization_id', this.orgIdOf(ctx))
      .where('project_id', this.projectIdOf(ctx))
    if (filters.status) query = query.where('status', filters.status)

    const paginator = await query.orderBy('id', 'desc').paginate(page, perPage)
    return ctx.response.ok({
      data: paginator.all().map(serializeRun),
      meta: buildMeta(paginator.total, page, perPage),
    })
  }

  /** GET /api/v1/projects/:projectId/compiler/codegen/candidate-runs/:id */
  async show(ctx: HttpContext) {
    await new CodegenCandidateRunPolicy(ctx).assertView()
    const run = await this.findRunOrFail(ctx)
    return ctx.response.ok({ data: serializeRun(run) })
  }

  /** GET /api/v1/projects/:projectId/compiler/codegen/candidate-runs/:id/stages */
  async stages(ctx: HttpContext) {
    await new CodegenCandidateRunPolicy(ctx).assertView()
    const run = await this.findRunOrFail(ctx)
    const filters = await ctx.request.validateUsing(listCodegenStageRecordsValidator)
    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 50

    const paginator = await CompilerCodegenStageRecord.query()
      .where('run_id', run.id)
      .where('organization_id', run.organizationId)
      .orderBy('stage_order', 'asc')
      .paginate(page, perPage)

    return ctx.response.ok({
      data: paginator.all().map(serializeStageRecord),
      meta: buildMeta(paginator.total, page, perPage),
    })
  }

  /** GET /api/v1/projects/:projectId/compiler/codegen/candidate-runs/:id/review-packet */
  async reviewPacket(ctx: HttpContext) {
    await new CodegenCandidateRunPolicy(ctx).assertView()
    const run = await this.findRunOrFail(ctx)
    if (!run.reviewPacketJson) {
      throw new ResourceNotFoundException('候选运行尚未达到人工复核就绪状态')
    }
    return ctx.response.ok({
      data: {
        ...run.reviewPacketJson,
        // 复核门恒为待人工确认：本能力不提供任何自动转正路径
        requiresHumanReview: true,
      },
    })
  }
}

function serializeRun(run: CompilerCodegenCandidateRun) {
  return {
    id: run.id,
    projectId: run.projectId,
    runtimeSessionId: run.runtimeSessionId,
    catalogVersion: run.catalogVersion,
    provider: run.provider,
    executionMode: run.executionMode,
    status: run.status,
    stageCount: run.stageCount,
    completedStageCount: run.completedStageCount,
    totalStageCount: CODEGEN_STAGE_TOTAL,
    currentStageId: run.currentStageId,
    failureStageId: run.failureStageId,
    failureReasonCode: run.failureReasonCode,
    violations: run.failureViolationsJson,
    requiresHumanReview: true,
    readyForHumanReview: run.status === 'candidate_ready_pending_review',
    createdAt: run.createdAt?.toISO() ?? null,
    completedAt: run.completedAt?.toISO() ?? null,
  }
}

function serializeStageRecord(record: CompilerCodegenStageRecord) {
  return {
    stageId: record.stageId,
    order: record.stageOrder,
    status: record.status,
    contractVersion: record.contractVersion,
    contextScope: record.contextScope,
    reasonCode: record.reasonCode,
    visibleToolIds: record.visibleToolIdsJson,
    artifactRefs: record.artifactRefsJson,
    observationRefs: record.observationRefsJson,
    toolCallIds: record.toolCallIdsJson,
    summary: record.summary,
    completedAt: record.completedAt?.toISO() ?? null,
  }
}

function buildMeta(total: number, page: number, perPage: number) {
  return {
    total,
    page,
    perPage,
    totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0,
  }
}
