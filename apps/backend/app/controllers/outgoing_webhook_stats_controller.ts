/**
 * v2-5-webhook-templates-and-stats -- 出站 webhook 投递统计 HTTP 层（4.3 P0）。
 *
 * GET /api/v1/outgoing-webhook-stats
 * 受 auth + outgoing_webhook:manage Policy + 组织隔离门控。
 * 默认禁用（OUTGOING_WEBHOOK_STATS_ENABLED=false），禁用时返回 deterministic 不可用态。
 * 错误统一 `{error:{code,message,details?}}`。
 */
import { OutgoingWebhookStatsService } from '#services/webhooks/outgoing_webhook_stats_service'
import OutgoingWebhookTemplatePolicy from '#policies/outgoing_webhook_template_policy'
import User from '#models/user'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class OutgoingWebhookStatsController {
  constructor(
    private stats: OutgoingWebhookStatsService,
    private policy: OutgoingWebhookTemplatePolicy,
  ) {}

  private async actor(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    const allowed = await this.policy.manage(user, Number(orgId))
    if (!allowed) {
      throw new PermissionDeniedException('无权查看出站 webhook 统计')
    }
    return { userId: Number(user.id), organizationId: Number(orgId) }
  }

  /**
   * GET /api/v1/outgoing-webhook-stats
   * 查询参数：
   *   startDate (optional) - ISO date, 默认 30 天前
   *   endDate (optional) - ISO date, 默认当前时间
   */
  async index(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const qs = ctx.request.qs()
    const startDate = qs.startDate as string | undefined
    const endDate = qs.endDate as string | undefined

    // 基本日期格式校验
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new ValidationException('startDate 格式无效，应为 YYYY-MM-DD')
    }
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new ValidationException('endDate 格式无效，应为 YYYY-MM-DD')
    }

    const result = await this.stats.getStats(actor.organizationId, startDate, endDate)
    return ctx.response.ok({ data: result })
  }
}
