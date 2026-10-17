// v3-bi-dashboard-builder — BI Dashboard Builder 服务 barrel。

export { default as BiDashboardPreviewService } from './preview_service.js'
export { default as BiDashboardDefinitionService } from './definition_service.js'
export { default as BiDashboardSummaryModuleService } from './org_dashboard_summary_module.js'
export { default as BiDashboardReportDataSourceAdapter } from './report_data_source_adapter.js'
export {
  getWidgetRegistry,
  getAuthorizedRegistry,
  getAvailableWidgetKeys,
} from './widget_registry.js'
