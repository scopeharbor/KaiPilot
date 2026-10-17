import { apiFetch } from '@/lib/api-client'
import type { ObservabilitySummary } from '@aiproj/compiler-spec'

export interface CompilerRunSummaryResponse {
  data: ObservabilitySummary
}

export const compilerApi = {
  /** 查询 Compiler run 可观测摘要。 */
  getObservabilitySummary: (runId: number) =>
    apiFetch<CompilerRunSummaryResponse>(`/ai/compiler/runs/${runId}/observability-summary`),
}
