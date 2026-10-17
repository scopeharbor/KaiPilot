/**
 * v3-unified-ai-budget-and-quota §7.2 — 只读预算状态 Controller。
 *
 * 挂 auth、Policy、validator、分页与统一 envelope。
 * 全部查询路径附加 organization_id 过滤。
 * 跨组织访问返回不泄露错误。
 *
 * 说明（v3-backend-type-debt-closure）：
 * - 原实现导出的是**裸函数**，而路由按 `[Controller, 'method']` 引用类——运行时解析不到，
 *   类型上也报 TS2345。已改为标准 Controller 类。
 * - 组织上下文原读 `user.organizationId`；`User` 模型没有该字段，取值恒为 undefined，
 *   预算查询会在无组织过滤的情况下执行。已改为请求级租户上下文。
 * - `BudgetStatusService` 目前**没有任何地方装配**（见下方 resolveService），端点因此返回 503。
 *   这是 v3-unified-ai-budget-and-quota 的接线缺口，不在本 change 范围内实现；
 *   保留显式 503 而非假成功——一个「看起来成功但没数据」的预算端点比失败更危险。
 */

import type { HttpContext } from '@adonisjs/core/http'
import type { BudgetStatusService } from '../services/ai_budget/budget_status_service.js'

/** 运行时装配槽位：由应用启动流程注入；未装配时端点显式不可用。 */
interface BudgetStatusServiceHolder {
  __budgetStatusService?: BudgetStatusService
}

export default class BudgetStatusController {
  /**
   * GET /api/v1/organizations/:organizationId/ai-budget/status
   *
   * Query params: projectId / userId / capability / recentDecisionsLimit（默认 10，上限 50）
   * Response: BudgetStatusResponse（costLabel: 'estimate'）
   */
  async getBudgetStatus(ctx: HttpContext) {
    const { request, response, auth } = ctx
    try {
      const user = auth.user
      if (!user) {
        return response.unauthorized({
          error: { code: 'AUTH_REQUIRED', message: '需要登录' },
        })
      }

      const organizationId = ctx.tenant?.organizationId
      if (!organizationId) {
        return response.badRequest({
          error: { code: 'VALIDATION_ERROR', message: '缺少组织上下文' },
        })
      }

      const projectId = request.input('projectId') ? Number(request.input('projectId')) : null
      const userId = request.input('userId') ? Number(request.input('userId')) : null
      const capability = request.input('capability') || null
      const recentDecisionsLimit = request.input('recentDecisionsLimit')
        ? Math.min(Number(request.input('recentDecisionsLimit')), 50)
        : 10

      const budgetStatusService = this.resolveService()
      if (!budgetStatusService) {
        return response.serviceUnavailable({
          error: { code: 'AI_SERVICE_ERROR', message: '预算服务未初始化' },
        })
      }

      const status = await budgetStatusService.getStatus({
        organizationId: Number(organizationId),
        projectId,
        userId,
        capability,
        recentDecisionsLimit,
      })

      return response.ok({ data: status })
    } catch (error) {
      // 组织隔离：跨组织访问返回不泄露错误
      if ((error as { code?: string } | null)?.code === 'CROSS_ORGANIZATION_ACCESS') {
        return response.forbidden({
          error: { code: 'PERMISSION_DENIED', message: '无权访问该组织的预算数据' },
        })
      }

      return response.internalServerError({
        error: { code: 'AI_SERVICE_ERROR', message: '预算状态查询失败' },
      })
    }
  }

  /** 取运行时装配的服务实例；未装配返回 undefined（端点随即 503）。 */
  private resolveService(): BudgetStatusService | undefined {
    return (globalThis as unknown as BudgetStatusServiceHolder).__budgetStatusService
  }
}
