// 组织资源池 API client（v3-organization-resource-pool §6.1）。
// TanStack Query keys + API fetch helpers。
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type {
  OrganizationResourcePoolSummary,
  OrganizationResourcePoolResourceRow,
  OrganizationResourcePoolCapacityMatrix,
  OrganizationResourcePoolSkillItem,
  OrganizationResourcePoolConflict,
  OrganizationResourcePoolDemandGap,
  OrganizationResourcePoolQuery,
  OrganizationResourcePoolEnvelope,
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

const poolPath = (organizationId: number) => `/organizations/${organizationId}/resource-pool`

// ── API ─────────────────────────────────────────────────────────────────────

export const organizationResourcePoolApi = {
  catalogue: (organizationId: number) =>
    apiFetch<OrganizationResourcePoolSummary>(`${poolPath(organizationId)}/catalogue`),

  summary: (organizationId: number, query: OrganizationResourcePoolQuery = {}) =>
    apiFetch<OrganizationResourcePoolSummary>(
      `${poolPath(organizationId)}/summary${buildQuery(query as Record<string, unknown>)}`,
    ),

  resources: (organizationId: number, query: OrganizationResourcePoolQuery = {}) =>
    apiFetchEnvelope<OrganizationResourcePoolEnvelope<OrganizationResourcePoolResourceRow[]>>(
      `${poolPath(organizationId)}/resources${buildQuery(query as Record<string, unknown>)}`,
    ),

  skills: (organizationId: number, query: OrganizationResourcePoolQuery = {}) =>
    apiFetch<OrganizationResourcePoolSkillItem[]>(
      `${poolPath(organizationId)}/skills${buildQuery(query as Record<string, unknown>)}`,
    ),

  capacity: (organizationId: number, query: OrganizationResourcePoolQuery = {}) =>
    apiFetch<OrganizationResourcePoolCapacityMatrix>(
      `${poolPath(organizationId)}/capacity${buildQuery(query as Record<string, unknown>)}`,
    ),

  conflicts: (organizationId: number, query: OrganizationResourcePoolQuery = {}) =>
    apiFetchEnvelope<OrganizationResourcePoolEnvelope<OrganizationResourcePoolConflict[]>>(
      `${poolPath(organizationId)}/conflicts${buildQuery(query as Record<string, unknown>)}`,
    ),

  demandGaps: (organizationId: number, query: OrganizationResourcePoolQuery = {}) =>
    apiFetchEnvelope<OrganizationResourcePoolEnvelope<OrganizationResourcePoolDemandGap[]>>(
      `${poolPath(organizationId)}/demand-gaps${buildQuery(query as Record<string, unknown>)}`,
    ),

  drillDown: (
    organizationId: number,
    params: {
      kind: string
      targetId?: number
      resourceId?: number
      projectId?: number
      taskId?: number
    },
  ) =>
    apiFetch<unknown>(
      `${poolPath(organizationId)}/drill-down${buildQuery(params as Record<string, unknown>)}`,
    ),
}

// ── TanStack Query Keys ────────────────────────────────────────────────────

export const organizationResourcePoolKeys = {
  all: ['organization-resource-pool'] as const,
  catalogue: (organizationId: number) =>
    [...organizationResourcePoolKeys.all, 'catalogue', organizationId] as const,
  summary: (organizationId: number, query: OrganizationResourcePoolQuery = {}) =>
    [...organizationResourcePoolKeys.all, 'summary', organizationId, query] as const,
  resources: (organizationId: number, query: OrganizationResourcePoolQuery = {}) =>
    [...organizationResourcePoolKeys.all, 'resources', organizationId, query] as const,
  skills: (organizationId: number, query: OrganizationResourcePoolQuery = {}) =>
    [...organizationResourcePoolKeys.all, 'skills', organizationId, query] as const,
  capacity: (organizationId: number, query: OrganizationResourcePoolQuery = {}) =>
    [...organizationResourcePoolKeys.all, 'capacity', organizationId, query] as const,
  conflicts: (organizationId: number, query: OrganizationResourcePoolQuery = {}) =>
    [...organizationResourcePoolKeys.all, 'conflicts', organizationId, query] as const,
  demandGaps: (organizationId: number, query: OrganizationResourcePoolQuery = {}) =>
    [...organizationResourcePoolKeys.all, 'demandGaps', organizationId, query] as const,
  drillDown: (organizationId: number, params: Record<string, unknown> = {}) =>
    [...organizationResourcePoolKeys.all, 'drillDown', organizationId, params] as const,
}
