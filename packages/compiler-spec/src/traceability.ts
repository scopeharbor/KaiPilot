/**
 * @aiproj/compiler-spec —— Traceability / Source Attribution 数据契约（tasks 1.1–1.3）。
 *
 * V2 Project Compiler 的 SourceAttribution、Traceability Link 及查询 view model。
 *
 * ⚠️ 新增 public type/function 必须同步更新 index.ts re-export。
 *
 * @aiproj/compiler-spec
 */

import { z } from 'zod'

// ============================================================================
// 1. 来源生成方式（tasks 1.1）
// ============================================================================

/** 来源生成方式。明确区分 AI/规则/用户编辑/导入。 */
export const attributionGeneratedBySchema = z.enum([
  'llm',
  'deterministic_rule',
  'user_edit',
  'imported',
])
export type AttributionGeneratedBy = z.infer<typeof attributionGeneratedBySchema>

// ============================================================================
// 2. 人工确认状态（tasks 1.1）
// ============================================================================

/** 人工确认状态。 */
export const humanReviewStatusSchema = z.enum([
  'pending',
  'reviewed_and_accepted',
  'reviewed_and_modified',
  'reviewed_and_rejected',
])
export type HumanReviewStatus = z.infer<typeof humanReviewStatusSchema>

// ============================================================================
// 3. 来源证据片段（tasks 1.1）
// ============================================================================

/** 来源证据短摘（只存摘要、hash 和 ref，不存完整正文）。 */
export const attributionEvidenceSnippetSchema = z.object({
  refId: z.string().min(1),
  label: z.string().default(''),
  snippet: z.string().default(''),
  charOffset: z.number().int().min(0).optional(),
  charLength: z.number().int().min(0).optional(),
  contentHash: z.string().optional(),
})
export type AttributionEvidenceSnippet = z.infer<typeof attributionEvidenceSnippetSchema>

// ============================================================================
// 4. 来源 Artifact Ref（tasks 1.1–1.2）
// ============================================================================

/** 结构化来源引用，必须包含 version 和 summaryLevel。 */
export const attributionSourceRefSchema = z.object({
  refId: z.string().min(1),
  artifactKind: z.string().min(1),
  version: z.number().int().min(1),
  summaryLevel: z.string().min(1),
  label: z.string().default(''),
  organizationId: z.number().int().min(1),
  compilerRunId: z.number().int().min(1).optional(),
  stageId: z.string().optional(),
})
export type AttributionSourceRef = z.infer<typeof attributionSourceRefSchema>

// ============================================================================
// 5. 来源归因 - 模型调用摘要（tasks 1.1）
// ============================================================================

export const attributionGeneratedBySchemaDetailed = z.object({
  kind: attributionGeneratedBySchema,
  provider: z.string().optional(),
  model: z.string().optional(),
  tokenSummary: z
    .object({
      inputTokens: z.number().int().min(0).optional(),
      outputTokens: z.number().int().min(0).optional(),
      totalTokens: z.number().int().min(0).optional(),
    })
    .optional(),
  costSummary: z
    .object({
      currency: z.string().default('CNY'),
      estimatedCost: z.number().min(0).optional(),
    })
    .optional(),
  ruleId: z.string().optional(),
  ruleName: z.string().optional(),
})
export type AttributionGeneratedByDetail = z.infer<typeof attributionGeneratedBySchemaDetailed>

// ============================================================================
// 6. SourceAttribution 核心类型（tasks 1.1–1.2）
// ============================================================================

export const sourceAttributionSchema = z.object({
  id: z.number().int().min(1),
  organizationId: z.number().int().min(1),
  compilerRunId: z.number().int().min(1),
  draftSessionId: z.number().int().optional(),

  stageId: z.string().min(1),
  stageAttemptId: z.string().optional(),

  /** 目标实体 ID（实体级归因）。 */
  entityId: z.string().optional(),
  /** 目标字段路径（字段级归因）。 */
  fieldPath: z.string().optional(),

  /** 来源 artifact refs。 */
  sourceRefs: z.array(attributionSourceRefSchema).default([]),
  /** 验证 refs。 */
  validationRefs: z.array(attributionSourceRefSchema).default([]),

  /** 生成方式与模型摘要。 */
  generatedBy: attributionGeneratedBySchemaDetailed,

  /** 置信度 (0–1)。 */
  confidence: z.number().min(0).max(1).default(0),

  /** 假设列表。 */
  assumptions: z.array(z.string()).default([]),

  /** 证据片段（只存短摘要、hash 和 ref，不存完整正文）。 */
  evidenceSnippets: z.array(attributionEvidenceSnippetSchema).default([]),

  /** 摘要。 */
  summary: z.string().default(''),

  /** 内容 hash（用于校验来源是否被篡改）。 */
  contentHash: z.string().min(1),

  /** 人工确认状态。 */
  humanReviewStatus: humanReviewStatusSchema.default('pending'),
  humanReviewedBy: z.number().int().optional(),
  humanReviewedAt: z.string().optional(),

  /** 是否 unanchored（Soft finding 无实体锚点）。 */
  unanchored: z.boolean().default(false),

  createdAt: z.string(),
  updatedAt: z.string().optional(),
})
export type SourceAttribution = z.infer<typeof sourceAttributionSchema>

// ============================================================================
// 7. SourceAttribution Create Params（创建时用，不含 id/timestamps）
// ============================================================================

