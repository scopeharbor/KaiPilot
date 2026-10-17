import type { HttpContext } from '@adonisjs/core/http'
import TrizAssistantService from '#services/triz_assistant_service'
import {
  submitMessageValidator,
  listRunsValidator,
  runDetailValidator,
  feedbackValidator,
  previewValidator,
} from '#validators/triz_assistant_validator'
import type { AiTrizAssistantActorPermissions, AiTrizAssistantSourceKind } from '@aiproj/types'
import TrizAssistantPolicy from '#policies/triz_assistant_policy'

/**
 * AI-TRIZ 助手 Controller（v3-ai-triz-assistant §5.9–§5.10）。
 *
 * 薄控制器：只做 HTTP 解析、响应格式化和权限委托。
 * 业务逻辑全在 TrizAssistantService。
 */
export default class TrizAssistantController {
  private service = new TrizAssistantService()
  readonly #policy = new TrizAssistantPolicy()

  /**
   * GET /api/v1/projects/:projectId/triz/assistant/runs
   */
  async listRuns(ctx: HttpContext) {
    const { request, response, params } = ctx
    await this.#policy.view(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)

    const query = await request.validateUsing(listRunsValidator)
    const result = await this.service.listRuns(organizationId, projectId, query)

    return response.ok(result)
  }

  /**
   * GET /api/v1/projects/:projectId/triz/assistant/runs/:runId
   */
  async runDetail(ctx: HttpContext) {
    const { request, response, params } = ctx
    await this.#policy.view(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)

    const { runId } = await request.validateUsing(runDetailValidator)
    const detail = await this.service.getRunDetail(organizationId, projectId, runId)

    return response.ok({ data: detail })
  }

  /**
   * POST /api/v1/projects/:projectId/triz/assistant/submit
   */
  async submitMessage(ctx: HttpContext) {
    const { request, response, auth, params } = ctx
    await this.#policy.submit(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)
    const actorId = auth.user!.id

    const payload = await request.validateUsing(submitMessageValidator)

    const permissions: AiTrizAssistantActorPermissions = {
      canViewTriz: true,
      canManageTriz: true,
      // User 模型不带权限判定，统一走 Policy 上的 RbacService 判定链
      canTriggerAi: await this.#policy.canTriggerAi(ctx),
      sourcePermissions: {
        contradiction: true,
        contradiction_matrix: true,
        technical_contradiction_analysis: true,
        physical_contradiction_analysis: true,
        ifr_snapshot: true,
        function_analysis_snapshot: true,
        resource_analysis: true,
        evolution_trend_run: true,
        recommendation_rationale: true,
        innovation_workbench_scheme: true,
        decision_log: true,
        clarification_card: true,
        compiler_triz_artifact: true,
        draft_layer: true,
        knowledge_summary: true,
        skill_summary: true,
      } as Record<AiTrizAssistantSourceKind, boolean>,
    }

    const responseData = await this.service.submitMessage(
      organizationId,
      projectId,
      actorId,
      payload.message,
      permissions,
      {
        selectedSourceRefs: payload.selectedSourceRefs,
        idempotencyKey: payload.idempotencyKey,
        enableAi: payload.enableAi,
      },
    )

    return response.ok({ data: responseData })
  }

  /**
   * POST /api/v1/projects/:projectId/triz/assistant/runs/:runId/feedback
   */
  async recordFeedback(ctx: HttpContext) {
    const { request, response, auth, params } = ctx
    await this.#policy.feedback(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)
    const actorId = auth.user!.id

    const payload = await request.validateUsing(feedbackValidator)
    const feedback = await this.service.recordFeedback(
      organizationId,
      projectId,
      actorId,
      params.runId,
      payload.reason,
      payload.comment,
    )

    return response.ok({ data: feedback })
  }

  /**
   * POST /api/v1/projects/:projectId/triz/assistant/preview
   */
  async previewAction(ctx: HttpContext) {
    const { request, response, params } = ctx
    await this.#policy.preview(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)

    const payload = await request.validateUsing(previewValidator)
    const preview = await this.service.previewAction(
      organizationId,
      projectId,
      payload.actionId,
      payload.sourceHashes,
    )

    return response.ok({ data: preview })
  }
}
