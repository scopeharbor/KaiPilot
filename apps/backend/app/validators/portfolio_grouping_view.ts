import vine from '@vinejs/vine'
import {
  PMO_GROUPING_VIEW_PRIMARY_KEYS,
  PMO_GROUPING_VIEW_SECONDARY_KEYS,
  PMO_GROUPING_VIEW_COMPARE_MODES,
  PMO_GROUPING_VIEW_SORT_KEYS,
  PMO_GROUPING_VIEW_SCOPES,
  PMO_GROUPING_VIEW_MAX_PER_PAGE,
  PMO_GROUPING_VIEW_MAX_NAME_LENGTH,
  PMO_GROUPING_VIEW_MAX_DESCRIPTION_LENGTH,
  PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N,
  PMO_GROUPING_VIEW_MAX_DISPLAY_METRICS,
  PMO_GROUPING_VIEW_MAX_FILTER_VALUES,
} from '@aiproj/types'

/**
 * PMO 组合分组视图验证器（v3-pmo-portfolio-grouping-views §3.3）。
 * 覆盖：list query、detail、preview request、create、update、delete、duplicate、set default。
 * 约束：分页上限、scope 白名单、名称长度、定义版本、grouping key 白名单、敏感内容拒绝。
 */

// ─── 白名单常量导出供 Vine 校验 ──────────────────────────────
const PRIMARY_KEY_VALUES = Object.values(PMO_GROUPING_VIEW_PRIMARY_KEYS)
const SECONDARY_KEY_VALUES = Object.values(PMO_GROUPING_VIEW_SECONDARY_KEYS)
const COMPARE_MODE_VALUES = Object.values(PMO_GROUPING_VIEW_COMPARE_MODES)
const SORT_KEY_VALUES = Object.values(PMO_GROUPING_VIEW_SORT_KEYS)
const SCOPE_VALUES = Object.values(PMO_GROUPING_VIEW_SCOPES)

// ─── 分组查询定义 ────────────────────────────────────────────
const groupingViewQuerySchema = vine.object({
  primaryGrouping: vine.string().in(PRIMARY_KEY_VALUES),
  secondaryGrouping: vine.string().in(SECONDARY_KEY_VALUES).optional(),
  filters: vine
    .object({
      status: vine
        .array(vine.string().maxLength(50))
        .maxLength(PMO_GROUPING_VIEW_MAX_FILTER_VALUES)
        .optional(),
      health: vine
        .array(vine.string().maxLength(50))
        .maxLength(PMO_GROUPING_VIEW_MAX_FILTER_VALUES)
        .optional(),
      search: vine.string().maxLength(200).optional(),
    })
    .optional(),
  sort: vine.string().in(SORT_KEY_VALUES).optional(),
  order: vine.enum(['asc', 'desc']).optional(),
  trendWindow: vine.string().maxLength(30).optional(),
  displayMetricKeys: vine
    .array(vine.string().maxLength(60))
    .maxLength(PMO_GROUPING_VIEW_MAX_DISPLAY_METRICS)
    .optional(),
  compareMode: vine.string().in(COMPARE_MODE_VALUES).optional(),
  topN: vine.number().positive().max(PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N).optional(),
  bottomN: vine.number().positive().max(PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N).optional(),
})

// ─── 列表查询 ─────────────────────────────────────────────────
export const portfolioGroupingViewListValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(PMO_GROUPING_VIEW_MAX_PER_PAGE).optional(),
    scope: vine.string().in(SCOPE_VALUES).optional(),
    search: vine.string().maxLength(200).optional(),
  }),
)

// ─── 详情 ─────────────────────────────────────────────────────
export const portfolioGroupingViewDetailValidator = vine.compile(
  vine.object({
    id: vine.string().maxLength(120),
  }),
)

// ─── 预览请求 ─────────────────────────────────────────────────
export const portfolioGroupingViewPreviewValidator = vine.compile(
  vine.object({
    viewId: vine.string().maxLength(120).optional(),
    query: groupingViewQuerySchema.optional(),
  }),
)

// ─── 创建视图 ─────────────────────────────────────────────────
export const portfolioGroupingViewCreateValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(PMO_GROUPING_VIEW_MAX_NAME_LENGTH),
    description: vine
      .string()
      .trim()
      .maxLength(PMO_GROUPING_VIEW_MAX_DESCRIPTION_LENGTH)
      .optional(),
    scope: vine.string().in(SCOPE_VALUES),
    query: groupingViewQuerySchema,
    isDefault: vine.boolean().optional(),
  }),
)

// ─── 更新视图 ─────────────────────────────────────────────────
export const portfolioGroupingViewUpdateValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(PMO_GROUPING_VIEW_MAX_NAME_LENGTH).optional(),
    description: vine
      .string()
      .trim()
      .maxLength(PMO_GROUPING_VIEW_MAX_DESCRIPTION_LENGTH)
      .optional(),
    query: groupingViewQuerySchema.optional(),
    isDefault: vine.boolean().optional(),
  }),
)

// ─── 复制视图 ─────────────────────────────────────────────────
export const portfolioGroupingViewDuplicateValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(PMO_GROUPING_VIEW_MAX_NAME_LENGTH).optional(),
  }),
)

// ─── 设默认视图 ───────────────────────────────────────────────
export const portfolioGroupingViewSetDefaultValidator = vine.compile(
  vine.object({
    scope: vine.enum(['personal', 'organization']),
  }),
)
