import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  ResourceSkillMatrixQuery,
  ResourceSkillMatrixSummaryResponse,
  ResourceSkillMatrixResponse,
  ResourceSkillMatrixCoverageResponse,
  ResourceSkillMatrixGapsResponse,
  ResourceSkillMatrixCandidatesResponse,
  ResourceSkillMatrixSkillDetailResponse,
  ResourceSkillMatrixDrillDownResponse,
} from '@aiproj/types'

const BASE = '/organizations/:organizationId/resource-skill-matrix'

function resolveBase(organizationId: number): string {
  return BASE.replace(':organizationId', String(organizationId))
}

export const resourceSkillMatrixKeys = {
  all: ['resource-skill-matrix'] as const,
  summary: (orgId: number, query?: ResourceSkillMatrixQuery) =>
    [...resourceSkillMatrixKeys.all, orgId, 'summary', query ?? {}] as const,
  matrix: (orgId: number, query?: ResourceSkillMatrixQuery) =>
    [...resourceSkillMatrixKeys.all, orgId, 'matrix', query ?? {}] as const,
  coverage: (orgId: number, query?: ResourceSkillMatrixQuery) =>
    [...resourceSkillMatrixKeys.all, orgId, 'coverage', query ?? {}] as const,
  gaps: (orgId: number, query?: ResourceSkillMatrixQuery) =>
    [...resourceSkillMatrixKeys.all, orgId, 'gaps', query ?? {}] as const,
  candidates: (orgId: number, skillKey: string, query?: ResourceSkillMatrixQuery) =>
    [...resourceSkillMatrixKeys.all, orgId, 'candidates', skillKey, query ?? {}] as const,
  skillDetail: (orgId: number, skillKey: string) =>
    [...resourceSkillMatrixKeys.all, orgId, 'skill-detail', skillKey] as const,
  drillDown: (orgId: number, itemType: string, skillKey: string) =>
    [...resourceSkillMatrixKeys.all, orgId, 'drill-down', itemType, skillKey] as const,
}

export async function fetchResourceSkillMatrixSummary(
  organizationId: number,
  query?: ResourceSkillMatrixQuery,
): Promise<ResourceSkillMatrixSummaryResponse> {
  const result = await apiFetchEnvelope<{ data: ResourceSkillMatrixSummaryResponse }>(
    `${resolveBase(organizationId)}/summary${buildQuery(query)}`,
  )
  return result.data
}

export async function fetchResourceSkillMatrix(
  organizationId: number,
  query?: ResourceSkillMatrixQuery,
): Promise<ResourceSkillMatrixResponse> {
  const result = await apiFetchEnvelope<{ data: ResourceSkillMatrixResponse }>(
    `${resolveBase(organizationId)}/matrix${buildQuery(query)}`,
  )
  return result.data
}

export async function fetchResourceSkillMatrixCoverage(
  organizationId: number,
  query?: ResourceSkillMatrixQuery,
): Promise<{
  coverages: ResourceSkillMatrixCoverageResponse['coverages']
  meta: ResourceSkillMatrixCoverageResponse['meta']
}> {
  const result = await apiFetchEnvelope<{
    data: {
      coverages: ResourceSkillMatrixCoverageResponse['coverages']
      meta: ResourceSkillMatrixCoverageResponse['meta']
    }
  }>(`${resolveBase(organizationId)}/coverage${buildQuery(query)}`)
  return result.data
}

export async function fetchResourceSkillMatrixGaps(
  organizationId: number,
  query?: ResourceSkillMatrixQuery,
): Promise<{
  gaps: ResourceSkillMatrixGapsResponse['gaps']
  meta: ResourceSkillMatrixGapsResponse['meta']
}> {
  const result = await apiFetchEnvelope<{
    data: {
      gaps: ResourceSkillMatrixGapsResponse['gaps']
      meta: ResourceSkillMatrixGapsResponse['meta']
    }
  }>(`${resolveBase(organizationId)}/gaps${buildQuery(query)}`)
  return result.data
}

