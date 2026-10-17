/**
 * v3-copilot-usage-and-quota-surface §6.5, §7 — 用量视图控制器。
 *
 * RBAC: `ai:usage:view` 权限。
 * 纯只读：不产生任何动作入口。
 *
 * @aiproj/backend
 */

import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { UsageSurfaceService } from '#services/copilot_usage/usage_surface_service'
import RateLimitQueryService from '#services/rate_limiting/rate_limit_query_service'
import { BudgetStatusService } from '#services/ai_budget/budget_status_service'
import RbacService from '#services/rbac_service'
import {
  AI_USAGE_VIEW,
  AI_QUALITY_COST_CONSOLE_VIEW,
  AI_QUALITY_COST_CONSOLE_VIEW_COST,
} from '#start/rbac/permissions'
import type { Permission } from '#start/rbac/permissions'
import type { UsageWindowType } from '#services/copilot_usage/usage_surface_service'
import ExchangeRateService from '#services/ai_pricing/exchange_rate_service'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_ALIASES: Record<string, UsageWindowType> = {
  monthly: 'monthly',
  last_30_days: 'last_30_days',
  '30d': 'last_30_days',
  last_7_days: 'last_7_days',
  '7d': 'last_7_days',
  last_24_hours: 'last_24_hours',
  '24h': 'last_24_hours',
  all: 'all',
}

/** 未识别的 window 参数回落为本月。 */
export function resolveUsageWindowType(raw: unknown): UsageWindowType {
  return WINDOW_ALIASES[String(raw)] ?? 'monthly'
}

/** 时间窗起止（UTC）。 */
export function usageWindowRange(
  type: UsageWindowType,
  now: Date,
): { windowStart: Date; windowEnd: Date } {
  switch (type) {
    case 'last_24_hours':
      return { windowStart: new Date(now.getTime() - DAY_MS), windowEnd: now }
    case 'last_7_days':
      return { windowStart: new Date(now.getTime() - 7 * DAY_MS), windowEnd: now }
    case 'last_30_days':
      return { windowStart: new Date(now.getTime() - 30 * DAY_MS), windowEnd: now }
    case 'all':
      return { windowStart: new Date(0), windowEnd: now }
    case 'monthly':
      return {
        windowStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        windowEnd: new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
        ),
      }
  }
}

/**
 * AiUsageSurfaceController —— 用量与额度只读视图控制器。
 *
 * 路由：GET /api/v1/ai/usage-surface
 * 权限：ai:usage:view
 * 组织隔离：从 auth context 读取 organization_id。
 */
@inject()
export default class AiUsageSurfaceController {
  constructor(private readonly rbac: RbacService) {}

  /**
   * GET /api/v1/ai/usage-surface
   *
   * 返回组织级 AI 用量与额度只读视图。
   * 聚合在权限过滤之后进行；无权限维度缺席。
   */
  async index({ tenant, request, response, auth }: HttpContext) {
    const organizationId = tenant?.organizationId ? Number(tenant.organizationId) : undefined
    if (!organizationId) {
      return response.unauthorized({ error: { code: 'AUTH_REQUIRED', message: '需要组织上下文' } })
    }

    const user = auth.user
    if (!user) {
      return response.unauthorized({ error: { code: 'AUTH_REQUIRED', message: '需要登录' } })
    }

    // 解析时间窗参数：本月（默认）/ 近 24 小时 / 近 7 天 / 近 30 天 / 全部时段
    const now = new Date()
    const windowType = resolveUsageWindowType(request.input('window', 'monthly'))
    const { windowStart, windowEnd } = usageWindowRange(windowType, now)

    // 解析 topN 参数（默认 10）
    const topN = Math.min(50, Math.max(1, Number.parseInt(request.input('topN', '10'), 10)))

    // 构建服务
    const rateLimitQuery = new RateLimitQueryService()
    const budgetStatus = new BudgetStatusService({
      repository: {
        listByOrganization: async () => [],
        accumulateInWindow: async () => ({ totalCost: 0, totalTokens: 0, currency: 'CNY' }),
      },
      policies: [],
    })

    const exchangeRates = new ExchangeRateService()
    const displayCurrency = await exchangeRates.getDisplayCurrency(organizationId)
    const rateTable = await exchangeRates.latestTable()
    const service = new UsageSurfaceService({
      rateLimitQuery,
      budgetStatus,
      displayCurrency,
      convertCost: (value, from) => {
        if (String(from).toUpperCase() === displayCurrency) return value
        return rateTable ? exchangeRates.convert(value, from, displayCurrency, rateTable) : null
      },
    })

    // 从 RBAC 解析可见维度
    const permissions = await this.rbac.resolveUserPermissions(user, organizationId, undefined)
    const allowedDimensions = this.#allowedDimensions(permissions)

    if (allowedDimensions.size === 0) {
      return response.forbidden({
        error: {
          code: 'PERMISSION_DENIED',
          message: '无权查看用量视图',
        },
      })
    }

    const result = await service.getUsageSurface({
      organizationId,
      windowStart,
      windowEnd,
      permissions: {
        allowedDimensions,
        allowedProjectIds: null,
        allowedUserIds: null,
        allowedCapabilities: null,
      },
      topN,
      windowType,
    })

    return response.ok({ data: result })
  }

  /**
   * 根据 actor 权限决定可见维度集合；无任何查看权限时返回空集合。
   */
  #allowedDimensions(
    permissions: Permission[],
  ): Set<'organization' | 'user' | 'project' | 'capability' | 'model'> {
    const hasAnyView =
      permissions.includes(AI_USAGE_VIEW) ||
      permissions.includes(AI_QUALITY_COST_CONSOLE_VIEW) ||
      permissions.includes(AI_QUALITY_COST_CONSOLE_VIEW_COST)

    if (!hasAnyView) {
      return new Set()
    }

    return new Set<'organization' | 'user' | 'project' | 'capability' | 'model'>([
      'organization',
      'project',
      'user',
      'capability',
      'model',
    ])
  }
}
