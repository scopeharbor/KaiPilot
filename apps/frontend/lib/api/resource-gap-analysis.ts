// 资源缺口分析 API client（v3-resource-gap-analysis §8.1）。
// TanStack Query keys + API fetch helpers。
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type {
  ResourceGapSummary,
  ResourceGapEntry,
  ResourceGapExplanation,
  ResourceGapDrillDownResponse,
  ResourceGapQuery,
  ResourceGapEnvelope,
} from '@aiproj/types'

// ── API Helpers ────────────────────────────────────────────────────────────

function buildQuery(filters: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value))
    }
  }
  return query.size ? `?${query.toString()}` : ''
}

const gapPath = (organizationId: number) => `/organizations/${organizationId}/resource-gaps`

// ── Query Keys ──────────────────────────────────────────────────────────────

export const resourceGapKeys = {
  all: (organizationId: number) => ['resource-gaps', organizationId] as const,
  summary: (organizationId: number, query?: ResourceGapQuery) =>
    [...resourceGapKeys.all(organizationId), 'summary', query] as const,
  byRole: (organizationId: number, query?: ResourceGapQuery) =>
    [...resourceGapKeys.all(organizationId), 'by-role', query] as const,
  bySkill: (organizationId: number, query?: ResourceGapQuery) =>
    [...resourceGapKeys.all(organizationId), 'by-skill', query] as const,
  byTimebucket: (organizationId: number, query?: ResourceGapQuery) =>
    [...resourceGapKeys.all(organizationId), 'by-timebucket', query] as const,
  byProject: (organizationId: number, query?: ResourceGapQuery) =>
    [...resourceGapKeys.all(organizationId), 'by-project', query] as const,
  byPortfolio: (organizationId: number, query?: ResourceGapQuery) =>
    [...resourceGapKeys.all(organizationId), 'by-portfolio', query] as const,
  explanation: (organizationId: number, gapId: string, includeAi?: boolean) =>
    [...resourceGapKeys.all(organizationId), 'explanation', gapId, includeAi] as const,
  drillDown: (organizationId: number, gapId: string, sourceCapability?: string) =>
    [...resourceGapKeys.all(organizationId), 'drill-down', gapId, sourceCapability] as const,
}

// ── API ─────────────────────────────────────────────────────────────────────

export const resourceGapApi = {
  summary: (organizationId: number, query: ResourceGapQuery = {}) =>
    apiFetch<ResourceGapSummary>(
      `${gapPath(organizationId)}/summary${buildQuery(query as Record<string, unknown>)}`,
    ),

  byRole: (organizationId: number, query: ResourceGapQuery = {}) =>
    apiFetchEnvelope<ResourceGapEnvelope<ResourceGapEntry[]>>(
      `${gapPath(organizationId)}/by-role${buildQuery(query as Record<string, unknown>)}`,
    ),

  bySkill: (organizationId: number, query: ResourceGapQuery = {}) =>
    apiFetchEnvelope<ResourceGapEnvelope<ResourceGapEntry[]>>(
      `${gapPath(organizationId)}/by-skill${buildQuery(query as Record<string, unknown>)}`,
    ),

  byTimebucket: (organizationId: number, query: ResourceGapQuery = {}) =>
    apiFetchEnvelope<ResourceGapEnvelope<ResourceGapEntry[]>>(
      `${gapPath(organizationId)}/by-timebucket${buildQuery(query as Record<string, unknown>)}`,
    ),

  byProject: (organizationId: number, query: ResourceGapQuery = {}) =>
    apiFetchEnvelope<ResourceGapEnvelope<ResourceGapEntry[]>>(
      `${gapPath(organizationId)}/by-project${buildQuery(query as Record<string, unknown>)}`,
    ),

  byPortfolio: (organizationId: number, query: ResourceGapQuery = {}) =>
    apiFetchEnvelope<ResourceGapEnvelope<ResourceGapEntry[]>>(
      `${gapPath(organizationId)}/by-portfolio${buildQuery(query as Record<string, unknown>)}`,
    ),

  explanation: (organizationId: number, gapId: string, includeAi?: boolean) => {
    const params = new URLSearchParams({ gapId })
    if (includeAi) params.set('includeAi', 'true')
    return apiFetch<ResourceGapExplanation>(
      `${gapPath(organizationId)}/explanation?${params.toString()}`,
    )
  },

  drillDown: (organizationId: number, gapId: string, sourceCapability?: string) => {
    const params = new URLSearchParams({ gapId })
    if (sourceCapability) params.set('sourceCapability', sourceCapability)
    return apiFetch<ResourceGapDrillDownResponse>(
      `${gapPath(organizationId)}/drill-down?${params.toString()}`,
    )
  },
}