export async function fetchResourceSkillMatrixCandidates(
  organizationId: number,
  skillKey: string,
  query?: ResourceSkillMatrixQuery,
): Promise<{
  skillKey: string
  candidates: ResourceSkillMatrixCandidatesResponse['candidates']
  meta: ResourceSkillMatrixCandidatesResponse['meta']
}> {
  const result = await apiFetchEnvelope<{
    data: {
      skillKey: string
      candidates: ResourceSkillMatrixCandidatesResponse['candidates']
      meta: ResourceSkillMatrixCandidatesResponse['meta']
    }
  }>(
    `${resolveBase(organizationId)}/candidates?skillKey=${encodeURIComponent(skillKey)}${buildQuerySuffix(query)}`,
  )
  return result.data
}

export async function fetchResourceSkillMatrixSkillDetail(
  organizationId: number,
  skillKey: string,
): Promise<ResourceSkillMatrixSkillDetailResponse> {
  const result = await apiFetchEnvelope<{ data: ResourceSkillMatrixSkillDetailResponse }>(
    `${resolveBase(organizationId)}/skill-detail?skillKey=${encodeURIComponent(skillKey)}`,
  )
  return result.data
}

export async function fetchResourceSkillMatrixDrillDown(
  organizationId: number,
  itemType: 'resource' | 'task_requirement' | 'project',
  skillKey: string,
): Promise<ResourceSkillMatrixDrillDownResponse> {
  const result = await apiFetchEnvelope<{
    data: { items: ResourceSkillMatrixDrillDownResponse['items'] }
    meta: ResourceSkillMatrixDrillDownResponse['meta']
  }>(
    `${resolveBase(organizationId)}/drill-down?itemType=${encodeURIComponent(itemType)}&skillKey=${encodeURIComponent(skillKey)}`,
  )
  // 后端把 `meta` 放在 `data` 的兄弟键上：只 `return result.data` 会把 `meta` 整块丢掉。
  return { items: result.data.items, meta: result.meta }
}

function buildQuery(query?: ResourceSkillMatrixQuery): string {
  const sp = new URLSearchParams()
  if (query?.scope) sp.set('scope', query.scope)
  if (query?.projectIds?.length) sp.set('projectIds', query.projectIds.join(','))
  if (query?.skillKeys?.length) sp.set('skillKeys', query.skillKeys.join(','))
  if (query?.resourceStatuses?.length) sp.set('resourceStatuses', query.resourceStatuses.join(','))
  if (query?.requirementStatuses?.length)
    sp.set('requirementStatuses', query.requirementStatuses.join(','))
  if (query?.includeSkillAdvisory !== undefined)
    sp.set('includeSkillAdvisory', String(query.includeSkillAdvisory))
  if (query?.from) sp.set('from', query.from)
  if (query?.to) sp.set('to', query.to)
  if (query?.topN) sp.set('topN', String(query.topN))
  if (query?.groupBy) sp.set('groupBy', query.groupBy)
  if (query?.sort) sp.set('sort', query.sort)
  if (query?.search) sp.set('search', query.search)
  if (query?.page) sp.set('page', String(query.page))
  if (query?.perPage) sp.set('perPage', String(query.perPage))
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

function buildQuerySuffix(query?: ResourceSkillMatrixQuery): string {
  const sp = new URLSearchParams()
  if (query?.scope) sp.set('scope', query.scope)
  if (query?.projectIds?.length) sp.set('projectIds', query.projectIds.join(','))
  if (query?.from) sp.set('from', query.from)
  if (query?.to) sp.set('to', query.to)
  if (query?.sort) sp.set('sort', query.sort)
  if (query?.page) sp.set('page', String(query.page))
  if (query?.perPage) sp.set('perPage', String(query.perPage))
  const qs = sp.toString()
  return qs ? `&${qs}` : ''
}
