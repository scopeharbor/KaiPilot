/**
 * v3-ocr-provider-observability-cost-controls — 前端 API 客户端。
 *
 * 项目级 OCR provider observability 只读查询。
 */

import { apiFetch } from '@/lib/api-client'
import type {
  OcrProviderObservabilitySummary,
  OcrProviderObservabilityEventList,
  OcrProviderObservabilityFilters,
} from '@aiproj/types'

export function fetchOcrProviderObservabilitySummary(
  projectId: number | string,
): Promise<{ data: OcrProviderObservabilitySummary }> {
  return apiFetch<{ data: OcrProviderObservabilitySummary }>(
    `/projects/${projectId}/ocr/provider-observability/summary`,
  )
}

export function fetchOcrProviderObservabilityEvents(
  projectId: number | string,
  filters?: OcrProviderObservabilityFilters,
): Promise<{
  data: OcrProviderObservabilityEventList['data']
  meta: OcrProviderObservabilityEventList['meta']
}> {
  const params = new URLSearchParams()
  if (filters?.ocrJobId) params.set('ocrJobId', String(filters.ocrJobId))
  if (filters?.provider) params.set('provider', filters.provider)
  if (filters?.model) params.set('model', filters.model)
  if (filters?.status) params.set('status', filters.status)
  if (filters?.errorCategory) params.set('errorCategory', filters.errorCategory)
  if (filters?.timeWindowStart) params.set('timeWindowStart', filters.timeWindowStart)
  if (filters?.timeWindowEnd) params.set('timeWindowEnd', filters.timeWindowEnd)
  if (filters?.page) params.set('page', String(filters.page))
  if (filters?.perPage) params.set('perPage', String(filters.perPage))

  const qs = params.toString()
  return apiFetch<{
    data: OcrProviderObservabilityEventList['data']
    meta: OcrProviderObservabilityEventList['meta']
  }>(`/projects/${projectId}/ocr/provider-observability/events${qs ? `?${qs}` : ''}`)
}
