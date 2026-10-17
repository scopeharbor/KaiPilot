// v3-bi-dashboard-builder §7.1 & §7.2 — 组织 Dashboard bi-dashboard-summary 模块。
// 只读模块，settings 只能引用 dashboardId/version，不能内嵌 BI widget definition。

import type User from '#models/user'
import BiDashboardDefinition from '#models/bi_dashboard_definition'
import type BiDashboardPolicy from '#policies/bi_dashboard_policy'

/**
 * 组织 Dashboard 的 bi-dashboard-summary 模块服务。
 *
 * 职责：
 *   - 根据 layout module settings 中的 dashboardId/version 读取已保存 BI dashboard 摘要。
 *   - 权限校验：只返回授权可见的摘要，不允许泄露隐藏数据。
 *   - 不嵌入 BI widget definition、dataSources、fields、filters、query、script、prompt。
 *   - 不修改 BI dashboard、layout 或任何项目事实。
 */
export default class BiDashboardSummaryModuleService {
  constructor(private readonly policy: BiDashboardPolicy) {}

  /**
   * 获取 BI dashboard 摘要用于组织 Dashboard 模块渲染。
   * @param user 当前用户
   * @param organizationId 组织 ID
   * @param settings layout module settings（必须只包含 dashboardId / version）
   */
  async getSummary(
    user: User,
    organizationId: number,
    settings: { dashboardId: number; version?: number },
  ): Promise<{
    status: 'available' | 'forbidden' | 'unavailable'
    summary: Record<string, unknown>
  }> {
    const dashboard = await BiDashboardDefinition.find(settings.dashboardId)

    if (!dashboard || dashboard.organizationId !== organizationId) {
      return {
        status: 'unavailable',
        summary: {
          emptyStateKey: '无可用 BI Dashboard',
          reason: 'dashboard_not_found',
        },
      }
    }

    if (dashboard.isArchived) {
      return {
        status: 'unavailable',
        summary: {
          emptyStateKey: 'BI Dashboard 已归档',
          reason: 'archived',
          dashboardId: dashboard.id,
        },
      }
    }

    try {
      const canView = await this.policy.authorizeView(user, dashboard)
      if (!canView) {
        return {
          status: 'forbidden',
          summary: {
            emptyStateKey: '无权限查看此 BI Dashboard',
            reason: 'permission_denied',
          },
        }
      }
    } catch {
      return {
        status: 'forbidden',
        summary: {
          emptyStateKey: '无权限查看此 BI Dashboard',
          reason: 'permission_denied',
        },
      }
    }

    // 返回低敏摘要：不包含完整 widget data、evidence、raw rows、secret
    return {
      status: 'available',
      summary: {
        dashboardId: dashboard.id,
        name: dashboard.name,
        scope: dashboard.scope,
        version: dashboard.version,
        definitionHash: dashboard.definitionHash,
        snapshotHash: dashboard.snapshotHash,
        widgetCount: Array.isArray(dashboard.widgets) ? dashboard.widgets.length : 0,
        widgetKeys: Array.isArray(dashboard.widgets)
          ? dashboard.widgets.map((w) => w.widgetKey)
          : [],
        layout: dashboard.layout,
        isDefault: dashboard.isDefault,
        freshnessPolicy: dashboard.freshnessPolicy,
        updatedAt: dashboard.updatedAt.toISO(),
        warnings: dashboard.warningSummary,
      },
    }
  }
}
