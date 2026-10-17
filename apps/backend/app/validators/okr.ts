import vine from '@vinejs/vine'
import {
  OKR_SCOPE_VALUES,
  OKR_STATUS_VALUES,
  OKR_MEASUREMENT_TYPE_VALUES,
  OKR_CONFIDENCE_LEVEL_VALUES,
  OKR_SORT_FIELD_VALUES,
  OKR_INCLUDE_VALUES,
  OKR_EVIDENCE_SOURCE_KIND_VALUES,
  OKR_EVIDENCE_TARGET_KINDS,
  OKR_RELATION_TYPE_VALUES,
  OKR_RELATION_STATUS_VALUES,
  OKR_HEALTH_LEVEL_VALUES,
  OKR_CASCADE_PLAN_STATUS_VALUES,
} from '@aiproj/types'

// ── Cycle ──────────────────────────────────────────────────────────────────

export const okrCycleCreateValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().maxLength(2000).nullable().optional(),
    startDate: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: vine.enum(OKR_STATUS_VALUES).optional(),
  }),
)

export const okrCycleUpdateValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(255).optional(),
    description: vine.string().trim().maxLength(2000).nullable().optional(),
    startDate: vine
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: vine
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    status: vine.enum(OKR_STATUS_VALUES).optional(),
  }),
)

// ── Objective ──────────────────────────────────────────────────────────────

export const okrObjectiveCreateValidator = vine.compile(
  vine.object({
    cycleId: vine.number().positive().nullable().optional(),
    projectId: vine.number().positive().nullable().optional(),
    teamId: vine.number().positive().nullable().optional(),
    ownerId: vine.number().positive().nullable().optional(),
    scope: vine.enum(OKR_SCOPE_VALUES),
    title: vine.string().trim().minLength(1).maxLength(500),
    description: vine.string().trim().maxLength(5000).nullable().optional(),
    status: vine.enum(OKR_STATUS_VALUES).optional(),
    weight: vine.number().min(0).max(100).optional(),
    startDate: vine
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    endDate: vine
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  }),
)

export const okrObjectiveUpdateValidator = vine.compile(
  vine.object({
    cycleId: vine.number().positive().nullable().optional(),
    projectId: vine.number().positive().nullable().optional(),
    teamId: vine.number().positive().nullable().optional(),
    ownerId: vine.number().positive().nullable().optional(),
    scope: vine.enum(OKR_SCOPE_VALUES).optional(),
    title: vine.string().trim().minLength(1).maxLength(500).optional(),
    description: vine.string().trim().maxLength(5000).nullable().optional(),
    status: vine.enum(OKR_STATUS_VALUES).optional(),
    weight: vine.number().min(0).max(100).optional(),
    startDate: vine
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    endDate: vine
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  }),
)

// ── Key Result ─────────────────────────────────────────────────────────────

export const okrKeyResultCreateValidator = vine.compile(
  vine.object({
    objectiveId: vine.number().positive(),
    title: vine.string().trim().minLength(1).maxLength(500),
    description: vine.string().trim().maxLength(5000).nullable().optional(),
    measurementType: vine.enum(OKR_MEASUREMENT_TYPE_VALUES),
    unitLabel: vine.string().trim().maxLength(50).nullable().optional(),
    baselineValue: vine.number(),
    targetValue: vine.number(),
    currentValue: vine.number().optional(),
    confidence: vine.enum(OKR_CONFIDENCE_LEVEL_VALUES).optional(),
    status: vine.enum(OKR_STATUS_VALUES).optional(),
    weight: vine.number().min(0).max(100).optional(),
  }),
)

export const okrKeyResultUpdateValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(500).optional(),
    description: vine.string().trim().maxLength(5000).nullable().optional(),
    measurementType: vine.enum(OKR_MEASUREMENT_TYPE_VALUES).optional(),
    unitLabel: vine.string().trim().maxLength(50).nullable().optional(),
    baselineValue: vine.number().optional(),
    targetValue: vine.number().optional(),
    currentValue: vine.number().optional(),
    confidence: vine.enum(OKR_CONFIDENCE_LEVEL_VALUES).optional(),
    status: vine.enum(OKR_STATUS_VALUES).optional(),
    weight: vine.number().min(0).max(100).optional(),
  }),
)

// ── Progress ───────────────────────────────────────────────────────────────

export const okrProgressUpdateValidator = vine.compile(
  vine.object({
    currentValue: vine.number(),
    confidence: vine.enum(OKR_CONFIDENCE_LEVEL_VALUES).optional(),
    note: vine.string().trim().maxLength(2000).nullable().optional(),
    evidenceRefs: vine.string().trim().maxLength(2000).nullable().optional(),
  }),
)

// ── Alignment ──────────────────────────────────────────────────────────────

export const okrAlignmentCreateValidator = vine.compile(
  vine.object({
    childObjectiveId: vine.number().positive(),
    parentObjectiveId: vine.number().positive(),
  }),
)

