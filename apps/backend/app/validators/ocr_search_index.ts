/**
 * OCR 搜索索引 Validator（v3-ocr-document-search-indexing §7.1）
 *
 * 使用 AdonisJS VineJS 定义验证契约。
 * 与后端 API 端点 1:1 对应。
 */

import vine from '@vinejs/vine'

/** 列表/状态查询参数 */
export const ocrSearchIndexListValidator = vine.compile(
  vine.object({
    sourceKind: vine.enum(['attachment', 'document'] as const).optional(),
    sourceId: vine.number().min(1).optional(),
    extractionId: vine.number().min(1).optional(),
    status: vine.enum(['active', 'inactive', 'tombstoned'] as const).optional(),
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(50).optional(),
  }),
)

/** 索引预览请求 */
export const ocrSearchIndexPreviewValidator = vine.compile(
  vine.object({
    extractionIds: vine.array(vine.number().min(1)).maxLength(200).optional(),
    sourceKind: vine.enum(['attachment', 'document'] as const).optional(),
    sourceId: vine.number().min(1).optional(),
    note: vine.string().maxLength(500).optional(),
  }),
)

/** 索引执行请求 */
export const ocrSearchIndexExecuteValidator = vine.compile(
  vine.object({
    previewHash: vine.string().minLength(8).maxLength(64),
    idempotencyKey: vine.string().minLength(1).maxLength(128),
    note: vine.string().maxLength(500).optional(),
  }),
)

/** 重新索引请求（与预览相同结构） */
export const ocrSearchIndexReindexValidator = vine.compile(
  vine.object({
    extractionIds: vine.array(vine.number().min(1)).maxLength(200).optional(),
    sourceKind: vine.enum(['attachment', 'document'] as const).optional(),
    sourceId: vine.number().min(1).optional(),
    note: vine.string().maxLength(500).optional(),
  }),
)

/** 取消索引预览请求 */
export const ocrSearchIndexUnindexPreviewValidator = vine.compile(
  vine.object({
    entryIds: vine.array(vine.number().min(1)).minLength(1).maxLength(200),
    note: vine.string().maxLength(500).optional(),
  }),
)

/** 取消索引执行请求 */
export const ocrSearchIndexUnindexExecuteValidator = vine.compile(
  vine.object({
    previewHash: vine.string().minLength(8).maxLength(64),
    idempotencyKey: vine.string().minLength(1).maxLength(128),
    entryIds: vine.array(vine.number().min(1)).minLength(1).maxLength(200),
    note: vine.string().maxLength(500).optional(),
  }),
)
