/**
 * @aiproj/backend —— Repair Module 入口。
 *
 * 导出所有 repair 服务和类型。
 */

export { RepairIssueClassifier } from './repair_issue_classifier.js'
export type {
  ClassifierInput,
  LlmOutputIssue,
  SchemaIssue,
  DeterministicIssue,
  ManifestLedgerIssue,
} from './repair_issue_classifier.js'
export { RepairBudgetGuard } from './repair_budget_guard.js'
export type { BudgetState } from './repair_budget_guard.js'
export { CascadeGuardService } from './cascade_guard_service.js'
export type { AffectedClosureResult } from './cascade_guard_service.js'
export { RepairPlanner } from './repair_planner.js'
export type { ManifestEntityState, PlannerContext } from './repair_planner.js'
export { RepairCandidatePatchService } from './repair_candidate_patch_service.js'
export type {
  PathValidationResult,
  ReplayResult,
  PatchGenInput,
  RepairIdempotencyKeyInput,
} from './repair_candidate_patch_service.js'
export { RepairExecutor } from './repair_executor.js'
export type {
  DeterministicAutoFixAdapter,
  LlmRetryAdapter,
  ExecutorAttemptResult,
} from './repair_executor.js'
export { RepairRevalidationOrchestrator } from './repair_revalidation_orchestrator.js'
export type {
  SchemaValidator,
  GraphValidator,
  DeterministicRecompute,
  HardValidator,
  VGate,
} from './repair_revalidation_orchestrator.js'
export { RepairEvidenceWriter } from './repair_evidence_writer.js'
export type { ArtifactStoreWriter, LedgerWriter } from './repair_evidence_writer.js'
export { GlobalReconciliationChecker } from './global_reconciliation_checker.js'
export type {
  ReconciliationPdmInput,
  PdmComputedInput,
  ReconciliationRule,
} from './global_reconciliation_checker.js'
