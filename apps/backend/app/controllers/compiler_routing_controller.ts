/**
 * v2-5-compiler-dynamic-routing-management-ui（tasks 3.5/4.3/5.9）—— CompilerRoutingController。
 *
 * HTTP 入口，只处理请求解析、权限校验、响应格式化。
 * 业务逻辑下沉到 CompilerRoutingService。
 *
 * 切片 A：GET .../routing/rules, GET .../runs/:id/routing-decision
 * 切片 C：POST .../routing/simulate
 * 切片 B：POST/PATCH .../routing/rules（预览与确认两步）
 *
 * 红线：路由管理控制台绝不写正式项目数据、绝不自动 apply artifact。
 * 跨组织访问返回 not-found，不泄漏存在性。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import CompilerRoutingPolicy from '#policies/compiler_routing_policy'
import {
  getRegistrySnapshot,
  getRunRoutingDecision,
  simulate,
  buildRulePreview,
  confirmAndCommitRule,
} from '#services/compiler/dynamic-routing/compiler_routing_service'
import {
  validateSimulateRequest,
  validateRuleAuthoringRequest,
  validateRuleConfirmRequest,
} from '#validators/compiler_routing_validator'
import { CompilerRunService } from '#services/compiler/compiler_run_service'

@inject()
export default class CompilerRoutingController {
  constructor(
    private readonly policy: CompilerRoutingPolicy,
    private readonly compilerService: CompilerRunService,
  ) {}

  // ── 切片 A：只读观测 ──

  /** GET /api/v1/ai/compiler/routing/rules —— 注册表快照。 */
  async getRules(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canViewRouting(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const snapshot = await getRegistrySnapshot(tenant.organizationId)
    return response.ok({ data: snapshot })
  }

  /** GET /api/v1/ai/compiler/runs/:id/routing-decision —— per-run 决策证据。 */
  async getRunRoutingDecision(ctx: HttpContext) {
    const { response, authUser, tenant, params } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canViewRouting(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const runId = Number(params.id)
    if (!Number.isInteger(runId) || runId <= 0) {
      return response.badRequest({ error: { code: 'VALIDATION_ERROR', message: 'Invalid run ID' } })
    }

    // 组织隔离：先确认 run 存在且属于本组织
    const run = await this.compilerService.getRun(tenant.organizationId, runId)
    if (!run) {
      return response.notFound({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Run not found' } })
    }

    const decisionView = await getRunRoutingDecision(tenant.organizationId, runId)
    return response.ok({ data: decisionView })
  }

  // ── 切片 C：只读路由模拟 ──

  /** POST /api/v1/ai/compiler/routing/simulate —— dry-run 模拟。 */
  async simulateRouting(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canViewRouting(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const input = validateSimulateRequest(ctx)
    if (!input) return

    const result = simulate(
      input as import('@aiproj/types/compiler-dynamic-routing').RoutingSimulateRequest,
    )
    return response.ok({ data: result })
  }

  // ── 切片 B：受控规则编排 ──

  /** POST /api/v1/ai/compiler/routing/rules —— 预览规则变更。 */
  async previewRule(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canManageRouting(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const request = validateRuleAuthoringRequest(ctx)
    if (!request) return

    const preview = await buildRulePreview(
      tenant.organizationId,
      request as import('@aiproj/types/compiler-dynamic-routing').RoutingRuleAuthoringRequest,
    )
    return response.ok({ data: preview })
  }

  /** PATCH /api/v1/ai/compiler/routing/rules —— 确认并落库规则变更。 */
  async confirmRule(ctx: HttpContext) {
    const { response, authUser, tenant } = ctx
    if (!authUser || !tenant) {
      return response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      })
    }

    const authResult = await this.policy.canManageRouting(authUser, tenant.organizationId)
    if (!authResult.allowed) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: authResult.reason ?? 'Insufficient permissions',
        },
      })
    }

    const confirmInput = validateRuleConfirmRequest(ctx)
    if (!confirmInput) return

    try {
      const committed = await confirmAndCommitRule(confirmInput.confirmToken, authUser.id)
      return response.ok({ data: committed })
    } catch (error) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: (error as Error).message },
      })
    }
  }
}
