import OrganizationDashboardPolicy from '#policies/organization_dashboard_policy'
import OrganizationDashboardService from '#services/organization_dashboard_service'
import {
  organizationDashboardParamsValidator,
  organizationDashboardQueryValidator,
  parseSectionsParam,
} from '#validators/organization_dashboard'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import type { OrganizationDashboardQuery } from '@aiproj/types'

/**
 * 组织 Dashboard Controller（v3-organization-dashboard §4.1）。
 *
 * 职责严格限定：认证 → 参数解析与校验 → Policy 调用 → 响应格式化。
 * 聚合口径、脱敏与降级逻辑全部在 `OrganizationDashboardService`。
 * 路由：`GET /api/v1/organizations/:organizationId/dashboard`
 */
@inject()
export default class OrganizationDashboardController {
  constructor(
    private dashboard: OrganizationDashboardService,
    private policy: OrganizationDashboardPolicy,
  ) {}

  /** GET /api/v1/organizations/:organizationId/dashboard */
  async show(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User

    const { organizationId } = await organizationDashboardParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    // 组织隔离先于权限判定：非成员不得推断组织或 Dashboard 是否存在。
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await organizationDashboardQueryValidator.validate({
      ...qs,
      sections: parseSectionsParam(qs.sections),
    })
    const query = validated as OrganizationDashboardQuery

    const access = await this.policy.resolveAccess(user, organizationId)
    const result = await this.dashboard.getSummary(user, organizationId, query, access)

    return ctx.response.ok({ data: result })
  }
}
