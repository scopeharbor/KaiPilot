/**
 * @aiproj/compiler-spec —— V2 Project Compiler 数据契约（前后端共享）。
 *
 * 导出所有 PDM 类型、Stage Contract 类型、Manifest/Ledger 类型与 Entity ID 工具。
 * 前后端统一从此入口 import，避免重复类型声明。
 *
 * ⚠️ 新增 public type/function 必须在此 re-export。
 */

// ── Entity ID ──
export type { EntityType } from './entity-id.js'
export { ENTITY_ID_PREFIX, generateEntityId, isEntityIdForType, slug } from './entity-id.js'

// ── PDM ──
export type {
  Computed,
  Milestone,
  ParsedIntent,
  PdmLedger,
  PdmManifest,
  PdmMetadata,
  ProjectDataModel,
  RawIntent,
  Resource,
  Risk,
  Stakeholder,
  TaskL1,
  TaskL2,
  Validation,
  WorkPackage,
  Workstream,
} from './pdm.js'
export {
  computedSchema,
  entityIdSchema,
  milestoneSchema,
  parsedIntentSchema,
  pdmLedgerSchema,
  pdmManifestSchema,
  pdmMetadataSchema,
  pdmSchema,
  rawIntentSchema,
  resourceSchema,
  riskSchema,
  stakeholderSchema,
  taskL1Schema,
  taskL2Schema,
  validationSchema,
  workPackageSchema,
  workstreamSchema,
} from './pdm.js'

// ── Stage Contract ──
export type {
  AllowedTool,
  ContextScope,
  SideEffects,
  StageDefinition,
  StagePhase,
  StageType,
} from './stage-contract.js'
export {
  StageContract,
  allowedToolSchema,
  contextScopeSchema,
  sideEffectsSchema,
  stagePhaseSchema,
  stageTypeSchema,
} from './stage-contract.js'

// ── Foundation Manifest & Ledger（v2-project-compiler-foundation，保留向后兼容）──
export type {
  CompletenessLedger as FoundationCompletenessLedger,
  GenerationManifest as FoundationGenerationManifest,
  LedgerDeliverable,
  ManifestEntity as FoundationManifestEntity,
  ManifestEntityStatus as FoundationManifestEntityStatus,
  ManifestExecutionStep,
  ManifestStepStatus,
} from './manifest-ledger.js'
export {
  completenessLedgerSchema as foundationCompletenessLedgerSchema,
  generationManifestSchema as foundationGenerationManifestSchema,
  ledgerDeliverableSchema,
  manifestEntitySchema as foundationManifestEntitySchema,
  manifestEntityStatusSchema as foundationManifestEntityStatusSchema,
  manifestExecutionStepSchema,
  manifestStepStatusSchema,
} from './manifest-ledger.js'

// ── Generation Contract（v2-generation-contract-manifest-ledger 新增）──
export type {
  ContractChangeDiff,
  ContractMeta,
  ContentHash,
  ExpectedEntity,
  GenerationContract,
  QualityGate,
  Relationship,
  SourceRef,
} from './generation-contract.js'
export {
  contractChangeDiffSchema,
  contractMetaSchema,
  contentHashSchema,
  expectedEntitySchema,
  generationContractSchema,
  qualityGateSchema,
  relationshipSchema,
  sourceRefSchema,
} from './generation-contract.js'

// ── Generation Manifest（v2-generation-contract-manifest-ledger 增强）──
export type {
  BatchPlan,
  EntityValidator,
  ExecutionPhase,
  GenerationManifest,
  GenerationStrategy,
  ManifestEntity,
  ManifestMeta,
  ModelMode,
  TokenBudget,
} from './generation-manifest.js'
export {
  batchPlanSchema,
  entityValidatorSchema,
  executionPhaseSchema,
  generationManifestSchema,
  generationStrategySchema,
  manifestEntitySchema,
  manifestMetaSchema,
  modelModeSchema,
  tokenBudgetSchema,
} from './generation-manifest.js'