// ── Evidence ───────────────────────────────────────────────────────────────

export const okrEvidenceLinkCreateValidator = vine.compile(
  vine.object({
    targetType: vine.enum(Object.values(OKR_EVIDENCE_TARGET_KINDS)),
    targetId: vine.number().positive(),
    sourceKind: vine.enum(OKR_EVIDENCE_SOURCE_KIND_VALUES),
    sourceId: vine.number().positive(),
    summary: vine.string().trim().minLength(1).maxLength(2000),
  }),
)

// ── AI Draft ───────────────────────────────────────────────────────────────

export const okrAiDraftValidator = vine.compile(
  vine.object({
    cycleId: vine.number().positive().nullable().optional(),
    scope: vine.enum(OKR_SCOPE_VALUES).optional(),
    context: vine.string().trim().maxLength(10000).nullable().optional(),
    includeAlignment: vine.boolean().optional(),
    includeRisk: vine.boolean().optional(),
  }),
)

export const okrAiDraftConfirmationValidator = vine.compile(
  vine.object({
    draftId: vine.string().trim().minLength(1).maxLength(100),
    accepted: vine.array(
      vine.object({
        kind: vine.enum(['objective', 'key_result', 'alignment']),
        data: vine.object({}).allowUnknownProperties(),
      }),
    ),
  }),
)

// ── Query ──────────────────────────────────────────────────────────────────

