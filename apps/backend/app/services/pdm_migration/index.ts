/**
 * v2-pdm-migration-compatibility —— PDM 迁移服务模块聚合导出。
 */
export * from './types.js'

// Extractors
export { ProjectExtractor } from './extractors/project_extractor.js'
export { WbsTaskExtractor } from './extractors/wbs_task_extractor.js'
export { ResourceRiskExtractor } from './extractors/resource_risk_extractor.js'
export { AiDraftExtractor } from './extractors/ai_draft_extractor.js'

// Projectors
export { PdmProjector } from './projectors/pdm_projector.js'

// Validators
export { MigrationValidator } from './validators/migration_validator.js'

// Reporters
export { MigrationReportBuilder } from './reporters/migration_report_builder.js'

// Orchestrator
export { MigrationOrchestrator } from './orchestrator/migration_orchestrator.js'

// Compat Adapter
export { PdmReadAdapter } from './compat_adapter/pdm_read_adapter.js'
export { V1ReadAdapter } from './compat_adapter/v1_read_adapter.js'
export { DualReadVerifier } from './compat_adapter/dual_read_verifier.js'

// PG Gate
export { PgCompatibilityGate } from './validators/pg_compatibility_gate.js'
