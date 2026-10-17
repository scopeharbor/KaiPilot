/**
 * bi_custom_report/index —— 自定义报表构建器服务入口。
 *
 * v3-bi-custom-report-builder
 */
export {
  BiCustomReportDataSourceRegistry,
  biCustomReportDataSourceRegistry,
  BUILTIN_BI_CUSTOM_REPORT_DATA_SOURCES,
} from './data_source_registry.js'
export {
  normalizeDefinition,
  normalizeFields,
  normalizeDataSources,
  normalizeFilters,
  normalizeGroups,
  normalizeSorts,
  normalizeVisualizations,
} from './definition_normalizer.js'
export type { NormalizableDefinition, NormalizedDefinition } from './definition_normalizer.js'
export {
  checkForbiddenPayloadFields,
  checkComplexity,
  validateDefinitionAgainstRegistry,
} from './definition_validator.js'
export type { ComplexityCheckResult, ValidationResult } from './definition_validator.js'
export { BiCustomReportPreviewService, biCustomReportPreviewService } from './preview_service.js'
export type { PreviewInput } from './preview_service.js'
export { planPreview } from './preview_planner.js'
export type { PreviewPlanInput, PreviewPlan } from './preview_planner.js'
export {
  BiCustomReportDefinitionService,
  biCustomReportDefinitionService,
} from './definition_service.js'
export type { ListOptions, CreateInput, UpdateInput, CopyInput } from './definition_service.js'
