import vine from '@vinejs/vine'
import {
  DOCUMENT_INTELLIGENCE_ATTENTION_FACETS,
  DOCUMENT_INTELLIGENCE_SOURCE_KINDS,
  DOCUMENT_INTELLIGENCE_DIMENSION_STATES,
  DOCUMENT_INTELLIGENCE_SORT_KEYS,
  DOCUMENT_INTELLIGENCE_MAX_PER_PAGE,
} from '@aiproj/types'

/**
 * 文档智能工作台查询验证器（v3-document-intelligence-workbench §3.15）。
 *
 * 红线：attention/sourceKind/capability/status/sort/page/perPage/source refs
 * 全部封闭枚举或正整数；搜索长度有界；未知字段拒绝——非法参数一律
 * VALIDATION_ERROR，绝不退化为无界扫描。
 */

/** 列表分页上限（服务层扫描预算之外的第二道闸） */
export const DOCUMENT_INTELLIGENCE_VALIDATOR_MAX_PER_PAGE = DOCUMENT_INTELLIGENCE_MAX_PER_PAGE

/** 路由参数：projectId / sourceId 必须为正整数 */
export const documentIntelligenceParamsValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
  }),
)

export const documentIntelligenceSourceParamsValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    sourceKind: vine.enum(DOCUMENT_INTELLIGENCE_SOURCE_KINDS),
    sourceId: vine.number().positive(),
  }),
)

/** 允许的查询键白名单（vine 默认剥离未知键，这里补一道显式拒绝） */
export const DOCUMENT_INTELLIGENCE_ALLOWED_QUERY_KEYS = [
  'attention',
  'sourceKind',
  'capability',
  'status',
  'sort',
  'direction',
  'page',
  'perPage',
  'search',
] as const

/**
 * 显式拒绝白名单之外的查询键（任务 3.16「额外字段」）。
 * 必须在 validateUsing/validate 之前调用——vine 会静默剥离未知字段。
 */
export function assertOnlyAllowedQueryKeys(qs: Record<string, unknown>): void {
  for (const key of Object.keys(qs)) {
    if (!(DOCUMENT_INTELLIGENCE_ALLOWED_QUERY_KEYS as readonly string[]).includes(key)) {
      throw new Error(`VALIDATION_ERROR: 不支持的查询参数 ${key}`)
    }
  }
}

/** GET /document-intelligence/sources 查询白名单 */
export const documentIntelligenceListQueryValidator = vine.compile(
  vine.object({
    attention: vine.enum(DOCUMENT_INTELLIGENCE_ATTENTION_FACETS).optional(),
    sourceKind: vine.enum(DOCUMENT_INTELLIGENCE_SOURCE_KINDS).optional(),
    capability: vine.enum(['ocr_supported', 'document_body']).optional(),
    status: vine.enum(DOCUMENT_INTELLIGENCE_DIMENSION_STATES).optional(),
    sort: vine.enum(DOCUMENT_INTELLIGENCE_SORT_KEYS).optional(),
    direction: vine.enum(['asc', 'desc']).optional(),
    page: vine.number().positive().max(10000).optional(),
    perPage: vine.number().positive().max(DOCUMENT_INTELLIGENCE_VALIDATOR_MAX_PER_PAGE).optional(),
    search: vine
      .string()
      .trim()
      .maxLength(80)
      .regex(/^[^<>"';\\]*$/)
      .optional(),
  }),
)
