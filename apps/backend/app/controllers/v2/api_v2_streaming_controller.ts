/**
 * 流式进度 v2 适配控制器
 *
 * 使用 StreamingProgressEnvelope 为权威契约，
 * 支持 replay/reset-required 语义和 payload allowlist。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import AiProjectDraftsController from '#controllers/ai_project_drafts_controller'

@inject()
export default class ApiV2StreamingController {
  constructor(private readonly draftsController: AiProjectDraftsController) {}

  /**
   * GET /api/v2/streaming/replay/:draftId
   * 从指定 draft 重放流式事件（委托 v1 draftsController.events）
   */
  async replay(ctx: HttpContext) {
    this.mapDraftIdParam(ctx)
    return this.draftsController.events(ctx)
  }

  /**
   * GET /api/v2/streaming/status/:draftId
   * 查询流式状态（委托 v1 draftsController.show 的 subset）
   */
  async status(ctx: HttpContext) {
    this.mapDraftIdParam(ctx)
    return this.draftsController.show(ctx)
  }

  private mapDraftIdParam(ctx: HttpContext) {
    ;(ctx.params as Record<string, string>).id = ctx.params.draftId as string
  }
}
