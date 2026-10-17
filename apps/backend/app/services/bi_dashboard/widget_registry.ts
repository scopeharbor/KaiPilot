// v3-bi-dashboard-builder §3.1 — BI Dashboard Widget Registry。
// 服务端控制 widget 白名单，声明 key、size、visualization、settings schema、
// dataDependencyId、permissionTags、freshness、drillDown 和 fallback。

import type { BiDashboardWidgetRegistryEntry } from '@aiproj/types'
import { BI_DASHBOARD_WIDGET_KEYS } from '@aiproj/types'

/**
 * Widget Registry —— 每个 widget 必须在此注册表中有明确定义。
 * 前端只能引用 registry key 与受控 settings，不能提交任意数据路径、字段、查询或代码。
 */
const WIDGET_REGISTRY: Record<string, BiDashboardWidgetRegistryEntry> = {
  [BI_DASHBOARD_WIDGET_KEYS.BI_TREND]: {
    widgetKey: BI_DASHBOARD_WIDGET_KEYS.BI_TREND,
    displayKey: 'BI 趋势分析',
    allowedSizes: ['small', 'medium', 'large', 'full'],
    supportedVisualizations: ['line_chart', 'bar_chart', 'area_chart'],
    settingSchema: {
      metricKey: { type: 'string', required: true },
      dimension: { type: 'string', required: true },
      grain: { type: 'string', required: true },
      compareMode: { type: 'string', required: false },
      forecastEnabled: { type: 'boolean', required: false },
    },
    dataDependencyId: 'bi_trend_series',
    permissionTags: [],
    supportedFilters: ['time_range', 'project_status'],
    supportedDrillDown: true,
    freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' },
    emptyBehavior: 'show_empty',
    fallbackBehavior: 'warning',
    availability: 'available',
  },

  [BI_DASHBOARD_WIDGET_KEYS.BI_RISK_HEATMAP]: {
    widgetKey: BI_DASHBOARD_WIDGET_KEYS.BI_RISK_HEATMAP,
    displayKey: '风险热力图',
    allowedSizes: ['medium', 'large', 'full'],
    supportedVisualizations: ['heatmap_grid', 'top_list'],
    settingSchema: {
      riskDimension: { type: 'string', required: true },
      topN: { type: 'number', required: false },
      severityFilter: { type: 'string', required: false },
    },
    dataDependencyId: 'bi_risk_heatmap',
    permissionTags: ['risk_view'],
    supportedFilters: ['time_range', 'risk_level'],
    supportedDrillDown: true,
    freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' },
    emptyBehavior: 'show_empty',
    fallbackBehavior: 'warning',
    availability: 'available',
  },

  [BI_DASHBOARD_WIDGET_KEYS.BI_CUSTOM_REPORT_SUMMARY]: {
    widgetKey: BI_DASHBOARD_WIDGET_KEYS.BI_CUSTOM_REPORT_SUMMARY,
    displayKey: '自定义报表摘要',
    allowedSizes: ['small', 'medium', 'large', 'full'],
    supportedVisualizations: ['summary_card', 'table', 'bar_chart'],
    settingSchema: {
      definitionId: { type: 'number', required: true },
      definitionVersion: { type: 'number', required: false },
    },
    dataDependencyId: 'bi_custom_report',
    permissionTags: [],
    supportedFilters: ['time_range'],
    supportedDrillDown: true,
    freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' },
    emptyBehavior: 'show_placeholder',
    fallbackBehavior: 'warning',
    availability: 'available',
  },

  [BI_DASHBOARD_WIDGET_KEYS.PMO_HEALTH]: {
    widgetKey: BI_DASHBOARD_WIDGET_KEYS.PMO_HEALTH,
    displayKey: 'PMO 组合健康度',
    allowedSizes: ['medium', 'large', 'full'],
    supportedVisualizations: ['traffic_light', 'summary_card', 'bar_chart'],
    settingSchema: {
      portfolioId: { type: 'number', required: false },
      groupBy: { type: 'string', required: false },
    },
    dataDependencyId: 'pmo_portfolio',
    permissionTags: ['pmo'],
    supportedFilters: ['portfolio', 'project_status'],
    supportedDrillDown: true,
    freshnessPolicy: { maxAgeSeconds: 1800, staleBehavior: 'warning' },
    emptyBehavior: 'show_empty',
    fallbackBehavior: 'warning',
    availability: 'available',
  },

  [BI_DASHBOARD_WIDGET_KEYS.RESOURCE_SUMMARY]: {
    widgetKey: BI_DASHBOARD_WIDGET_KEYS.RESOURCE_SUMMARY,
    displayKey: '资源摘要',
    allowedSizes: ['small', 'medium', 'large'],
    supportedVisualizations: ['summary_card', 'bar_chart', 'table'],
    settingSchema: {
      groupBy: { type: 'string', required: false },
      showGap: { type: 'boolean', required: false },
    },
    dataDependencyId: 'resource_summary',
    permissionTags: [],
    supportedFilters: ['time_range'],
    supportedDrillDown: true,
    freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' },
    emptyBehavior: 'show_empty',
    fallbackBehavior: 'warning',
    availability: 'available',
  },

  [BI_DASHBOARD_WIDGET_KEYS.OKR_SUMMARY]: {
    widgetKey: BI_DASHBOARD_WIDGET_KEYS.OKR_SUMMARY,
    displayKey: 'OKR 摘要',
    allowedSizes: ['small', 'medium', 'large', 'full'],
    supportedVisualizations: ['progress_bar', 'summary_card', 'table'],
    settingSchema: {
      groupBy: { type: 'string', required: false },
      showAlignment: { type: 'boolean', required: false },
    },
    dataDependencyId: 'okr_summary',
    permissionTags: [],
    supportedFilters: ['time_range'],
    supportedDrillDown: true,
    freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' },
    emptyBehavior: 'show_placeholder',
    fallbackBehavior: 'warning',
    availability: 'available',
  },

  [BI_DASHBOARD_WIDGET_KEYS.ORGANIZATION_DASHBOARD_SUMMARY]: {
    widgetKey: BI_DASHBOARD_WIDGET_KEYS.ORGANIZATION_DASHBOARD_SUMMARY,
    displayKey: '组织 Dashboard 摘要',
    allowedSizes: ['medium', 'large', 'full'],
    supportedVisualizations: ['summary_card', 'table'],
    settingSchema: {},
    dataDependencyId: 'organization_dashboard',
    permissionTags: [],
    supportedFilters: [],
    supportedDrillDown: false,
    freshnessPolicy: { maxAgeSeconds: 1800, staleBehavior: 'warning' },
    emptyBehavior: 'show_empty',
    fallbackBehavior: 'warning',
    availability: 'available',
  },
}

/** 获取完整的 widget 注册表 */
export function getWidgetRegistry(): Readonly<Record<string, BiDashboardWidgetRegistryEntry>> {
  return WIDGET_REGISTRY
}

/** 获取授权可见的注册表（根据用户权限过滤） */
export function getAuthorizedRegistry(
  authorizedTags: Set<string>,
): Readonly<Record<string, BiDashboardWidgetRegistryEntry>> {
  const result: Record<string, BiDashboardWidgetRegistryEntry> = {}
  for (const [key, entry] of Object.entries(WIDGET_REGISTRY)) {
    if (entry.permissionTags.length === 0) {
      result[key] = entry
      continue
    }
    const hasAllTags = entry.permissionTags.every((t) => authorizedTags.has(t))
    if (hasAllTags) {
      result[key] = entry
    } else {
      result[key] = { ...entry, availability: 'unavailable' }
    }
  }
  return result
}

/** 获取 registry 中所有可用的 widget keys */
export function getAvailableWidgetKeys(): Set<string> {
  return new Set(Object.keys(WIDGET_REGISTRY))
}
