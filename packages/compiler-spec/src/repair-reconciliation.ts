/**
 * @aiproj/compiler-spec —— Repair Loop + Reconciliation 数据契约。
 *
 * V2 Project Compiler 的 repair/reconciliation 类型与 zod schema。
 * 定义 repair issue、repair plan、repair attempt、candidate patch、budget、
 * cascade guard、reconciliation finding/report 和 repair evidence。
 *
 * ⚠️ 新增 public type/function 必须同步更新 index.ts re-export。
 *
 * @aiproj/compiler-spec
 */

import { z } from 'zod'

// ============================================================================
// 1. Repair Issue（任务 1.1）
// ============================================================================

/** Issue 来源。 */
export const repairIssueSourceSchema = z.enum([
  'schema_parse',
  'reference_integrity',
  'deterministic',
  'hard_validator',
  'soft_evaluator',
  'v_gate',
  'llm_output',
  'reconciliation',
  'stage_contract',
  'manifest_ledger',
])
export type RepairIssueSource = z.infer<typeof repairIssueSourceSchema>

/** Issue 严重度。 */
export const repairSeveritySchema = z.enum(['blocking', 'warning', 'info'])
export type RepairSeverity = z.infer<typeof repairSeveritySchema>

/** Issue 可修复性。 */
export const repairabilitySchema = z.enum([
  'deterministic_auto_fixable',
  'retryable',
  'human_review_required',
  'not_repairable',
])
export type Repairability = z.infer<typeof repairabilitySchema>

/** 建议的修复策略。 */
export const suggestedRepairStrategySchema = z.enum([
  'deterministic_auto_fix',
  'same_stage_llm_retry',
  'human_review',
  'skip',
])
export type SuggestedRepairStrategy = z.infer<typeof suggestedRepairStrategySchema>

/** Repair Issue 核心类型（任务 1.1）。 */
export const repairIssueSchema = z.object({
  issueId: z.string().min(1),
  source: repairIssueSourceSchema,
  stageId: z.string().min(1),
  entityIds: z.array(z.string()).default([]),
  ruleId: z.string().optional(),
  dimensionId: z.string().optional(),
  severity: repairSeveritySchema,
  repairability: repairabilitySchema,
  suggestedStrategy: suggestedRepairStrategySchema.optional(),
  evidenceRefs: z.array(z.string()).default([]),
  description: z.string().default(''),
  affectedPaths: z.array(z.string()).default([]),
  createdAt: z.string(),
})
export type RepairIssue = z.infer<typeof repairIssueSchema>

// ============================================================================
// 2. Repair Plan（任务 1.2）
// ============================================================================

/** Repair Plan Item（单个 issue 的修复条目）。 */
export const repairPlanItemSchema = z.object({
  itemId: z.string().min(1),
  issueId: z.string().min(1),
  strategy: suggestedRepairStrategySchema,
  entityIds: z.array(z.string()).default([]),
  stageId: z.string().min(1),
  priority: z.number().int().min(0).default(0),
  estimatedCost: z
    .object({
      estimatedAttempts: z.number().int().min(1).default(1),
      estimatedTokens: z.number().int().min(0).default(0),
    })
    .optional(),
  executable: z.boolean().default(true),
  blockedReason: z.string().optional(),
})
export type RepairPlanItem = z.infer<typeof repairPlanItemSchema>

/** Repair Budget（任务 1.2）。 */
export const repairBudgetSchema = z.object({
  maxAttemptsPerItem: z.number().int().min(1).default(3),
  maxTotalAttempts: z.number().int().min(1).default(10),
  maxLlmRetries: z.number().int().min(0).default(2),
  maxCascadeDepth: z.number().int().min(0).default(3),
  maxWallClockMs: z.number().int().min(0).default(30000),
  maxTokenBudget: z.number().int().min(0).default(50000),
})
export type RepairBudget = z.infer<typeof repairBudgetSchema>

/** Cascade Guard（任务 1.2）。 */
export const cascadeGuardSchema = z.object({
  changedEntityIds: z.array(z.string()).default([]),
  changedPaths: z.array(z.string()).default([]),
  affectedEntityIds: z.array(z.string()).default([]),
  cascadeDepth: z.number().int().min(0).default(0),
  exceedsLimit: z.boolean().default(false),
})
export type CascadeGuard = z.infer<typeof cascadeGuardSchema>

/** Repair Blocked Item（任务 1.2）。 */
export const repairBlockedItemSchema = z.object({
  itemId: z.string().min(1),
  issueId: z.string().min(1),
  reason: z.enum([
    'budget_exhausted',
    'cascade_exceeded',
    'needs_human_review',
    'not_repairable',
    'already_fixed',
    'skipped_by_policy',
  ]),
  description: z.string().default(''),
})
export type RepairBlockedItem = z.infer<typeof repairBlockedItemSchema>

