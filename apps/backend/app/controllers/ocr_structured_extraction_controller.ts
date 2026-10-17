/**
 * OcrStructuredExtractionController — OCR 结构化提取 API 控制器（v3-ocr-structured-extraction §5）
 *
 * 端点全部挂载在 /api/v1/projects/:projectId/ocr/structured-extraction 下。
 * 所有操作需项目成员 + 相应 RBAC 权限。
 */

import OcrStructuredExtractionPolicy from '#policies/ocr_structured_extraction_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import OcrStructuredExtractionService from '#services/ai_ocr/ocr_structured_extraction_service'
import {
  createOcrStructuredExtractionProfileValidator,
  updateOcrStructuredExtractionProfileValidator,
  createOcrStructuredExtractionRunValidator,
  listOcrStructuredExtractionRunsValidator,
  ocrStructuredExtractionPreviewValidator,
  ocrStructuredExtractionSaveValidator,
} from '#validators/ocr_structured_extraction'
import { buildStructuredExtractionAuditMetadata } from '@aiproj/types'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import { OcrDownstreamGuard } from '#services/ai_ocr/ocr_downstream_guard'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class OcrStructuredExtractionController {
  readonly #guard: OcrDownstreamGuard

  constructor(private audit: AuditService) {
    this.#guard = new OcrDownstreamGuard(audit)
  }

  private orgIdOf(ctx: HttpContext): number {
    const orgId = (ctx as any).tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private projectIdOf(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private userIdOf(ctx: HttpContext): number {
    const user = (ctx as any).auth?.user
    return user ? Number(user.id) : 0
  }

  private makePolicy(ctx: HttpContext): OcrStructuredExtractionPolicy {
    return new OcrStructuredExtractionPolicy(ctx)
  }

  private makeService(ctx: HttpContext): OcrStructuredExtractionService {
    return new OcrStructuredExtractionService(ctx, this.audit)
  }

  // ── Profiles ──────────────────────────────────────────────────────

  /** GET /api/v1/projects/:projectId/ocr/structured-extraction/profiles */
  async listProfiles(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    this.makePolicy(ctx).assertView()

    const qs = ctx.request.qs()
    const service = this.makeService(ctx)
    const result = await service.listProfiles(orgId, projectId, {
      scope: qs.scope as string | undefined,
      status: qs.status as string | undefined,
      page: Number(qs.page || 1),
      perPage: Number(qs.perPage || 20),
    })
    return ctx.response.json({ data: result.data, meta: result.meta })
  }

  /** GET /api/v1/projects/:projectId/ocr/structured-extraction/profiles/:id */
  async getProfile(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    this.makePolicy(ctx).assertView()

    const service = this.makeService(ctx)
    const profileId = Number(ctx.params.id)
    const profile = await service.getProfileDetail(profileId, orgId)
    if (!profile) throw new ResourceNotFoundException('提取配置不存在')
    return ctx.response.json({ data: profile })
  }

  /** POST /api/v1/projects/:projectId/ocr/structured-extraction/profiles */
  async createProfile(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const userId = this.userIdOf(ctx)
    this.makePolicy(ctx).assertManage()

    const input = await ctx.request.validateUsing(createOcrStructuredExtractionProfileValidator)
    const service = this.makeService(ctx)
    const profile = await service.createProfile(input, orgId, userId)
    return ctx.response.status(201).json({ data: profile })
  }

  /** PUT /api/v1/projects/:projectId/ocr/structured-extraction/profiles/:id */
  async updateProfile(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const userId = this.userIdOf(ctx)
    this.makePolicy(ctx).assertManage()

    const input = await ctx.request.validateUsing(updateOcrStructuredExtractionProfileValidator)
    const service = this.makeService(ctx)
    const profileId = Number(ctx.params.id)
    const profile = await service.updateProfile(profileId, input, orgId, userId)
    return ctx.response.json({ data: profile })
  }

  /** PATCH /api/v1/projects/:projectId/ocr/structured-extraction/profiles/:id/archive */
  async archiveProfile(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const userId = this.userIdOf(ctx)
    this.makePolicy(ctx).assertManage()

    const service = this.makeService(ctx)
    const profileId = Number(ctx.params.id)
    const profile = await service.updateProfile(profileId, { status: 'archived' }, orgId, userId)
    return ctx.response.json({ data: profile })
  }

  // ── Runs ──────────────────────────────────────────────────────────

  /** POST /api/v1/projects/:projectId/ocr/structured-extraction/runs */
  async createRun(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)

    // 权限守卫：结构化提取运行（§6.9）——先解析决策，被拒写低敏边界审计。
    // 该动作针对已确认提取，单来源可见性/retention/stale 由 service 自身
    // eligibility 检查保留（isAcceptedExtractionEligible），此处只把关 RBAC。
    await this.#guard.guard({
      actorId: userId,
      organizationId: orgId,
      projectId,
      action: 'structured_extraction_run',
      sourceRef: null,
    })
    this.makePolicy(ctx).assertRun()

    const input = await ctx.request.validateUsing(createOcrStructuredExtractionRunValidator)
    const service = this.makeService(ctx)
    const run = await service.createRun(input, orgId, projectId, userId)
    return ctx.response.status(201).json({ data: run })
  }

  /** GET /api/v1/projects/:projectId/ocr/structured-extraction/runs */
  async listRuns(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    this.makePolicy(ctx).assertView()

    const filters = await ctx.request.validateUsing(listOcrStructuredExtractionRunsValidator)
    const service = this.makeService(ctx)
    const result = await service.listRuns(orgId, projectId, filters)
    return ctx.response.json({ data: result.data, meta: result.meta })
  }

  /** GET /api/v1/projects/:projectId/ocr/structured-extraction/runs/:id */
  async getRun(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    this.makePolicy(ctx).assertView()

    const service = this.makeService(ctx)
    const runId = Number(ctx.params.id)
    const run = await service.getRunDetail(runId, orgId, this.projectIdOf(ctx))
    if (!run) throw new ResourceNotFoundException('提取运行不存在')
    return ctx.response.json({ data: run })
  }

  /** GET /api/v1/projects/:projectId/ocr/structured-extraction/runs/:id/candidates */
  async getCandidates(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    this.makePolicy(ctx).assertView()

    const service = this.makeService(ctx)
    const runId = Number(ctx.params.id)
    const run = await service.getRunDetail(runId, orgId, this.projectIdOf(ctx))
    if (!run) throw new ResourceNotFoundException('提取运行不存在')
    return ctx.response.json({
      data: { fields: run.fieldCandidates, tables: run.tableCandidates },
    })
  }

  // ── Confirmation ──────────────────────────────────────────────────

  /** POST /api/v1/projects/:projectId/ocr/structured-extraction/preview */
  async previewConfirmation(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)

    // 权限守卫：结构化提取确认预览（§6.9）——被拒不暴露候选/快照。
    await this.#guard.guard({
      actorId: userId,
      organizationId: orgId,
      projectId,
      action: 'structured_extraction_run',
      sourceRef: null,
    })
    this.makePolicy(ctx).assertConfirm()

    const input = await ctx.request.validateUsing(ocrStructuredExtractionPreviewValidator)
    const service = this.makeService(ctx)
    try {
      const preview = await service.previewConfirmation(input, orgId, userId)
      return ctx.response.json({ data: preview })
    } catch (err: any) {
      if (err.message?.includes('stale') || err.message?.includes('过期')) {
        this.audit.log({
          event: AuditEvent.OCR_STRUCTURED_STALE_BLOCKED,
          userId,
          organizationId: orgId,
          projectId,
          metadata: buildStructuredExtractionAuditMetadata({
            actorId: userId,
            organizationId: orgId,
            projectId,
            action: 'OCR_STRUCTURED_STALE_BLOCKED' as any,
            runId: input.runId,
            denialReason: err.message,
          }),
        })
      }
      throw err
    }
  }

  /** POST /api/v1/projects/:projectId/ocr/structured-extraction/save */
  async saveConfirmation(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)

    // 权限守卫：结构化提取保存确认（§6.10）——被拒不建 confirmed snapshot。
    await this.#guard.guard({
      actorId: userId,
      organizationId: orgId,
      projectId,
      action: 'structured_extraction_run',
      sourceRef: null,
    })
    this.makePolicy(ctx).assertConfirm()

    const input = await ctx.request.validateUsing(ocrStructuredExtractionSaveValidator)
    const service = this.makeService(ctx)
    const snapshot = await service.saveConfirmation(input, orgId, projectId, userId)
    return ctx.response.status(201).json({ data: snapshot })
  }

  // ── Snapshots ─────────────────────────────────────────────────────

  /** GET /api/v1/projects/:projectId/ocr/structured-extraction/snapshots */
  async listSnapshots(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    this.makePolicy(ctx).assertView()

    const qs = ctx.request.qs()
    const service = this.makeService(ctx)
    const result = await service.listSnapshots(orgId, projectId, {
      extractionId: qs.extractionId ? Number(qs.extractionId) : undefined,
      profileId: qs.profileId ? Number(qs.profileId) : undefined,
      page: Number(qs.page || 1),
      perPage: Number(qs.perPage || 20),
    })
    return ctx.response.json({ data: result.data, meta: result.meta })
  }

  /** GET /api/v1/projects/:projectId/ocr/structured-extraction/snapshots/:id */
  async getSnapshot(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    this.makePolicy(ctx).assertView()

    const service = this.makeService(ctx)
    const snapshotId = Number(ctx.params.id)
    const snapshot = await service.getSnapshotDetail(snapshotId, orgId)
    if (!snapshot) throw new ResourceNotFoundException('结构化提取快照不存在')
    return ctx.response.json({ data: snapshot })
  }
}
