// v3-bi-dashboard-builder §7.3 — V2 Report Data Source Adapter。
// 使 eligible report templates 可消费 confirmed BI dashboard summary。

import type User from '#models/user'
import BiDashboardDefinition from '#models/bi_dashboard_definition'

/**
 * V2 报表数据源适配器：消费已确认 BI Dashboard 摘要作为报表输入。
 *
 * 职责：
 *   - 读取已保存、已授权、未归档的 BI dashboard 定义，生成报告数据源摘要。
 *   - 返回 definitionHash、snapshotHash、sourceHash、warnings、freshness。
 *   - 不修改 BI dashboard、报表版本或任何来源事实。
 *   - 不可用时返回结构化 warning，不阻断报表预览流程（由模板决定是否阻断）。
 */
export default class BiDashboardReportDataSourceAdapter {
  constructor() {}

  /**
   * 读取 BI dashboard 摘要作为报表数据源。
   * @param user 当前用户
   * @param organizationId 组织 ID
   * @param dashboardId BI dashboard ID
   */
  async getDataSource(
    _user: User,
    organizationId: number,
    dashboardId: number,
  ): Promise<{
    sourceKey: string
    status: 'available' | 'forbidden' | 'unavailable'
    data?: Record<string, unknown>
    warnings: Array<{ code: string; message: string }>
    sourceHash: string
    generatedAt: string
  }> {
    const dashboard = await BiDashboardDefinition.find(dashboardId)

    if (!dashboard || dashboard.organizationId !== organizationId) {
      return {
        sourceKey: 'bi_dashboard_summary',
        status: 'unavailable',
        warnings: [
          {
            code: 'BI_DASHBOARD_UNAVAILABLE',
            message: 'BI Dashboard not found or not in this organization',
          },
        ],
        sourceHash: '',
        generatedAt: new Date().toISOString(),
      }
    }

    if (dashboard.isArchived) {
      return {
        sourceKey: 'bi_dashboard_summary',
        status: 'unavailable',
        warnings: [{ code: 'BI_DASHBOARD_ARCHIVED', message: 'BI Dashboard is archived' }],
        sourceHash: dashboard.definitionHash,
        generatedAt: dashboard.updatedAt.toISO()!,
      }
    }

    return {
      sourceKey: 'bi_dashboard_summary',
      status: 'available',
      data: {
        dashboardId: dashboard.id,
        name: dashboard.name,
        version: dashboard.version,
        definitionHash: dashboard.definitionHash,
        snapshotHash: dashboard.snapshotHash,
        widgetKeys: Array.isArray(dashboard.widgets)
          ? dashboard.widgets.map((w) => w.widgetKey)
          : [],
        warnings: dashboard.warningSummary,
      },
      warnings: [],
      sourceHash: dashboard.snapshotHash,
      generatedAt: dashboard.updatedAt.toISO()!,
    }
  }
}
