/**
 * v3-plugin-permission-audit-and-observation — Decision Controller（task 7.5-7.6）。
 *
 * 薄 Controller：HTTP 解析、响应格式化。
 * 复用 audit:view Policy/RBAC 与统一错误 envelope。
 * Controller 不写业务逻辑、不拼 decision/audit payload。
 */
import type { HttpContext } from '@adonisjs/core/http'
import {
  queryDecisions,
  aggregateDecisions,
} from '#services/plugin_permission_decision/decision_query_service'
import type {
  PluginPermissionDecisionMode,
  PluginPermissionDecisionOperation,
  PluginPermissionDecisionOutcome,
  PluginPermissionReasonCode,
} from '@aiproj/types'

export default class PluginPermissionDecisionController {
  /**
   * GET /api/v1/organizations/:organizationId/plugin-permission-decisions
   * 分页查询当前组织的权限决策事件。
   */
  async index({ params, request, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    if (!organizationId) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid organization ID' },
      })
    }

    const mode = request.input('mode') as PluginPermissionDecisionMode | undefined
    const operation = request.input('operation') as PluginPermissionDecisionOperation | undefined
    const outcome = request.input('outcome') as PluginPermissionDecisionOutcome | undefined
    const reasonCode = request.input('reasonCode') as PluginPermissionReasonCode | undefined
    const createdAfter = request.input('createdAfter') as string | undefined
    const createdBefore = request.input('createdBefore') as string | undefined
    const page = Number(request.input('page', 1))
    const perPage = Math.min(100, Math.max(1, Number(request.input('perPage', 20))))

    const result = await queryDecisions(organizationId, {
      mode,
      operation,
      outcome,
      reasonCode,
      createdAfter,
      createdBefore,
      page,
      perPage,
    })

    return response.ok(result)
  }

  /**
   * GET /api/v1/organizations/:organizationId/plugin-permission-decisions/aggregate
   * 聚合当前组织的权限决策统计。
   */
  async aggregate({ params, request, response }: HttpContext) {
    const organizationId = Number(params.organizationId)
    if (!organizationId) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid organization ID' },
      })
    }

    const createdAfter = request.input('createdAfter') as string | undefined
    const createdBefore = request.input('createdBefore') as string | undefined

    const result = await aggregateDecisions(organizationId, {
      createdAfter,
      createdBefore,
    })

    return response.ok(result)
  }
}
