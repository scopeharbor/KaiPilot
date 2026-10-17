import type {
  AiM0EvaluationMode,
  AiM0EvaluationOutcome,
  AiM0EvaluationStep,
  AiM0Strategy,
} from '@aiproj/types'
import { apiFetch, apiFetchEnvelope, apiRawFetch } from '@/lib/api-client'

export interface EvaluationPlanResponse {
  steps: AiM0EvaluationStep[]
  inputSetHash: string
  total: number
  repetitions: number
  temperature: number
}

export const aiM0EvaluationApi = {
  async plan(mode: AiM0EvaluationMode, repetitions?: number): Promise<EvaluationPlanResponse> {
    const envelope = await apiFetchEnvelope<{
      data: AiM0EvaluationStep[]
      meta: Omit<EvaluationPlanResponse, 'steps'>
    }>('/dev/ai-m0/evaluation/plan', {
      method: 'POST',
      body: JSON.stringify({ mode, repetitions }),
    })
    return { steps: envelope.data, ...envelope.meta }
  },

  execute(input: {
    stepId: string
    inputId: string
    requestedStrategy: AiM0Strategy
    repetition: number
    mode: AiM0EvaluationMode
    connectionId?: number
  }) {
    return apiFetch<AiM0EvaluationOutcome>('/dev/ai-m0/evaluation/execute', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  stream(
    input: {
      sentence: string
      strategy: AiM0Strategy
      inputId?: string
      temperature: number
      connectionId?: number
      streamId?: string
    },
    lastEventId = '0',
  ) {
    return apiRawFetch('/dev/ai-m0/generate/stream', {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Last-Event-ID': lastEventId },
      body: JSON.stringify(input),
    })
  },
}
