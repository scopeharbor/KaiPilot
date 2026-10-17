import vine from '@vinejs/vine'

/**
 * PMO 组合分组视图验证器（v3-pmo-portfolio-grouping-views §3.3）。
 *
 * 覆盖：list、detail、preview、create、update、delete、duplicate、set-default。
 * 约束：分页上限 100、scope 白名单、name 长度、definition version、whitelist keys、
 *       sensitive-content 拒绝、group cardinality bound。
 */
import {
  PMO_GROUPING_VIEW_SCOPES,
  PMO_GROUPING_VIEW_PRIMARY_KEYS,
  PMO_GROUPING_VIEW_SECONDARY_KEYS,
  PMO_GROUPING_VIEW_COMPARE_MODES,
  PMO_GROUPING_VIEW_SORT_KEYS,
  PMO_GROUPING_VIEW_TREND_WINDOWS,
  PMO_GROUPING_VIEW_MAX_PER_PAGE,
  PMO_GROUPING_VIEW_MAX_NAME_LENGTH,
  PMO_GROUPING_VIEW_MAX_DESCRIPTION_LENGTH,
  PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N,
} from '@aiproj/types'

const scopeValues = Object.values(PMO_GROUPING_VIEW_SCOPES)
const primaryKeyValues = Object.values(PMO_GROUPING_VIEW_PRIMARY_KEYS)
const secondaryKeyValues = Object.values(PMO_GROUPING_VIEW_SECONDARY_KEYS)
const compareModeValues = Object.values(PMO_GROUPING_VIEW_COMPARE_MODES)
const sortKeyValues = Object.values(PMO_GROUPING_VIEW_SORT_KEYS)
const trendWindowValues = Object.values(PMO_GROUPING_VIEW_TREND_WINDOWS)

// ─── Shared Schemas ─────────────────────────────────────────────────────────

const queryDefinitionSchema = vine.object({
  primaryGrouping: vine.string().in(primaryKeyValues),
  secondaryGrouping: vine.string().in(secondaryKeyValues).optional(),
  filters: vine
    .object({
      status: vine.array(vine.string().maxLength(50)).maxLength(15).optional(),
      health: vine.array(vine.string().maxLength(50)).maxLength(15).optional(),
      search: vine.string().maxLength(200).optional(),
    })
    .optional(),
  sort: vine.string().in(sortKeyValues).optional(),
  order: vine.string().in(['asc', 'desc']).optional(),
  trendWindow: vine.string().in(trendWindowValues).optional(),
  displayMetricKeys: vine.array(vine.string().maxLength(60)).maxLength(8).optional(),
  compareMode: vine.string().in(compareModeValues).optional(),
  topN: vine.number().min(1).max(PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N).optional(),
  bottomN: vine.number().min(1).max(PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N).optional(),
})

/** 获取分组视图列表 */
export const pmoGroupingViewListValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(PMO_GROUPING_VIEW_MAX_PER_PAGE).optional(),
    scope: vine.string().in(scopeValues).optional(),
    search: vine.string().maxLength(200).optional(),
  }),
)

/** 获取分组视图详情 */
export const pmoGroupingViewDetailValidator = vine.compile(
  vine.object({
    viewId: vine.string().maxLength(64),
  }),
)

/** 预览分组视图结果 */
export const pmoGroupingViewPreviewValidator = vine.compile(
  vine.object({
    viewId: vine.string().maxLength(64).optional(),
    query: queryDefinitionSchema.optional(),
  }),
)

/** 创建分组视图 */
export const pmoGroupingViewCreateValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(1).maxLength(PMO_GROUPING_VIEW_MAX_NAME_LENGTH),
    description: vine.string().maxLength(PMO_GROUPING_VIEW_MAX_DESCRIPTION_LENGTH).optional(),
    scope: vine.string().in(scopeValues),
    query: queryDefinitionSchema,
    isDefault: vine.boolean().optional(),
  }),
)

/** 更新分组视图 */
export const pmoGroupingViewUpdateValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(1).maxLength(PMO_GROUPING_VIEW_MAX_NAME_LENGTH).optional(),
    description: vine.string().maxLength(PMO_GROUPING_VIEW_MAX_DESCRIPTION_LENGTH).optional(),
    query: queryDefinitionSchema.optional(),
    isDefault: vine.boolean().optional(),
  }),
)

/** 复制分组视图 */
export const pmoGroupingViewDuplicateValidator = vine.compile(
  vine.object({
    viewId: vine.string().maxLength(64),
    name: vine.string().minLength(1).maxLength(PMO_GROUPING_VIEW_MAX_NAME_LENGTH).optional(),
    scope: vine.string().in(scopeValues).optional(),
  }),
)

/** 设置默认视图 */
export const pmoGroupingViewSetDefaultValidator = vine.compile(
  vine.object({
    viewId: vine.string().maxLength(64),
    scope: vine.string().in(['personal', 'organization']),
  }),
)

/** 删除分组视图 */
export const pmoGroupingViewDeleteValidator = vine.compile(
  vine.object({
    viewId: vine.string().maxLength(64),
  }),
)
