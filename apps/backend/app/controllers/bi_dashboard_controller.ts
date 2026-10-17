// v3-bi-dashboard-builder §6 — BI Dashboard Builder Controller。
// registry / list / current / detail / preview / create / update / copy / default / archive / restore。

import type { HttpContext } from '@adonisjs/core/http'
import type BiDashboardDefinitionService from '#services/bi_dashboard/definition_service'
import { getAuthorizedRegistry } from '#services/bi_dashboard/widget_registry'
import type BiDashboardPolicy from '#policies/bi_dashboard_policy'
import {
  biDashboardPreviewValidator,
  biDashboardCreateValidator,
  biDashboardUpdateValidator,
  biDashboardListValidator,
} from '#validators/bi_dashboard'
import type { BiDashboardGlobalFilter, BiDashboardWidgetInstance } from '@aiproj/types'

/**
 * vine 侧 `settings` 与 `value` 都是可选的（`vine.any()` 的输出类型天然含 undefined），
 * 而契约里 BiDashboardWidgetInstance.settings / BiDashboardGlobalFilter.value 均为必填。
 * 这里在进 Service 前补默认值：缺省 settings 视为空配置，缺省筛选值视为 null，
 * 而不是用 as 断言把契约缺口藏起来。
 */
function normalizeWidgets(
  widgets: Array<
    Omit<BiDashboardWidgetInstance, 'settings'> & { settings?: Record<string, unknown> }
  >,
): BiDashboardWidgetInstance[] {
  return widgets.map((w) => ({ ...w, settings: w.settings ?? {} }))
}

function normalizeGlobalFilters(
  filters?: Array<Omit<BiDashboardGlobalFilter, 'value'> & { value?: unknown }>,
): BiDashboardGlobalFilter[] | undefined {
  return filters?.map((f) => ({ ...f, value: f.value ?? null }))
}

export default class BiDashboardController {
  constructor(
    private readonly service: BiDashboardDefinitionService,
    private readonly policy: BiDashboardPolicy,
  ) {}

  // GET /api/v1/organizations/:organizationId/bi/dashboards/registry
  async registry({ params, auth, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.user!

    // 获取授权可见 registry
    const authorizedTags = new Set<string>()
    try {
      if (await this.policy.authorizeCreateShared(user, organizationId)) {
        authorizedTags.add('pmo')
        authorizedTags.add('bi_dashboard_manage')
      }
    } catch {
      /* no pmo */
    }
    authorizedTags.add('risk_view')

    const registry = getAuthorizedRegistry(authorizedTags)
    return response.ok({ data: Object.values(registry) })
  }

  // GET /api/v1/organizations/:organizationId/bi/dashboards
  async list({ params, auth, request, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.user!
    const query = await biDashboardListValidator.validate(request.qs())
    const result = await this.service.list(user, organizationId, query)
    return response.ok(result)
  }

  // GET /api/v1/organizations/:organizationId/bi/dashboards/current
  async current({ params, auth, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.user!
    const result = await this.service.getCurrent(user, organizationId)
    return response.ok(result)
  }

  // GET /api/v1/organizations/:organizationId/bi/dashboards/:id
  async detail({ params, auth, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const dashboardId = Number(params.id)
    const user = auth.user!
    const result = await this.service.getById(user, organizationId, dashboardId)
    return response.ok(result)
  }

  // POST /api/v1/organizations/:organizationId/bi/dashboards/preview
  async preview({ params, auth, request, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.user!
    const payload = await biDashboardPreviewValidator.validate(request.body())
    const result = await this.service.preview(user, organizationId, {
      ...payload,
      widgets: normalizeWidgets(payload.widgets),
      globalFilters: normalizeGlobalFilters(payload.globalFilters),
    })
    return response.ok({ data: result })
  }

  // POST /api/v1/organizations/:organizationId/bi/dashboards
  async create({ params, auth, request, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const user = auth.user!
    const payload = await biDashboardCreateValidator.validate(request.body())
    const result = await this.service.create(user, organizationId, {
      ...payload,
      widgets: normalizeWidgets(payload.widgets),
      globalFilters: normalizeGlobalFilters(payload.globalFilters),
    })
    return response.created(result)
  }

  // PUT /api/v1/organizations/:organizationId/bi/dashboards/:id
  async update({ params, auth, request, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const dashboardId = Number(params.id)
    const user = auth.user!
    const payload = await biDashboardUpdateValidator.validate(request.body())
    const result = await this.service.update(user, organizationId, dashboardId, {
      ...payload,
      widgets: normalizeWidgets(payload.widgets),
      globalFilters: normalizeGlobalFilters(payload.globalFilters),
    })
    return response.ok(result)
  }

  // POST /api/v1/organizations/:organizationId/bi/dashboards/:id/copy
  async copy({ params, auth, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const dashboardId = Number(params.id)
    const user = auth.user!
    const result = await this.service.copy(user, organizationId, dashboardId)
    return response.created(result)
  }

  // POST /api/v1/organizations/:organizationId/bi/dashboards/:id/set-default
  async setDefault({ params, auth, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const dashboardId = Number(params.id)
    const user = auth.user!
    const result = await this.service.setDefault(user, organizationId, dashboardId)
    return response.ok(result)
  }

  // POST /api/v1/organizations/:organizationId/bi/dashboards/:id/archive
  async archive({ params, auth, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const dashboardId = Number(params.id)
    const user = auth.user!
    const result = await this.service.archive(user, organizationId, dashboardId)
    return response.ok(result)
  }

  // POST /api/v1/organizations/:organizationId/bi/dashboards/:id/restore
  async restore({ params, auth, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const dashboardId = Number(params.id)
    const user = auth.user!
    const result = await this.service.restore(user, organizationId, dashboardId)
    return response.ok(result)
  }

  // DELETE /api/v1/organizations/:organizationId/bi/dashboards/:id
  async destroy({ params, auth, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    const dashboardId = Number(params.id)
    const user = auth.user!
    await this.service.delete(user, organizationId, dashboardId)
    return response.noContent()
  }
}
