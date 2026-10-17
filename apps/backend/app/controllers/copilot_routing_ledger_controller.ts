/**
 * v3-copilot-routing-decision-ledger（任务 6.10）—— 路由决策账本控制器。
 *
 * `/api/v1/copilot-routing-decisions` 只读端点：
 * - GET / — 聚合路由决策指标（准确率/规则命中率/澄清效率/不可用分布）
 * - GET /violations — 确定性违规查询
 * - GET /evaluation — 供评测与排序消费的稳定读接口
 *
 * 全部只读、组织隔离、挂 auth、Policy、分页与统一 envelope。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'
import {
  aggregateRoutingMetrics,
  queryReproducibilityViolations,
  readRoutingAggregatesForEvaluation,
} from '../services/copilot_routing_ledger/index.js'

export default class CopilotRoutingLedgerController {
  /**
   * 当前组织取自请求级租户上下文（`User` 模型无 organizationId，原写法恒 undefined，
   * 路由决策账本查询因此可能无组织过滤）。
   */
  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  /**
   * GET / — 聚合路由决策指标
   */
  async index(ctx: HttpContext) {
    const { request, response } = ctx
    const organizationId = this.orgIdOf(ctx)
    const intentClass = request.input('intentClass')
    const subIntentId = request.input('subIntentId')
    const catalogVersion = request.input('catalogVersion')
    const startTime = request.input('startTime')
    const endTime = request.input('endTime')

    try {
      const result = await aggregateRoutingMetrics({
        organizationId,
        intentClass,
        subIntentId,
        catalogVersion,
        startTime,
        endTime,
      })

      return response.ok({
        data: result,
      })
    } catch (error: any) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: error.message },
      })
    }
  }

  /**
   * GET /violations — 确定性违规查询
   */
  async violations(ctx: HttpContext) {
    const { response } = ctx
    const organizationId = this.orgIdOf(ctx)

    try {
      const violations = await queryReproducibilityViolations(organizationId)

      return response.ok({
        data: violations,
        meta: { total: violations.length },
      })
    } catch (error: any) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: error.message },
      })
    }
  }

  /**
   * GET /evaluation — 供评测与排序消费的稳定读接口
   */
  async evaluation(ctx: HttpContext) {
    const { request, response } = ctx
    const organizationId = this.orgIdOf(ctx)
    const intentClass = request.input('intentClass')
    const catalogVersion = request.input('catalogVersion')
    const startTime = request.input('startTime')
    const endTime = request.input('endTime')

    try {
      const result = await readRoutingAggregatesForEvaluation({
        organizationId,
        intentClass,
        catalogVersion,
        startTime,
        endTime,
      })

      return response.ok({
        data: result,
      })
    } catch (error: any) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: error.message },
      })
    }
  }
}