// ── Completeness Ledger（v2-generation-contract-manifest-ledger 增强）──
export type {
  AttemptRecord,
  BlockingItem,
  CompletenessLedger,
  CompletenessSummary,
  LedgerEntry,
  LedgerEntryStatus,
  LedgerMeta,
  ResumeQueue,
  ValidationResult,
} from './completeness-ledger.js'
export {
  attemptRecordSchema,
  blockingItemSchema,
  completenessLedgerSchema,
  completenessSummarySchema,
  ledgerEntrySchema,
  ledgerEntryStatusSchema,
  ledgerMetaSchema,
  resumeQueueSchema,
  validationResultSchema,
} from './completeness-ledger.js'

// ── Deterministic Engine（v2-deterministic-engine-baseline 新增）──
export type {
  AutoFixCandidate,
  CriticalPathResult,
  CriticalPathTaskResult,
  Dependency,
  DependencyType,
  DeterministicEngineResult,
  DiffOp,
  EngineEvidence,
  GraphValidationInput,
  GraphValidationResult,
  HardValidationReport,
  PdmDiff,
  PdmDiffItem,
  ResourceLoadBucket,
  ResourceLoadInput,
  ResourceLoadResult,
  ScheduleComputed,
  ScheduleResult,
  TaskDependency,
  ValidationRuleResult,
  ValidationRuleSeverity,
  WorkingCalendar,
} from './deterministic.js'
export {
  autoFixCandidateSchema,
  criticalPathResultSchema,
  criticalPathTaskResultSchema,
  dependencySchema,
  dependencyTypeSchema,
  deterministicEngineResultSchema,
  diffOpSchema,
  engineEvidenceSchema,
  graphValidationInputSchema,
  graphValidationResultSchema,
  hardValidationReportSchema,
  pdmDiffItemSchema,
  pdmDiffSchema,
  resourceLoadBucketSchema,
  resourceLoadInputSchema,
  resourceLoadResultSchema,
  scheduleComputedSchema,
  scheduleResultSchema,
  taskDependencySchema,
  validationRuleResultSchema,
  validationRuleSeveritySchema,
  workingCalendarSchema,
} from './deterministic.js'

// ── Idempotency Key（v2-generation-contract-manifest-ledger 新增）──
export type { IdempotencyKey, IdempotencyKeyType } from './idempotency.js'
export {
  IDEMPOTENCY_SCOPE,
  artifactIdempotencyKey,
  contractIdempotencyKey,
  generateIdempotencyKey,
  idempotencyKeyHash,
  isAttemptNewer,
  ledgerIdempotencyKey,
  manifestIdempotencyKey,
  parseIdempotencyKey,
} from './idempotency.js'

// ── Artifact / Context（v2-context-compiler-artifact-store 新增）──
export type {
  ArtifactEnvelope,
  ArtifactRef,
  ArtifactSummaryLevel,
  ContextBudget,
  ContextCompilerError,
  ContextPacket,
  ContextPriority,
  ContextProvenance,
  ContextSection,
} from './artifact-context.js'
export {
  artifactEnvelopeSchema,
  artifactRefSchema,
  artifactSummaryLevelSchema,
  contextBudgetSchema,
  contextCompilerErrorSchema,
  contextPacketSchema,
  contextPrioritySchema,
  contextProvenanceSchema,
  contextSectionSchema,
  estimateTokens,
  parseArtifactRef,
  stringifyArtifactRef,
  validateArtifactRef,
} from './artifact-context.js'

// ── Context Compiler Fixtures（v2-context-compiler-artifact-store §1.6 P1）──
export {
  ALL_FIXTURE_REFS,
  CONTRACT_REF,
  FIXTURE_ENTITY_ID,
  FIXTURE_ORG_ID,
  FIXTURE_RUN_ID,
  FIXTURE_STAGE_ID,
  LEDGER_REF,
  LONG_TEXT_ARTIFACT,
  LONG_TEXT_PAYLOAD,
  MANIFEST_REF,
  MINIMAL_USER_INPUT,
  PDM_REF,
  REPAIR_FEEDBACK_ENTRIES,
  generate1000TaskBudgetSample,
  verify1000TaskTokenEstimate,
} from './compiler-context.fixtures.js'

