/**
 * @aiproj/backend —— Traceability Services 统一导出。
 */
export { SourceAttributionService } from './source_attribution_service.js'
export type {
  LlmOutputSource,
  DeterministicRuleSource,
  UserEditSource,
} from './source_attribution_service.js'
export {
  SourceAttributionError,
  RefIntegrityError,
  CrossOrganizationRefError,
} from './source_attribution_service.js'

export { TraceabilityService } from './traceability_service.js'
export type { ApplyEntityRelation, ApplyResultRelations } from './traceability_service.js'
export { TraceabilityError, ImplicitRelationError } from './traceability_service.js'
