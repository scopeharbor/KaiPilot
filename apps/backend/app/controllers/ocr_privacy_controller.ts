/**
 * OcrPrivacyController — OCR 隐私策略 API 控制器（v3-ocr-privacy-policy-controls §6.5）
 *
 * 端点：
 * - GET    /api/v1/projects/:projectId/ocr/privacy/policy
 * - PUT    /api/v1/projects/:projectId/ocr/privacy/policy
 * - GET    /api/v1/projects/:projectId/ocr/privacy/status
 * - POST   /api/v1/projects/:projectId/ocr/privacy/decision-preview
 * - POST   /api/v1/projects/:projectId/ocr/privacy/export-preview
 * - POST   /api/v1/projects/:projectId/ocr/privacy/export-execute
 * - GET    /api/v1/projects/:projectId/ocr/privacy/runs
 * - GET    /api/v1/projects/:projectId/ocr/privacy/runs/:runId
 */
import { OcrPrivacyPolicyResolver } from '#services/ai_ocr/ocr_privacy_policy_resolver'
import { OcrPrivacyDecisionService } from '#services/ai_ocr/ocr_privacy_decision_service'
import { OcrPrivacyCopyExportService } from '#services/ai_ocr/ocr_privacy_copy_export_service'
import { OcrPermissionDownstreamGuard } from '#services/ai_ocr/ocr_privacy_downstream_guard'
import OcrPrivacyPolicyClass from '#policies/ocr_privacy_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  ocrPrivacyPolicyUpdateValidator,
  ocrPrivacyDecisionPreviewValidator,
  ocrPrivacyExportPreviewValidator,
  ocrPrivacyExportExecuteValidator,
} from '#validators/ocr_privacy'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class OcrPrivacyController {
  /** 下游敏感复用边界守卫（复用已注入的 copy/export 服务与审计服务）。 */
  private readonly downstreamGuard: OcrPermissionDownstreamGuard

  constructor(
    private policyResolver: OcrPrivacyPolicyResolver,
    private decisionService: OcrPrivacyDecisionService,
    private copyExportService: OcrPrivacyCopyExportService,
    private audit: AuditService,
  ) {
    this.downstreamGuard = new OcrPermissionDownstreamGuard({
      copyExport: this.copyExportService,
      audit: this.audit,
    })
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
    return Number(ctx.auth?.user?.id ?? 0)
  }

  private makePolicy(ctx: HttpContext): OcrPrivacyPolicyClass {
    return new OcrPrivacyPolicyClass(ctx)
  }

  // ── 策略读取 ──
  async readPolicy(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policy = this.makePolicy(ctx)
    policy.assertView()

    const result = await this.policyResolver.resolve(orgId, projectId)
    const allowedActions = policy.resolveAllowedActions()

    await this.audit.log({
      event: AuditEvent.OCR_PRIVACY_POLICY_READ,
      userId,
      organizationId: orgId,
      projectId,
      metadata: {
        action: 'OCR_PRIVACY_POLICY_READ',
        policyHash: result.policyHash,
        policySource: result.source,
      },
    })

    return ctx.response.ok({ data: { ...result, allowedActions } })
  }

  // ── 策略更新 ──
  async updatePolicy(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policy = this.makePolicy(ctx)
    policy.assertManage()

    const body = await ctx.request.validateUsing(ocrPrivacyPolicyUpdateValidator)
    const result = await this.policyResolver.update(orgId, projectId, body, userId)

    await this.audit.log({
      event: AuditEvent.OCR_PRIVACY_POLICY_UPDATED,
      userId,
      organizationId: orgId,
      projectId,
      metadata: {
        action: 'OCR_PRIVACY_POLICY_UPDATED',
        policyHash: result.policyHash,
        policySource: result.source,
        version: result.version,
      },
    })

    return ctx.response.ok({ data: result })
  }

  // ── 状态读取 ──
  async readStatus(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policy = this.makePolicy(ctx)
    policy.assertView()

    const resolved = await this.policyResolver.resolve(orgId, projectId)

    const allowedActions = policy.resolveAllowedActions()

    await this.audit.log({
      event: AuditEvent.OCR_PRIVACY_POLICY_READ,
      userId,
      organizationId: orgId,
      projectId,
      metadata: {
        action: 'OCR_PRIVACY_POLICY_READ',
        policyHash: resolved.policyHash,
      },
    })

    return ctx.response.ok({
      data: {
        policyHash: resolved.policyHash,
        policySource: resolved.source,
        allowedActions,
        globalOutputMode: resolved.globalOutputMode,
        warnings: [],
        policyVersion: resolved.version,
      },
    })
  }

  // ── 决策预览 ──
  async decisionPreview(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policyClass = this.makePolicy(ctx)
    policyClass.assertView()

    const body = await ctx.request.validateUsing(ocrPrivacyDecisionPreviewValidator)
    const resolved = await this.policyResolver.resolve(orgId, projectId)

    const decision = this.decisionService.preflight(
      {
        purpose: body.purpose,
        contentCategory: body.contentCategory,
        action: body.action as any,
        sourceVisible: true,
        sourceHash: body.sourceHash ?? null,
        contentHash: body.contentHash ?? null,
        lifecycleState: 'active',
        holdActive: false,
        policyHash: body.policyHash,
        authContext: {
          userId,
          organizationId: orgId,
          projectId,
          permissions: ['ocr_privacy:view', 'file:view'],
        },
      },
      resolved,
    )

    await this.audit.log({
      event: AuditEvent.OCR_PRIVACY_DECISION_PREVIEW,
      userId,
      organizationId: orgId,
      projectId,
      metadata: {
        action: 'OCR_PRIVACY_DECISION_PREVIEW',
        decisionHash: decision.decisionHash,
        result: decision.result,
        policyHash: decision.policyHash,
      },
    })

    return ctx.response.ok({ data: decision })
  }

  // ── 导出预览 ──
  async exportPreview(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policyClass = this.makePolicy(ctx)
    policyClass.assertExport()

    const body = await ctx.request.validateUsing(ocrPrivacyExportPreviewValidator)
    const resolved = await this.policyResolver.resolve(orgId, projectId)

    const extractions = body.acceptedExtractionIds.map((id) => ({
      id,
      sourceHash: `src_${id}`,
      textLength: 1500,
      pageCount: 1,
      lifecycleState: 'active',
      holdActive: false,
    }))

    // 敏感复用边界守卫：resolver 拒绝/陈旧/隐私/保留阻止 → 不消费预览，返回低敏降级。
    const guard = await this.downstreamGuard.guardCopyExportPreview(
      {
        purpose: body.purpose,
        scope: {
          organizationId: orgId,
          projectId,
          acceptedExtractionIds: body.acceptedExtractionIds,
          sourceKind: 'attachment',
        },
        format: body.format,
        policyHash: body.policyHash,
      },
      resolved,
      extractions,
      {
        actorId: userId,
        organizationId: orgId,
        projectId,
        sourceRef: { type: 'ocr_source', id: extractions[0]?.id ?? 0, kind: 'attachment' },
        sourceHash: extractions[0]?.sourceHash ?? null,
      },
    )

    if (!guard.allowed) {
      return ctx.response.ok({ data: { blocked: guard.blocked } })
    }

    const preview = guard.data

    await this.audit.log({
      event: AuditEvent.OCR_PRIVACY_EXPORT_PREVIEW,
      userId,
      organizationId: orgId,
      projectId,
      metadata: {
        action: 'OCR_PRIVACY_EXPORT_PREVIEW',
        previewHash: preview.previewHash,
        policyHash: preview.policyHash,
        recordCount: preview.recordCount,
      },
    })

    return ctx.response.ok({ data: preview })
  }

  // ── 导出执行 ──
  async exportExecute(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const policyClass = this.makePolicy(ctx)
    policyClass.assertExport()

    const body = await ctx.request.validateUsing(ocrPrivacyExportExecuteValidator)
    const resolved = await this.policyResolver.resolve(orgId, projectId)

    // 策略哈希重校验
    if (body.policyHash !== resolved.policyHash) {
      throw new ValidationException('策略已变更，请重新预览导出')
    }

    // 敏感复用边界守卫：resolver 拒绝/陈旧/隐私/保留阻止 → 阻止导出执行，返回低敏降级。
    const guard = await this.downstreamGuard.guardCopyExportExecute(
      // 校验器允许 null（前端显式清空），契约只接受 undefined 表示"未提供确认 token"
      { ...body, confirmationToken: body.confirmationToken ?? undefined },
      resolved,
      [], // 实际生产中应传入真实提取
      userId,
      {
        actorId: userId,
        organizationId: orgId,
        projectId,
        sourceRef: { type: 'ocr_source', id: 0, kind: 'attachment' },
      },
    )

    if (!guard.allowed) {
      return ctx.response.ok({ data: { blocked: guard.blocked } })
    }

    const run = guard.data

    await this.audit.log({
      event: AuditEvent.OCR_PRIVACY_EXPORT_EXECUTED,
      userId,
      organizationId: orgId,
      projectId,
      metadata: {
        action: 'OCR_PRIVACY_EXPORT_EXECUTED',
        runKey: run.runKey,
        previewHash: run.previewHash,
        policyHash: run.policyHash,
        recordCount: run.counts.recordCount,
      },
    })

    return ctx.response.ok({ data: run })
  }

  // ── 运行列表 ──
  async listRuns(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const policyClass = this.makePolicy(ctx)
    policyClass.assertAuditStatus()

    const runs = await this.copyExportService.listRuns(orgId, projectId)

    return ctx.response.ok({
      data: runs,
      meta: { total: runs.length, page: 1, perPage: 50, totalPages: 1 },
    })
  }

  // ── 运行详情 ──
  async runDetail(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const policyClass = this.makePolicy(ctx)
    policyClass.assertAuditStatus()

    const runId = Number(ctx.params.runId)
    const run = await this.copyExportService.getRun(runId)

    if (!run || run.organizationId !== orgId) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '导出运行记录不存在' },
      })
    }

    return ctx.response.ok({ data: run })
  }
}
