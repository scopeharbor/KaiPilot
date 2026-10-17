/**
 * v3-ocr-provider-observability-cost-controls — TanStack Query hooks。
 *
 * 项目级 OCR provider observability 只读数据获取。
 */

import { useQuery } from '@tanstack/react-query'
import {
  fetchOcrProviderObservabilitySummary,
  fetchOcrProviderObservabilityEvents,
} from '@/lib/api/ocr-provider-observability'
import type { OcrProviderObservabilityFilters } from '@aiproj/types'

export const OCR_PROVIDER_OBSERVABILITY_KEYS = {
  root: ['ocr', 'provider-observability'] as const,
  summary: (projectId: number | string) =>
    [...OCR_PROVIDER_OBSERVABILITY_KEYS.root, 'summary', projectId] as const,
  events: (projectId: number | string, filters?: OcrProviderObservabilityFilters) =>
    [...OCR_PROVIDER_OBSERVABILITY_KEYS.root, 'events', projectId, filters ?? {}] as const,
}

export function useOcrProviderObservabilitySummary(projectId: number | string, enabled = true) {
  return useQuery({
    queryKey: OCR_PROVIDER_OBSERVABILITY_KEYS.summary(projectId),
    queryFn: () => fetchOcrProviderObservabilitySummary(projectId),
    enabled: enabled && !!projectId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  })
}

export function useOcrProviderObservabilityEvents(
  projectId: number | string,
  filters?: OcrProviderObservabilityFilters,
  enabled = true,
) {
  return useQuery({
    queryKey: OCR_PROVIDER_OBSERVABILITY_KEYS.events(projectId, filters),
    queryFn: () => fetchOcrProviderObservabilityEvents(projectId, filters),
    enabled: enabled && !!projectId,
    staleTime: 15_000,
    retry: 1,
  })
}
