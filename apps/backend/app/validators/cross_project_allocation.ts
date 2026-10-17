import vine from '@vinejs/vine'
import {
  CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_VALUES,
  CROSS_PROJECT_ALLOCATION_DRAFT_STATUS_VALUES,
  CROSS_PROJECT_ALLOCATION_ITEM_TYPE_VALUES,
  CROSS_PROJECT_ALLOCATION_SORT_KEY_VALUES,
  CROSS_PROJECT_ALLOCATION_MAX_PER_PAGE,
  CROSS_PROJECT_ALLOCATION_MAX_TOP_N,
  CROSS_PROJECT_ALLOCATION_MAX_SEARCH_LENGTH,
  CROSS_PROJECT_ALLOCATION_MAX_PROJECT_SCOPE,
  CROSS_PROJECT_ALLOCATION_MIN_PERCENT,
  CROSS_PROJECT_ALLOCATION_MAX_PERCENT,
} from '@aiproj/types'

/**
 * 跨项目资源调配验证器（v3-cross-project-resource-allocation §4.1）。
 */

const isoDate = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)

const draftStatus = () => vine.enum(CROSS_PROJECT_ALLOCATION_DRAFT_STATUS_VALUES)

const sortKey = () => vine.enum(CROSS_PROJECT_ALLOCATION_SORT_KEY_VALUES)

const conflictSeverity = () => vine.enum(CROSS_PROJECT_ALLOCATION_CONFLICT_SEVERITY_VALUES)

const itemType = () => vine.enum(CROSS_PROJECT_ALLOCATION_ITEM_TYPE_VALUES)

// ─── 路由参数 ──────────────────────────────────────────────────────────────

export const crossProjectAllocationParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

// ─── 创建草案 ──────────────────────────────────────────────────────────────

export const createDraftValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255),
    projectIds: vine
      .array(vine.number().positive())
      .maxLength(CROSS_PROJECT_ALLOCATION_MAX_PROJECT_SCOPE),
    dateWindow: vine.object({
      from: isoDate(),
      to: isoDate(),
    }),
    resourceTypes: vine.array(vine.string().trim()).optional(),
    roles: vine.array(vine.string().trim()).optional(),
    skillTags: vine.array(vine.string().trim()).optional(),
    departments: vine.array(vine.string().trim()).optional(),
    loadStatuses: vine.array(vine.string().trim()).optional(),
    topN: vine.number().positive().max(CROSS_PROJECT_ALLOCATION_MAX_TOP_N).optional(),
    freshnessThresholdMinutes: vine.number().positive().max(1440).optional(),
  }),
)

// ─── 更新草案 items ────────────────────────────────────────────────────

const draftItemSchema = vine.object({
  id: vine.string().trim().optional(),
  itemType: itemType(),
  targetProjectId: vine.number().positive(),
  targetTaskId: vine.number().positive().optional(),
  candidateResourceId: vine.number().positive().optional(),
  allocationPercent: vine
    .number()
    .min(CROSS_PROJECT_ALLOCATION_MIN_PERCENT)
    .max(CROSS_PROJECT_ALLOCATION_MAX_PERCENT),
  startDate: isoDate(),
  endDate: isoDate(),
  source: vine.enum(['rule', 'manual']).optional(),
})

export const updateDraftItemsValidator = vine.compile(
  vine.object({
    items: vine.array(draftItemSchema).minLength(1).maxLength(200),
  }),
)

// ─── 列表查询 ──────────────────────────────────────────────────────────────

export const listDraftsValidator = vine.compile(
  vine.object({
    status: draftStatus().optional(),
    projectIds: vine.string().trim().optional(), // comma-separated
    dateFrom: isoDate().optional(),
    dateTo: isoDate().optional(),
    search: vine.string().trim().maxLength(CROSS_PROJECT_ALLOCATION_MAX_SEARCH_LENGTH).optional(),
    sort: sortKey().optional(),
    order: vine.enum(['asc', 'desc']).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(CROSS_PROJECT_ALLOCATION_MAX_PER_PAGE).optional(),
  }),
)

// ─── 获取单个草案 ──────────────────────────────────────────────────────────

export const getDraftValidator = vine.compile(
  vine.object({
    draftId: vine.number().positive(),
  }),
)

// ─── 候选资源查询 ──────────────────────────────────────────────────────────

export const listCandidatesValidator = vine.compile(
  vine.object({
    dateFrom: isoDate(),
    dateTo: isoDate(),
    projectIds: vine
      .array(vine.number().positive())
      .maxLength(CROSS_PROJECT_ALLOCATION_MAX_PROJECT_SCOPE)
      .optional(),
    skillTags: vine.array(vine.string().trim()).optional(),
    roles: vine.array(vine.string().trim()).optional(),
    resourceTypes: vine.array(vine.string().trim()).optional(),
    loadStatuses: vine.array(vine.string().trim()).optional(),
    topN: vine.number().positive().max(CROSS_PROJECT_ALLOCATION_MAX_TOP_N).optional(),
    freshnessThresholdMinutes: vine.number().positive().max(1440).optional(),
  }),
)

// ─── 预览草案 ──────────────────────────────────────────────────────────────

export const previewDraftValidator = vine.compile(
  vine.object({
    draftId: vine.number().positive(),
  }),
)

// ─── 确认草案 ──────────────────────────────────────────────────────────────

export const confirmDraftValidator = vine.compile(
  vine.object({
    draftId: vine.number().positive(),
    idempotencyKey: vine.string().trim().maxLength(128),
    warningsAcknowledged: vine.array(vine.string().trim()).optional(),
  }),
)

// ─── 应用确认草案 ──────────────────────────────────────────────────────────

export const applyDraftValidator = vine.compile(
  vine.object({
    draftId: vine.number().positive(),
    idempotencyKey: vine.string().trim().maxLength(128),
  }),
)

// ─── 取消草案 ──────────────────────────────────────────────────────────────

export const cancelDraftValidator = vine.compile(
  vine.object({
    draftId: vine.number().positive(),
  }),
)

// ─── 冲突查询 ──────────────────────────────────────────────────────────────

export const listConflictsValidator = vine.compile(
  vine.object({
    draftId: vine.number().positive(),
    severity: conflictSeverity().optional(),
  }),
)

// ─── 下钻查询 ──────────────────────────────────────────────────────────────

export const drillDownValidator = vine.compile(
  vine.object({
    kind: vine.enum(['project', 'task', 'resource', 'allocation', 'conflict', 'evidence']),
    targetId: vine.number().positive(),
    projectId: vine.number().positive().optional(),
    resourceId: vine.number().positive().optional(),
  }),
)

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

/** 解析逗号分隔的 projectIds */
export function parseProjectIdsParam(raw: unknown): number[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const str = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw)
  const ids = str
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return ids.length > 0 ? ids : undefined
}
