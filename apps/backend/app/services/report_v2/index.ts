/**
 * report_v2 —— V2 报表服务入口。
 */
export { ReportDataSourceRegistry } from './data_source_registry.js'
export type { DataSourceResultMap } from './data_source_registry.js'
export type { DataSourceAdapter } from './data_source_adapter.js'
export {
  computeSourceHash,
  makeSuccess,
  makeForbidden,
  makeUnavailable,
  makeTimeout,
  makeEmpty,
  makeWarning,
} from './data_source_adapter.js'
export {
  TEMPLATE_MAP,
  BUILTIN_TEMPLATES,
  isValidTemplateId,
  getVisibleTemplates,
} from './templates.js'
export type { ReportTemplateDef } from './templates.js'

import { ReportDataSourceRegistry } from './data_source_registry.js'
import { TaskSummaryAdapter } from './adapters/task_summary.js'
import { ScheduleSummaryAdapter } from './adapters/schedule_summary.js'
import { DashboardMetricsAdapter } from './adapters/dashboard_metrics.js'
import { ResourceSummaryAdapter } from './adapters/resource_summary.js'
import { RiskSummaryAdapter } from './adapters/risk_summary.js'
import { TimelineActivityAdapter } from './adapters/timeline_activity.js'
import { CompilerSummaryAdapter } from './adapters/compiler_summary.js'
import { ChangeImpactSummaryAdapter } from './adapters/change_impact_summary.js'

/**
 * 创建预配置的完整注册表（含所有已实现的数据源适配器）。
 */
export function createDefaultRegistry(): ReportDataSourceRegistry {
  return new ReportDataSourceRegistry().registerAll([
    new TaskSummaryAdapter(),
    new ScheduleSummaryAdapter(),
    new DashboardMetricsAdapter(),
    new ResourceSummaryAdapter(),
    new RiskSummaryAdapter(),
    new TimelineActivityAdapter(),
    new CompilerSummaryAdapter(),
    new ChangeImpactSummaryAdapter(),
  ])
}