// ── Validation（v2-hard-validator-soft-evaluator 新增）──
export type {
  CostAndLatencySummary,
  EvaluationProfile,
  HardRuleApplicableProfile,
  HardRuleCategory,
  HardRuleDefaultSeverity,
  HardRuleImplementation,
  HardRuleRegistry,
  HardRuleRegistryEntry,
  HardRuleRequiredInput,
  HardValidationInputSignature,
  HardValidationIssue,
  HardValidationNotApplicable,
  SoftDimensionGroup,
  SoftDimensionRegistry,
  SoftDimensionRegistryEntry,
  SoftDimensionRubric,
  SoftDimensionScore,
  SoftEvaluationReport,
  V2HardValidationReport,
  VGateDecision,
  VGateDecisionStatus,
  ValidationInputContext,
  ValidationLedgerEvidence,
} from './validation.js'
export {
  HV_RULE_IDS,
  SE_DIMENSION_IDS,
  costAndLatencySummarySchema,
  evaluationProfileSchema,
  hardRuleApplicableProfileSchema,
  hardRuleCategorySchema,
  hardRuleDefaultSeveritySchema,
  hardRuleImplementationSchema,
  hardRuleRegistryEntrySchema,
  hardRuleRegistrySchema,
  hardRuleRequiredInputSchema,
  hardValidationInputSignatureSchema,
  hardValidationIssueSchema,
  hardValidationNotApplicableSchema,
  softDimensionGroupSchema,
  softDimensionRegistryEntrySchema,
  softDimensionRegistrySchema,
  softDimensionRubricSchema,
  softDimensionScoreSchema,
  softEvaluationReportSchema,
  v2HardValidationReportSchema,
  vGateDecisionSchema,
  vGateDecisionStatusSchema,
  validationInputContextSchema,
  validationLedgerEvidenceSchema,
} from './validation.js'

// ── Repair / Reconciliation（v2-repair-loop-reconciliation 新增）──
export type {
  CascadeGuard,
  PatchOp,
  PatchRiskLevel,
  ReconciliationFinding,
  ReconciliationReport,
  ReconciliationSeverity,
  Repairability,
  RepairAttempt,
  RepairAttemptStatus,
  RepairBlockedItem,
  RepairBudget,
  RepairCandidatePatch,
  RepairCostSummary,
  RepairErrorCategory,
  RepairEvidenceEntry,
  RepairEvidenceType,
  RepairHistoryQuery,
  RepairIssue,
  RepairIssueSource,
  RepairPlan,
  RepairPlanItem,
  RepairSeverity,
  RevalidationRequest,
  RevalidationResult,
  SuggestedRepairStrategy,
} from './repair-reconciliation.js'
export {
  DEFAULT_REPAIR_BUDGET,
  cascadeGuardSchema,
  patchOpSchema,
  patchRiskLevelSchema,
  reconciliationFindingSchema,
  reconciliationReportSchema,
  reconciliationSeveritySchema,
  repairabilitySchema,
  repairAttemptSchema,
  repairAttemptStatusSchema,
  repairBlockedItemSchema,
  repairBudgetSchema,
  repairCandidatePatchSchema,
  repairCostSummarySchema,
  repairErrorCategorySchema,
  repairEvidenceEntrySchema,
  repairEvidenceTypeSchema,
  repairHistoryQuerySchema,
  repairIssueSchema,
  repairIssueSourceSchema,
  repairPlanItemSchema,
  repairPlanSchema,
  repairSeveritySchema,
  revalidationRequestSchema,
  revalidationResultSchema,
  suggestedRepairStrategySchema,
} from './repair-reconciliation.js'

// ── Traceability / Source Attribution（v2-traceability-source-attribution 新增）──
export type {
  AttributionDetail,
  AttributionEvidenceSnippet,
  AttributionGeneratedBy,
  AttributionGeneratedByDetail,
  AttributionSourceRef,
  EntitySourceSummary,
  HumanReviewStatus,
  SourceAttribution,
  SourceAttributionCreate,
  SourceIntegrityIssue,
  TraceabilityLink,
  TraceabilityLinkCreate,
  TraceabilityLinkSummary,
  TraceabilityRelationType,
} from './traceability.js'
export {
  attributionDetailSchema,
  attributionEvidenceSnippetSchema,
  attributionGeneratedBySchema,
  attributionGeneratedBySchemaDetailed,
  attributionSourceRefSchema,
  entitySourceSummarySchema,
  humanReviewStatusSchema,
  sourceAttributionCreateSchema,
  sourceAttributionSchema,
  sourceIntegrityIssueSchema,
  traceabilityLinkCreateSchema,
  traceabilityLinkSchema,
  traceabilityLinkSummarySchema,
  traceabilityRelationTypeSchema,
} from './traceability.js'

