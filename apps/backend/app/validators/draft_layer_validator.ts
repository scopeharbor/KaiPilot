/**
 * v2-ai-draft-layer-preview-diff-apply —— Draft Layer 入参校验（task 9.2）。
 *
 * 用 zod 做 gate 级校验。禁止客户端提交 organizationId、
 * 完整 PDM JSON、规则开关、severityOverride 或 confidenceScore。
 */
import { z } from 'zod'
import {
  DRAFT_LAYER_REVIEW_STATUSES,
  DRAFT_LAYER_ENTITY_TYPES,
  DRAFT_LAYER_CHANGE_OPERATIONS,
} from '@aiproj/types'

/** 创建 session 请求：只允许 compilerRunId，禁止客户端提交 PDM JSON。 */
export const draftLayerCreateSchema = z.object({
  compilerRunId: z.number().int().positive(),
  // 明确拒绝客户端 PDM JSON
  pdm: z.undefined().optional(),
  input: z.undefined().optional(),
})

/** 单项决策请求 */
export const draftLayerDecisionSchema = z.object({
  changeId: z.number().int().positive(),
  reviewStatus: z.enum(DRAFT_LAYER_REVIEW_STATUSES),
  userModifiedValue: z.unknown().optional(),
  userNote: z.string().max(2000).optional().nullable(),
})

/** 批量决策过滤器 */
export const draftLayerBulkDecisionSchema = z.object({
  filter: z.object({
    entityTypes: z.array(z.enum(DRAFT_LAYER_ENTITY_TYPES)).optional(),
    operations: z.array(z.enum(DRAFT_LAYER_CHANGE_OPERATIONS)).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    fieldPattern: z.string().optional(),
    allExcept: z.array(z.number().int().positive()).optional(),
    action: z.enum(DRAFT_LAYER_REVIEW_STATUSES),
  }),
})

/** Dry-run 请求 */
export const draftLayerDryRunSchema = z
  .object({
    force: z.boolean().optional(),
  })
  .optional()

/** Apply 请求 */
export const draftLayerApplySchema = z.object({
  idempotencyKey: z.string().min(1).max(100).optional(),
})
