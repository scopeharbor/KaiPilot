import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import User from '#models/user'
import CopilotWebSearchSettingsService, {
  CopilotWebSearchPermissionDeniedError,
} from '#services/copilot_web_search/settings_service'
import CopilotWebSearchPolicy from '#policies/copilot_web_search_policy'
import { updateCopilotWebSearchSettingsValidator } from '#validators/copilot_web_search'
import { PermissionDeniedException } from '#exceptions/api_exception'

/**
 * Copilot 网页搜索工具设置控制器（v3-copilot-optional-web-search-configuration）。
 *
 * 只做 HTTP 解析与权限校验；GET 返回低敏投影（configured + masked label，无 credential）；
 * PUT 需要 `copilot:web_search:manage`；status 追加今日配额与 provider 状态。
 */
@inject()
export default class CopilotWebSearchSettingsController {
  constructor(
    private settings: CopilotWebSearchSettingsService,
    private policy: CopilotWebSearchPolicy,
  ) {}

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private async authorizeManage(user: User, organizationId: number) {
    const allowed = await this.policy.manage(user, organizationId)
    if (!allowed) throw new PermissionDeniedException('无权管理 Copilot 网页搜索设置')
  }

  /** GET /api/v1/settings/copilot-tools/web-search —— 低敏投影（读不需要 manage 权限）。 */
  async show(ctx: HttpContext) {
    const organizationId = this.orgIdOf(ctx)
    const summary = await this.settings.buildSummary(organizationId)
    return ctx.response.ok({ data: summary })
  }

  /** PUT /api/v1/settings/copilot-tools/web-search —— 部分更新（需管理权限）。 */
  async update(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = this.orgIdOf(ctx)
    await this.authorizeManage(user, organizationId)
    const input = await ctx.request.validateUsing(updateCopilotWebSearchSettingsValidator)
    const summary = await this.settings.updateSettings(user, organizationId, input)
    return ctx.response.ok({ data: summary })
  }

  /** GET /api/v1/settings/copilot-tools/web-search/status —— 状态检查（含今日配额与 provider）。 */
  async status(ctx: HttpContext) {
    const organizationId = this.orgIdOf(ctx)
    const summary = await this.settings.buildSummary(organizationId)
    const quota = await this.settings.readQuota(organizationId)
    return ctx.response.ok({
      data: {
        ...summary,
        quota: {
          usedToday: quota.currentCount,
          limitToday: summary.dailyQueryLimit,
          remainingToday: Math.max(0, summary.dailyQueryLimit - quota.currentCount),
        },
      },
    })
  }
}

export { CopilotWebSearchPermissionDeniedError as CopilotWebSearchSettingsPermissionDeniedError }
