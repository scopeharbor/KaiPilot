/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftLayerController（task 9.1-9.5）。
 *
 * 只做 HTTP 解析、权限校验、审计；核心逻辑下沉到 services/draft_layer/*。
 * 契约：成功 `{ data }`；错误 `{ error: { code, message, details? } }`。
 * 红线：绝不由本控制器写正式业务表；禁止客户端指定 organizationId。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import {
  DraftLayerHandoffService,
  HandoffValidationError,
} from '#services/draft_layer/handoff_service'
import { DraftLayerPreviewService, PreviewError } from '#services/draft_layer/preview_service'
import { DraftLayerDiffService } from '#services/draft_layer/diff_service'
import {
  DraftLayerDecisionService,
  DecisionValidationError,
} from '#services/draft_layer/decision_service'
import {
  DraftLayerDryRunService,
  DryRunValidationError,
} from '#services/draft_layer/dry_run_service'
import { DraftLayerApplyService, ApplyValidationError } from '#services/draft_layer/apply_service'
import DraftLayerSession from '#models/draft_layer_session'
import DraftLayerPreview from '#models/draft_layer_preview'
import DraftLayerChange from '#models/draft_layer_change'
import DraftLayerApplyResult from '#models/draft_layer_apply_result'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  draftLayerCreateSchema,
  draftLayerDecisionSchema,
  draftLayerBulkDecisionSchema,
  draftLayerDryRunSchema,
  draftLayerApplySchema,
} from '#validators/draft_layer_validator'

@inject()
export default class DraftLayerController {
  constructor(
    private readonly handoff: DraftLayerHandoffService,
    private readonly previewService: DraftLayerPreviewService,
    private readonly diffService: DraftLayerDiffService,
    private readonly decision: DraftLayerDecisionService,
    private readonly dryRunService: DraftLayerDryRunService,
    private readonly applyService: DraftLayerApplyService,
    private readonly audit: AuditService,
  ) {}

  /**
   * POST /api/v1/ai/draft-layer/sessions —— 从 Compiler Run 创建草案会话。
   */
  async create(ctx: HttpContext) {
    const { user, organizationId } = await this.requireAuth(ctx)
    const body = await draftLayerCreateSchema.parseAsync(ctx.request.body())

    try {
      const result = await this.handoff.createFromCompilerRun(
        organizationId,
        user.id,
        body.compilerRunId,
      )

      await this.audit.log({
        event: AuditEvent.DRAFT_LAYER_CREATED,
        organizationId,
        userId: user.id,
        metadata: {
          draftSessionId: result.session.id,
          compilerRunId: result.handoff.compilerRunId,
          pdmArtifactId: result.handoff.pdmArtifactId,
        },
      })

      return ctx.response.created({ data: { session: result.session } })
    } catch (error) {
      if (error instanceof HandoffValidationError) {
        throw new ValidationException(error.message, { details: error.details })
      }
      throw error
    }
  }

  /**
   * GET /api/v1/ai/draft-layer/sessions/:id —— 获取草案会话详情。
   */
  async show(ctx: HttpContext) {
    const { organizationId } = await this.requireAuth(ctx)
    const sessionId = Number(ctx.params.id)

    const session = await DraftLayerSession.forOrganization(organizationId)
      .where('id', sessionId)
      .first()
    if (!session) throw new ResourceNotFoundException('草案会话不存在')

    const changes = await DraftLayerChange.query()
      .where('session_id', sessionId)
      .orderBy('sequence', 'asc')
    const preview = await DraftLayerPreview.query()
      .where('session_id', sessionId)
      .orderBy('version', 'desc')
      .first()
    const applyResult = await DraftLayerApplyResult.query()
      .where('session_id', sessionId)
      .orderBy('id', 'desc')
      .first()

    return { data: { session, changes, preview, applyResult } }
  }

  /**
   * POST /api/v1/ai/draft-layer/sessions/:id/preview —— 生成 Preview。
   */
  async preview(ctx: HttpContext) {
    const { user, organizationId } = await this.requireAuth(ctx)
    const sessionId = Number(ctx.params.id)

    try {
      const session = await DraftLayerSession.forOrganization(organizationId)
        .where('id', sessionId)
        .first()
      if (!session) throw new ResourceNotFoundException('草案会话不存在')

      const p = await this.previewService.generatePreview(sessionId, organizationId)

      await this.audit.log({
        event: AuditEvent.DRAFT_LAYER_PREVIEWED,
        organizationId,
        userId: user.id,
        metadata: {
          draftSessionId: sessionId,
          previewVersion: p.version,
          previewHash: p.previewHash,
        },
      })

      return { data: { preview: p } }
    } catch (error) {
      if (error instanceof PreviewError) throw new ValidationException(error.message)
      throw error
    }
  }

  /**
   * GET /api/v1/ai/draft-layer/sessions/:id/diff —— 获取 Diff 结果。
   */
  async diff(ctx: HttpContext) {
    const { organizationId } = await this.requireAuth(ctx)
    const sessionId = Number(ctx.params.id)

    const result = await this.diffService.computeDiff(sessionId, organizationId)
    return { data: { diff: result } }
  }

  /**
   * POST /api/v1/ai/draft-layer/sessions/:id/decisions —— 提交单项决策。
   */
  async decide(ctx: HttpContext) {
    const { user, organizationId } = await this.requireAuth(ctx)
    const sessionId = Number(ctx.params.id)
    const body = await draftLayerDecisionSchema.parseAsync(ctx.request.body())

    try {
      const result = await this.decision.decide(
        sessionId,
        body.changeId,
        organizationId,
        body.reviewStatus,
        body.userModifiedValue,
        body.userNote ?? undefined,
      )

      await this.audit.log({
        event: AuditEvent.DRAFT_LAYER_DECIDED,
        organizationId,
        userId: user.id,
        metadata: {
          draftSessionId: sessionId,
          changeId: body.changeId,
          reviewStatus: body.reviewStatus,
          selectionHash: result.selectionHash,
        },
      })

      return { data: result }
    } catch (error) {
      if (error instanceof DecisionValidationError) throw new ValidationException(error.message)
      throw error
    }
  }

  /**
   * POST /api/v1/ai/draft-layer/sessions/:id/bulk-decisions —— 批量操作。
   */
  async bulkDecide(ctx: HttpContext) {
    const { user, organizationId } = await this.requireAuth(ctx)
    const sessionId = Number(ctx.params.id)
    const body = await draftLayerBulkDecisionSchema.parseAsync(ctx.request.body())

    try {
      const result = await this.decision.bulkDecide(sessionId, organizationId, {
        ...body.filter,
        sessionId,
      })

      await this.audit.log({
        event: AuditEvent.DRAFT_LAYER_BULK_DECIDED,
        organizationId,
        userId: user.id,
        metadata: {
          draftSessionId: sessionId,
          affected: result.affected,
          action: body.filter.action,
          selectionHash: result.selectionHash,
        },
      })

      return { data: result }
    } catch (error) {
      if (error instanceof DecisionValidationError) throw new ValidationException(error.message)
      throw error
    }
  }

  /**
   * POST /api/v1/ai/draft-layer/sessions/:id/dry-run —— 执行 dry-run。
   */
  async dryRun(ctx: HttpContext) {
    const { user, organizationId } = await this.requireAuth(ctx)
    const sessionId = Number(ctx.params.id)
    const body = await draftLayerDryRunSchema.parseAsync(ctx.request.body())

    try {
      const result = await this.dryRunService.dryRun(sessionId, organizationId, body?.force)

      await this.audit.log({
        event: AuditEvent.DRAFT_LAYER_DRY_RUN,
        organizationId,
        userId: user.id,
        metadata: {
          draftSessionId: sessionId,
          canApply: result.canApply,
          applyPlanHash: result.applyPlanHash,
          blockingCount: result.blocking.length,
        },
      })

      return { data: { result } }
    } catch (error) {
      if (error instanceof DryRunValidationError) throw new ValidationException(error.message)
      throw error
    }
  }

  /**
   * POST /api/v1/ai/draft-layer/sessions/:id/apply —— 执行事务性 Apply。
   */
  async apply(ctx: HttpContext) {
    const { user, organizationId } = await this.requireAuth(ctx)
    const sessionId = Number(ctx.params.id)
    const body = await draftLayerApplySchema.parseAsync(ctx.request.body())

    try {
      const result = await this.applyService.apply({
        sessionId,
        organizationId,
        userId: user.id,
        idempotencyKey: body.idempotencyKey,
      })

      await this.audit.log({
        event: AuditEvent.DRAFT_LAYER_APPLIED,
        organizationId,
        userId: user.id,
        metadata: {
          draftSessionId: sessionId,
          status: result.status,
          projectId: result.projectId,
          applyPlanHash: result.applyPlanHash,
        },
      })

      return { data: { result } }
    } catch (error) {
      if (error instanceof ApplyValidationError) {
        await this.audit.log({
          event: AuditEvent.DRAFT_LAYER_APPLY_FAILED,
          organizationId,
          userId: user.id,
          metadata: { draftSessionId: sessionId, error: error.message },
        })
        throw new ValidationException(error.message, { details: error.details })
      }
      throw error
    }
  }

  /**
   * POST /api/v1/ai/draft-layer/sessions/:id/discard —— 放弃草案。
   */
  async discard(ctx: HttpContext) {
    const { user, organizationId } = await this.requireAuth(ctx)
    const sessionId = Number(ctx.params.id)

    const session = await DraftLayerSession.forOrganization(organizationId)
      .where('id', sessionId)
      .first()
    if (!session) throw new ResourceNotFoundException('草案会话不存在')

    session.status = 'discarded'
    await session.save()

    await this.audit.log({
      event: AuditEvent.DRAFT_LAYER_DISCARDED,
      organizationId,
      userId: user.id,
      metadata: { draftSessionId: sessionId },
    })

    return { data: { session } }
  }

  /** 获取认证用户和租户上下文。 */
  private async requireAuth(ctx: HttpContext) {
    const { authUser, tenant } = ctx
    if (!authUser || !tenant) throw new ValidationException('缺少组织上下文')
    return { user: authUser, organizationId: tenant.organizationId }
  }
}
