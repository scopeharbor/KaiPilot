/**
 * v2-ai-draft-layer-preview-diff-apply —— Draft Layer 运行时 zod schema（task 1.1 后端侧）。
 *
 * 与 `@aiproj/types` 的 Draft Layer 静态类型互为镜像。
 * 提供 safeParse 与字段路径错误映射。
 */
import { z } from 'zod'
import {
  DRAFT_LAYER_SOURCE_TYPES,
  DRAFT_LAYER_SESSION_STATUSES,
  DRAFT_LAYER_CHANGE_OPERATIONS,
  DRAFT_LAYER_REVIEW_STATUSES,
  DRAFT_LAYER_CONFLICT_SEVERITIES,
  DRAFT_LAYER_APPLY_STATUSES,
  DRAFT_LAYER_ENTITY_TYPES,
  DRAFT_LAYER_DIFF_OPERATIONS,
} from '@aiproj/types'

// ── Target ──

const changeTargetSchema = z.object({
  entityType: z.enum(DRAFT_LAYER_ENTITY_TYPES),
  entityId: z.string().min(1),
  fieldPath: z.string().nullable(),
})

// ── Change Validation ──

const changeValidationSchema = z.object({
  blocking: z.array(z.string()),
  warning: z.array(z.string()),
  info: z.array(z.string()),
})

// ── Session Summary ──

const sessionSummarySchema = z.object({
  compilerRunStatus: z.string().optional(),
  ledgerStatus: z.string().optional(),
  pdmEntityCount: z.number().int().min(0).optional(),
  totalChanges: z.number().int().min(0),
  acceptedChanges: z.number().int().min(0),
  rejectedChanges: z.number().int().min(0),
  pendingChanges: z.number().int().min(0),
  unresolvedConflicts: z.number().int().min(0),
  dryRunStatus: z.enum(DRAFT_LAYER_APPLY_STATUSES).nullable(),
  applyStatus: z.enum(DRAFT_LAYER_APPLY_STATUSES).nullable(),
})

// ── Change ──

export const draftLayerChangeSchema = z.object({
  sessionId: z.number().int().positive(),
  target: changeTargetSchema,
  operation: z.enum(DRAFT_LAYER_CHANGE_OPERATIONS),
  path: z.string().min(1),
  value: z.unknown(),
  oldValue: z.unknown().nullable(),
  reviewStatus: z.enum(DRAFT_LAYER_REVIEW_STATUSES).default('pending'),
  userModifiedValue: z.unknown().nullable(),
  userNote: z.string().max(2000).nullable(),
  sequence: z.number().int().min(1),
  dependsOn: z.array(z.number().int().positive()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  validationSummary: changeValidationSchema.nullable(),
})

// ── Preview ──

export const draftLayerPreviewSchema = z.object({
  sessionId: z.number().int().positive(),
  version: z.number().int().positive().default(1),
  baselineSummary: z.record(z.string(), z.unknown()).nullable(),
  currentSummary: z.record(z.string(), z.unknown()).nullable(),
  previewHash: z.string().min(1),
  computedFromChangeIds: z.array(z.number().int().positive()).default([]),
  validationSummary: z
    .object({
      blocking: z.array(z.string()),
      warning: z.array(z.string()),
      info: z.array(z.string()),
    })
    .nullable(),
})

// ── Apply Result ──

export const draftLayerApplyResultSchema = z.object({
  sessionId: z.number().int().positive(),
  applyPlanHash: z.string().min(1),
  selectionHash: z.string().min(1),
  status: z.enum(DRAFT_LAYER_APPLY_STATUSES),
  projectId: z.number().int().positive().nullable(),
  entityCounts: z
    .object({
      projects: z.number().int().min(0),
      wbsNodes: z.number().int().min(0),
      tasks: z.number().int().min(0),
      dependencies: z.number().int().min(0),
      milestones: z.number().int().min(0),
      acceptanceCriteria: z.number().int().min(0),
      risks: z.number().int().min(0),
      resources: z.number().int().min(0),
    })
    .nullable(),
  errorSummary: z.string().nullable(),
  idempotencyKey: z.string().min(1).max(100),
  appliedAt: z.string().datetime().nullable(),
})

// ── Session ──

export const draftLayerSessionSchema = z.object({
  organizationId: z.number().int().positive(),
  createdByUserId: z.number().int().positive(),
  sourceType: z.enum(DRAFT_LAYER_SOURCE_TYPES),
  compilerRunId: z.number().int().positive().nullable(),
  pdmArtifactId: z.string().nullable(),
  pdmHash: z.string().nullable(),
  status: z.enum(DRAFT_LAYER_SESSION_STATUSES).default('active'),
  version: z.number().int().positive().default(1),
  summary: sessionSummarySchema.nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
})

// ── PDM Handoff ──

const ledgerSummarySchema = z.object({
  totalEntities: z.number().int().min(0),
  completedEntities: z.number().int().min(0),
  needsHumanReview: z.boolean(),
  blockingItems: z.array(z.string()),
  hasBlockingHumanReview: z.boolean(),
})

export const pdmHandoffSchema = z.object({
  compilerRunId: z.number().int().positive(),
  pdmArtifactId: z.string().min(1),
  pdmHash: z.string().min(1),
  ledgerSummary: ledgerSummarySchema,
  status: z.enum(['ready_to_handoff', 'needs_human_review', 'blocked']),
})

// ── Entity Diff ──

export const draftLayerFieldDiffSchema = z.object({
  field: z.string(),
  operation: z.enum(DRAFT_LAYER_DIFF_OPERATIONS),
  baselineValue: z.unknown().nullable(),
  currentValue: z.unknown().nullable(),
  previewValue: z.unknown().nullable(),
  conflict: z.boolean().default(false),
  conflictDetails: z.string().nullable(),
})

export const draftLayerDiffEntitySchema = z.object({
  entityType: z.enum(DRAFT_LAYER_ENTITY_TYPES),
  tempId: z.string().min(1),
  operation: z.enum(DRAFT_LAYER_DIFF_OPERATIONS),
  conflictSeverity: z.enum(DRAFT_LAYER_CONFLICT_SEVERITIES).default('none'),
  fieldDiffs: z.array(draftLayerFieldDiffSchema).default([]),
})

export const draftLayerDiffResultSchema = z.object({
  sessionId: z.number().int().positive(),
  previewHash: z.string(),
  baselineVersion: z.number().int().nullable(),
  currentVersion: z.number().int().nullable(),
  entities: z.array(draftLayerDiffEntitySchema),
  entitySummaries: z.array(
    z.object({
      entityType: z.enum(DRAFT_LAYER_ENTITY_TYPES),
      added: z.number().int().min(0),
      modified: z.number().int().min(0),
      removed: z.number().int().min(0),
      unchanged: z.number().int().min(0),
      conflicts: z.number().int().min(0),
    }),
  ),
  patchOperations: z.array(
    z.object({
      op: z.enum(['add', 'remove', 'replace']),
      path: z.string(),
      value: z.unknown().nullable(),
      oldValue: z.unknown().nullable(),
    }),
  ),
})
