/**
 * v3-ai-automated-evaluation —— 评测评分聚合查询参数校验。
 */
import vine from '@vinejs/vine'

const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/

export const evaluationScoreQueryValidator = vine.compile(
  vine.object({
    dimension: vine.string().optional(),
    windowStart: vine.string().regex(iso8601Regex),
    windowEnd: vine.string().regex(iso8601Regex),
    groupBy: vine.string().optional(),
  }),
)
