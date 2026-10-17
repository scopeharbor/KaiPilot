/**
 * OcrPermissionAuditController — OCR 权限/审计 API 控制器（v3-ocr-permission-and-audit §5.2）
 *
 * 端点（均挂 auth + RBAC 中间件，统一 `{ data, meta }` / `{ error }` 约定）：
 * - GET  /status            —— 权限状态（低敏，来源/构件引用可选）
 * - POST /decision-preview  —— 单动作决策预览（服务端重验证，拒绝时写低敏边界审计）
 * - GET  /audit-summaries   —— 只读审计摘要（有界分页 + 过滤）
 *
 * 安全红线：
 * - 前端允许动作声明一律忽略，仅以服务端 resolver 输出为准（§5.5）。
 * - 跨组织/跨项目越权由 RBAC 中间件统一返回 404（不泄露存在性）。
 * - 响应只含哈希 / 枚举码 / 原因码 / 引用，绝不含完整 OCR 文本、载荷、提示词、密钥或绝对路径。
 */
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import AuditService, { AuditEvent } from '#services/audit_service'
import { OcrPermissionAuditResolver } from '#services/ai_ocr/ocr_permission_audit_resolver'
import {
  queryOcrPermissionAudit,
  validateOcrAuditQueryBounds,
} from '#services/ai_ocr/ocr_permission_audit_query'
import { writeOcrBoundaryAudit } from '#services/ai_ocr/ocr_permission_audit_logger'
import {
  ocrPermissionAuditSummaryQueryValidator,
  ocrPermissionDecisionPreviewValidator,
  ocrPermissionStatusQueryValidator,
} from '#validators/ocr_permission_audit'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import type { OcrArtifactRef, OcrDecisionPreview, OcrSourceRef } from '@aiproj/types'

@inject()
export default class OcrPermissionAuditController {
  constructor(private audit: AuditService) {}

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

  private makeResolver(): OcrPermissionAuditResolver {
    return new OcrPermissionAuditResolver()
  }

  private toSourceRef(id?: number, kind?: string): OcrSourceRef | null {
    if (!id) return null
    return { type: 'ocr_source', id, kind: kind ?? 'attachment' }
  }

  private toArtifactRef(id?: number, kind?: string): OcrArtifactRef | null {
    if (!id) return null
    return { type: 'ocr_artifact', id, kind: (kind ?? 'accepted_extraction') as never }
  }

  // GET /status —— 权限状态（低敏）
  async status(ctx: HttpContext) {
    const query = await ctx.request.validateUsing(ocrPermissionStatusQueryValidator, {
      data: ctx.request.qs(),
    })
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const sourceRef = this.toSourceRef(query.sourceRefId, query.sourceRefKind)
    const artifactRef = this.toArtifactRef(query.artifactRefId, query.artifactRefKind)

    const status = await this.makeResolver().resolveStatus({
      actorId: userId,
      organizationId: orgId,
      projectId,
      sourceRef,
      artifactRef,
    })

    // 低敏状态读取审计（只写哈希/引用，不写敏感内容）。
    await this.audit.log({
      event: AuditEvent.OCR_PERMISSION_STATUS_READ,
      userId,
      organizationId: orgId,
      projectId,
      entityType: 'ocr',
      entityId: sourceRef?.id ?? null,
      metadata: {
        action: 'permission_status_read',
        statusHash: status.statusHash,
        sourceRefId: sourceRef?.id ?? null,
        artifactRefId: artifactRef?.id ?? null,
      },
    })

    return ctx.response.ok({ data: status })
  }

  // POST /decision-preview —— 单动作决策预览（服务端重验证）
  async decisionPreview(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ocrPermissionDecisionPreviewValidator)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)
    const userId = this.userIdOf(ctx)
    const sourceRef = this.toSourceRef(input.sourceRefId, input.sourceRefKind)
    const artifactRef = this.toArtifactRef(input.artifactRefId, input.artifactRefKind)

    const snapshot = await this.makeResolver().resolve({
      actorId: userId,
      organizationId: orgId,
      projectId,
      action: input.action,
      sourceRef,
      artifactRef,
      sourceHash: input.sourceHash ?? null,
    })

    // 边界拒绝/陈旧/隐私/保留审计（§4.8）：仅拒绝类决策写一条，放行不写。
    await writeOcrBoundaryAudit(this.audit, snapshot)

    const preview: OcrDecisionPreview = {
      action: snapshot.action,
      result: snapshot.result,
      requiresConfirmation: snapshot.requiresConfirmation,
      outputMode: snapshot.outputMode,
      reasonCodes: snapshot.reasonCodes,
      decisionHash: snapshot.decisionHash,
    }
    return ctx.response.ok({ data: preview })
  }

  // GET /audit-summaries —— 只读审计摘要（有界分页 + 过滤）
  async auditSummaries(ctx: HttpContext) {
    const query = await ctx.request.validateUsing(ocrPermissionAuditSummaryQueryValidator, {
      data: ctx.request.qs(),
    })
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdOf(ctx)

    const bounds = validateOcrAuditQueryBounds({
      perPage: query.perPage,
      from: query.from,
      to: query.to,
    })
    if (bounds.length > 0) {
      throw new ValidationException(bounds.join('；'))
    }

    const { data, meta } = await queryOcrPermissionAudit({
      organizationId: orgId,
      projectId,
      userId: query.actorId ?? null,
      action: query.action,
      result: query.result,
      reasonCode: query.reasonCode,
      from: query.from,
      to: query.to,
      page: query.page,
      perPage: query.perPage,
    })

    // 只读：本端点不写审计（避免审计读取自身产生噪声保留面），只做 SELECT。
    return ctx.response.ok({ data, meta })
  }
}
