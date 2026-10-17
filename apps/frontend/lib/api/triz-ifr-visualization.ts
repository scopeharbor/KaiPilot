/**
 * v3-triz-ifr-visualization —— IFR API client（tasks 5.1 P0）。
 */

import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  IfrPreviewResponse,
  IfrListResponse,
  IfrDetailResponse,
  IfrAiDraftResponse,
  IfrFreshnessResponse,
  IfrHandoffCandidateResponse,
  IfrSaveRequest,
  IfrAiDraftRequest,
  IfrHandoffRequest,
} from '@aiproj/types'

const BASE = (projectId: number) => `/projects/${projectId}/triz/ifr-visualizations`

export const trizIfrApi = {
  async getPreview(
    projectId: number,
    params?: {
      currentState?: string
      idealState?: string
      usefulFunction?: number
      cost?: number
      harm?: number
    },
  ): Promise<IfrPreviewResponse> {
    const searchParams = new URLSearchParams()
    if (params?.currentState) searchParams.set('currentState', params.currentState)
    if (params?.idealState) searchParams.set('idealState', params.idealState)
    if (params?.usefulFunction !== undefined)
      searchParams.set('usefulFunction', String(params.usefulFunction))
    if (params?.cost !== undefined) searchParams.set('cost', String(params.cost))
    if (params?.harm !== undefined) searchParams.set('harm', String(params.harm))

    const qs = searchParams.toString()
    const url = `${BASE(projectId)}/preview${qs ? `?${qs}` : ''}`
    return apiFetchEnvelope<IfrPreviewResponse>(url)
  },

  async list(projectId: number, page = 1, perPage = 20): Promise<IfrListResponse> {
    const url = `${BASE(projectId)}?page=${page}&perPage=${perPage}`
    return apiFetchEnvelope<IfrListResponse>(url)
  },

  async detail(projectId: number, ifrId: string): Promise<IfrDetailResponse> {
    const url = `${BASE(projectId)}/${ifrId}`
    return apiFetchEnvelope<IfrDetailResponse>(url)
  },

  async save(projectId: number, body: IfrSaveRequest): Promise<IfrDetailResponse> {
    const url = `${BASE(projectId)}`
    return apiFetchEnvelope<IfrDetailResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  },

  async aiDraft(projectId: number, body: IfrAiDraftRequest): Promise<IfrAiDraftResponse> {
    const url = `${BASE(projectId)}/ai-draft`
    return apiFetchEnvelope<IfrAiDraftResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  },

  async freshness(projectId: number, ifrId: string): Promise<IfrFreshnessResponse> {
    const url = `${BASE(projectId)}/${ifrId}/freshness`
    return apiFetchEnvelope<IfrFreshnessResponse>(url)
  },

  async handoffPreview(
    projectId: number,
    ifrId: string,
    body: IfrHandoffRequest,
  ): Promise<IfrHandoffCandidateResponse> {
    const url = `${BASE(projectId)}/${ifrId}/handoff-preview`
    return apiFetchEnvelope<IfrHandoffCandidateResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  },

  async handoffCandidate(
    projectId: number,
    ifrId: string,
    body: IfrHandoffRequest,
  ): Promise<IfrHandoffCandidateResponse> {
    const url = `${BASE(projectId)}/${ifrId}/handoff-candidate`
    return apiFetchEnvelope<IfrHandoffCandidateResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
