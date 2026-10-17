/**
 * v3-triz-contradiction-copilot W4 任务 4.2 —— 分馆只读查询控制器（矩阵参数对 / 预填脚手架）。
 *
 * 端点（前缀 `/api/v1/projects/:projectId/triz-gallery`）：
 * - `GET /matrix-principles?improving=N&worsening=M` 矛盾矩阵参数对 → 推荐原则
 *   （知识包只读投影，封装 W1 的 `searchByParameterPair`；空单元中性提示）；
 * - `GET /prefill?artifactType=nine_windows|function_analysis` 预填草案
 *   （九屏幕九格 / 功能分析初始图；模型路径 + 确定性模板回退；**只产草案不落库**）。
 *
 * 权限：两者均只要求 `project:view`（读取属只读操作，spec「分馆访问的权限与中性防护」第 1 条）。
 * 跨组织 / 不存在统一 404（RL-05）；预填草案的落库走 4.1 的创建端点，由前端在人工确认后调用。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import TrizGalleryArtifactPolicy, {
  type TrizGalleryArtifactPolicyDecision,
} from '#policies/triz_gallery_artifact_policy'
import TrizContextPackService from '#services/triz_copilot/triz_context_pack_service'
import TrizGalleryPrefillService, {
  type TrizGalleryPrefillArtifactType,
} from '#services/triz_copilot/triz_gallery_prefill_service'
import { projectMatrixPrinciples } from '#services/triz_copilot/triz_gallery_matrix_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import { hashParameters } from '#services/ai_tools/ai_tools_audit_helper'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import { matrixPrinciplesValidator, prefillValidator } from '#validators/triz_gallery'
import type User from '#models/user'

@inject()
export default class TrizGalleryController {
  constructor(
    private readonly policy: TrizGalleryArtifactPolicy,
    private readonly contextPack: TrizContextPackService,
    private readonly prefill: TrizGalleryPrefillService,
    private readonly audit: AuditService,
  ) {}

  /** 矛盾矩阵参数对：命中的推荐原则与来源；空单元中性提示（零写、零模型调用）。 */
  async matrixPrinciples(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const query = await ctx.request.validateUsing(matrixPrinciplesValidator, {
      data: { projectId, ...ctx.request.qs() },
    })

    const decision = await this.policy.authorizeView(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, 'matrix_principles', startedAt)

    return ctx.response.ok({
      data: projectMatrixPrinciples(Number(query.improving), Number(query.worsening)),
    })
  }

  /**
   * 预填草案：九屏幕九格 / 功能分析初始图。生成过程只读项目事实（经上下文包按域权限裁剪），
   * **不落任何库**；响应携带 `path`（`ai` / `rule`）与回退原因，前端据实披露。
   */
  async prefillDraft(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const query = await ctx.request.validateUsing(prefillValidator, {
      data: { projectId, ...ctx.request.qs() },
    })

    const decision = await this.policy.authorizeView(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, 'prefill', startedAt)

    const pack = await this.contextPack.assemble({
      organizationId,
      projectId,
      user,
      asOfDate: this.asOfDateFrom(ctx),
    })

    const draft = await this.prefill.prefetch({
      organizationId,
      projectId,
      actor: user,
      artifactType: query.artifactType as TrizGalleryPrefillArtifactType,
      contextPack: pack,
      traceId: this.requestIdOf(ctx),
    })

    return ctx.response.ok({ data: draft })
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgIdOf(ctx: HttpContext): number {
    return Number(ctx.tenant!.organizationId)
  }

  private projectIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private requestIdOf(ctx: HttpContext): string | null {
    return ctx.request.id() ?? null
  }

  /** 评估日（可选 `asOfDate` 查询参数，口径与对话流求解一致）。 */
  private asOfDateFrom(ctx: HttpContext): string | undefined {
    const value = ctx.request.qs().asOfDate
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
  }

  private async assertAuthorized(
    ctx: HttpContext,
    decision: TrizGalleryArtifactPolicyDecision,
    action: string,
    startedAt: number,
  ): Promise<void> {
    if (decision.allowed) return

    const crossOrg = decision.reason === 'cross_org_denied'
    const errorCode = crossOrg ? 'RESOURCE_NOT_FOUND' : 'PERMISSION_DENIED'
    const parameters = {
      action,
      missingPermission: decision.missingPermission,
      reason: decision.reason,
    }

    await this.audit.log({
      event: AuditEvent.AI_TOOL_DENIED,
      userId: Number(this.currentUser(ctx).id),
      organizationId: this.orgIdOf(ctx),
      projectId: this.projectIdFrom(ctx),
      requestId: this.requestIdOf(ctx),
      entityType: 'triz_gallery_artifact',
      entityId: null,
      // 低敏：只记动作名、缺失权限码与入参哈希（RL-12）。
      metadata: {
        toolName: 'triz_gallery_read',
        parametersHash: hashParameters(parameters),
        status: 'REJECTED',
        durationMs: Date.now() - startedAt,
        errorCode,
        ...parameters,
      },
    })

    if (crossOrg) throw new ResourceNotFoundException('项目不存在或无权访问')
    throw new PermissionDeniedException(
      `缺少分馆读取所需权限 (${decision.missingPermission ?? 'project:view'})`,
    )
  }
}
