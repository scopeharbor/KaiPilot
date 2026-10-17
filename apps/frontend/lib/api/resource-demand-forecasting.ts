import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  ResourceDemandForecastQuery,
  ForecastSummaryResponse,
  ForecastDemandCurveResponse,
  ForecastGapAnalysisResponse,
  ForecastProjectDriversResponse,
  ForecastSkillDriversResponse,
  ForecastTrendBaselineResponse,
  ForecastDrillDownResponseEnvelope,
  ForecastDrillDownQuery,
  ForecastAiAdvisoryResponse,
} from '@aiproj/types'

const BASE = '/organizations/:organizationId/resource-demand-forecasting'

function resolveBase(organizationId: number): string {
  return BASE.replace(':organizationId', String(organizationId))
}

export const resourceDemandForecastingKeys = {
  all: ['resource-demand-forecasting'] as const,
  summary: (orgId: number, query?: Partial<ResourceDemandForecastQuery>) =>
    [...resourceDemandForecastingKeys.all, orgId, 'summary', query ?? {}] as const,
  demandCurves: (orgId: number, query?: Partial<ResourceDemandForecastQuery>) =>
    [...resourceDemandForecastingKeys.all, orgId, 'demand-curves', query ?? {}] as const,
  gapAnalysis: (orgId: number, query?: Partial<ResourceDemandForecastQuery>) =>
    [...resourceDemandForecastingKeys.all, orgId, 'gap-analysis', query ?? {}] as const,
  projectDrivers: (orgId: number, query?: Partial<ResourceDemandForecastQuery>) =>
    [...resourceDemandForecastingKeys.all, orgId, 'project-drivers', query ?? {}] as const,
  skillDrivers: (orgId: number, query?: Partial<ResourceDemandForecastQuery>) =>
    [...resourceDemandForecastingKeys.all, orgId, 'skill-drivers', query ?? {}] as const,
  trendBaseline: (orgId: number, query?: Partial<ResourceDemandForecastQuery>) =>
    [...resourceDemandForecastingKeys.all, orgId, 'trend-baseline', query ?? {}] as const,
  drillDown: (orgId: number, drillDownQuery: ForecastDrillDownQuery) =>
    [...resourceDemandForecastingKeys.all, orgId, 'drill-down', drillDownQuery] as const,
  aiAdvisory: (orgId: number) =>
    [...resourceDemandForecastingKeys.all, orgId, 'ai-advisory'] as const,
}

// ── Summary ──────────────────────────────────────────────────────────────

export async function fetchForecastSummary(
  organizationId: number,
  query?: Partial<ResourceDemandForecastQuery>,
): Promise<ForecastSummaryResponse['data']> {
  const result = await apiFetchEnvelope<ForecastSummaryResponse>(
    `${resolveBase(organizationId)}/summary${buildQuery(query)}`,
  )
  return result.data
}

// ── Demand Curves ────────────────────────────────────────────────────────

export async function fetchForecastDemandCurves(
  organizationId: number,
  query?: Partial<ResourceDemandForecastQuery>,
): Promise<ForecastDemandCurveResponse['data']> {
  const result = await apiFetchEnvelope<ForecastDemandCurveResponse>(
    `${resolveBase(organizationId)}/demand-curves${buildQuery(query)}`,
  )
  return result.data
}

// ── Gap Analysis ────────────────────────────────────────────────────────

export async function fetchForecastGapAnalysis(
  organizationId: number,
  query?: Partial<ResourceDemandForecastQuery>,
): Promise<ForecastGapAnalysisResponse['data']> {
  const result = await apiFetchEnvelope<ForecastGapAnalysisResponse>(
    `${resolveBase(organizationId)}/gap-analysis${buildQuery(query)}`,
  )
  return result.data
}

// ── Project Drivers ──────────────────────────────────────────────────────

export async function fetchForecastProjectDrivers(
  organizationId: number,
  query?: Partial<ResourceDemandForecastQuery>,
): Promise<{
  data: ForecastProjectDriversResponse['data']
  meta: ForecastProjectDriversResponse['meta']
}> {
  return apiFetchEnvelope<{
    data: ForecastProjectDriversResponse['data']
    meta: ForecastProjectDriversResponse['meta']
  }>(`${resolveBase(organizationId)}/project-drivers${buildQuery(query)}`)
}

