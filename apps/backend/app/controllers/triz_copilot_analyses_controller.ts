/**
 * v3-triz-contradiction-copilot 任务 2.2 —— 矛盾求解对话流 API 控制器。
 *
 * 端点（前缀 `/api/v1/projects/:projectId/triz-copilot/analyses`）：
 * - `POST /` 受理并求解（陈述 → 上下文包 → 映射 → Top 3 → 落库低敏记录）；
 * - `GET /` 列表（统一 `{ data, meta }` 信封）；
 * - `GET /:analysisId` 详情与依据（参数 / 候选原则 / 置信度 / 路径 / 预算）；
 * - `POST /:analysisId/override` 人工改判并重算（业务数据零变更 + 审计）。
 *
 * HTTP 入口只做请求解析、策略判定、响应格式化与**拒绝留痕**；业务全部在
 * `TrizCopilotAnalysisService`（本 change 的编排服务）。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import TrizCopilotPolicy, { type TrizCopilotPolicyDecision } from '#policies/triz_copilot_policy'
import TrizCopilotAnalysisService, {
  TRIZ_COPILOT_ANALYSIS_TOOL_NAME,
  TRIZ_COPILOT_OVERRIDE_TOOL_NAME,
} from '#services/triz_copilot/triz_copilot_analysis_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import { hashParameters } from '#services/ai_tools/ai_tools_audit_helper'
import { TRIZ_PARAMETERS } from '#services/triz_copilot/knowledge/parameters'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import {
  listValidator,
  overrideValidator,
  showValidator,
  solveValidator,
} from '#validators/triz_copilot'
import type User from '#models/user'

@inject()
export default class TrizCopilotAnalysesController {
  constructor(
    private readonly policy: TrizCopilotPolicy,
    private readonly analyses: TrizCopilotAnalysisService,
    private readonly audit: AuditService,
  ) {}

  /** 受理并求解。 */
  async store(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const body = await ctx.request.validateUsing(solveValidator, {
      data: { projectId, ...ctx.request.body() },
    })

    const decision = await this.policy.authorizeSolve(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, TRIZ_COPILOT_ANALYSIS_TOOL_NAME, 'solve', startedAt)

    const result = await this.analyses.solve({
      organizationId,
      projectId,
      user,
      statement: body.statement,
      asOfDate: body.asOfDate,
      parentAnalysisId: body.parentAnalysisId ?? null,
      sourceSignalId: body.sourceSignalId ?? null,
      forceRulePath: body.forceRulePath,
      budget: body.budget,
      requestId: this.requestIdOf(ctx),
    })

    return ctx.response.created({
      data: {
        ...result.analysis,
        mapping: result.mapping,
        solutions: result.solutions,
        clarification: result.clarification,
        modelUsage: result.modelUsage,
      },
    })
  }

  /** 列表（统一信封）。 */
  async index(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const query = await ctx.request.validateUsing(listValidator, {
      data: { projectId, ...ctx.request.qs() },
    })

    const decision = await this.policy.authorizeView(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, TRIZ_COPILOT_ANALYSIS_TOOL_NAME, 'list', startedAt)

    const result = await this.analyses.list({
      organizationId,
      projectId,
      user,
      page: query.page,
      perPage: query.perPage,
      path: query.path,
      humanOverride: query.humanOverride,
    })

    return ctx.response.ok({
      data: result.data.map((record) => this.analyses.toDTO(record)),
      meta: result.meta,
    })
  }

  /** 详情与依据。 */
  async show(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const params = await ctx.request.validateUsing(showValidator, {
      data: { projectId, analysisId: ctx.params.analysisId },
    })

    const decision = await this.policy.authorizeView(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, TRIZ_COPILOT_ANALYSIS_TOOL_NAME, 'show', startedAt)

    const record = await this.analyses.findById(
      organizationId,
      projectId,
      Number(params.analysisId),
    )
    return ctx.response.ok({ data: this.analyses.toDTO(record) })
  }

  /** 人工改判并重算（只改本分析记录，业务数据零变更）。 */
  async override(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const body = await ctx.request.validateUsing(overrideValidator, {
      data: { projectId, analysisId: ctx.params.analysisId, ...ctx.request.body() },
    })

    const decision = await this.policy.authorizeOverride(user, organizationId, projectId)
    await this.assertAuthorized(
      ctx,
      decision,
      TRIZ_COPILOT_OVERRIDE_TOOL_NAME,
      'override',
      startedAt,
    )

    const result = await this.analyses.override({
      organizationId,
      projectId,
      user,
      analysisId: Number(body.analysisId),
      improvingParameter: body.improvingParameter,
      worseningParameter: body.worseningParameter,
      contradictionType: body.contradictionType,
      reason: body.reason ?? null,
      budget: body.budget,
      requestId: this.requestIdOf(ctx),
    })

    return ctx.response.ok({
      data: {
        ...result.analysis,
        change: result.change,
        solutions: result.solutions,
      },
    })
  }

  /** 只读投影 39 项工程参数（只读零写）。 */
  async parameters(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const decision = await this.policy.authorizeView(user, organizationId, projectId)
    await this.assertAuthorized(
      ctx,
      decision,
      TRIZ_COPILOT_ANALYSIS_TOOL_NAME,
      'parameters',
      startedAt,
    )

    const data = TRIZ_PARAMETERS.map((param) => ({
      number: param.number,
      nameZh: param.nameZh,
      displayName: param.displayName,
      pmMeaning: param.pmMeaning,
      category: param.category,
    }))

    return ctx.response.ok({ data })
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

  /**
   * 策略判定失败：跨组织 / 不存在统一 404（RL-05 不泄露存在性），其余 403；
   * 两类拒绝都留痕（spec「反幻觉与低敏审计边界」第 4 条）。
   */
  private async assertAuthorized(
    ctx: HttpContext,
    decision: TrizCopilotPolicyDecision,
    toolName: string,
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
      entityType: 'triz_copilot_analysis',
      entityId: null,
      // 低敏：只记动作名、缺失权限码与入参哈希，不回显任何入参正文（RL-12）。
      metadata: {
        toolName,
        parametersHash: hashParameters(parameters),
        status: 'REJECTED',
        durationMs: Date.now() - startedAt,
        errorCode,
        ...parameters,
      },
    })

    if (crossOrg) throw new ResourceNotFoundException('项目不存在或无权访问')
    throw new PermissionDeniedException(
      `缺少矛盾求解所需权限 (${decision.missingPermission ?? 'ai:trigger'})`,
    )
  }
}
