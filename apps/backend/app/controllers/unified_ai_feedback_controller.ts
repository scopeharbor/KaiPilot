/**
 * v3-unified-ai-feedback-ledger §7.6 — 只读采纳率聚合端点控制器。
 *
 * 挂 auth、Policy、validator、分页与统一 envelope。
 * 全部读路径附加 organization_id 过滤（组织隔离）。
 *
 * 注（v3-backend-type-debt-closure）：原实现存在三处接不上的地方——
 * 1. 注入了 `policyService` 却从不调用，即控制器声称"挂 Policy"实则**无任何授权判定**；
 * 2. 依赖 `../services/organization_policy.js`，该模块**不存在**；
 * 3. 按 `this.aggregationService.aggregate()/listEvents()` 调用，而服务层导出的是
 *    模块函数 `aggregateAdoptionRate` / `listEvents` / `downstreamSummary`，形状对不上。
 * 现改为直接调用真实服务函数，并在每个端点前置 `UnifiedAiFeedbackPolicy` 判定。
 *
 * **已知缺口**：本控制器目前**没有任何路由登记**（`start/routes.ts` 无 ai-feedback 条目），
 * 端点因此不可达。路由登记归 v3-unified-ai-feedback-ledger，不在本 change 范围。
 */

import type { HttpContext } from '@adonisjs/core/http'
import UnifiedAiFeedbackPolicy from '#policies/unified_ai_feedback_policy'
import {
  aggregateAdoptionRate,
  downstreamSummary,
  listEvents,
} from '../services/unified_ai_feedback/aggregation_service.js'
import type { FeedbackType } from '@aiproj/types'
import {
  aiFeedbackAggregateValidator,
  aiFeedbackEventsValidator,
} from '#validators/unified_ai_feedback'

export default class UnifiedAiFeedbackController {
  readonly #policy = new UnifiedAiFeedbackPolicy()

  /**
   * GET /api/v1/organizations/:organizationId/ai-feedback/aggregate
   *
   * 返回采纳率聚合：accepted/modified/rejected/skipped 分量 + 拒绝原因分布 + 覆盖率。
   * 组织隔离：organizationId 取自路径参数，且必须与租户上下文一致（Policy 判定）。
   */
  async aggregate(ctx: HttpContext) {
    const { params, response } = ctx
    const organizationId = this.orgIdOf(params, response)
    if (typeof organizationId !== 'number') return organizationId
    await this.#policy.assertView(ctx, organizationId)

    const payload = await ctx.request.validateUsing(aiFeedbackAggregateValidator)

    const result = await aggregateAdoptionRate({
      organizationId,
      capabilitySurface: payload.surface as string | undefined,
      windowStart: payload.windowStart as string | undefined,
      windowEnd: payload.windowEnd as string | undefined,
    })
    return response.ok({ data: result })
  }

  /**
   * GET /api/v1/organizations/:organizationId/ai-feedback/events
   *
   * 列出反馈事件（只读）。分页、过滤、组织隔离。
   */
  async events(ctx: HttpContext) {
    const { params, response } = ctx
    const organizationId = this.orgIdOf(params, response)
    if (typeof organizationId !== 'number') return organizationId
    await this.#policy.assertView(ctx, organizationId)

    const payload = await ctx.request.validateUsing(aiFeedbackEventsValidator)

    const result = await listEvents({
      organizationId,
      page: Number(payload.page ?? 1),
      perPage: Math.min(Number(payload.perPage ?? 50), 100),
      feedbackType: payload.feedbackType as FeedbackType | undefined,
      capabilitySurface: payload.surface as string | undefined,
    })
    return response.ok(result)
  }

  /**
   * GET /api/v1/organizations/:organizationId/ai-feedback/downstream
   *
   * 下游读接口：评测的采纳维度、排序的反哺输入。
   * 只暴露 references、fingerprints、enumerated values 和 counts。
   */
  async downstream(ctx: HttpContext) {
    const { params, request, response } = ctx
    const organizationId = this.orgIdOf(params, response)
    if (typeof organizationId !== 'number') return organizationId
    await this.#policy.assertDownstream(ctx, organizationId)

    const result = await downstreamSummary({
      organizationId,
      capabilitySurface: request.input('surface') as string | undefined,
    })
    return response.ok({ data: result })
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** 解析路径上的组织 id；非法时直接返回 400 响应对象。 */
  private orgIdOf(params: Record<string, unknown>, response: HttpContext['response']) {
    const organizationId = Number(params.organizationId)
    if (!organizationId || Number.isNaN(organizationId)) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'organizationId 非法' },
      })
    }
    return organizationId
  }
}