export const sourceAttributionCreateSchema = sourceAttributionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})
export type SourceAttributionCreate = z.infer<typeof sourceAttributionCreateSchema>

// ============================================================================
// 8. Traceability Link 关系类型（tasks 1.1）
// ============================================================================

export const traceabilityRelationTypeSchema = z.enum([
  'hierarchy_parent',
  'hierarchy_child',
  'depends_on',
  'depended_by',
  'validates',
  'validated_by',
  'milestone_tracks',
  'risk_impacts',
  'risk_mitigated_by',
  'derived_from',
  'generated',
  'confirms',
])
export type TraceabilityRelationType = z.infer<typeof traceabilityRelationTypeSchema>

// ============================================================================
// 9. Traceability Link（tasks 1.1–1.2）
// ============================================================================

export const traceabilityLinkSchema = z.object({
  id: z.number().int().min(1),
  organizationId: z.number().int().min(1),
  projectId: z.number().int().min(1).optional(),

  /** 来源实体。 */
  sourceEntityType: z.string().min(1),
  sourceEntityId: z.string().min(1),

  /** 目标实体。 */
  targetEntityType: z.string().min(1),
  targetEntityId: z.string().min(1),

  /** 关系类型与方向。 */
  relationType: traceabilityRelationTypeSchema,
  direction: z.enum(['forward', 'bidirectional']).default('forward'),

  /** 关系强度（0–1）。 */
  strength: z.number().min(0).max(1).default(1),

  /** 绑定来源归因 ID。 */
  sourceAttributionId: z.number().int().min(1).optional(),

  createdBy: z.number().int().min(1),
  deletedAt: z.string().optional(),

  createdAt: z.string(),
  updatedAt: z.string().optional(),
})
export type TraceabilityLink = z.infer<typeof traceabilityLinkSchema>

// ============================================================================
// 10. Traceability Link Create Params
// ============================================================================

export const traceabilityLinkCreateSchema = traceabilityLinkSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})
export type TraceabilityLinkCreate = z.infer<typeof traceabilityLinkCreateSchema>

// ============================================================================
// 11. 来源查询响应（tasks 1.1）
// ============================================================================

/** 实体级来源摘要（前端 view model）。 */
export const entitySourceSummarySchema = z.object({
  entityId: z.string(),
  entityType: z.string(),
  hasFieldLevel: z.boolean().default(false),
  fieldAttributions: z
    .array(
      z.object({
        fieldPath: z.string(),
        generatedBy: attributionGeneratedBySchema,
        confidence: z.number().min(0).max(1),
        summary: z.string(),
        attributionId: z.number(),
      }),
    )
    .default([]),
  entityAttribution: z
    .object({
      attributionId: z.number(),
      generatedBy: attributionGeneratedBySchema,
      stageId: z.string(),
      confidence: z.number().min(0).max(1),
      summary: z.string(),
      humanReviewStatus: humanReviewStatusSchema,
      evidenceCount: z.number().int().min(0).default(0),
      sourceRefCount: z.number().int().min(0).default(0),
    })
    .nullable(),
})
export type EntitySourceSummary = z.infer<typeof entitySourceSummarySchema>

/** 来源详情 view model（前端展示用）。 */
export const attributionDetailSchema = z.object({
  attributionId: z.number(),
  generatedBy: attributionGeneratedBySchema,
  provider: z.string().optional(),
  model: z.string().optional(),
  stageId: z.string(),
  stageAttemptId: z.string().optional(),
  entityId: z.string().optional(),
  fieldPath: z.string().optional(),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  assumptions: z.array(z.string()).default([]),
  evidenceSnippets: z
    .array(
      z.object({
        label: z.string(),
        snippet: z.string(),
        contentHash: z.string().optional(),
      }),
    )
    .default([]),
  validationSummary: z
    .object({
      totalRefs: z.number().int().min(0),
      passedRefs: z.number().int().min(0),
      failedRefs: z.number().int().min(0),
    })
    .optional(),
  humanReviewStatus: humanReviewStatusSchema,
  humanReviewedBy: z.number().int().optional(),
  humanReviewedAt: z.string().optional(),
  createdAt: z.string(),
})
export type AttributionDetail = z.infer<typeof attributionDetailSchema>

/** Traceability Link 摘要（前端 view model）。 */
export const traceabilityLinkSummarySchema = z.object({
  linkId: z.number(),
  relationType: traceabilityRelationTypeSchema,
  direction: z.enum(['forward', 'bidirectional']).default('forward'),
  sourceEntityType: z.string(),
  sourceEntityId: z.string(),
  targetEntityType: z.string(),
  targetEntityId: z.string(),
  strength: z.number().min(0).max(1),
  attributionId: z.number().optional(),
  createdAt: z.string(),
})
export type TraceabilityLinkSummary = z.infer<typeof traceabilityLinkSummarySchema>

// ============================================================================
// 12. 来源完整性校验结果（tasks 4.3-4.4）
// ============================================================================

export const sourceIntegrityIssueSchema = z.object({
  entityId: z.string(),
  fieldPath: z.string().optional(),
  issueType: z.enum(['missing_attribution', 'missing_source_ref', 'unanchored_finding']),
  severity: z.enum(['blocking', 'warning']),
  message: z.string(),
})
export type SourceIntegrityIssue = z.infer<typeof sourceIntegrityIssueSchema>
