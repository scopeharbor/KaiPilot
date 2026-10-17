// @aiproj/backend — V3 TRIZ 矛盾矩阵审查 Validator
// v3-triz-contradiction-matrix-ui / design D2 §3.3 + D5 §4.1
//
// 矩阵筛选器校验：contradiction type、status、severity、stale state、source type、
// parameter key、principle id、warning code 和 sort。
// Handoff 输入校验：selected cells/tensions、sourceRefs、sourceHashes、idempotencyKey。

import vine from '@vinejs/vine'
import {
  MATRIX_CONTRADICTION_TYPES,
  MATRIX_STATUS_FILTERS,
  MATRIX_SEVERITY_FILTERS,
  MATRIX_STALE_FILTERS,
  MATRIX_SOURCE_TYPE_FILTERS,
  MATRIX_SORT_FIELDS,
  SORT_DIRECTIONS,
  PROJECT_PARAMETER_KEYS,
  INVENTIVE_PRINCIPLE_IDS,
  TRIZ_ANALYSIS_WARNING_CODES,
} from '@aiproj/types'

export const listMatrixValidator = vine.compile(
  vine.object({
    contradictionType: vine.enum(MATRIX_CONTRADICTION_TYPES).optional(),
    status: vine.enum(MATRIX_STATUS_FILTERS).optional(),
    severity: vine.enum(MATRIX_SEVERITY_FILTERS).optional(),
    stale: vine.enum(MATRIX_STALE_FILTERS).optional(),
    sourceType: vine.enum(MATRIX_SOURCE_TYPE_FILTERS).optional(),
    parameterKey: vine.enum(PROJECT_PARAMETER_KEYS).optional(),
    principleId: vine.enum(INVENTIVE_PRINCIPLE_IDS).optional(),
    warningCode: vine.enum(TRIZ_ANALYSIS_WARNING_CODES).optional(),
    sort: vine.enum(MATRIX_SORT_FIELDS).optional(),
    sortDirection: vine.enum(SORT_DIRECTIONS).optional(),
  }),
)

/**
 * Handoff 输入校验器（§4.1）。
 * 禁止可执行字段（patch/mutations/sql/applyPlan/executablePatch）。
 */
export const handoffMatrixValidator = vine.compile(
  vine.object({
    target: vine.enum(['workbench', 'draft_review']),
    organizationId: vine.number(),
    projectId: vine.number(),
    actorId: vine.number(),
    selectedCells: vine.array(vine.string()),
    selectedTensions: vine.array(vine.string()),
    sourceRefs: vine.array(
      vine.object({
        sourceType: vine.enum(['contradiction', 'triz_analysis', 'rationale', 'workbench']),
        ref: vine.string(),
        hash: vine.string().nullable(),
        title: vine.string(),
        severity: vine.enum(['critical', 'high', 'medium', 'low']).nullable().optional(),
        stale: vine.boolean(),
        isAiGenerated: vine.boolean(),
        isFallback: vine.boolean(),
        warningCodes: vine.array(vine.string()),
      }),
    ),
    sourceHashes: vine.array(vine.string()),
    selectedParameterKeys: vine.array(vine.enum(PROJECT_PARAMETER_KEYS)),
    selectedPrincipleIds: vine.array(vine.enum(INVENTIVE_PRINCIPLE_IDS)),
    warningSummary: vine.object({
      total: vine.number(),
      blocking: vine.number(),
      warning: vine.number(),
      info: vine.number(),
      codes: vine.array(vine.string()),
    }),
    idempotencyKey: vine.string().minLength(1).maxLength(256),
    note: vine.string().nullable().optional(),
  }),
)
