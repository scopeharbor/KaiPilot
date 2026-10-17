'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  triggerAiSuggestions,
  acceptAiSuggestion,
  rejectAiSuggestion,
  type AiMarker,
  type RiskCategory,
} from '@/lib/api/risks'

const riskKeys = {
  all: ['risks'] as const,
  lists: () => [...riskKeys.all, 'list'] as const,
}

export function useTriggerAiSuggestions(projectId: number) {
  return useMutation({
    mutationFn: () => triggerAiSuggestions(projectId),
  })
}

export function useAcceptAiSuggestion(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      title: string
      description: string
      category: RiskCategory
      probability: number
      impact: number
      mitigation?: string
      aiMarker: AiMarker
      suggestionBatchId: string
      modifiedByUser?: boolean
    }) => acceptAiSuggestion(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskKeys.lists() })
    },
  })
}

export function useRejectAiSuggestion(projectId: number) {
  return useMutation({
    mutationFn: (batchId: string) => rejectAiSuggestion(projectId, batchId),
  })
}
