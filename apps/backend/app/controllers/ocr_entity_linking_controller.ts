/**
 * OcrEntityLinkingController — OCR 实体链接 API 控制器（v3-ocr-entity-linking §5.8）
 *
 * 端点全部挂载在 /api/v1/projects/:projectId/ocr/entity-links 下。
 * 所有操作需项目成员 + 相应 RBAC 权限。
 *
 * 注意：OcrEntityLinkingService 的每个方法自带 ctx 并在内部做 Policy 断言，
 * 控制器只负责取上下文、校验入参与格式化响应，不重复实例化 Policy。
 */

import OcrEntityLinkingService from '#services/ai_ocr/ocr_entity_linking_service'
import AuditService from '#services/audit_service'
import { OcrDownstreamGuard } from '#services/ai_ocr/ocr_downstream_guard'
import {
  createOcrEntityLinkRunValidator,
  listOcrEntityLinkRunsValidator,
  listOcrEntityLinkCandidatesValidator,
  ocrEntityLinkPreviewValidator,
  ocrEntityLinkConfirmValidator,
  ocrEntityLinkSupersedeValidator,
  ocrEntityLinkRejectValidator,
  ocrEntityLinkExplainValidator,
} from '#validators/ocr_entity_linking'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type { HttpContext } from '@adonisjs/core/http'

export default class OcrEntityLinkingController {
  readonly #guard: OcrDownstreamGuard

  constructor() {
    this.#guard = new OcrDownstreamGuard(new AuditService())
  }
  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private projectIdOf(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private userIdOf(ctx: HttpContext): number {
    const user = ctx.auth?.user
    return user ? Number(user.id) : 0
  }

  private makeService(): OcrEntityLinkingService {
    return new OcrEntityLinkingService()
  }

  // ── Runs ──────────────────────────────────────────────────────────

  /** POST /api/v1/projects/:projectId/ocr/entity-links/runs */
  async createRun(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)

    // 权限守卫：实体链接运行（§6.11）——被拒不读 selectedText 全文、不持久化 advisory link。
    await this.#guard.guard({
      actorId: userId,
      organizationId: orgId,
      projectId,
      action: 'entity_linking_run',
      sourceRef: null,
    })

    const input = await ctx.request.validateUsing(createOcrEntityLinkRunValidator)
    // 幂等由 Service 侧基于输入签名判定，客户端 idempotencyKey 当前不参与去重
    const run = await this.makeService().createRun(
      ctx,
      orgId,
      projectId,
      userId,
      input.acceptedExtractionIds,
      input.targetKinds,
      input.ruleVersion,
    )
    return ctx.response.status(201).json({ data: run })
  }

  /** GET /api/v1/projects/:projectId/ocr/entity-links/runs */
  async listRuns(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)

    const filters = await ctx.request.validateUsing(listOcrEntityLinkRunsValidator)
    const result = await this.makeService().listRuns(ctx, orgId, projectId, filters)
    return ctx.response.json({ data: result.data, meta: result.meta })
  }

  /** GET /api/v1/projects/:projectId/ocr/entity-links/runs/:id */
  async getRun(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)

    const runId = Number(ctx.params.id)
    const run = await this.makeService().getRun(ctx, orgId, projectId, runId)
    if (!run) throw new ResourceNotFoundException('实体链接运行不存在')
    return ctx.response.json({ data: run })
  }

  /** GET /api/v1/projects/:projectId/ocr/entity-links/runs/:id/candidates */
  async listCandidates(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)

    const runId = Number(ctx.params.id)
    const pageFilters = await ctx.request.validateUsing(listOcrEntityLinkCandidatesValidator)
    const page = pageFilters.page ?? 1
    const perPage = pageFilters.perPage ?? 50
    // 候选分页复用 getRun：Service 只有这一处按 run 读取候选，避免另起一条未经权限断言的查询
    const detail = await this.makeService().getRun(ctx, orgId, projectId, runId, page, perPage)
    if (!detail) throw new ResourceNotFoundException('实体链接运行不存在')
    return ctx.response.json({
      data: detail.candidates,
      meta: {
        total: detail.run.candidateCount,
        page,
        perPage,
        totalPages: Math.max(1, Math.ceil(detail.run.candidateCount / perPage)),
      },
    })
  }

  // ── Preview / Confirm ────────────────────────────────────────────

  /** POST /api/v1/projects/:projectId/ocr/entity-links/preview */
  async preview(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)

    // 权限守卫：实体链接 advisory 预览（§6.11）——被拒不暴露 advisory span。
    await this.#guard.guard({
      actorId: userId,
      organizationId: orgId,
      projectId,
      action: 'entity_linking_run',
      sourceRef: null,
    })

    const input = await ctx.request.validateUsing(ocrEntityLinkPreviewValidator)
    const preview = await this.makeService().preview(
      ctx,
      orgId,
      projectId,
      input.runId,
      input.candidateId,
    )
    return ctx.response.json({ data: preview })
  }

  /** POST /api/v1/projects/:projectId/ocr/entity-links/confirm */
  async confirm(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)

    // 权限守卫：实体链接确认（§6.12）——被拒不持久化 advisory link。
    await this.#guard.guard({
      actorId: userId,
      organizationId: orgId,
      projectId,
      action: 'entity_linking_run',
      sourceRef: null,
    })

    const input = await ctx.request.validateUsing(ocrEntityLinkConfirmValidator)
    // reviewerNote 已通过校验但确认链接表无对应列，Service 侧暂不落库
    const link = await this.makeService().confirm(
      ctx,
      orgId,
      projectId,
      input.runId,
      input.candidateId,
      input.previewHash,
      userId,
    )
    return ctx.response.status(201).json({ data: link })
  }

  // ── Supersede / Reject ───────────────────────────────────────────

  /** POST /api/v1/projects/:projectId/ocr/entity-links/:id/supersede */
  async supersede(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)

    const input = await ctx.request.validateUsing(ocrEntityLinkSupersedeValidator)
    const linkId = Number(ctx.params.id)
    await this.makeService().supersede(ctx, orgId, projectId, linkId, input.reason, userId)
    return ctx.response.json({ data: { success: true } })
  }

  /** POST /api/v1/projects/:projectId/ocr/entity-links/:id/reject */
  async reject(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)

    const input = await ctx.request.validateUsing(ocrEntityLinkRejectValidator)
    const linkId = Number(ctx.params.id)
    await this.makeService().reject(ctx, orgId, projectId, linkId, input.reason, userId)
    return ctx.response.json({ data: { success: true } })
  }

  // ── Optional AI Explain ──────────────────────────────────────────

  /** POST /api/v1/projects/:projectId/ocr/entity-links/explain */
  async explain(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)

    // 权限守卫：实体链接解释请求（§6.11）——被拒（缺 explain 权限/隐私/retention）
    // 不暴露 advisory 候选引用。
    await this.#guard.guard({
      actorId: userId,
      organizationId: orgId,
      projectId,
      action: 'explain_request',
      sourceRef: null,
    })

    const input = await ctx.request.validateUsing(ocrEntityLinkExplainValidator)
    const explanation = await this.makeService().explain(
      ctx,
      orgId,
      projectId,
      input.runId,
      input.candidateId,
    )
    return ctx.response.json({ data: explanation })
  }
}
