/**
 * v2-triz-decision-log-traceability —— TrizDecisionLogController。
 *
 * HTTP 入口，只处理请求解析、权限校验、响应格式化。
 * 业务逻辑下沉到 TrizDecisionLogService。
 *
 * 端点：
 *  GET    /api/v1/projects/:projectId/triz-decision-logs              — 列表
 *  GET    /api/v1/projects/:projectId/triz-decision-logs/:decisionLogId — 详情
 *  POST   /api/v1/projects/:projectId/triz-decision-logs              — 创建
 *  POST   /api/v1/projects/:projectId/triz-decision-logs/:decisionLogId/supersede — 废止
 *  GET    /api/v1/projects/:projectId/triz-decision-logs/subject-lookup — 主题查询
 *  POST   /api/v1/projects/:projectId/triz-decision-logs/draft-reason  — AI 理由草稿
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import TrizDecisionLogPolicy from '#policies/triz_decision_log_policy'
import TrizDecisionLogService from '#services/triz_decision/triz_decision_log_service'
import { TrizDecisionAiDraftService } from '#services/triz_decision/triz_decision_ai_draft_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  trizDecisionListValidator,
  trizDecisionCreateValidator,
  trizDecisionSupersedeValidator,
  trizDecisionSubjectLookupValidator,
  trizDecisionAiDraftValidator,
} from '#validators/triz_decision_log'
import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import type {
  TrizDecisionType,
  TrizDecisionSourceKind,
  TrizDecisionSubjectRef,
  TrizDecisionSourceRef,
  TrizDecisionArtifactHash,
} from '@aiproj/types'
import logger from '@adonisjs/core/services/logger'

@inject()
export default class TrizDecisionLogController {
  constructor(
    private policy: TrizDecisionLogPolicy,
    private service: TrizDecisionLogService,
    private aiDraftService: TrizDecisionAiDraftService,
    private audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgIdOf(ctx: HttpContext): number {
    return Number(ctx.tenant!.organizationId)
  }

  private projectIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private decisionLogIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.decisionLogId)
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  private async guardView(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    if (!(await this.policy.view(user, orgId, projectId))) {
      throw new PermissionDeniedException('无权查看 TRIZ 决策日志')
    }
  }

  private async guardManage(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    if (!(await this.policy.manage(user, orgId, projectId))) {
      throw new PermissionDeniedException('无权管理 TRIZ 决策日志')
    }
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  /**
   * GET /api/v1/projects/:projectId/triz-decision-logs
   *
   * 列出项目下决策日志。按创建时间倒序。
   */
  async index(ctx: HttpContext) {
    await this.guardView(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const params = await ctx.request.validateUsing(trizDecisionListValidator, {
      data: { projectId, ...ctx.request.qs() },
    })

    const result = await this.service.list(orgId, projectId, {
      page: params.page,
      perPage: params.perPage,
      status: params.status,
    })

    return ctx.response.ok(result)
  }

  /**
   * GET /api/v1/projects/:projectId/triz-decision-logs/:decisionLogId
   *
   * 查看单条决策日志详情。
   */
  async show(ctx: HttpContext) {
    await this.guardView(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const decisionLogId = this.decisionLogIdFrom(ctx)

    const entry = await this.service.detail(orgId, projectId, decisionLogId)

    return ctx.response.ok({ data: entry })
  }

  /**
   * POST /api/v1/projects/:projectId/triz-decision-logs
   *
   * 创建决策日志。
   */
  async store(ctx: HttpContext) {
    await this.guardManage(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const body = await ctx.request.validateUsing(trizDecisionCreateValidator)

    const entry = await this.service.create(orgId, projectId, user.id, {
      ...body,
      decisionType: body.decisionType as TrizDecisionType,
      subjectRefs: body.subjectRefs.map((r: Record<string, unknown>) => ({
        ...r,
        kind: r.kind as TrizDecisionSourceKind,
      })) as unknown as TrizDecisionSubjectRef[],
      sourceRefs: body.sourceRefs.map((r: Record<string, unknown>) => ({
        ...r,
      })) as unknown as TrizDecisionSourceRef[],
      artifactHashes: body.artifactHashes.map((h: Record<string, unknown>) => ({
        ...h,
      })) as unknown as TrizDecisionArtifactHash[],
    })

    return ctx.response.created({ data: entry })
  }

  /**
   * POST /api/v1/projects/:projectId/triz-decision-logs/:decisionLogId/supersede
   *
   * 废止旧决策日志并创建新决策。
   */
  async supersede(ctx: HttpContext) {
    await this.guardManage(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const decisionLogId = this.decisionLogIdFrom(ctx)
    const body = await ctx.request.validateUsing(trizDecisionSupersedeValidator)

    const entry = await this.service.supersede(orgId, projectId, user.id, decisionLogId, {
      ...body,
      decisionType: body.decisionType as TrizDecisionType,
      subjectRefs: body.subjectRefs.map((r) => ({
        ...r,
        kind: r.kind as TrizDecisionSourceKind,
      })) as TrizDecisionSubjectRef[],
      sourceRefs: body.sourceRefs as unknown as TrizDecisionSourceRef[],
      artifactHashes: body.artifactHashes as unknown as TrizDecisionArtifactHash[],
    })

    return ctx.response.ok({ data: entry })
  }

  /**
   * GET /api/v1/projects/:projectId/triz-decision-logs/subject-lookup
   *
   * 按主题 kind+id 查找关联的决策日志。
   */
  async subjectLookup(ctx: HttpContext) {
    await this.guardView(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const params = await ctx.request.validateUsing(trizDecisionSubjectLookupValidator, {
      data: { ...ctx.request.qs(), ...ctx.params },
    })

    const result = await this.service.subjectLookup(
      orgId,
      projectId,
      params.kind,
      params.id,
      params.version,
    )

    return ctx.response.ok(result)
  }

  /**
   * POST /api/v1/projects/:projectId/triz-decision-logs/draft-reason
   *
   * 生成 AI 辅助决策理由草稿。
   * 默认走确定性 fallback 路径。AI 路径需 ai:trigger 权限（预留）。
   */
  async draftReason(ctx: HttpContext) {
    await this.guardView(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const body = await ctx.request.validateUsing(trizDecisionAiDraftValidator)

    // 检查用户是否有 ai:trigger 权限
    const hasAiTrigger = user.isSuperAdmin || (await this.policy.manage(user, orgId, projectId))

    const result = await this.aiDraftService.generateWithAiFallback(
      {
        subjectRefs: body.subjectRefs.map((r) => ({
          ...r,
          kind: r.kind as TrizDecisionSourceKind,
        })) as TrizDecisionSubjectRef[],
        sourceRefs: body.sourceRefs as unknown as TrizDecisionSourceRef[],
        decisionType: body.decisionType as TrizDecisionType,
      },
      hasAiTrigger,
    )

    // 审计
    this.audit
      .log({
        event: AuditEvent.TRIZ_DECISION_AI_DRAFT_GENERATED,
        userId: user.id,
        organizationId: orgId,
        projectId,
        entityType: 'triz_decision_log',
        entityId: null,
        metadata: {
          decisionType: body.decisionType,
          isFallback: result.isFallback,
          warningCount: result.warnings.length,
        },
      })
      .catch((err) => {
        logger.error({ err }, 'TRIZ_DECISION_AI_DRAFT_GENERATED audit log failed')
      })

    return ctx.response.ok({
      data: {
        draftReason: result.draftReason,
        warnings: result.warnings,
        costSummary: result.costSummary,
        isFallback: result.isFallback,
      },
    })
  }
}
