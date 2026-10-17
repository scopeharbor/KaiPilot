/**
 * OCR 隐私策略控制 Validator（v3-ocr-privacy-policy-controls §6.4）
 *
 * 使用 AdonisJS VineJS 定义验证契约。
 * 与后端 API 端点 1:1 对应。
 */
import vine from '@vinejs/vine'
import {
  OCR_CONTENT_SENSITIVITY_CATEGORIES,
  OCR_PRIVACY_PURPOSES,
  OCR_PRIVACY_OUTPUT_MODES,
  OCR_PRIVACY_EXPORT_FORMATS,
  OCR_PRIVACY_POLICY_STATUSES,
} from '@aiproj/types'

/** 策略更新请求 */
export const ocrPrivacyPolicyUpdateValidator = vine.compile(
  vine.object({
    categoryRules: vine
      .array(
        vine.object({
          category: vine.enum(OCR_CONTENT_SENSITIVITY_CATEGORIES),
          allowedPurposes: vine.array(vine.enum(OCR_PRIVACY_PURPOSES)),
          defaultOutputMode: vine.enum(OCR_PRIVACY_OUTPUT_MODES),
        }),
      )
      .minLength(1)
      .maxLength(13),
    allowedPurposes: vine.array(vine.enum(OCR_PRIVACY_PURPOSES)),
    globalOutputMode: vine.enum(OCR_PRIVACY_OUTPUT_MODES),
  }),
)

/** 策略状态过滤器 */
export const ocrPrivacyStatusFilterValidator = vine.compile(
  vine.object({
    status: vine.enum(OCR_PRIVACY_POLICY_STATUSES).optional(),
    sourceKind: vine.string().maxLength(50).optional(),
  }),
)

/** 决策预览请求 */
export const ocrPrivacyDecisionPreviewValidator = vine.compile(
  vine.object({
    purpose: vine.enum(OCR_PRIVACY_PURPOSES),
    contentCategory: vine.enum(OCR_CONTENT_SENSITIVITY_CATEGORIES),
    action: vine.string().minLength(1).maxLength(50),
    sourceHash: vine.string().maxLength(200).nullable().optional(),
    contentHash: vine.string().maxLength(200).nullable().optional(),
    extractionId: vine.number().min(1).nullable().optional(),
    policyHash: vine.string().maxLength(64),
  }),
)

/** 复制/导出预览请求 */
export const ocrPrivacyExportPreviewValidator = vine.compile(
  vine.object({
    purpose: vine.enum(OCR_PRIVACY_PURPOSES),
    format: vine.enum(OCR_PRIVACY_EXPORT_FORMATS),
    acceptedExtractionIds: vine.array(vine.number().min(1)).minLength(1).maxLength(500),
    policyHash: vine.string().maxLength(64),
  }),
)

/** 复制/导出执行请求 */
export const ocrPrivacyExportExecuteValidator = vine.compile(
  vine.object({
    previewHash: vine.string().minLength(1).maxLength(64),
    policyHash: vine.string().maxLength(64),
    confirmationToken: vine.string().maxLength(200).nullable().optional(),
    idempotencyKey: vine.string().minLength(1).maxLength(128),
  }),
)
