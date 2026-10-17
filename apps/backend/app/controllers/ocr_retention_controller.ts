/**
 * OcrRetentionController — OCR 保留治理 API 控制器（v3-ocr-result-persistence-and-retention §6）
 */

import { OcrResultRetentionPolicyResolver } from '#services/ai_ocr/ocr_result_retention_policy_resolver'
import { OcrResultRetentionReadService } from '#services/ai_ocr/ocr_result_retention_read_service'
import { OcrResultRetentionService } from '#services/ai_ocr/ocr_result_retention_service'
import OcrRetentionPolicyClass from '#policies/ocr_retention_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import { buildOcrRetentionAuditMetadata } from '@aiproj/types'
import {
  ocrRetentionPolicyUpdateValidator,
  ocrRetentionCleanupPreviewValidator,
  ocrRetentionCleanupExecuteValidator,
  ocrRetentionHoldSetValidator,
  ocrRetentionHoldReleaseValidator,
  ocrRetentionStatusQueryValidator,
  ocrRetentionPolicyQueryValidator,
} from '#validators/ocr_retention'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import { OcrDownstreamGuard } from '#services/ai_ocr/ocr_downstream_guard'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import type { OcrSourceRef } from '@aiproj/types'

@inject()
export default class OcrRetentionController {
  readonly #guard: OcrDownstreamGuard

  constructor(
    private policyResolver: OcrResultRetentionPolicyResolver,
    private readService: OcrResultRetentionReadService,
    private retentionService: OcrResultRetentionService,
    private audit: AuditService,
    private policy: OcrRetentionPolicyClass,
  ) {
    this.#guard = new OcrDownstreamGuard(audit)
  }

  /**
   * 保留管理守卫：解析指定动作；被拒则写低敏边界审计并阻止。
   * `allowMetadataOnly` 用于状态/清理预览等仅元数据路径（敏感复用被阻断但
   * metadata-only 状态仍可读）。
   */
  private async guardRetention(
    ctx: HttpContext,
    action: 'retention_hold' | 'retention_cleanup_preview' | 'metadata_read',
    sourceRef: OcrSourceRef | null,
    allowMetadataOnly = false,
  ): Promise<void> {
    await this.#guard.guard(
      {
        actorId: this.userIdOf(ctx),
        organizationId: this.orgIdOf(ctx),
        projectId: this.projectIdOf(ctx),
        action,
        sourceRef,
      },
      { allowMetadataOnly },
    )
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

