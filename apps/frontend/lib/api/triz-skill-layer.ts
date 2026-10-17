/**
 * TRIZ Skill Layer API client (v3-triz-skill-layer-integration §4.1)
 */
import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  TrizSkillLayerSummary,
  TrizSkillLayerDestinationsResponse,
  TrizRoutePreviewRequest,
  TrizRoutePreviewResponse,
  TrizHandoffPreviewRequest,
  TrizHandoffPreviewResponse,
} from '@aiproj/types'

export interface TrizSkillLayerDestinationsParams {
  stage?: string
  availability?: string
  sort?: string
  page?: number
  perPage?: number
}

export async function fetchTrizSkillLayerSummary(
  projectId: number | string,
): Promise<{ data: TrizSkillLayerSummary }> {
  return apiFetchEnvelope<{ data: TrizSkillLayerSummary }>(
    `/projects/${projectId}/triz/skill-layer/summary`,
  )
}

export async function fetchTrizSkillLayerDestinations(
  projectId: number | string,
  params?: TrizSkillLayerDestinationsParams,
): Promise<TrizSkillLayerDestinationsResponse> {
  const searchParams = new URLSearchParams()
  if (params?.stage) searchParams.set('stage', params.stage)
  if (params?.availability) searchParams.set('availability', params.availability)
  if (params?.sort) searchParams.set('sort', params.sort)
  if (params?.page) searchParams.set('page', String(params.page))
  if (params?.perPage) searchParams.set('perPage', String(params.perPage))

  const qs = searchParams.toString()
  const url = `/projects/${projectId}/triz/skill-layer/destinations${qs ? `?${qs}` : ''}`
  return apiFetchEnvelope<TrizSkillLayerDestinationsResponse>(url)
}

export async function postTrizSkillLayerRoutePreview(
  projectId: number | string,
  input: TrizRoutePreviewRequest,
): Promise<{ data: TrizRoutePreviewResponse }> {
  return apiFetchEnvelope<{ data: TrizRoutePreviewResponse }>(
    `/projects/${projectId}/triz/skill-layer/route-preview`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export async function postTrizSkillLayerHandoffPreview(
  projectId: number | string,
  input: TrizHandoffPreviewRequest,
): Promise<{ data: TrizHandoffPreviewResponse }> {
  return apiFetchEnvelope<{ data: TrizHandoffPreviewResponse }>(
    `/projects/${projectId}/triz/skill-layer/handoff-preview`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}
