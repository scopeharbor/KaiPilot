/**
 * v2-ai-smart-recommendations — 推荐 Service Barrel 导出。
 *
 * §3 — Source Adapter 候选收集与聚合。
 * §4 — 推荐核心服务。
 */

export { default as AdapterRegistry } from './adapter_registry.js'
export { default as ResourceAdapter } from './resource_adapter.js'
export { default as RiskAdapter } from './risk_adapter.js'
export { default as ChangeImpactAdapter } from './change_impact_adapter.js'
export { default as DashboardAdapter } from './dashboard_adapter.js'
export { default as ReportAdapter } from './report_adapter.js'
export { default as SourceUnavailableAdapter } from './source_unavailable_adapter.js'
export * from './adapter_types.js'

export { default as RecommendationService } from './recommendation_service.js'
export * from './scoring.js'
export * from './status_machine.js'

import AdapterRegistry from './adapter_registry.js'
import ResourceAdapter from './resource_adapter.js'
import RiskAdapter from './risk_adapter.js'
import ChangeImpactAdapter from './change_impact_adapter.js'
import DashboardAdapter from './dashboard_adapter.js'
import ReportAdapter from './report_adapter.js'
import SourceUnavailableAdapter from './source_unavailable_adapter.js'

/**
 * 创建并返回一个已注册所有标准 adapter 的 registry。
 *
 * 外部使用方也可选择自行构造 AdapterRegistry 并按需注册。
 */
export function createDefaultAdapterRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry()

  registry.register('resource', new ResourceAdapter())
  registry.register('risk', new RiskAdapter())
  registry.register('change_impact', new ChangeImpactAdapter())
  registry.register('dashboard', new DashboardAdapter())
  registry.register('report', new ReportAdapter())
  registry.register('health_diagnosis', new SourceUnavailableAdapter('health_diagnosis'))
  registry.register('prediction', new SourceUnavailableAdapter('prediction'))
  registry.register('weekly_report', new SourceUnavailableAdapter('weekly_report'))
  registry.register('monthly_report', new SourceUnavailableAdapter('monthly_report'))

  return registry
}
