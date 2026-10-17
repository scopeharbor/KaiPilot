import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type {
  ResourceContentionQuery,
  ResourceContentionSummary,
  ResourceContentionItem,
  ResourceContentionMatrix,
  ResourceContentionEvidence,
  ResourceContentionSuggestionPreview,
  ResourceContentionEnvelope,
} from '@aiproj/types'

function buildQuery(filters: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== null) {
      query.set(key, String(value))
    }
  }
  return query.size ? `?${query.toString()}` : ''
}

const organizationContentions = (organizationId: number) =>
  `/organizations/${organizationId}/resource-contentions`

export const resourceContentionApi = {
  /** 争用摘要 */
  summary: (organizationId: number, query?: ResourceContentionQuery) =>
    apiFetch<ResourceContentionSummary>(
      `${organizationContentions(organizationId)}/summary${buildQuery((query ?? {}) as Record<string, unknown>)}`,
    ),

  /** 争用列表 */
  items: (organizationId: number, query?: ResourceContentionQuery) =>
    apiFetchEnvelope<ResourceContentionEnvelope<ResourceContentionItem[]>>(
      `${organizationContentions(organizationId)}/items${buildQuery((query ?? {}) as Record<string, unknown>)}`,
    ),

  /** 争用矩阵 */
  matrix: (organizationId: number, query?: ResourceContentionQuery) =>
    apiFetch<ResourceContentionMatrix>(
      `${organizationContentions(organizationId)}/matrix${buildQuery((query ?? {}) as Record<string, unknown>)}`,
    ),

  /** 争用详情 */
  detail: (organizationId: number, contentionId: string, query?: { from?: string; to?: string }) =>
    apiFetch<ResourceContentionItem>(
      `${organizationContentions(organizationId)}/${contentionId}${buildQuery((query ?? {}) as Record<string, unknown>)}`,
    ),

  /** 低敏证据 */
  evidence: (organizationId: number, contentionId: string) =>
    apiFetch<ResourceContentionEvidence>(
      `${organizationContentions(organizationId)}/${contentionId}/evidence`,
    ),

  /** 建议预览 */
  suggestions: (organizationId: number, contentionId: string, kind: 'rule' | 'ai' = 'rule') =>
    apiFetch<ResourceContentionSuggestionPreview[]>(
      `${organizationContentions(organizationId)}/${contentionId}/suggestions?kind=${kind}`,
    ),
}

export const resourceContentionKeys = {
  all: ['resource-contentions'] as const,
  summary: (organizationId: number, query?: ResourceContentionQuery) =>
    [...resourceContentionKeys.all, 'summary', organizationId, query] as const,
  items: (organizationId: number, query?: ResourceContentionQuery) =>
    [...resourceContentionKeys.all, 'items', organizationId, query] as const,
  matrix: (organizationId: number, query?: ResourceContentionQuery) =>
    [...resourceContentionKeys.all, 'matrix', organizationId, query] as const,
  detail: (organizationId: number, contentionId: string) =>
    [...resourceContentionKeys.all, 'detail', organizationId, contentionId] as const,
  evidence: (organizationId: number, contentionId: string) =>
    [...resourceContentionKeys.all, 'evidence', organizationId, contentionId] as const,
  suggestions: (organizationId: number, contentionId: string) =>
    [...resourceContentionKeys.all, 'suggestions', organizationId, contentionId] as const,
}
