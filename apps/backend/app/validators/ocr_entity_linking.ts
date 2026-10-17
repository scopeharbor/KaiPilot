/**
 * OCR 实体链接 Validator（v3-ocr-entity-linking §5.7）
 *
 * 使用 AdonisJS VineJS 定义验证契约。
 * 与后端 API 端点 1:1 对应。
 */

import vine from '@vinejs/vine'

/** 创建实体链接运行请求 */
export const createOcrEntityLinkRunValidator = vine.compile(
  vine.object({
    acceptedExtractionIds: vine.array(vine.number().min(1)).minLength(1).maxLength(50),
    targetKinds: vine
      .array(
        vine.enum([
          'project',
          'task',
          'wbs_node',
          'milestone',
          'risk',
          'file',
          'attachment',
          'project_member',
        ]),
      )
      .optional(),
    ruleVersion: vine.string().trim().maxLength(32).optional(),
    idempotencyKey: vine.string().trim().maxLength(255).optional(),
  }),
)

/** 运行列表过滤 */
export const listOcrEntityLinkRunsValidator = vine.compile(
  vine.object({
    status: vine.enum(['running', 'completed', 'stale', 'failed']).optional(),
    stale: vine.boolean().optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)

/** 候选列表分页 */
export const listOcrEntityLinkCandidatesValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)

/** 确认预览请求 */
export const ocrEntityLinkPreviewValidator = vine.compile(
  vine.object({
    runId: vine.number().min(1),
    candidateId: vine.number().min(1),
  }),
)

/** 确认链接请求 */
export const ocrEntityLinkConfirmValidator = vine.compile(
  vine.object({
    runId: vine.number().min(1),
    candidateId: vine.number().min(1),
    previewHash: vine.string().trim().minLength(16).maxLength(32),
    reviewerNote: vine.string().trim().maxLength(1000).optional(),
  }),
)

/** 取代链接请求 */
export const ocrEntityLinkSupersedeValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().minLength(1).maxLength(1000),
  }),
)

/** 拒绝链接请求 */
export const ocrEntityLinkRejectValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().minLength(1).maxLength(1000),
  }),
)

/** 可选 AI 解释请求 */
export const ocrEntityLinkExplainValidator = vine.compile(
  vine.object({
    runId: vine.number().min(1),
    candidateId: vine.number().min(1),
  }),
)
