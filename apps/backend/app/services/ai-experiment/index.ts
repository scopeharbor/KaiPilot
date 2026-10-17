/**
 * AI Experiment services —— 影子与 A/B 实验后端服务。
 */

export { ExperimentConfigService } from './experiment_config_service.js'
export {
  ExperimentValidationError,
  ExperimentNotFoundError,
  ExperimentAccessDeniedError,
} from './experiment_config_service.js'

export { ShadowInvocationService } from './shadow_invocation_service.js'
export type {
  ShadowInvocationResult,
  ShadowInvocationInput,
  ShadowCostRecord,
} from './shadow_invocation_service.js'

export { AbAssignmentService } from './ab_assignment_service.js'

export { ComparisonService } from './comparison_service.js'
export type { ComparisonInput, MetricDataPoint } from './comparison_service.js'

export { CostAttributionService } from './cost_attribution_service.js'
export type { CostAttributionEntry, CostSummary } from './cost_attribution_service.js'
