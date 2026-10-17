// apps/backend/app/validators/bi_aggregation.ts
// v3-bi-data-aggregation-service §3.3-3.4：BI aggregation Vine validator。
//
// 白名单参数校验：拒绝 SQL、公式、脚本、JSONPath、GraphQL、外部 URL、prompt、
// 模型输出、未注册 field、跨组织引用和超限参数。

import vine from '@vinejs/vine'
import {
  BI_AGGREGATION_SCOPE_VALUES,
  BI_AGGREGATION_METRIC_KEY_VALUES,
  BI_AGGREGATION_DIMENSION_KEY_VALUES,
  BI_AGGREGATION_WINDOW_VALUES,
  BI_AGGREGATION_GRAIN_VALUES,
  BI_AGGREGATION_COMPARE_MODE_VALUES,
  BI_AGGREGATION_SORT_KEY_VALUES,
  BI_AGGREGATION_MAX_METRIC_KEYS,
  BI_AGGREGATION_MAX_DIMENSIONS,
  BI_AGGREGATION_MAX_FILTERS,
  BI_AGGREGATION_MAX_PER_PAGE,
} from '@aiproj/types'
import { isUnsupportedBiAggregationMetricKey } from '@aiproj/types'

// ─── Rejection patterns ────────────────────────────────────────────────

const REJECTION_PATTERNS = [
  /\bSELECT\b/i,
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bDROP\b/i,
  /\bUNION\b/i,
  /\bEXEC\b/i,
  /\bSCRIPT\b/i,
  /\bEVAL\b/i,
  /\bREQUIRE\b/i,
  /\bIMPORT\b/i,
  /\bFETCH\b/i,
  /\bXMLHTTP/i,
  /\bWEBSOCKET\b/i,
  /\bPROMPT\b/i,
  /\bMODEL\b/i,
  /\bOUTPUT\b/i,
  /\bTOKEN\b/i,
  /\bAPI.?KEY\b/i,
  /\bJSONPATH\b/i,
  /\bGRAPHQL\b/i,
  /\bCURL\b/i,
  /\bHTTP/i,
  /\bHTTPS:/i,
  /\$\./,
  /\$\(/,
  /\(\)\s*=>/,
  /function\s*\(/,
  /class\s+\w+\s*\{/,
  /\.\.\/|%2e%2e%2f/i,
]

/** 检查字符串是否包含被禁止的表达式 */
function isUnsafeString(value: string): boolean {
  for (const pattern of REJECTION_PATTERNS) {
    if (pattern.test(value)) return true
  }
  return false
}

// ─── Field validators ──────────────────────────────────────────────────

const scope = () => vine.enum(BI_AGGREGATION_SCOPE_VALUES)

const metricKey = () => vine.enum(BI_AGGREGATION_METRIC_KEY_VALUES)

const dimensionKey = () => vine.enum(BI_AGGREGATION_DIMENSION_KEY_VALUES)

const windowVal = () => vine.enum(BI_AGGREGATION_WINDOW_VALUES)

const grainVal = () => vine.enum(BI_AGGREGATION_GRAIN_VALUES)

const compareMode = () => vine.enum(BI_AGGREGATION_COMPARE_MODE_VALUES)

const sortKey = () => vine.enum(BI_AGGREGATION_SORT_KEY_VALUES)

const sortDir = () => vine.enum(['asc', 'desc'])

// ─── Filter validator ──────────────────────────────────────────────────

const filterSchema = vine.object({
  dimension: dimensionKey(),
  operator: vine.enum(['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'between']),
  value: vine.unionOfTypes([vine.string().trim(), vine.number(), vine.boolean()]),
  values: vine.array(vine.unionOfTypes([vine.string().trim(), vine.number()])).optional(),
  valueEnd: vine.number().optional(),
})

// ─── Params validator ──────────────────────────────────────────────────

/** 路由参数：organizationId 必须是正整数 */
export const biAggregationParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

// ─── Query validator ──────────────────────────────────────────────────

/** 查询参数白名单 */
export const biAggregationQueryValidator = vine.compile(
  vine.object({
    scope: scope().optional(),
    metricKeys: vine.array(metricKey()).minLength(1).maxLength(BI_AGGREGATION_MAX_METRIC_KEYS),
    dimensions: vine.array(dimensionKey()).maxLength(BI_AGGREGATION_MAX_DIMENSIONS).optional(),
    filters: vine.array(filterSchema).maxLength(BI_AGGREGATION_MAX_FILTERS).optional(),
    window: windowVal().optional(),
    grain: grainVal().optional(),
    compareWith: compareMode().optional(),
    sort: sortKey().optional(),
    sortDir: sortDir().optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(BI_AGGREGATION_MAX_PER_PAGE).optional(),
    includeSources: vine.boolean().optional(),
    includeEvidence: vine.boolean().optional(),
  }),
)

// ─── CSV parser ────────────────────────────────────────────────────────

/** 解析逗号分隔或数组形式的 query string 参数 */
export function parseBiAggregationCsvParam(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const list = Array.isArray(raw)
    ? raw.map((item) => String(item))
    : String(raw)
        .split(',')
        .map((item) => item.trim())
  const cleaned = list.filter((item) => item.length > 0)
  return cleaned.length > 0 ? cleaned : undefined
}

// ─── Query normalizer ──────────────────────────────────────────────────

/**
 * 将 query string 中的 CSV 参数展开为数组，供验证器消费。
 * 同时做不安全输入检测。
 */
export function normalizeBiAggregationQuery(qs: Record<string, unknown>): Record<string, unknown> {
  const out = { ...qs }

  for (const key of ['metricKeys', 'dimensions']) {
    const val = parseBiAggregationCsvParam(qs[key])
    if (val !== undefined) out[key] = val
  }

  for (const key of ['scope', 'window', 'grain', 'compareWith', 'sort', 'sortDir']) {
    if (typeof qs[key] === 'string' && qs[key] !== '') {
      out[key] = qs[key]
    }
  }

  for (const key of ['includeSources', 'includeEvidence']) {
    if (qs[key] === 'true') out[key] = true
    else if (qs[key] === 'false') out[key] = false
  }

  if (qs['page'] !== undefined) out['page'] = Number(qs['page'])
  if (qs['perPage'] !== undefined) out['perPage'] = Number(qs['perPage'])

  return out
}

// ─── Unsafe input detector ─────────────────────────────────────────────

/**
 * 对查询参数做不安全输入深度扫描。
 * 返回非法字段名列表，空列表表示安全。
 */
export function detectUnsafeBiAggregationInput(qs: Record<string, unknown>): string[] {
  const unsafe: string[] = []

  function scan(value: unknown, path: string) {
    if (typeof value === 'string') {
      if (isUnsafeString(value)) {
        unsafe.push(path)
      }
    } else if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) {
        scan(item, `${path}[${i}]`)
      }
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        scan(v, `${path}.${k}`)
      }
    }
  }

  scan(qs, 'query')
  return unsafe
}

// ─── Cross-validation ──────────────────────────────────────────────────

/** 交叉校验：检查财务类 unsupported 指标 */
export function checkUnsupportedBiAggregationMetrics(metricKeys: string[]): string[] {
  return metricKeys.filter((k) => isUnsupportedBiAggregationMetricKey(k))
}
