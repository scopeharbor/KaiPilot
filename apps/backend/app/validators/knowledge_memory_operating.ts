/**
 * v3-knowledge-memory-operating-layer —— GET `/api/v1/knowledge-memory/*` 共享 Validator。
 *
 * 严格白名单：enums / page / perPage / kind / ref / surface / scopedRef 字符集。
 * 失败 → 422，统一 envelope（参考 design D5）。
 *
 * 不引入 vine / zod；本 change 与 §2 types 共享的 `parseOperatingUrlState`
 * 已是纯函数确定性，本文件是该纯函数的 vine / server-side 适配层。
 *
 * @aiproj/backend
 */

import vine from '@vinejs/vine'
import {
  KNOWLEDGE_MEMORY_OPERATING_KINDS,
  KNOWLEDGE_MEMORY_OPERATING_SCOPES,
  KNOWLEDGE_MEMORY_OPERATING_STATUSES,
  KNOWLEDGE_MEMORY_OPERATING_SURFACES,
  KNOWLEDGE_MEMORY_OPERATING_VISIBILITIES,
} from '@aiproj/types'

const KIND_ENUM = vine.enum(KNOWLEDGE_MEMORY_OPERATING_KINDS)
const SCOPE_ENUM = vine.enum(KNOWLEDGE_MEMORY_OPERATING_SCOPES)
const STATUS_ENUM = vine.enum(KNOWLEDGE_MEMORY_OPERATING_STATUSES)
const SURFACE_ENUM = vine.enum(KNOWLEDGE_MEMORY_OPERATING_SURFACES)
const VISIBILITY_ENUM = vine.enum(KNOWLEDGE_MEMORY_OPERATING_VISIBILITIES)

/**
 * summary / list 共享 query 校验 schema。
 * GET /api/v1/knowledge-memory/summary + GET /api/v1/knowledge-memory/items
 *
 * 设计 D6 / §2.12 / §4.11：
 * - kinds / statuses / scopes / attentionFacets 允许多值；
 * - 其它字段单值；
 * - 字符 / 数字边界与 OperatingUrlState 完全一致（一致是 critical，避免前端
 *   URL state 与后端校验 split 行为）。
 */
export const operatingListQueryValidator = vine.compile(
  vine.object({
    attention: STATUS_ENUM.optional(),
    kind: KIND_ENUM.optional(),
    scope: SCOPE_ENUM.optional(),
    status: STATUS_ENUM.optional(),
    sort: vine.enum(['attentionPriority', 'attentionAt', 'kind', 'scopedRef']).optional(),
    order: vine.enum(['desc', 'asc']).optional(),
    page: vine.number().min(1).max(1000).optional(),
    perPage: vine.number().min(1).max(100).optional(),
    surface: SURFACE_ENUM.optional(),
  }),
)

/**
 * GET /api/v1/knowledge-memory/items/:kind/:scopedRef
 *
 * :kind 必须为四 kind 之一；:scopedRef 必须匹配 `[a-zA-Z0-9._-]{1,128}`。
 * 失败 422。
 */
export const operatingDetailParamsValidator = vine.compile(
  vine.object({
    kind: KIND_ENUM,
    scopedRef: vine
      .string()
      .minLength(1)
      .maxLength(128)
      .regex(/^[a-zA-Z0-9._-]+$/),
  }),
)

/**
 * GET /api/v1/knowledge-memory/items/:kind/:scopedRef/surface
 * （server-side surface resolve）。
 */
export const operatingSurfaceParamsValidator = vine.compile(
  vine.object({
    kind: KIND_ENUM,
    scopedRef: vine
      .string()
      .minLength(1)
      .maxLength(128)
      .regex(/^[a-zA-Z0-9._-]+$/),
    surface: SURFACE_ENUM,
  }),
)

/**
 * 暴露 const 便于测试与 future recomposition。
 */
export const OPERATING_VALIDATORS = {
  list: operatingListQueryValidator,
  detail: operatingDetailParamsValidator,
  surface: operatingSurfaceParamsValidator,
} as const

export const OPERATING_VALIDATOR_ENUMS = {
  KIND_ENUM,
  SCOPE_ENUM,
  STATUS_ENUM,
  SURFACE_ENUM,
  VISIBILITY_ENUM,
} as const

// 显式 re-export 避免 unused import 静态噪声
export const OPERATING_VALIDATOR_KINDS = KNOWLEDGE_MEMORY_OPERATING_KINDS
export const OPERATING_VALIDATOR_SCOPES = KNOWLEDGE_MEMORY_OPERATING_SCOPES
export const OPERATING_VALIDATOR_STATUSES = KNOWLEDGE_MEMORY_OPERATING_STATUSES
export const OPERATING_VALIDATOR_SURFACES = KNOWLEDGE_MEMORY_OPERATING_SURFACES
export const OPERATING_VALIDATOR_VISIBILITIES = KNOWLEDGE_MEMORY_OPERATING_VISIBILITIES
