/**
 * OCR 保留治理 Validator（v3-ocr-result-persistence-and-retention §5.11）
 *
 * 使用 AdonisJS VineJS 定义验证契约。
 * 与后端 API 端点 1:1 对应。
 */

import vine from '@vinejs/vine'
import {
  OCR_RETENTION_SENSITIVITY_CATEGORIES,
  OCR_RETENTION_RECORD_KINDS,
  OCR_RETENTION_HOLD_SCOPE_KINDS,
  OCR_RETENTION_HOLD_REASON_CODES,
  OCR_RETENTION_HOLD_NOTE_MAX_LENGTH,
} from '@aiproj/types'

/** 保留策略更新请求 */
export const ocrRetentionPolicyUpdateValidator = vine.compile(
  vine.object({
    categories: vine
      .array(
        vine.object({
          category: vine.enum(OCR_RETENTION_SENSITIVITY_CATEGORIES),
          retentionDays: vine.number().min(1).max(3650),
          actionAfterExpiry: vine.enum(['expire', 'redact', 'purge'] as const),
        }),
      )
      .minLength(1)
      .maxLength(9),
  }),
)

/** 清理预览请求 */
export const ocrRetentionCleanupPreviewValidator = vine.compile(
  vine.object({
    recordKinds: vine.array(vine.enum(OCR_RETENTION_RECORD_KINDS)).optional(),
    sourceHash: vine.string().maxLength(200).nullable().optional(),
    jobId: vine.number().min(1).nullable().optional(),
    limit: vine.number().min(1).max(2000).optional(),
  }),
)

/** 清理执行请求 */
export const ocrRetentionCleanupExecuteValidator = vine.compile(
  vine.object({
    previewHash: vine.string().minLength(1).maxLength(64),
    runKey: vine.string().minLength(1).maxLength(128),
    confirm: vine.literal(true),
  }),
)

/** Hold 设置请求 */
export const ocrRetentionHoldSetValidator = vine.compile(
  vine.object({
    scopeKind: vine.enum(OCR_RETENTION_HOLD_SCOPE_KINDS),
    scopeRef: vine.string().minLength(1).maxLength(200),
    reasonCode: vine.enum(OCR_RETENTION_HOLD_REASON_CODES),
    note: vine.string().maxLength(OCR_RETENTION_HOLD_NOTE_MAX_LENGTH).nullable().optional(),
  }),
)

/** Hold 释放请求 */
export const ocrRetentionHoldReleaseValidator = vine.compile(
  vine.object({
    holdId: vine.number().min(1),
  }),
)

/** 保留状态分页过滤参数 */
export const ocrRetentionStatusQueryValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(200).optional(),
    recordKind: vine.enum(OCR_RETENTION_RECORD_KINDS).optional(),
  }),
)

/** 保留策略查询 */
export const ocrRetentionPolicyQueryValidator = vine.compile(vine.object({}))