/** Repair Plan 完整类型（任务 1.2）。 */
export const repairPlanSchema = z.object({
  planId: z.string().min(1),
  compilerRunId: z.number().int().positive(),
  policyProfile: z.string().default('default'),
  budget: repairBudgetSchema,
  cascadeDepth: z.number().int().min(0).default(0),
  items: z.array(repairPlanItemSchema).default([]),
  blockedItems: z.array(repairBlockedItemSchema).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  createdAt: z.string(),
})
export type RepairPlan = z.infer<typeof repairPlanSchema>

// ============================================================================
// 3. Repair Attempt（任务 1.3）
// ============================================================================

/** Attempt 状态。 */
export const repairAttemptStatusSchema = z.enum([
  'pending',
  'in_progress',
  'succeeded',
  'failed',
  'degraded_to_human_review',
  'skipped',
  'budget_exhausted',
])
export type RepairAttemptStatus = z.infer<typeof repairAttemptStatusSchema>

/** 错误类别。 */
export const repairErrorCategorySchema = z.enum([
  'schema_validation',
  'reference_integrity',
  'deterministic_failure',
  'llm_empty',
  'llm_malformed_json',
  'llm_truncated',
  'llm_unknown_entity',
  'llm_duplicate_entity',
  'llm_retry_exhausted',
  'budget_exhausted',
  'cascade_exceeded',
  'revalidation_failed',
  'internal_error',
  'none',
])
export type RepairErrorCategory = z.infer<typeof repairErrorCategorySchema>

/** Cost Summary（任务 1.3）。 */
export const repairCostSummarySchema = z.object({
  tokensUsed: z.number().int().min(0).default(0),
  llmCallsMade: z.number().int().min(0).default(0),
  deterministicAttempts: z.number().int().min(0).default(0),
  latencyMs: z.number().int().min(0).default(0),
})
export type RepairCostSummary = z.infer<typeof repairCostSummarySchema>

/** Repair Attempt（任务 1.3）。 */
export const repairAttemptSchema = z.object({
  attemptId: z.string().min(1),
  issueId: z.string().min(1),
  planItemId: z.string().min(1),
  strategy: suggestedRepairStrategySchema,
  stageId: z.string().min(1),
  entityIds: z.array(z.string()).default([]),
  attemptNumber: z.number().int().min(1),
  inputArtifactRefs: z.array(z.string()).default([]),
  outputArtifactRefs: z.array(z.string()).default([]),
  status: repairAttemptStatusSchema,
  costSummary: repairCostSummarySchema.optional(),
  errorCategory: repairErrorCategorySchema.default('none'),
  errorMessage: z.string().optional(),
  idempotencyKey: z.string().min(1),
  startedAt: z.string(),
  completedAt: z.string().optional(),
})
export type RepairAttempt = z.infer<typeof repairAttemptSchema>

// ============================================================================
// 4. Candidate Patch（任务 1.4）
// ============================================================================

/** Patch op 类型。 */
export const patchOpSchema = z.enum(['replace', 'add', 'remove', 'transform'])
export type PatchOp = z.infer<typeof patchOpSchema>

/** Patch 风险等级。 */
export const patchRiskLevelSchema = z.enum(['safe', 'low_risk', 'medium_risk', 'high_risk'])
export type PatchRiskLevel = z.infer<typeof patchRiskLevelSchema>

/** Repair Candidate Patch（任务 1.4）。 */
export const repairCandidatePatchSchema = z.object({
  patchId: z.string().min(1),
  attemptId: z.string().min(1),
  issueIds: z.array(z.string()).default([]),
  baseArtifactRef: z.string().min(1),
  targetArtifactRef: z.string().optional(),
  entityIds: z.array(z.string()).min(1),
  ops: z
    .array(
      z.object({
        op: patchOpSchema,
        path: z.string().min(1),
        value: z.unknown(),
        oldValue: z.unknown().optional(),
        reason: z.string().optional(),
      }),
    )
    .min(1),
  isSchemaPath: z.boolean().default(true),
  reason: z.string().default(''),
  sourceRuleIds: z.array(z.string()).default([]),
  attemptNumber: z.number().int().min(1).default(1),
  riskLevel: patchRiskLevelSchema.default('low_risk'),
  confidence: z.number().min(0).max(1).default(0.5),
  idempotencyKey: z.string().min(1),
  createdAt: z.string(),
  revalidationStatus: z.enum(['pending', 'passed', 'failed', 'not_applicable']).default('pending'),
})
export type RepairCandidatePatch = z.infer<typeof repairCandidatePatchSchema>

// ============================================================================
// 5. Revalidation Request/Result（任务 1.5）
// ============================================================================

/** Revalidation Request（任务 1.5）。 */
export const revalidationRequestSchema = z.object({
  requestId: z.string().min(1),
  compilerRunId: z.number().int().positive(),
  attemptId: z.string().min(1),
  affectedEntityIds: z.array(z.string()).default([]),
  affectedClosurePaths: z.array(z.string()).default([]),
  artifactRefs: z.array(z.string()).default([]),
  includeDeterministicRecompute: z.boolean().default(true),
  includeHardValidation: z.boolean().default(true),
  includeVGate: z.boolean().default(true),
  createdAt: z.string(),
})
export type RevalidationRequest = z.infer<typeof revalidationRequestSchema>

