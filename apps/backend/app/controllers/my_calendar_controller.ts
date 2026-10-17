import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import MyCalendarService from '#services/calendar/my_calendar_service'
import PersonalCalendarService from '#services/calendar/personal_calendar_service'
import { isWindowTooLarge } from '#services/calendar/calendar_item_mapper'
import {
  myCalendarQueryValidator,
  personalCalendarUpdateValidator,
} from '#validators/personal_calendar'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'

/**
 * 日历第 3 批：「我的日历」（跨项目）与个人工作日历（休假 / 个人工作日）。都只涉及当前用户自己。
 */
@inject()
export default class MyCalendarController {
  constructor(
    private myCalendar: MyCalendarService,
    private personal: PersonalCalendarService,
  ) {}

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  /** GET /api/v1/me/calendar?dateFrom=&dateTo= */
  async index(ctx: HttpContext) {
    const { dateFrom, dateTo } = await myCalendarQueryValidator.validate(ctx.request.qs())
    if (dateFrom > dateTo) throw new ValidationException('开始日期不能晚于结束日期')
    if (isWindowTooLarge(dateFrom, dateTo)) throw new ValidationException('查询区间过长')
    const user = ctx.auth.getUserOrFail() as User
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const data = await this.myCalendar.list(user, this.orgIdOf(ctx), dateFrom, dateTo, today)
    return ctx.response.ok(data)
  }

  /** GET /api/v1/me/working-calendar */
  async showWorkingCalendar(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    return ctx.response.ok({ data: this.personal.get(user) })
  }

  /** PUT /api/v1/me/working-calendar  { workdays, leaves } */
  async updateWorkingCalendar(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(personalCalendarUpdateValidator)
    const user = ctx.auth.getUserOrFail() as User
    const data = await this.personal.update(user, this.orgIdOf(ctx), input, {
      requestId: ctx.request.id() ?? undefined,
    })
    return ctx.response.ok({ data })
  }
}
