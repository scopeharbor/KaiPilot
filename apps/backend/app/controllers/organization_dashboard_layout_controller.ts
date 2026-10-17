import OrganizationDashboardLayoutService from '#services/organization_dashboard_layout_service'
import {
  layoutCopyValidator,
  layoutIdParamsValidator,
  layoutPayloadValidator,
  layoutPreviewValidator,
  layoutSetDefaultValidator,
  organizationDashboardLayoutParamsValidator,
} from '#validators/organization_dashboard_layout'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import type { OrganizationDashboardLayoutPayload } from '@aiproj/types'

/**
 * 组织 Dashboard 布局编排 Controller（v3-organization-dashboard-layout-builder §4.1）。
 *
 * 职责严格限定：认证 → 参数解析与校验 → Service 调用 → 响应格式化。
 * 所有布局验证、权限判定、审计与默认策略逻辑在 Service 层。
 */
@inject()
export default class OrganizationDashboardLayoutController {
  constructor(private readonly service: OrganizationDashboardLayoutService) {}

  private getUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private async getOrgId(ctx: HttpContext): Promise<number> {
    const { organizationId } = await organizationDashboardLayoutParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })
    return organizationId
  }

  /** GET /api/v1/organizations/:organizationId/dashboard/layouts */
  async index(ctx: HttpContext) {
    const user = this.getUser(ctx)
    const organizationId = await this.getOrgId(ctx)
    const result = await this.service.list(user, organizationId)
    return ctx.response.ok(result)
  }

  /** GET /api/v1/organizations/:organizationId/dashboard/layouts/current */
  async current(ctx: HttpContext) {
    const user = this.getUser(ctx)
    const organizationId = await this.getOrgId(ctx)
    const result = await this.service.getCurrent(user, organizationId)
    return ctx.response.ok({ data: result })
  }

  /** GET /api/v1/organizations/:organizationId/dashboard/layouts/:layoutId */
  async show(ctx: HttpContext) {
    const user = this.getUser(ctx)
    const { organizationId, layoutId } = await layoutIdParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      layoutId: ctx.params.layoutId,
    })
    const result = await this.service.getById(user, organizationId, layoutId)
    return ctx.response.ok({ data: result })
  }

  /** POST /api/v1/organizations/:organizationId/dashboard/layouts/preview */
  async preview(ctx: HttpContext) {
    const user = this.getUser(ctx)
    const organizationId = await this.getOrgId(ctx)
    const payload = (await layoutPreviewValidator.validate(
      ctx.request.body(),
    )) as OrganizationDashboardLayoutPayload
    const result = await this.service.preview(user, organizationId, payload)
    return ctx.response.ok({ data: result })
  }

  /** POST /api/v1/organizations/:organizationId/dashboard/layouts/personal */
  async savePersonal(ctx: HttpContext) {
    const user = this.getUser(ctx)
    const organizationId = await this.getOrgId(ctx)
    const payload = (await layoutPayloadValidator.validate(
      ctx.request.body(),
    )) as OrganizationDashboardLayoutPayload
    const result = await this.service.savePersonal(user, organizationId, payload)
    return ctx.response.created({ data: result })
  }

  /** POST /api/v1/organizations/:organizationId/dashboard/layouts/shared */
  async saveShared(ctx: HttpContext) {
    const user = this.getUser(ctx)
    const organizationId = await this.getOrgId(ctx)
    const payload = (await layoutPayloadValidator.validate(
      ctx.request.body(),
    )) as OrganizationDashboardLayoutPayload
    const result = await this.service.saveShared(user, organizationId, payload)
    return ctx.response.created({ data: result })
  }

  /** POST /api/v1/organizations/:organizationId/dashboard/layouts/:layoutId/copy */
  async copy(ctx: HttpContext) {
    const user = this.getUser(ctx)
    const { organizationId, layoutId } = await layoutIdParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      layoutId: ctx.params.layoutId,
    })
    const { name, scope } = (await layoutCopyValidator.validate(ctx.request.body())) as {
      name?: string
      scope?: string
    }
    const result = await this.service.copy(
      user,
      organizationId,
      layoutId,
      (scope as 'personal' | 'shared' | undefined) ?? 'personal',
      name,
    )
    return ctx.response.created({ data: result })
  }

  /** PUT /api/v1/organizations/:organizationId/dashboard/layouts/:layoutId/default */
  async setDefault(ctx: HttpContext) {
    const user = this.getUser(ctx)
    const { organizationId, layoutId } = await layoutIdParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      layoutId: ctx.params.layoutId,
    })
    const { expectedVersion } = (await layoutSetDefaultValidator.validate(ctx.request.body())) as {
      expectedVersion?: number
    }
    const result = await this.service.setDefault(user, organizationId, layoutId, expectedVersion)
    return ctx.response.ok({ data: result })
  }

  /** POST /api/v1/organizations/:organizationId/dashboard/layouts/reset */
  async reset(ctx: HttpContext) {
    const user = this.getUser(ctx)
    const organizationId = await this.getOrgId(ctx)
    const result = await this.service.reset(user, organizationId)
    return ctx.response.ok({ data: result })
  }

  /** DELETE /api/v1/organizations/:organizationId/dashboard/layouts/:layoutId */
  async destroy(ctx: HttpContext) {
    const user = this.getUser(ctx)
    const { organizationId, layoutId } = await layoutIdParamsValidator.validate({
      organizationId: ctx.params.organizationId,
      layoutId: ctx.params.layoutId,
    })
    await this.service.delete(user, organizationId, layoutId)
    return ctx.response.noContent()
  }
}
