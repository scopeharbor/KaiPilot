import vine from '@vinejs/vine'
import { TRIZ_DL_POSTURES, TRIZ_DL_ENTITY_KINDS } from '@aiproj/types'

/**
 * v3-triz-to-delivery-closed-loop —— API 校验器（task 9.1）。
 *
 * 全部仅验证结构/类型/封闭枚举/有界长度；业务存在性、权限、freshness、
 * fingerprint 一致性由 Service/Policy 判定（fail closed）。
 */

/** summary / list 公共分页与过滤 */
export const trizDeliveryLoopListValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    page: vine.number().positive().optional(),
    perPage: vine.number().range([1, 100]).optional(),
    posture: vine.enum(TRIZ_DL_POSTURES).optional(),
  }),
)

export const trizDeliveryLoopItemValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    itemId: vine.string().trim().minLength(6).maxLength(64),
  }),
)

/** link preview/confirm 共用实体 ref 结构 */
const entityRefSchema = vine.object({
  kind: vine.enum(TRIZ_DL_ENTITY_KINDS),
  entityId: vine.string().trim().minLength(1).maxLength(64),
})

export const trizDeliveryLoopLinkPreviewValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    decisionLogId: vine.string().trim().minLength(1).maxLength(32),
    deliveryRefs: vine.array(entityRefSchema).minLength(1).maxLength(50),
    contextRefs: vine.array(entityRefSchema).maxLength(20).optional(),
  }),
)

export const trizDeliveryLoopLinkConfirmValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    decisionLogId: vine.string().trim().minLength(1).maxLength(32),
    deliveryRefs: vine.array(entityRefSchema).minLength(1).maxLength(50),
    contextRefs: vine.array(entityRefSchema).maxLength(20).optional(),
    previewFingerprint: vine.string().trim().minLength(8).maxLength(64),
    confirmation: vine.object({
      acknowledgedOnlyLinkWrite: vine.boolean(),
      requestedAt: vine.string().trim().maxLength(40),
    }),
  }),
)

export const trizDeliveryLoopVerifyValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    itemId: vine.string().trim().minLength(6).maxLength(64),
    conclusion: vine.enum(['effective', 'ineffective', 'inconclusive']),
    observationWindow: vine.object({
      from: vine.string().trim().maxLength(40),
      to: vine.string().trim().maxLength(40),
    }),
    baselineSummary: vine.string().trim().maxLength(2000).optional(),
    targetSummary: vine.string().trim().maxLength(2000).optional(),
    actualResult: vine.string().trim().maxLength(2000).optional(),
    reason: vine.string().trim().maxLength(2000).optional(),
    evidenceRefs: vine.array(vine.string().trim().maxLength(200)).minLength(0).maxLength(20),
    verificationFingerprint: vine.string().trim().minLength(8).maxLength(64),
    supersedesEventId: vine.number().positive().optional(),
  }),
)

export const trizDeliveryLoopReopenValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    itemId: vine.string().trim().minLength(6).maxLength(64),
    reason: vine.string().trim().minLength(1).maxLength(2000),
    currentFingerprint: vine.string().trim().minLength(8).maxLength(64),
  }),
)