/** Revalidation Result（任务 1.5）。 */
export const revalidationResultSchema = z.object({
  requestId: z.string().min(1),
  passed: z.boolean(),
  schemaValid: z.boolean().default(true),
  referencesValid: z.boolean().default(true),
  deterministicValid: z.boolean().default(true),
  hardValidationValid: z.boolean().default(true),
  vGateDecision: z.enum(['pass', 'conditional_pass', 'blocked', 'awaiting_review']).optional(),
  vGateSummary: z.string().optional(),
  affectedEntityIds: z.array(z.string()).default([]),
  remainingIssues: z.array(z.string()).default([]),
  summary: z.string().default(''),
  completedAt: z.string(),
})
export type RevalidationResult = z.infer<typeof revalidationResultSchema>

// ============================================================================
// 6. Reconciliation Finding / Report（任务 1.6）
// ============================================================================

/** Reconciliation finding 严重度。 */
export const reconciliationSeveritySchema = z.enum(['blocking', 'warning', 'info'])
export type ReconciliationSeverity = z.infer<typeof reconciliationSeveritySchema>

/** Reconciliation Rule ID。 */
export const reconciliationRuleIdSchema = z.string().min(1)
export type ReconciliationRuleId = z.infer<typeof reconciliationRuleIdSchema>

/** Reconciliation finding（任务 1.6）。 */
export const reconciliationFindingSchema = z.object({
  findingId: z.string().min(1),
  ruleId: z.string().min(1),
  severity: reconciliationSeveritySchema,
  entityIds: z.array(z.string()).default([]),
  affectedFields: z.array(z.string()).default([]),
  description: z.string().min(1),
  expected: z.string().optional(),
  actual: z.string().optional(),
  candidatePatchRef: z.string().optional(),
  requiresHumanReview: z.boolean().default(false),
  createdAt: z.string(),
})
export type ReconciliationFinding = z.infer<typeof reconciliationFindingSchema>

/** Reconciliation Report（任务 1.6）。 */
export const reconciliationReportSchema = z.object({
  reportId: z.string().min(1),
  compilerRunId: z.number().int().positive(),
  scope: z
    .enum([
      'global',
      'wbs_task',
      'schedule',
      'milestone',
      'resource',
      'risk',
      'pdm_ledger',
      'custom',
    ])
    .default('global'),
  rulesetVersion: z.string().default('2.0'),
  summary: z.object({
    totalFindings: z.number().int().min(0),
    blockingCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    infoCount: z.number().int().min(0),
    candidatePatches: z.number().int().min(0),
    reviewItems: z.number().int().min(0),
  }),
  findings: z.array(reconciliationFindingSchema).default([]),
  candidatePatchRefs: z.array(z.string()).default([]),
  blockingItems: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  generatedAt: z.string(),
})
export type ReconciliationReport = z.infer<typeof reconciliationReportSchema>

// ============================================================================
// 7. Repair Evidence（任务 1.7）
// ============================================================================

/** Repair evidence 条目类型。 */
export const repairEvidenceTypeSchema = z.enum([
  'repair_plan_generated',
  'repair_attempt_executed',
  'candidate_patch_created',
  'revalidation_completed',
  'reconciliation_report_generated',
  'repair_budget_exceeded',
  'repair_item_blocked',
  'repair_plan_item_skipped',
  'human_review_requested',
])
export type RepairEvidenceType = z.infer<typeof repairEvidenceTypeSchema>

/** Repair evidence 条目（任务 1.7）。 */
export const repairEvidenceEntrySchema = z.object({
  evidenceId: z.string().min(1),
  compilerRunId: z.number().int().positive(),
  evidenceType: repairEvidenceTypeSchema,
  stageId: z.string().optional(),
  planId: z.string().optional(),
  attemptId: z.string().optional(),
  patchId: z.string().optional(),
  reportId: z.string().optional(),
  summary: z
    .object({
      entityCount: z.number().int().min(0).default(0),
      attemptCount: z.number().int().min(0).default(0),
      tokenCost: z.number().int().min(0).default(0),
      llmCalls: z.number().int().min(0).default(0),
      status: z.string().default(''),
    })
    .optional(),
  createdAt: z.string(),
})
export type RepairEvidenceEntry = z.infer<typeof repairEvidenceEntrySchema>

/** Repair history query DTO（任务 1.7）。 */
export const repairHistoryQuerySchema = z.object({
  compilerRunId: z.number().int().positive().optional(),
  organizationId: z.number().int().positive().optional(),
  stageId: z.string().optional(),
  planId: z.string().optional(),
  attemptStatus: repairAttemptStatusSchema.optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
})
export type RepairHistoryQuery = z.infer<typeof repairHistoryQuerySchema>

// ============================================================================
// Default budget constants（任务 2.6 默认值来源）
// ============================================================================

export const DEFAULT_REPAIR_BUDGET: z.infer<typeof repairBudgetSchema> = {
  maxAttemptsPerItem: 3,
  maxTotalAttempts: 10,
  maxLlmRetries: 2,
  maxCascadeDepth: 3,
  maxWallClockMs: 30000,
  maxTokenBudget: 50000,
}
