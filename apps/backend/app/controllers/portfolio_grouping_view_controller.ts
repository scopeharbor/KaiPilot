import PortfolioGroupingViewService from '#services/portfolio_grouping_view_service'
import PortfolioGroupingViewPolicy from '#policies/portfolio_grouping_view_policy'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import {
  portfolioGroupingViewListValidator,
  portfolioGroupingViewPreviewValidator,
  portfolioGroupingViewCreateValidator,
  portfolioGroupingViewUpdateValidator,
  portfolioGroupingViewDuplicateValidator,
  portfolioGroupingViewSetDefaultValidator,
} from '#validators/portfolio_grouping_view'
import { PMO_GROUPING_VIEW_SCOPES, containsSensitiveContent, isSystemPresetId } from '@aiproj/types'

/**
 * PMO 组合分组视图 Controller（v3-pmo-portfolio-grouping-views §4.9）。
 *
 * 职责：HTTP 解析与响应格式化。业务逻辑在 PortfolioGroupingViewService。
 * 路由：/api/v1/pmo/grouping-views/*
 */
@inject()
export default class PortfolioGroupingViewController {
  constructor(
    private service: PortfolioGroupingViewService,
    private policy: PortfolioGroupingViewPolicy,
  ) {}

  // ─── List ──────────────────────────────────────────────────────────────

  /** GET /api/v1/pmo/grouping-views */
  async index(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    const query = await portfolioGroupingViewListValidator.validate(ctx.request.qs())
    const result = await this.service.list(user, organizationId, query as any)

    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  // ─── Detail ────────────────────────────────────────────────────────────

  /** GET /api/v1/pmo/grouping-views/:id */
  async show(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    const result = await this.service.detail(user, organizationId, ctx.params.id)
    if (!result) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '分组视图不存在' },
      })
    }

    return ctx.response.ok({ data: result })
  }

  // ─── Preview ───────────────────────────────────────────────────────────

  /** POST /api/v1/pmo/grouping-views/preview */
  async preview(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    // 敏感内容检查必须在原始请求体上做：Vine 校验会剥离未知字段，
    // 校验后的 body.query 已经看不到 projectResults/evidenceText 等禁止字段。
    const rawQuery = (ctx.request.body() as { query?: unknown }).query
    if (rawQuery !== undefined && containsSensitiveContent(rawQuery).found) {
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: '查询定义包含禁止的敏感内容字段' },
      })
    }

    const body = await portfolioGroupingViewPreviewValidator.validate(ctx.request.body())

    // 拒绝敏感内容（临时查询，双保险：校验后形状）
    if (body.query && containsSensitiveContent(body.query).found) {
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: '查询定义包含禁止的敏感内容字段' },
      })
    }

    const result = await this.service.preview(user, organizationId, body as any)
    if (!result) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '分组视图不存在或无权访问' },
      })
    }

    return ctx.response.ok({ data: result })
  }

  // ─── Create ────────────────────────────────────────────────────────────

  /** POST /api/v1/pmo/grouping-views */
  async store(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    const body = await portfolioGroupingViewCreateValidator.validate(ctx.request.body())

    // 拒绝敏感内容（原始请求体优先：Vine 已剥离的未知字段也要挡住）
    const rawQuery = (ctx.request.body() as { query?: unknown }).query
    if (
      (rawQuery !== undefined && containsSensitiveContent(rawQuery).found) ||
      containsSensitiveContent(body.query).found
    ) {
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: '查询定义包含禁止的敏感内容字段' },
      })
    }

    // 组织共享视图需要额外管理权限
    if (body.scope === PMO_GROUPING_VIEW_SCOPES.ORGANIZATION) {
      await this.policy.authorizeManage(user, organizationId)
    }

    // 系统 preset 不可创建
    if (body.scope === PMO_GROUPING_VIEW_SCOPES.SYSTEM) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '不可创建系统预设视图' },
      })
    }

    const result = await this.service.create(user, organizationId, body as any)

    return ctx.response.created({ data: result })
  }

  // ─── Update ────────────────────────────────────────────────────────────

  /** PUT /api/v1/pmo/grouping-views/:id */
  async update(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    const body = await portfolioGroupingViewUpdateValidator.validate(ctx.request.body())

    // 拒绝敏感内容（原始请求体优先，同 store）
    const rawQuery = (ctx.request.body() as { query?: unknown }).query
    if (
      (rawQuery !== undefined && containsSensitiveContent(rawQuery).found) ||
      (body.query && containsSensitiveContent(body.query).found)
    ) {
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: '查询定义包含禁止的敏感内容字段' },
      })
    }

    // 防止更新系统预设
    if (isSystemPresetId(ctx.params.id)) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '系统预设视图不可修改' },
      })
    }

    const result = await this.service.update(user, organizationId, ctx.params.id, body as any)
    if (!result) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '分组视图不存在' },
      })
    }

    return ctx.response.ok({ data: result })
  }

  // ─── Delete ────────────────────────────────────────────────────────────

  /** DELETE /api/v1/pmo/grouping-views/:id */
  async destroy(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    // 防止删除系统预设
    if (isSystemPresetId(ctx.params.id)) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '系统预设视图不可删除' },
      })
    }

    const deleted = await this.service.delete(user, organizationId, ctx.params.id)
    if (!deleted) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '分组视图不存在' },
      })
    }

    return ctx.response.noContent()
  }

  // ─── Duplicate ─────────────────────────────────────────────────────────

  /** POST /api/v1/pmo/grouping-views/:id/duplicate */
  async duplicate(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    const body = await portfolioGroupingViewDuplicateValidator.validate(ctx.request.body())

    const result = await this.service.duplicate(user, organizationId, ctx.params.id, body.name)
    if (!result) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '源分组视图不存在' },
      })
    }

    return ctx.response.created({ data: result })
  }

  // ─── Set Default ───────────────────────────────────────────────────────

  /** POST /api/v1/pmo/grouping-views/:id/set-default */
  async setDefault(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    const body = await portfolioGroupingViewSetDefaultValidator.validate(ctx.request.body())

    // 系统预设不可设为默认
    if (isSystemPresetId(ctx.params.id)) {
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: '系统预设视图不可设为默认视图' },
      })
    }

    const result = await this.service.setDefault(user, organizationId, ctx.params.id, body.scope)
    if (!result) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '分组视图不存在' },
      })
    }

    return ctx.response.ok({ data: result })
  }
}
