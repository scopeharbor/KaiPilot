/**
 * v3-knowledge-memory-operating-layer —— 知识与记忆运营层 API 客户端。
 *
 * 三个 GET endpoint + surface resolve 第四个 GET；URL state 在前端用
 * `parseOperatingUrlState`（来自 `@aiproj/types`）做语义校验，与后端
 * Validator 完全一致（避免 split 行为）。
 *
 * feature flag off 时所有调用由 `isKnowledgeMemoryOperatingLayerEnabled`
 * 在上层 `useKnowledgeMemoryOperating` hooks 内短路，**本文件不感知 flag**。
 *
 * 严格只读；零 mutation。
 */
import { apiFetch } from '@/lib/api-client'
import type {
  KnowledgeMemoryOperatingKind,
  KnowledgeMemoryOperatingScope,
  KnowledgeMemoryOperatingStatus,
  KnowledgeMemoryOperatingSurface,
  KnowledgeMemoryOperatingItem,
  KnowledgeMemoryOperatingDetail,
  OperatingOwningSurfaceDescriptor,
  OperatingSummary,
  OperatingListEnvelope,
} from '@aiproj/types'

export interface KnowledgeMemoryOperatingListQuery {
  attention?: KnowledgeMemoryOperatingStatus
  kind?: KnowledgeMemoryOperatingKind
  scope?: KnowledgeMemoryOperatingScope
  status?: KnowledgeMemoryOperatingStatus
  sort?: 'attentionPriority' | 'attentionAt' | 'kind' | 'scopedRef'
  order?: 'desc' | 'asc'
  page?: number
  perPage?: number
}

function buildQs(qs: KnowledgeMemoryOperatingListQuery): string {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(qs as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue
    out.set(k, String(v))
  }
  const s = out.toString()
  return s ? `?${s}` : ''
}

export interface KnowledgeMemoryOperatingSummaryResponse {
  data: OperatingSummary
}

export interface KnowledgeMemoryOperatingListResponse {
  data: OperatingListEnvelope
}

export interface KnowledgeMemoryOperatingDetailResponse {
  data: KnowledgeMemoryOperatingDetail
}

export interface KnowledgeMemoryOperatingSurfaceResponse {
  data: OperatingOwningSurfaceDescriptor
}

export const knowledgeMemoryOperatingApi = {
  /** GET /api/v1/knowledge-memory/summary */
  summary: () => apiFetch<KnowledgeMemoryOperatingSummaryResponse>('/knowledge-memory/summary'),

  /** GET /api/v1/knowledge-memory/items */
  list: (query: KnowledgeMemoryOperatingListQuery = {}) =>
    apiFetch<KnowledgeMemoryOperatingListResponse>(`/knowledge-memory/items${buildQs(query)}`),

  /** GET /api/v1/knowledge-memory/items/:kind/:scopedRef */
  detail: (kind: KnowledgeMemoryOperatingKind, scopedRef: string) =>
    apiFetch<KnowledgeMemoryOperatingDetailResponse>(
      `/knowledge-memory/items/${encodeURIComponent(kind)}/${encodeURIComponent(scopedRef)}`,
    ),

  /** GET /api/v1/knowledge-memory/items/:kind/:scopedRef/surfaces/:surface */
  surface: (
    kind: KnowledgeMemoryOperatingKind,
    scopedRef: string,
    surface: KnowledgeMemoryOperatingSurface,
  ) =>
    apiFetch<KnowledgeMemoryOperatingSurfaceResponse>(
      `/knowledge-memory/items/${encodeURIComponent(kind)}/${encodeURIComponent(scopedRef)}/surfaces/${encodeURIComponent(surface)}`,
    ),
}

/** 客户端知识与记忆运营层判别器（前端缓存/UI 分类使用）。 */
export function isOperatingKind(value: string): value is KnowledgeMemoryOperatingKind {
  return (
    value === 'knowledge_item' ||
    value === 'copilot_memory' ||
    value === 'skill_knowledge_draft' ||
    value === 'retrieval_signal'
  )
}

export function isOperatingStatus(value: string): value is KnowledgeMemoryOperatingStatus {
  return (
    value === 'ready' ||
    value === 'needs_review' ||
    value === 'stale_or_unconfirmed' ||
    value === 'conflict' ||
    value === 'provenance_gap' ||
    value === 'synthetic_eval_only' ||
    value === 'retention_attention' ||
    value === 'retrieval_gap' ||
    value === 'degraded'
  )
}

export function isOperatingSurface(value: string): value is KnowledgeMemoryOperatingSurface {
  return (
    value === 'knowledge_review' ||
    value === 'copilot_memory_governance' ||
    value === 'skill_knowledge_authoring' ||
    value === 'retrieval_observation_detail'
  )
}

export type {
  KnowledgeMemoryOperatingItem,
  KnowledgeMemoryOperatingKind,
  KnowledgeMemoryOperatingStatus,
  KnowledgeMemoryOperatingSurface,
  OperatingSummary,
  OperatingListEnvelope,
  OperatingOwningSurfaceDescriptor,
  KnowledgeMemoryOperatingDetail,
}
