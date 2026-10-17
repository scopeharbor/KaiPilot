/**
 * v2-5-compiler-cache-management-api（tasks 3.3/4.2/5.3）—— CompilerCacheController。
 *
 * HTTP 入口，只处理请求解析、权限校验、响应格式化；业务逻辑下沉到 CompilerCacheService。
 *
 * 切片 1：GET /cache（只读盘点，无副作用）
 * 切片 2：POST /cache/invalidation/preview（只读失效预览，no-delete/no-execute）
 * 切片 3：POST /cache/invalidation（受控失效写入，需显式确认 + 审计）
 *
 * 红线：只盘点与失效缓存加速层；绝不删业务数据/artifact、绝不触发 Compiler run、
 * 绝不 apply artifact、绝不绕过 RBAC/组织隔离/预览/确认/审计。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import CompilerCachePolicy from '#policies/compiler_cache_policy'
import {
  getCacheInventory,
  previewCacheInvalidation,
  invalidateCache,
} from '#services/compiler/compiler_cache_service'
import {
  validateOptionalStageIdQuery,
  validateInvalidationPreviewRequest,
  validateInvalidationRequest,
} from '#validators/compiler_cache_validator'

@inject()
export default class CompilerCacheController {
  constructor(private readonly policy: CompilerCachePolicy) {}

  // ── 切片 1：只读盘点 ──

  /** GET /api/v1/ai/compiler/cache —— 组织范围缓存盘点（可 ?stageId= 细分）。 */
  async getInventory(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canViewCache(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const stageId = validateOptionalStageIdQuery(ctx)
    if (stageId === null) return

    const inventory = await getCacheInventory(tenant.organizationId, stageId)
    return response.ok({ data: inventory })
  }

  // ── 切片 2：只读失效预览 ──

  /** POST /api/v1/ai/compiler/cache/invalidation/preview —— 失效预览（只读，不删不执行）。 */
  async previewInvalidation(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canViewCache(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const body = validateInvalidationPreviewRequest(ctx)
    if (!body) return // validator 已写 VALIDATION_ERROR 响应

    const preview = await previewCacheInvalidation(tenant.organizationId, {
      scope: body.scope,
      stageId: body.stageId,
      cachePolicyVersion: body.cachePolicyVersion,
    })
    return response.ok({ data: preview })
  }

  // ── 切片 3：受控失效写入 ──

  /** POST /api/v1/ai/compiler/cache/invalidation —— 受控按范围失效（需显式确认 + 审计）。 */
  async invalidate(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canManageCache(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const body = validateInvalidationRequest(ctx)
    if (!body) return // validator 已写 VALIDATION_ERROR 响应

    try {
      const result = await invalidateCache(tenant.organizationId, authUser.id, {
        scope: body.scope,
        stageId: body.stageId,
        cachePolicyVersion: body.cachePolicyVersion,
        confirm: body.confirm,
      })
      return response.ok({ data: result })
    } catch (error) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: (error as Error).message },
      })
    }
  }
}