// ── Observability / Cost Controls（v2-compiler-observability-cost-controls 新增）──
export type {
  BudgetDecision,
  BudgetDecisionStatus,
  BudgetPolicy,
  BudgetPolicyInput,
  BudgetScope,
  CacheCutSummary,
  CostSummaryItem,
  ErrorBreakdownItem,
  ErrorCategory,
  FinishReason,
  HardLimitAction,
  LatencySummaryItem,
  ModelBreakdownItem,
  ModelCostEvent,
  ObservabilityEvent,
  ObservabilityEventType,
  ObservabilitySummary,
  RetrySummaryItem,
  SoftLimitAction,
  TokenSummaryItem,
} from './observability-cost-controls.js'
export {
  budgetDecisionSchema,
  budgetDecisionStatusSchema,
  budgetPolicySchema,
  budgetScopeSchema,
  cacheCutSummarySchema,
  costSummaryItemSchema,
  errorBreakdownItemSchema,
  errorCategorySchema,
  finishReasonSchema,
  hardLimitActionSchema,
  latencySummaryItemSchema,
  modelBreakdownItemSchema,
  modelCostEventSchema,
  observabilityEventSchema,
  observabilityEventTypeSchema,
  observabilitySummarySchema,
  retrySummaryItemSchema,
  softLimitActionSchema,
  tokenSummaryItemSchema,
} from './observability-cost-controls.js'

// ── Deterministic UI Renderer（v2-deterministic-ui-renderer 新增）──
export {
  RENDERER_MAX_CONFIG_SIZE,
  RENDERER_CURRENT_SCHEMA_VERSION,
  RENDERER_MAX_FIELDS,
  RENDERER_MAX_FILTERS,
  RENDERER_MAX_OVERRIDE_ENTRIES,
  RENDERER_MAX_SORT,
  RENDERER_OLD_SUPPORTED_VERSIONS,
  RENDERER_UNSUPPORTED_VERSIONS,
  RENDERER_MAX_STRING_LENGTH,
  RENDERER_MAX_TITLE_LENGTH,
  RENDERER_MAX_VIEWS,
  RENDERER_MAX_WIDGETS,
  STRICT_DATA_QUERY_SCHEMA,
  STRICT_PROJECT_VIEW_CONFIG_SCHEMA,
  STRICT_VIEW_CONFIG_SCHEMA,
  aiRendererCandidateSchema,
  candidateStatusSchema,
  configHashSchema,
  configSourceMetadataSchema,
  dashboardWidgetConfigSchema,
  dataQueryConfigSchema,
  dataQueryFilterSchema,
  dataQuerySortSchema,
  dataQuerySourceSchema,
  defaultEntryResolveResultSchema,
  projectViewConfigSchema,
  rendererViewTypeSchema,
  safeIconSchema,
  userViewOverrideEntrySchema,
  userViewOverrideSchema,
  validateConfigSize,
  validationIssueSchema,
  rendererValidationResultSchema,
  viewConfigSchema,
  viewSpecificConfigSchema,
  widgetTypeSchema,
  checkConfigReadiness,
  migrateConfigVersion,
} from './renderer-schema.js'

// ── Renderer Fixtures（v2-deterministic-ui-renderer 新增）──
export {
  ALL_UNSAFE_CONFIGS,
  ALL_VALID_CONFIGS,
  PERMISSION_REDACTED_WIDGET_CONFIG,
  UNSAFE_CODE_CONFIG,
  UNSAFE_QUERY_CONFIG,
  UNSUPPORTED_COMPONENT_CONFIG,
  VALID_DASHBOARD_CONFIG,
  VALID_GANTT_CONFIG,
  VALID_KANBAN_CONFIG,
  VALID_LIST_CONFIG,
  VALID_PROJECT_VIEW_CONFIG,
  VALID_WBS_CONFIG,
  generateOversizedConfig,
} from './renderer-fixtures.js'

// ── Renderer Migration Facade（v2-5-shared-contract-versioning §4.1 P1）──
export {
  RENDERER_CONTRACT_ID,
  registerRendererAdapters,
  migrateRendererConfigViaRegistry,
  checkRendererReadinessViaRegistry,
} from './renderer-migration-facade.js'
