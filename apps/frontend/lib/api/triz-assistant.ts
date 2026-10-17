/**
 * AI-TRIZ 助手 API client (v3-ai-triz-assistant §6.1)
 */
import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  AiTrizAssistantSubmitRequest,
  AiTrizAssistantResponse,
  AiTrizAssistantRunDetail,
  AiTrizAssistantFeedbackRequest,
  AiTrizAssistantFeedbackResponse,
  AiTrizAssistantPreviewRequest,
  AiTrizAssistantPreviewResponse,
  AiTrizAssistantListRunsResponse,
  AiTrizAssistantListRunsQuery,
} from '@aiproj/types'

export async function fetchAssistantRuns(
  projectId: number | string,
  params?: AiTrizAssistantListRunsQuery,
): Promise<AiTrizAssistantListRunsResponse> {
  const searchParams = new URLSearchParams()
  if (params?.page) searchParams.set('page', String(params.page))
  if (params?.perPage) searchParams.set('perPage', String(params.perPage))
  if (params?.status) searchParams.set('status', params.status)
  if (params?.sort) searchParams.set('sort', params.sort)

  const qs = searchParams.toString()
  const url = `/projects/${projectId}/triz/assistant/runs${qs ? `?${qs}` : ''}`
  return apiFetchEnvelope<AiTrizAssistantListRunsResponse>(url)
}

export async function fetchAssistantRunDetail(
  projectId: number | string,
  runId: string,
): Promise<{ data: AiTrizAssistantRunDetail }> {
  return apiFetchEnvelope<{ data: AiTrizAssistantRunDetail }>(
    `/projects/${projectId}/triz/assistant/runs/${runId}`,
  )
}

export async function postAssistantSubmitMessage(
  projectId: number | string,
  input: AiTrizAssistantSubmitRequest,
): Promise<{ data: AiTrizAssistantResponse }> {
  return apiFetchEnvelope<{ data: AiTrizAssistantResponse }>(
    `/projects/${projectId}/triz/assistant/submit`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export async function postAssistantFeedback(
  projectId: number | string,
  runId: string,
  input: AiTrizAssistantFeedbackRequest,
): Promise<{ data: AiTrizAssistantFeedbackResponse }> {
  return apiFetchEnvelope<{ data: AiTrizAssistantFeedbackResponse }>(
    `/projects/${projectId}/triz/assistant/runs/${runId}/feedback`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export async function postAssistantPreview(
  projectId: number | string,
  input: AiTrizAssistantPreviewRequest,
): Promise<{ data: AiTrizAssistantPreviewResponse }> {
  return apiFetchEnvelope<{ data: AiTrizAssistantPreviewResponse }>(
    `/projects/${projectId}/triz/assistant/preview`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}
