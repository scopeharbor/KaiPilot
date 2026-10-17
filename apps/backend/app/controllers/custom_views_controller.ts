import CustomViewService from '#services/custom_view_service'
import {
  cloneCustomViewValidator,
  createCustomViewValidator,
  reorderCustomViewsValidator,
  updateCustomViewValidator,
} from '#validators/custom_view'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import type { AuthContext } from '#types/auth'
import type {
  CreateCustomViewRequest,
  CustomViewBaseType,
  CustomViewConfig,
  UpdateCustomViewRequest,
} from '@aiproj/types'
import { validateCustomViewConfig } from '#validators/custom_view_config_validator'

/**
 * CustomViewsController —— 自定义视图 CRUD + 克隆 + 排序入口（v2-custom-views-view-config）。
 *
 * 路由前缀：/api/v1/projects/:projectId/custom-views
 * 组织上下文由 tenant 中间件注入（ctx.tenant.organizationId）。
 * 行级权限由 CustomViewPolicy 在 Service 层判定。
 */
@inject()
export default class CustomViewsController {
  constructor(private customViews: CustomViewService) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private requestContext(ctx: HttpContext): AuthContext {
    return {
      ip: ctx.request.ip(),
      userAgent: ctx.request.header('user-agent'),
      requestId: ctx.request.id() ?? null,
    }
  }

  private normalizeConfig(
    config: Partial<CustomViewConfig>,
    fallbackBaseViewType: CustomViewBaseType,
  ): CustomViewConfig {
    return {
      schemaVersion: config.schemaVersion ?? 1,
      baseViewType: config.baseViewType ?? fallbackBaseViewType,
      filters: config.filters ?? {},
      sort: config.sort ?? [],
      display: config.display ?? {},
      scope: config.scope ?? {},
      state: config.state ?? {},
    }
  }

  /**
   * GET /projects/:projectId/custom-views
   * 列出项目的个人和共享自定义视图。
   */
  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)

    const result = await this.customViews.list(
      user,
      this.requestContext(ctx),
      organizationId,
      projectId,
    )
    return ctx.response.ok({ data: result })
  }

  /**
   * GET /projects/:projectId/custom-views/:viewId
   * 获取单个自定义视图详情。
   */
  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const viewId = Number(ctx.params.viewId)

    const view = await this.customViews.show(
      user,
      this.requestContext(ctx),
      organizationId,
      projectId,
      viewId,
    )
    return ctx.response.ok({ data: view })
  }

  /**
   * POST /projects/:projectId/custom-views
   * 创建自定义视图。
   */
  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createCustomViewValidator)
    const rawConfig = ctx.request.input('config') as unknown
    validateCustomViewConfig(rawConfig, input.baseViewType)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)

    const data: CreateCustomViewRequest = {
      ...input,
      config: this.normalizeConfig(rawConfig as Partial<CustomViewConfig>, input.baseViewType),
    }

    const view = await this.customViews.create(
      user,
      this.requestContext(ctx),
      organizationId,
      projectId,
      data,
    )
    return ctx.response.created({ data: view })
  }

  /**
   * PATCH /projects/:projectId/custom-views/:viewId
   * 更新自定义视图（名称/配置/可见性）。
   */
  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateCustomViewValidator)
    const rawConfig = ctx.request.input('config') as unknown
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const viewId = Number(ctx.params.viewId)

    const data: UpdateCustomViewRequest = {
      ...input,
      config: rawConfig
        ? this.normalizeConfig(
            rawConfig as Partial<CustomViewConfig>,
            input.config?.baseViewType ?? 'kanban',
          )
        : undefined,
    }

    const view = await this.customViews.update(
      user,
      this.requestContext(ctx),
      organizationId,
      projectId,
      viewId,
      data,
    )
    return ctx.response.ok({ data: view })
  }

  /**
   * DELETE /projects/:projectId/custom-views/:viewId
   * 软删除自定义视图。
   */
  async destroy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const viewId = Number(ctx.params.viewId)

    await this.customViews.destroy(
      user,
      this.requestContext(ctx),
      organizationId,
      projectId,
      viewId,
    )
    return ctx.response.noContent()
  }

  /**
   * POST /projects/:projectId/custom-views/:viewId/clone
   * 将共享视图复制为当前用户的个人视图。
   */
  async clone(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(cloneCustomViewValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const viewId = Number(ctx.params.viewId)

    const view = await this.customViews.clone(
      user,
      this.requestContext(ctx),
      organizationId,
      projectId,
      viewId,
      input.name,
    )
    return ctx.response.created({ data: view })
  }

  /**
   * PUT /projects/:projectId/custom-views/reorder
   * 更新当前用户的个人视图排序。
   */
  async reorder(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(reorderCustomViewsValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)

    await this.customViews.reorder(
      user,
      this.requestContext(ctx),
      organizationId,
      projectId,
      input.viewIds,
    )
    return ctx.response.ok({ message: '排序已更新' })
  }

  /**
   * PUT /projects/:projectId/custom-views/:viewId/default
   * 将指定视图设为当前用户的默认视图。
   */
  async setDefault(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const viewId = Number(ctx.params.viewId)

    await this.customViews.setDefault(
      user,
      this.requestContext(ctx),
      organizationId,
      projectId,
      viewId,
    )
    return ctx.response.ok({ message: '默认视图已更新' })
  }
}
