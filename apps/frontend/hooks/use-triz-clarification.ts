'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { trizClarificationApi } from '@/lib/api/triz-clarification'
import type { AnalyzeWithTrizRequest } from '@/lib/api/triz-clarification'
import type { AnalyzeProjectIntentResponse } from '@aiproj/types'

export const TRIZ_CLARIFICATION_KEYS = {
  all: ['triz-clarification'] as const,
  analyze: () => [...TRIZ_CLARIFICATION_KEYS.all, 'analyze'] as const,
} as const

export function useAnalyzeTrizClarification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: TRIZ_CLARIFICATION_KEYS.analyze(),
    mutationFn: (data: AnalyzeWithTrizRequest) => trizClarificationApi.analyze(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRIZ_CLARIFICATION_KEYS.all })
    },
  })
}

export function useTrizClarificationCards(response: AnalyzeProjectIntentResponse | undefined) {
  if (!response) return []
  return trizClarificationApi.extractTrizCards(response)
}
