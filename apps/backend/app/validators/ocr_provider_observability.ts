/**
 * v3-ocr-provider-observability-cost-controls — OCR provider observability 验证器。
 *
 * 只读摘要与事件列表的过滤参数校验。
 */

import vine from '@vinejs/vine'

export const ocrProviderObservabilitySummarySchema = vine.compile(
  vine.object({
    // 摘要查询无额外参数，projectId 在路由中。
  }),
)

export const ocrProviderObservabilityEventsSchema = vine.compile(
  vine.object({
    ocrJobId: vine.number().positive().optional(),
    provider: vine.string().maxLength(128).optional(),
    model: vine.string().maxLength(128).optional(),
    status: vine.string().optional(),
    errorCategory: vine.string().optional(),
    timeWindowStart: vine.string().optional(),
    timeWindowEnd: vine.string().optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().range([1, 100]).optional(),
  }),
)
