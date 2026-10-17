import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OkrDashboardService from '#services/okr_dashboard_service'
import {
  okrDashboardParamsValidator,
  okrDashboardQueryValidator,
  parseOkrDashboardListParam,
  validateOkrDashboardDateWindow,
} from '#validators/okr_dashboard'
import { ValidationException } from '#exceptions/api_exception'
import type {
  OkrDashboardAttentionSortKey,
  OkrDashboardInclude,
  OkrDashboardQuery,
  OkrDashboardSection,
  OkrScope,
  OkrStatus,
} from '@aiproj/types'

/**
 * OkrDashboardController —— v3-okr-dashboard §3.7。
 *
 * Controller 只做：路由参数校验、query 归一化、调用 service、格式化响应。
 * 不写业务逻辑；不直接查库；错误统一由 `ApiException` 处理器格式化为 `{ error: { code, message, details? } }`。
 */
@inject()
export default class OkrDashboardController {
  constructor(private readonly service: OkrDashboardService) {}

  async summary({ request, response, auth }: HttpContext) {
    const params = await okrDashboardParamsValidator.validate(request.params())
    const organizationId = params.organizationId

    const rawQs = request.qs()
    const preNormalized: Record<string, unknown> = {
      ...rawQs,
      sections: parseOkrDashboardListParam(rawQs.sections),
      include: parseOkrDashboardListParam(rawQs.include),
      scope: parseOkrDashboardListParam(rawQs.scope),
      status: parseOkrDashboardListParam(rawQs.status),
    }

    const validated = (await okrDashboardQueryValidator.validate(preNormalized)) as Record<
      string,
      unknown
    >

    const windowError = validateOkrDashboardDateWindow(
      validated.dateFrom as string | undefined,
      validated.dateTo as string | undefined,
    )
    if (windowError) throw new ValidationException(windowError)

    const query: OkrDashboardQuery = {
      cycleId: validated.cycleId as number | undefined,
      ownerId: validated.ownerId as number | undefined,
      scope: validated.scope as OkrScope[] | undefined,
      status: validated.status as OkrStatus[] | undefined,
      sections: validated.sections as OkrDashboardSection[] | undefined,
      include: validated.include as OkrDashboardInclude[] | undefined,
      attentionLimit: validated.attentionLimit as number | undefined,
      attentionSort: validated.attentionSort as OkrDashboardAttentionSortKey | undefined,
      attentionOrder: validated.attentionOrder as 'asc' | 'desc' | undefined,
      staleThresholdMinutes: validated.staleThresholdMinutes as number | undefined,
      dateFrom: validated.dateFrom as string | undefined,
      dateTo: validated.dateTo as string | undefined,
      search: validated.search as string | undefined,
    }

    const result = await this.service.getSummary(organizationId, query, auth.user!)
    return response.json(result)
  }
}
