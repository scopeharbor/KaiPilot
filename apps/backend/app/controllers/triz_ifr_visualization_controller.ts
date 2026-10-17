/**
 * v3-triz-ifr-visualization —— IFR 可视化 Controller（tasks 4.2-4.7 P0）。
 *
 * 端点：
 * - GET /api/v1/projects/:projectId/triz/ifr-visualizations/preview
 * - GET /api/v1/projects/:projectId/triz/ifr-visualizations
 * - GET /api/v1/projects/:projectId/triz/ifr-visualizations/:ifrId
 * - POST /api/v1/projects/:projectId/triz/ifr-visualizations
 * - POST /api/v1/projects/:projectId/triz/ifr-visualizations/ai-draft
 * - GET /api/v1/projects/:projectId/triz/ifr-visualizations/:ifrId/freshness
 * - POST /api/v1/projects/:projectId/triz/ifr-visualizations/:ifrId/handoff-preview
 * - POST /api/v1/projects/:projectId/triz/ifr-visualizations/:ifrId/handoff-candidate
 */

import type { HttpContext } from '@adonisjs/core/http'
import type {
  IfrPreviewResponse,
  IfrListResponse,
  IfrDetailResponse,
  IfrAiDraftResponse,
  IfrFreshnessResponse,
  IfrHandoffCandidateResponse,
  IfrSaveRequest,
  IfrAiDraftRequest,
  IfrHandoffRequest,
  IfrHandoffTarget,
} from '@aiproj/types'
import {
  computeIfrSourceHash,
  computeIfrHandoffIdempotencyKey,
  validateIfrHandoffInput,
  buildIfrLowSensitivityAuditMeta,
  simpleHash,
} from '@aiproj/types'
import TrizIfrVisualizationService from '#services/triz_ifr/triz_ifr_visualization_service'
import TrizIfrPolicy from '#policies/triz_ifr_policy'
import AuditService from '#services/audit_service'
import {
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type User from '#models/user'

@inject()
export default class TrizIfrVisualizationController {
  constructor(
    private service: TrizIfrVisualizationService,
    private policy: TrizIfrPolicy,
    private auditService: AuditService,
  ) {}

  // ── Helpers ──

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgIdOf(ctx: HttpContext): number {
    return Number(ctx.tenant!.organizationId)
  }

  private projectIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  // ── Guards ──

  private async guardView(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    if (!(await this.policy.view(user, orgId, projectId))) {
      await this.auditService.log({
        event: 'TRIZ_IFR_PERMISSION_DENIED' as any,
        userId: user.id,
        organizationId: orgId,
        projectId,
        entityType: 'triz_ifr_visualization',
        entityId: 0,
        metadata: {
          action: 'view',
          actor: user.id,
          org: orgId,
          project: projectId,
        },
      })
      throw new PermissionDeniedException('您没有权限查看 IFR 可视化。')
    }
  }

  private async guardManage(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    if (!(await this.policy.manage(user, orgId, projectId))) {
      await this.auditService.log({
        event: 'TRIZ_IFR_PERMISSION_DENIED' as any,
        userId: user.id,
        organizationId: orgId,
        projectId,
        entityType: 'triz_ifr_visualization',
        entityId: 0,
        metadata: {
          action: 'manage',
          actor: user.id,
          org: orgId,
          project: projectId,
        },
      })
      throw new PermissionDeniedException('您没有权限管理 IFR 可视化。')
    }
  }

  // ── Endpoints ──

  /**
   * GET /api/v1/projects/:projectId/triz/ifr-visualizations/preview
   */
  async preview(ctx: HttpContext) {
    await this.guardView(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const preview = await this.service.buildPreview({
      organizationId: orgId,
      projectId,
      user,
      currentState: ctx.request.qs().currentState,
      idealState: ctx.request.qs().idealState,
      usefulFunction: ctx.request.qs().usefulFunction
        ? Number(ctx.request.qs().usefulFunction)
        : undefined,
      cost: ctx.request.qs().cost ? Number(ctx.request.qs().cost) : undefined,
      harm: ctx.request.qs().harm ? Number(ctx.request.qs().harm) : undefined,
    })

    const body: IfrPreviewResponse = { data: preview }
    return ctx.response.json(body)
  }

  /**
   * GET /api/v1/projects/:projectId/triz/ifr-visualizations
   */
  async index(ctx: HttpContext) {
    await this.guardView(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const page = Number(ctx.request.qs().page ?? 1)
    const perPage = Math.min(Number(ctx.request.qs().perPage ?? 20), 100)

    const result = await this.service.listSaved(orgId, projectId, page, perPage)
    const body: IfrListResponse = { data: result.data, meta: result.meta }
    return ctx.response.json(body)
  }

  /**
   * GET /api/v1/projects/:projectId/triz/ifr-visualizations/:ifrId
   */
  async show(ctx: HttpContext) {
    await this.guardView(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const ifrId = ctx.params.ifrId as string

    const review = await this.service.detail(orgId, projectId, ifrId)

    if (!review) {
      throw new ResourceNotFoundException('IFR 审查会话不存在。')
    }

    const body: IfrDetailResponse = { data: review }
    return ctx.response.json(body)
  }

  /**
   * POST /api/v1/projects/:projectId/triz/ifr-visualizations
   */
  async save(ctx: HttpContext) {
    await this.guardManage(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const body = ctx.request.body() as IfrSaveRequest

    if (!body.confirmation) {
      throw new ValidationException('保存 IFR 审查需要显式用户确认（confirmation: true）。')
    }

    const preview = await this.service.buildPreview({
      organizationId: orgId,
      projectId,
      user,
      idealState: body.idealState,
    })

    const saved = await this.service.saveReview({
      organizationId: orgId,
      projectId,
      user,
      currentState: preview.currentState,
      idealState: body.idealState ?? preview.idealState,
      stages: preview.stages,
      idealityScore: preview.idealityScore,
      trendSummary: preview.trendSummary,
      sourceRefs: preview.sourceRefs,
      warningSummary: preview.warningSummary,
      sourceHash: computeIfrSourceHash(preview.sourceRefs),
      outputHash: preview.outputHash,
    })

    const respBody: IfrDetailResponse = { data: saved }
    return ctx.response.status(201).json(respBody)
  }

  /**
   * POST /api/v1/projects/:projectId/triz/ifr-visualizations/ai-draft
   */
  async aiDraft(ctx: HttpContext) {
    await this.guardManage(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const body = ctx.request.body() as IfrAiDraftRequest

    const draft: IfrAiDraftResponse = {
      data: {
        idealStateDraft: 'AI 草稿生成暂不可用（默认确定性模式）。请手动编辑理想态描述。',
        stageDescriptions: {},
        gapSuggestions: body.focusAreas ?? [],
        aiDraftState: 'fallback',
        warnings: ['AI_DRAFT_FALLBACK'],
        costSummary: null,
        inputHash: simpleHash(JSON.stringify(body)),
        outputRef: `fallback:${Date.now()}`,
        fallbackReason: '默认 fake provider：不调用真实模型，返回确定性 fallback。',
      },
    }

    await this.auditService.log({
      event: 'TRIZ_IFR_AI_DRAFT_FALLBACK' as any,
      userId: user.id,
      organizationId: orgId,
      projectId,
      entityType: 'triz_ifr_visualization',
      entityId: 0,
      metadata: {
        actor: user.id,
        org: orgId,
        project: projectId,
        focusAreas: body.focusAreas ?? [],
        aiDraftState: 'fallback',
      },
    })

    return ctx.response.json(draft)
  }

  /**
   * GET /api/v1/projects/:projectId/triz/ifr-visualizations/:ifrId/freshness
   */
  async freshness(ctx: HttpContext) {
    await this.guardView(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const ifrId = ctx.params.ifrId as string

    const preview = await this.service.buildPreview({
      organizationId: orgId,
      projectId,
      user,
    })
    const currentSourceHash = computeIfrSourceHash(preview.sourceRefs)

    const result = await this.service.checkFreshness(orgId, projectId, ifrId, currentSourceHash)

    if (!result) {
      throw new ResourceNotFoundException('IFR 审查会话不存在。')
    }

    const respBody: IfrFreshnessResponse = { data: result }
    return ctx.response.json(respBody)
  }

  /**
   * POST /api/v1/projects/:projectId/triz/ifr-visualizations/:ifrId/handoff-preview
   */
  async handoffPreview(ctx: HttpContext) {
    await this.guardManage(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const ifrId = ctx.params.ifrId as string

    const body = ctx.request.body() as IfrHandoffRequest

    const review = await this.service.detail(orgId, projectId, ifrId)
    if (!review) {
      throw new ResourceNotFoundException('IFR 审查会话不存在。')
    }

    const preview = await this.service.buildPreview({
      organizationId: orgId,
      projectId,
      user,
    })
    const currentSourceHash = computeIfrSourceHash(preview.sourceRefs)

    const idempotencyKey = computeIfrHandoffIdempotencyKey(
      ifrId,
      body.target as IfrHandoffTarget,
      body.stageRefs,
    )

    const handoffInput = {
      ifrId,
      projectId,
      organizationId: orgId,
      target: body.target as IfrHandoffTarget,
      stageRefs: body.stageRefs,
      suggestionRefs: body.suggestionRefs,
      principleRefs: body.principleRefs,
      sourceRefs: review.sourceRefs,
      sourceHash: review.outputHash,
      outputHash: review.outputHash,
      warningSummary: review.warningSummary,
      actorId: user.id,
      idempotencyKey,
      requiresUserConfirmation: body.confirmation,
    }

    const validation = validateIfrHandoffInput(handoffInput, currentSourceHash)

    const candidate: IfrHandoffCandidateResponse = {
      data: {
        input: handoffInput,
        targetRef: `handoff:${body.target}:${ifrId}`,
        staleBlocked: !validation.valid,
        staleReason: validation.errors.length > 0 ? validation.errors.join('; ') : null,
        candidateHash: simpleHash(JSON.stringify(handoffInput)),
        createdAt: new Date().toISOString(),
      },
    }

    await this.auditService.log({
      event: 'TRIZ_IFR_HANDOFF_PREVIEW' as any,
      userId: user.id,
      organizationId: orgId,
      projectId,
      entityType: 'triz_ifr_visualization',
      entityId: 0,
      metadata: buildIfrLowSensitivityAuditMeta({
        actorId: user.id,
        organizationId: orgId,
        projectId,
        ifrId,
        stageRefs: body.stageRefs,
        sourceKinds: review.sourceRefs.map((s) => s.kind),
        sourceHashPrefix: currentSourceHash,
        warningCount: review.warningSummary.length,
        outputHash: review.outputHash,
        idempotencyKey,
      }),
    })

    return ctx.response.json(candidate)
  }

  /**
   * POST /api/v1/projects/:projectId/triz/ifr-visualizations/:ifrId/handoff-candidate
   */
  async handoffCandidate(ctx: HttpContext) {
    await this.guardManage(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const ifrId = ctx.params.ifrId as string

    const body = ctx.request.body() as IfrHandoffRequest

    const review = await this.service.detail(orgId, projectId, ifrId)
    if (!review) {
      throw new ResourceNotFoundException('IFR 审查会话不存在。')
    }

    const preview = await this.service.buildPreview({
      organizationId: orgId,
      projectId,
      user,
    })
    const currentSourceHash = computeIfrSourceHash(preview.sourceRefs)

    const idempotencyKey = computeIfrHandoffIdempotencyKey(
      ifrId,
      body.target as IfrHandoffTarget,
      body.stageRefs,
    )

    const handoffInput = {
      ifrId,
      projectId,
      organizationId: orgId,
      target: body.target as IfrHandoffTarget,
      stageRefs: body.stageRefs,
      suggestionRefs: body.suggestionRefs,
      principleRefs: body.principleRefs,
      sourceRefs: review.sourceRefs,
      sourceHash: review.outputHash,
      outputHash: review.outputHash,
      warningSummary: review.warningSummary,
      actorId: user.id,
      idempotencyKey,
      requiresUserConfirmation: body.confirmation,
    }

    const validation = validateIfrHandoffInput(handoffInput, currentSourceHash)

    if (!validation.valid) {
      await this.auditService.log({
        event: 'TRIZ_IFR_HANDOFF_STALE_BLOCKED' as any,
        userId: user.id,
        organizationId: orgId,
        projectId,
        entityType: 'triz_ifr_visualization',
        entityId: 0,
        metadata: buildIfrLowSensitivityAuditMeta({
          actorId: user.id,
          organizationId: orgId,
          projectId,
          ifrId,
          stageRefs: body.stageRefs,
          sourceKinds: review.sourceRefs.map((s) => s.kind),
          sourceHashPrefix: currentSourceHash,
          warningCount: review.warningSummary.length,
          outputHash: review.outputHash,
          idempotencyKey,
        }),
      })

      throw new ValidationException(`Handoff 被阻止: ${validation.errors.join('; ')}`)
    }

    const candidate: IfrHandoffCandidateResponse = {
      data: {
        input: handoffInput,
        targetRef: `candidate:${body.target}:${ifrId}:${idempotencyKey}`,
        staleBlocked: false,
        staleReason: null,
        candidateHash: simpleHash(JSON.stringify(handoffInput)),
        createdAt: new Date().toISOString(),
      },
    }

    await this.auditService.log({
      event: 'TRIZ_IFR_HANDOFF_CANDIDATE' as any,
      userId: user.id,
      organizationId: orgId,
      projectId,
      entityType: 'triz_ifr_visualization',
      entityId: 0,
      metadata: buildIfrLowSensitivityAuditMeta({
        actorId: user.id,
        organizationId: orgId,
        projectId,
        ifrId,
        stageRefs: body.stageRefs,
        sourceKinds: review.sourceRefs.map((s) => s.kind),
        sourceHashPrefix: currentSourceHash,
        warningCount: review.warningSummary.length,
        outputHash: review.outputHash,
        idempotencyKey,
      }),
    })

    return ctx.response.status(201).json(candidate)
  }
}
