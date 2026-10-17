/**
 * AI-TRIZ 助手 TanStack Query hooks (v3-ai-triz-assistant §6.2)
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchAssistantRuns,
  fetchAssistantRunDetail,
  postAssistantSubmitMessage,
  postAssistantFeedback,
  postAssistantPreview,
} from '@/lib/api/triz-assistant'
import type {
  AiTrizAssistantSubmitRequest,
  AiTrizAssistantResponse,
  AiTrizAssistantFeedbackRequest,
  AiTrizAssistantFeedbackResponse,
  AiTrizAssistantPreviewRequest,
  AiTrizAssistantPreviewResponse,
  AiTrizAssistantListRunsQuery,
} from '@aiproj/types'

// ── Query Keys ──

export const assistantKeys = {
  all: (projectId: number | string) => ['assistant', projectId] as const,
  runs: (projectId: number | string, params?: AiTrizAssistantListRunsQuery) =>
    [...assistantKeys.all(projectId), 'runs', params] as const,
  runDetail: (projectId: number | string, runId: string) =>
    [...assistantKeys.all(projectId), 'run', runId] as const,
}

// ── Queries ──

export function useAssistantRuns(
  projectId: number | string,
  params?: AiTrizAssistantListRunsQuery,
) {
  return useQuery({
    queryKey: assistantKeys.runs(projectId, params),
    queryFn: () => fetchAssistantRuns(projectId, params),
    enabled: !!projectId,
  })
}

export function useAssistantRunDetail(projectId: number | string, runId: string) {
  return useQuery({
    queryKey: assistantKeys.runDetail(projectId, runId),
    queryFn: () => fetchAssistantRunDetail(projectId, runId),
    enabled: !!projectId && !!runId,
  })
}

// ── Mutations ──

export function useSubmitAssistantMessage(projectId: number | string) {
  const queryClient = useQueryClient()

  return useMutation<{ data: AiTrizAssistantResponse }, Error, AiTrizAssistantSubmitRequest>({
    mutationFn: (input) => postAssistantSubmitMessage(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: assistantKeys.all(projectId) })
    },
  })
}

export function useAssistantFeedback(projectId: number | string, runId: string) {
  const queryClient = useQueryClient()

  return useMutation<
    { data: AiTrizAssistantFeedbackResponse },
    Error,
    AiTrizAssistantFeedbackRequest
  >({
    mutationFn: (input) => postAssistantFeedback(projectId, runId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: assistantKeys.runDetail(projectId, runId) })
    },
  })
}

export function useAssistantPreview(projectId: number | string) {
  return useMutation<
    { data: AiTrizAssistantPreviewResponse },
    Error,
    AiTrizAssistantPreviewRequest
  >({
    mutationFn: (input) => postAssistantPreview(projectId, input),
  })
}
