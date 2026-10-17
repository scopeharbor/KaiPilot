/**
 * v3-plugin-permission-audit-and-observation — Observation Controller（task 8.5-8.6）。
 *
 * 薄 Controller：HTTP 解析、响应格式化。
 * 复用 audit:view Policy/RBAC。
 * objective 仅内存使用且不持久化。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { compileObservation } from '#services/plugin_permission_decision/observation_adapter'

export default class PluginPermissionObservationController {
  /**
   * GET /api/v1/organizations/:organizationId/plugin-permission-observations
   * 将权限决策编译为有预算的 Observation manifest。
   */
  async index({ params, request, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    if (!organizationId) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid organization ID' },
      })
    }

    const windowStart = request.input(
      'windowStart',
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    )
    const windowEnd = request.input('windowEnd', new Date().toISOString())
    const pluginId = request.input('pluginId') as string | undefined
    const operation = request.input('operation') as any | undefined
    const budgetCap = Math.min(100, Math.max(1, Number(request.input('budgetCap', 50))))

    const result = await compileObservation({
      organizationScope: `org:${organizationId}`,
      windowStart,
      windowEnd,
      pluginId,
      operation,
      budgetCap,
    })

    return response.ok(result)
  }
}
