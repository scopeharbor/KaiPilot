import { inject } from '@adonisjs/core'
import OrganizationSelectionService from '#services/organization_selection_service'
import { organizationSelectionValidator } from '#validators/organization_selection'
import { resolveCacheStore } from '#services/cache/cache_factory'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * 组织选择控制器（v3-multitenant-tenant-identification §4.1）。
 *
 * 受保护路由（`middleware.auth()`）：
 *   - `GET  /api/v1/account/organization-selection`  读当前有效租户上下文（前端 §8.1 消费）
 *   - `POST /api/v1/account/organization-selection`  显式切换 active organization
 *
 * 仅做 HTTP 解析与响应格式化；成员校验、selection 持久化、旧句柄失效、token 刷新与审计
 * 全部下沉到 `OrganizationSelectionService`。
 *
 * 响应体只含低敏字段（effective tenant context / scope hash / epoch / 失效报告）：
 * 不含组织名称、隐藏资源信息、权限全集或原始 refresh token。
 */
@inject()
export default class OrganizationSelectionController {
  constructor(private selectionService: OrganizationSelectionService) {}

  /**
   * GET /api/v1/account/organization-selection
   */
  async show(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const result = await this.selectionService.current(
      user,
      user.roleVersion,
      // token claim 作为回落：用户可能尚未调用过切换端点（首次登录 / 旧 token）。
      ctx.authPayload?.organizationId ?? null,
    )

    return ctx.response.ok({
      data: {
        effectiveContext: result.effectiveContext,
        scopeHash: result.effectiveContext.scopeHash,
        selectionEpoch: result.selectionEpoch,
        resolved: result.ok,
      },
    })
  }

  /**
   * POST /api/v1/account/organization-selection
   */
  async store(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const payload = await ctx.request.validateUsing(organizationSelectionValidator)

    const outcome = await this.selectionService.select({
      user,
      targetOrganizationId: payload.organizationId,
      previousScopeHash: payload.previousScopeHash ?? null,
      requestId: ctx.request.id() ?? 'unknown',
      cache: await this.cacheOrNull(),
    })

    return ctx.response.ok({
      data: {
        effectiveContext: outcome.effectiveContext,
        scopeHash: outcome.scopeHash,
        accessToken: outcome.accessToken,
        selectionEpoch: outcome.selectionEpoch,
        invalidation: outcome.invalidation,
      },
    })
  }

  /**
   * 缓存后端解析失败不阻断切换：清理降级为 `degraded`，隔离仍由 epoch 栅栏保证
   *（§4.3 的不变量是「降级只损失清理彻底性，不损失隔离」）。
   */
  private async cacheOrNull() {
    try {
      return await resolveCacheStore()
    } catch {
      return null
    }
  }
}
