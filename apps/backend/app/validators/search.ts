import vine from '@vinejs/vine'
import {
  SEARCH_ENTITY_TYPES,
  SEARCH_SORT_FIELDS,
  SEARCH_SORT_DIRECTIONS,
  SEARCH_MAX_PER_PAGE,
  SEARCH_KEYWORD_MIN_LENGTH,
  SEARCH_KEYWORD_MAX_LENGTH,
  SEARCH_SCOPES,
} from '@aiproj/types'

/**
 * 高级搜索 Validator（v2-advanced-search）：
 * - keyword：关键词（可选，允许空关键词纯结构化筛选）
 * - entityTypes：实体类型数组（白名单校验）
 * - projectIds：项目 ID 数组
 * - status：状态数组
 * - assigneeIds：负责人/上传者 ID 数组
 * - tagIds：标签 ID 数组
 * - dateFrom / dateTo：时间范围
 * - scope：搜索范围（organization / project）
 * - sort：排序表达式数组
 * - page / perPage：分页参数
 */

export const searchValidator = vine.compile(
  vine.object({
    keyword: vine
      .string()
      .trim()
      .minLength(SEARCH_KEYWORD_MIN_LENGTH)
      .maxLength(SEARCH_KEYWORD_MAX_LENGTH)
      .optional(),

    entityTypes: vine
      .array(
        vine
          .string()
          .trim()
          .in([...SEARCH_ENTITY_TYPES]),
      )
      .optional(),

    projectIds: vine.array(vine.number().withoutDecimals().positive()).optional(),

    status: vine.array(vine.string().trim()).optional(),

    assigneeIds: vine.array(vine.number().withoutDecimals().positive()).optional(),

    tagIds: vine.array(vine.number().withoutDecimals().positive()).optional(),

    dateFrom: vine.string().trim().optional(),

    dateTo: vine.string().trim().optional(),

    scope: vine
      .string()
      .trim()
      .in([...SEARCH_SCOPES])
      .optional(),

    sort: vine
      .array(
        vine.object({
          field: vine
            .string()
            .trim()
            .in([...SEARCH_SORT_FIELDS]),
          direction: vine
            .string()
            .trim()
            .in([...SEARCH_SORT_DIRECTIONS]),
        }),
      )
      .optional(),

    page: vine.number().withoutDecimals().positive().optional(),

    perPage: vine.number().withoutDecimals().positive().max(SEARCH_MAX_PER_PAGE).optional(),
  }),
)

/**
 * 搜索建议 Validator（GET /api/v1/search/suggestions）。
 */
export const suggestionsValidator = vine.compile(
  vine.object({
    q: vine.string().trim().minLength(1).maxLength(100),
    limit: vine.number().withoutDecimals().positive().max(10).optional(),
  }),
)

/**
 * 导出上限供 controller 使用。
 */
export { SEARCH_MAX_PER_PAGE }
