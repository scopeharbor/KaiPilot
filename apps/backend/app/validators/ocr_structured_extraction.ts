/**
 * OCR 结构化提取 Validator（v3-ocr-structured-extraction §5.11）
 *
 * 使用 AdonisJS VineJS 定义验证契约。
 * 与后端 API 端点 1:1 对应。
 */

import vine from '@vinejs/vine'

/** 提取配置创建请求 */
export const createOcrStructuredExtractionProfileValidator = vine.compile(
  vine.object({
    name: vine.string().trim().maxLength(255),
    scope: vine.enum(['builtin', 'project', 'organization']),
    description: vine.string().trim().maxLength(2000).optional(),
    schemaDefinition: vine.object({}).allowUnknownProperties(),
    projectId: vine.number().min(1).optional(),
  }),
)

/** 提取配置更新请求 */
export const updateOcrStructuredExtractionProfileValidator = vine.compile(
  vine.object({
    name: vine.string().trim().maxLength(255).optional(),
    description: vine.string().trim().maxLength(2000).optional(),
    status: vine.enum(['draft', 'active', 'archived']).optional(),
    schemaDefinition: vine.object({}).allowUnknownProperties().optional(),
  }),
)

/** 提取运行创建请求 */
export const createOcrStructuredExtractionRunValidator = vine.compile(
  vine.object({
    extractionId: vine.number().min(1),
    profileId: vine.number().min(1).optional(),
    profileRef: vine.string().trim().maxLength(180).optional(),
    idempotencyKey: vine.string().trim().maxLength(255).optional(),
    aiAssist: vine.boolean().optional(),
    options: vine
      .object({
        maxFieldCandidates: vine.number().min(1).max(10000).optional(),
        maxTableRows: vine.number().min(1).max(100000).optional(),
      })
      .optional(),
  }),
)

/** 提取运行列表过滤 */
export const listOcrStructuredExtractionRunsValidator = vine.compile(
  vine.object({
    extractionId: vine.number().min(1).optional(),
    profileId: vine.number().min(1).optional(),
    status: vine
      .enum(['pending', 'processing', 'completed', 'completed_with_warnings', 'failed', 'canceled'])
      .optional(),
    provenance: vine.enum(['deterministic', 'ai_assisted', 'ai_fallback']).optional(),
    sort: vine.string().trim().optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
  }),
)

/** 提取结果预览请求 */
export const ocrStructuredExtractionPreviewValidator = vine.compile(
  vine.object({
    runId: vine.number().min(1),
    selectedFieldCandidateIds: vine.array(vine.number().min(1)),
    selectedTableCandidateIds: vine.array(vine.number().min(1)),
    selectedTableRowKeys: vine.record(vine.array(vine.string())).optional(),
    reviewNote: vine.string().trim().maxLength(2000).optional(),
  }),
)

/** 提取结果保存请求 */
export const ocrStructuredExtractionSaveValidator = vine.compile(
  vine.object({
    previewHash: vine.string().trim().maxLength(255),
    runId: vine.number().min(1),
    selectedFieldCandidateIds: vine.array(vine.number().min(1)),
    selectedTableCandidateIds: vine.array(vine.number().min(1)),
    selectedTableRowKeys: vine.record(vine.array(vine.string())).optional(),
    reviewNote: vine.string().trim().maxLength(2000).optional(),
  }),
)
