/**
 * v2-5-compiler-config-management-api（tasks 2.3/3.2/4.3）—— CompilerConfigController。
 *
 * HTTP 入口，只处理请求解析、权限校验、响应格式化。
 * 业务逻辑下沉到 CompilerConfigService。
 *
 * 切片 1：GET /config, GET /config/profile
 * 切片 2：POST /config/preview
 * 切片 3：POST /config, PATCH /config/activate
 *
 * 红线：配置只影响 Compiler 运行态（预算/缓存/开关），绝不自动 apply artifact、
 * 绝不写正式项目数据、绝不绕过 RBAC/组织隔离/Preview/Diff/人工确认/审计。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import CompilerConfigPolicy from '#policies/compiler_config_policy'
import {
  getEffectiveConfig,
  getProfileHistory,
  previewConfig,
  createConfigProfile,
  activateConfigProfile,
} from '#services/compiler/compiler_config_service'
import type {
  BudgetPolicyInput,
  CompilerCachePolicy,
  CompilerFeatureToggles,
} from '@aiproj/types/compiler-config-management'

@inject()
export default class CompilerConfigController {
  constructor(private readonly policy: CompilerConfigPolicy) {}

  // ── 切片 1：只读解析 ──

  /** GET /api/v1/ai/compiler/config —— 生效配置。 */
  async getEffective(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canViewConfig(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const config = await getEffectiveConfig(tenant.organizationId)
    return response.ok({ data: config })
  }

  /** GET /api/v1/ai/compiler/config/profile —— 原始 profile + 版本历史。 */
  async getProfile(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canViewConfig(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const history = await getProfileHistory(tenant.organizationId)
    return response.ok({ data: history })
  }

  // ── 切片 2：只读 preview / 差异 ──

  /** POST /api/v1/ai/compiler/config/preview —— 预览配置改动（只读）。 */
  async preview(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canViewConfig(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const body = ctx.request.body()
    const preview = await previewConfig(tenant.organizationId, body)
    return response.ok({ data: preview })
  }

  // ── 切片 3：受控编排写入 ──

  /** POST /api/v1/ai/compiler/config —— 创建/新版本配置（需显式确认）。 */
  async create(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canManageConfig(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const body = ctx.request.body() as Record<string, unknown>
    const confirm = body.confirm === true
    const input = {
      featureToggles: body.featureToggles as CompilerFeatureToggles | undefined,
      budgetPolicies: body.budgetPolicies as BudgetPolicyInput[] | undefined,
      cachePolicy: body.cachePolicy as CompilerCachePolicy | undefined,
      confirm,
    }

    try {
      const committed = await createConfigProfile(tenant.organizationId, authUser.id, input)
      return response.ok({ data: committed })
    } catch (error) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: (error as Error).message },
      })
    }
  }

  /** PATCH /api/v1/ai/compiler/config/activate —— 启用/停用版本。 */
  async activate(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canManageConfig(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const body = ctx.request.body() as Record<string, unknown>
    const version = Number(body.version)
    const active = body.active === true
    const confirm = body.confirm === true

    if (!Number.isInteger(version) || version <= 0) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid version' },
      })
    }

    try {
      const committed = await activateConfigProfile(
        tenant.organizationId,
        authUser.id,
        version,
        active,
        confirm,
      )
      return response.ok({ data: committed })
    } catch (error) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: (error as Error).message },
      })
    }
  }
}