export const okrCycleListQueryValidator = vine.compile(
  vine.object({
    status: vine.enum(OKR_STATUS_VALUES).optional(),
    sort: vine.enum(OKR_SORT_FIELD_VALUES).optional(),
    order: vine.enum(['asc', 'desc']).optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)

// ── OKR Progress Backflow (v3-okr-progress-backflow) ───────────────────────

export const okrBackflowListQueryValidator = vine.compile(
  vine.object({
    keyResultId: vine.number().positive().optional(),
    objectiveId: vine.number().positive().optional(),
    cycleId: vine.number().positive().optional(),
    status: vine.enum(['pending', 'needs_review', 'confirmed', 'rejected', 'stale']).optional(),
    warningCode: vine
      .enum([
        'MANUAL_OVERRIDE_CONFLICT',
        'RECENT_MANUAL_UPDATE',
        'RESTRICTED_SOURCE',
        'INVALID_AGGREGATE_WEIGHT',
        'STALE_SOURCE',
        'SOURCE_UNAVAILABLE',
        'CANCELLED_PROJECT',
        'PAUSED_PROJECT',
        'UNSUPPORTED_LIFECYCLE',
        'CONCURRENT_UPDATE_CONFLICT',
        'BASE_PROGRESS_VERSION_MISMATCH',
        'SUGGESTION_HASH_MISMATCH',
        'NESTED_SOURCE_DEDUP',
      ])
      .optional(),
    sort: vine.enum(['calculatedAt', 'createdAt', 'delta']).optional(),
    order: vine.enum(['asc', 'desc']).optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)

export const okrBackflowRecalculateValidator = vine.compile(
  vine.object({
    keyResultId: vine.number().positive(),
  }),
)

export const okrBackflowBatchRecalculateValidator = vine.compile(
  vine.object({
    scope: vine.enum(['objective', 'cycle']),
    scopeId: vine.number().positive(),
    maxKrCount: vine.number().min(1).max(100).optional(),
  }),
)

export const okrBackflowConfirmValidator = vine.compile(
  vine.object({
    suggestionId: vine.number().positive(),
    note: vine.string().trim().maxLength(2000).nullable().optional(),
  }),
)

export const okrBackflowRejectValidator = vine.compile(
  vine.object({
    suggestionId: vine.number().positive(),
    reasonCode: vine.enum([
      'VALUE_INACCURATE',
      'SOURCE_STALE',
      'CONTRIBUTION_MISMATCH',
      'MANUAL_OVERRIDE_PREFERRED',
      'RESTRICTED_DATA_CONCERN',
      'OTHER',
    ]),
    reasonNote: vine.string().trim().minLength(1).maxLength(500),
  }),
)

export const okrObjectiveListQueryValidator = vine.compile(
  vine.object({
    cycleId: vine.number().positive().optional(),
    scope: vine.enum(OKR_SCOPE_VALUES).optional(),
    status: vine.enum(OKR_STATUS_VALUES).optional(),
    ownerId: vine.number().positive().optional(),
    projectId: vine.number().positive().optional(),
    teamId: vine.number().positive().optional(),
    sort: vine.enum(OKR_SORT_FIELD_VALUES).optional(),
    order: vine.enum(['asc', 'desc']).optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    include: vine.array(vine.enum(OKR_INCLUDE_VALUES)).optional(),
  }),
)

export const okrTreeQueryValidator = vine.compile(
  vine.object({
    cycleId: vine.number().positive().optional(),
    scope: vine.enum(OKR_SCOPE_VALUES).optional(),
    status: vine.enum(OKR_STATUS_VALUES).optional(),
    depth: vine.number().min(1).max(5).optional(),
    rootObjectiveId: vine.number().positive().optional(),
    include: vine.array(vine.enum(OKR_INCLUDE_VALUES)).optional(),
  }),
)

export const okrKeyResultListQueryValidator = vine.compile(
  vine.object({
    objectiveId: vine.number().positive().optional(),
    status: vine.enum(OKR_STATUS_VALUES).optional(),
    sort: vine.enum(OKR_SORT_FIELD_VALUES).optional(),
    order: vine.enum(['asc', 'desc']).optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    include: vine.array(vine.enum(OKR_INCLUDE_VALUES)).optional(),
  }),
)

export const okrEvidenceListQueryValidator = vine.compile(
  vine.object({
    targetType: vine.enum(Object.values(OKR_EVIDENCE_TARGET_KINDS)).optional(),
    targetId: vine.number().positive().optional(),
    sourceKind: vine.enum(OKR_EVIDENCE_SOURCE_KIND_VALUES).optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)

// ── OKR Cascade & Alignment (v3-okr-cascade-and-alignment) ─────────────────

export const okrCascadePlanCreateValidator = vine.compile(
  vine.object({
    sourceObjectiveId: vine.number().positive(),
    title: vine.string().trim().minLength(1).maxLength(500).optional(),
    includePersonalScope: vine.boolean().optional(),
  }),
)

export const okrCascadePlanListQueryValidator = vine.compile(
  vine.object({
    status: vine.enum(OKR_CASCADE_PLAN_STATUS_VALUES).optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)

export const okrCascadeItemConfirmValidator = vine.compile(
  vine.object({
    acceptedItemIds: vine.array(vine.number().positive()).minLength(1),
    rejectedItemIds: vine.array(vine.number().positive()).optional(),
    rejectionReasons: vine.object({}).allowUnknownProperties().optional(),
  }),
)

export const okrCascadeItemRejectValidator = vine.compile(
  vine.object({
    rejectedItemIds: vine.array(vine.number().positive()).minLength(1),
    reason: vine.string().trim().minLength(1).maxLength(2000),
  }),
)

export const okrRelationCreateValidator = vine.compile(
  vine.object({
    sourceObjectiveId: vine.number().positive(),
    targetObjectiveId: vine.number().positive(),
    relationType: vine.enum(OKR_RELATION_TYPE_VALUES),
    impactWeight: vine.number().min(0).max(10).optional(),
    reasonCode: vine.string().trim().maxLength(100).nullable().optional(),
  }),
)

export const okrRelationUpdateValidator = vine.compile(
  vine.object({
    relationType: vine.enum(OKR_RELATION_TYPE_VALUES).optional(),
    impactWeight: vine.number().min(0).max(10).optional(),
    reasonCode: vine.string().trim().maxLength(100).nullable().optional(),
    status: vine.enum(OKR_RELATION_STATUS_VALUES).optional(),
  }),
)

export const okrRelationListQueryValidator = vine.compile(
  vine.object({
    sourceObjectiveId: vine.number().positive().optional(),
    targetObjectiveId: vine.number().positive().optional(),
    relationType: vine.enum(OKR_RELATION_TYPE_VALUES).optional(),
    status: vine.enum(OKR_RELATION_STATUS_VALUES).optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)

export const okrHealthQueryValidator = vine.compile(
  vine.object({
    cycleId: vine.number().positive().optional(),
    scope: vine.enum(OKR_SCOPE_VALUES).optional(),
    ownerId: vine.number().positive().optional(),
    status: vine.enum(OKR_STATUS_VALUES).optional(),
    relationType: vine.enum(OKR_RELATION_TYPE_VALUES).optional(),
    includeRestricted: vine.boolean().optional(),
  }),
)

export const okrMatrixQueryValidator = vine.compile(
  vine.object({
    cycleId: vine.number().positive().optional(),
    scope: vine.enum(OKR_SCOPE_VALUES).optional(),
    ownerId: vine.number().positive().optional(),
    status: vine.enum(OKR_STATUS_VALUES).optional(),
    relationType: vine.enum(OKR_RELATION_TYPE_VALUES).optional(),
    healthLevel: vine.enum(OKR_HEALTH_LEVEL_VALUES).optional(),
    depth: vine.number().min(1).max(5).optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    sort: vine.enum(['title', 'health', 'scope', 'status']).optional(),
    order: vine.enum(['asc', 'desc']).optional(),
  }),
)

export const okrAiCascadeSuggestionValidator = vine.compile(
  vine.object({
    cycleId: vine.number().positive(),
    objectiveId: vine.number().positive().optional(),
    scope: vine.enum(OKR_SCOPE_VALUES).optional(),
    includeRelations: vine.boolean().optional(),
    includeConflictAnalysis: vine.boolean().optional(),
  }),
)