// ── Skill Drivers ────────────────────────────────────────────────────────

export async function fetchForecastSkillDrivers(
  organizationId: number,
  query?: Partial<ResourceDemandForecastQuery>,
): Promise<{
  data: ForecastSkillDriversResponse['data']
  meta: ForecastSkillDriversResponse['meta']
}> {
  return apiFetchEnvelope<{
    data: ForecastSkillDriversResponse['data']
    meta: ForecastSkillDriversResponse['meta']
  }>(`${resolveBase(organizationId)}/skill-drivers${buildQuery(query)}`)
}

// ── Trend Baseline ───────────────────────────────────────────────────────

export async function fetchForecastTrendBaseline(
  organizationId: number,
  query?: Partial<ResourceDemandForecastQuery>,
): Promise<ForecastTrendBaselineResponse['data']> {
  const result = await apiFetchEnvelope<ForecastTrendBaselineResponse>(
    `${resolveBase(organizationId)}/trend-baseline${buildQuery(query)}`,
  )
  return result.data
}

// ── Drill-Down ──────────────────────────────────────────────────────────

export async function fetchForecastDrillDown(
  organizationId: number,
  drillDownQuery: ForecastDrillDownQuery,
): Promise<ForecastDrillDownResponseEnvelope['data']> {
  const sp = new URLSearchParams()
  sp.set('targetType', drillDownQuery.targetType)
  sp.set('targetId', drillDownQuery.targetId)
  if (drillDownQuery.gapType) sp.set('gapType', drillDownQuery.gapType)
  if (drillDownQuery.role) sp.set('role', drillDownQuery.role)
  if (drillDownQuery.skill) sp.set('skill', drillDownQuery.skill)
  if (drillDownQuery.projectId) sp.set('projectId', drillDownQuery.projectId)
  if (drillDownQuery.bucketStart) sp.set('bucketStart', drillDownQuery.bucketStart)
  if (drillDownQuery.bucketEnd) sp.set('bucketEnd', drillDownQuery.bucketEnd)
  const result = await apiFetchEnvelope<ForecastDrillDownResponseEnvelope>(
    `${resolveBase(organizationId)}/drill-down?${sp.toString()}`,
  )
  return result.data
}

// ── AI Advisory ──────────────────────────────────────────────────────────

export async function fetchForecastAiAdvisory(
  organizationId: number,
): Promise<ForecastAiAdvisoryResponse['data']> {
  const result = await apiFetchEnvelope<ForecastAiAdvisoryResponse>(
    `${resolveBase(organizationId)}/ai-advisory`,
  )
  return result.data
}

// ── Query Builder ────────────────────────────────────────────────────────

function buildQuery(query?: Partial<ResourceDemandForecastQuery>): string {
  const sp = new URLSearchParams()
  if (query?.startDate) sp.set('startDate', query.startDate)
  if (query?.endDate) sp.set('endDate', query.endDate)
  if (query?.granularity) sp.set('granularity', query.granularity)
  if (query?.projectIds?.length) sp.set('projectIds', query.projectIds.join(','))
  if (query?.roles?.length) sp.set('roles', query.roles.join(','))
  if (query?.skills?.length) sp.set('skills', query.skills.join(','))
  if (query?.departments?.length) sp.set('departments', query.departments.join(','))
  if (query?.loadStatuses?.length) sp.set('loadStatuses', query.loadStatuses.join(','))
  if (query?.confidenceThreshold) sp.set('confidenceThreshold', query.confidenceThreshold)
  if (query?.method) sp.set('method', query.method)
  if (query?.topN) sp.set('topN', String(query.topN))
  if (query?.sort) sp.set('sort', query.sort)
  if (query?.sortDir) sp.set('sortDir', query.sortDir)
  if (query?.page) sp.set('page', String(query.page))
  if (query?.perPage) sp.set('perPage', String(query.perPage))
  if (query?.freshnessThresholdSeconds)
    sp.set('freshnessThresholdSeconds', String(query.freshnessThresholdSeconds))
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}
