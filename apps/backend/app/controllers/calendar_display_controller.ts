import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import CalendarDisplayService from '#services/calendar/calendar_display_service'
import {
  calendarDisplayQueryValidator,
  calendarDisplayUpdateValidator,
} from '#validators/calendar_display'
import { PermissionDeniedException } from '#exceptions/api_exception'

/**
 * 日历曆法显示设定：GET 生效值与各层原值；PUT 改某一层（个人 / 项目 / 组织，按权限）。
 */
@inject()
export default class CalendarDisplayController {
  constructor(private service: CalendarDisplayService) {}

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  /** GET /api/v1/settings/calendar-display?projectId= */
  async show(ctx: HttpContext) {
    const { projectId } = await calendarDisplayQueryValidator.validate(ctx.request.qs())
    const user = ctx.auth.getUserOrFail() as User
    const data = await this.service.resolve(user, this.orgIdOf(ctx), projectId ?? null)
    return ctx.response.ok({ data })
  }

  /** PUT /api/v1/settings/calendar-display  { layer, projectId?, systems | null } */
  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(calendarDisplayUpdateValidator)
    const user = ctx.auth.getUserOrFail() as User
    const data = await this.service.update(
      user,
      this.orgIdOf(ctx),
      input.layer,
      input.systems,
      input.projectId ?? null,
      { requestId: ctx.request.id() ?? undefined },
    )
    return ctx.response.ok({ data })
  }
}
