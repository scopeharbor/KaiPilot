/**
 * OCR 权限/审计 Validator（v3-ocr-permission-and-audit §5.1）
 *
 * 使用 AdonisJS VineJS 定义验证契约：
 * - 权限状态查询：低敏可选来源/构件引用（无敏感载荷）
 * - 决策预览：显式 action + 可选来源/构件引用/来源哈希
 * - 审计摘要查询：有界过滤（分页/动作/结果/原因码/时间窗）
 *
 * 红线：不接收任何客户端允许动作声明、不接收完整 OCR 文本/载荷/提示词/密钥。
 * 前端允许动作声明一律忽略，仅以服务端 resolver 输出为准（§5.5）。
 */

import vine from '@vinejs/vine'
import {
  OCR_PERMISSION_ACTIONS,
  OCR_PERMISSION_DECISION_RESULTS,
  OCR_PERMISSION_REASON_CODES,
} from '@aiproj/types'

/** 权限状态查询参数（低敏，可选来源/构件引用）。 */
export const ocrPermissionStatusQueryValidator = vine.compile(
  vine.object({
    sourceRefId: vine.number().min(1).optional(),
    sourceRefKind: vine.string().maxLength(40).optional(),
    artifactRefId: vine.number().min(1).optional(),
    artifactRefKind: vine.string().maxLength(40).optional(),
  }),
)

/** 决策预览请求体（显式 action + 可选来源/构件引用/来源哈希）。 */
export const ocrPermissionDecisionPreviewValidator = vine.compile(
  vine.object({
    action: vine.enum(OCR_PERMISSION_ACTIONS),
    sourceRefId: vine.number().min(1).optional(),
    sourceRefKind: vine.string().maxLength(40).optional(),
    artifactRefId: vine.number().min(1).optional(),
    artifactRefKind: vine.string().maxLength(40).optional(),
    sourceHash: vine.string().maxLength(200).nullable().optional(),
  }),
)

/** 审计摘要查询参数（有界：perPage 上限 100、时间窗上限 90 天）。 */
export const ocrPermissionAuditSummaryQueryValidator = vine.compile(
  vine.object({
    page: vine.number().min(1).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    action: vine.enum(OCR_PERMISSION_ACTIONS).optional(),
    result: vine.enum(OCR_PERMISSION_DECISION_RESULTS).optional(),
    reasonCode: vine.enum(OCR_PERMISSION_REASON_CODES).optional(),
    actorId: vine.number().min(1).optional(),
    from: vine.string().optional(),
    to: vine.string().optional(),
  }),
)