  private userOf(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private auditRetention(
    userId: number,
    orgId: number,
    projectId: number,
    event: (typeof AuditEvent)[keyof typeof AuditEvent],
    metadata: Record<string, unknown>,
  ) {
    return this.audit.log({
      event,
      userId,
      organizationId: orgId,
      projectId,
      metadata,
    })
  }

  // ── 策略读取 ──
  async readPolicy(ctx: HttpContext) {
    await ctx.request.validateUsing(ocrRetentionPolicyQueryValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const user = this.userOf(ctx)
    await this.policy.assertView(user, orgId, projectId)

    const result = await this.policyResolver.resolve(orgId, projectId)
    const allowedActions = this.readService.resolveAllowedActions(
      await this.policy.view(user, orgId, projectId),
      await this.policy.manage(user, orgId, projectId),
      await this.policy.hold(user, orgId, projectId),
    )

    await this.auditRetention(
      userId,
      orgId,
      projectId,
      AuditEvent.OCR_RETENTION_POLICY_READ,
      buildOcrRetentionAuditMetadata({
        actorId: userId,
        organizationId: orgId,
        projectId,
        action: 'OCR_RETENTION_POLICY_READ',
      }),
    )

    return ctx.response.ok({ data: { ...result, allowedActions } })
  }

  // ── 策略更新 ──
  async updatePolicy(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrRetentionPolicyUpdateValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const user = this.userOf(ctx)
    await this.policy.assertManage(user, orgId, projectId)

    const result = await this.policyResolver.update(orgId, projectId, input, userId)

    await this.auditRetention(
      userId,
      orgId,
      projectId,
      AuditEvent.OCR_RETENTION_POLICY_UPDATED,
      buildOcrRetentionAuditMetadata({
        actorId: userId,
        organizationId: orgId,
        projectId,
        action: 'OCR_RETENTION_POLICY_UPDATED',
        policyHash: result.policyHash,
      }),
    )

    return ctx.response.ok({ data: result })
  }

  // ── 保留状态 ──
  async getStatus(ctx: HttpContext) {
    await ctx.request.validateUsing(ocrRetentionStatusQueryValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const user = this.userOf(ctx)
    await this.policy.assertView(user, orgId, projectId)

    const allowedActions = this.readService.resolveAllowedActions(
      await this.policy.view(user, orgId, projectId),
      await this.policy.manage(user, orgId, projectId),
      await this.policy.hold(user, orgId, projectId),
    )

    // 权限守卫：仅元数据状态仍可读（§6.5）
    await this.guardRetention(ctx, 'metadata_read', null, true)

    const result = await this.readService.getProjectStatus(orgId, projectId, allowedActions)

    await this.auditRetention(
      userId,
      orgId,
      projectId,
      AuditEvent.OCR_RETENTION_STATUS_READ,
      buildOcrRetentionAuditMetadata({
        actorId: userId,
        organizationId: orgId,
        projectId,
        action: 'OCR_RETENTION_STATUS_READ',
      }),
    )

    return ctx.response.ok({ data: result })
  }

  // ── accepted extraction 保留摘要 ──
  async getAcceptedExtractions(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const user = this.userOf(ctx)
    await this.policy.assertView(user, orgId, projectId)

    const result = await this.readService.getAcceptedExtractionSummaries(orgId, projectId)
    return ctx.response.ok({
      data: result,
      meta: { total: result.length, page: 1, perPage: result.length, totalPages: 1 },
    })
  }

  // ── 清理预览 ──
  async previewCleanup(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrRetentionCleanupPreviewValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const user = this.userOf(ctx)

    // 权限守卫：清理预览（§6.5）——在 Policy 断言前解析决策，
    // 被拒时写低敏边界审计并阻止（保留既有 Policy 兜底语义用于放行路径）。
    const sourceRef = input.jobId
      ? { type: 'ocr_source' as const, id: input.jobId, kind: 'job' as const }
      : null
    await this.guardRetention(ctx, 'retention_cleanup_preview', sourceRef, false)
    await this.policy.assertManage(user, orgId, projectId)

    const result = await this.retentionService.preview(orgId, projectId, input, userId)
    return ctx.response.ok({ data: result })
  }

  // ── 清理执行 ──
  async executeCleanup(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrRetentionCleanupExecuteValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const user = this.userOf(ctx)

    if (input.confirm !== true) {
      throw new ValidationException('需要显式确认清理操作')
    }

    // 权限守卫：清理执行（§6.5）——先解析决策，被拒写低敏边界审计。
    await this.guardRetention(ctx, 'retention_cleanup_preview', null, false)
    await this.policy.assertManage(user, orgId, projectId)

    const result = await this.retentionService.execute(orgId, projectId, input, userId)
    return ctx.response.ok({ data: result })
  }

  // ── Hold 管理 ──
  async setHold(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrRetentionHoldSetValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const user = this.userOf(ctx)

    // 权限守卫：设置 hold（§6.5）——先解析决策，被拒写低敏边界审计。
    const sourceRef: OcrSourceRef | null = {
      type: 'ocr_source',
      id: Number(input.scopeRef) || 0,
      kind: input.scopeKind,
    }
    await this.guardRetention(ctx, 'retention_hold', sourceRef, false)
    await this.policy.assertHold(user, orgId, projectId)

    const result = await this.retentionService.setHold(orgId, projectId, input, userId)
    return ctx.response.ok({ data: result })
  }

  async releaseHold(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrRetentionHoldReleaseValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const user = this.userOf(ctx)

    // 权限守卫：释放 hold 同属 retention_hold 管理动作（§6.5）
    await this.guardRetention(ctx, 'retention_hold', null, false)
    await this.policy.assertHold(user, orgId, projectId)

    const result = await this.retentionService.releaseHold(input.holdId, orgId, projectId, userId)
    return ctx.response.ok({ data: result })
  }

  async listHolds(ctx: HttpContext) {
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const user = this.userOf(ctx)
    await this.policy.assertView(user, orgId, projectId)

    const result = await this.retentionService.listHolds(orgId, projectId)
    return ctx.response.ok({
      data: result,
      meta: { total: result.length, page: 1, perPage: result.length, totalPages: 1 },
    })
  }
}
