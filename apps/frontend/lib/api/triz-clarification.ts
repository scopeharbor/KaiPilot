import { apiFetch } from '@/lib/api-client'
import type {
  AnalyzeProjectIntentRequest,
  AnalyzeProjectIntentResponse,
  TrizClarificationAnswer,
} from '@aiproj/types'

export interface AnalyzeWithTrizRequest extends AnalyzeProjectIntentRequest {
  trizAnswers?: TrizClarificationAnswer[]
}

export const trizClarificationApi = {
  analyze: (data: AnalyzeWithTrizRequest) =>
    apiFetch<AnalyzeProjectIntentResponse>('/ai/project-intents/analyze', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  extractTrizCards: (response: AnalyzeProjectIntentResponse) => {
    return response.cards.filter(
      (card) => (card as unknown as Record<string, unknown>).source === 'triz',
    )
  },
}
